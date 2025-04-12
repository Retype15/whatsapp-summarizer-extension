// background.js - MODIFICADO v0.4.3 - i18n for errors

const MODEL_ID = 'gemini-1.5-flash';
const GENERATE_CONTENT_API = 'generateContent';

// --- Helper for i18n ---
function getMsg(key, substitutions = undefined) {
    try {
        // Check if chrome.i18n is available before using it
        if (chrome && chrome.i18n && chrome.i18n.getMessage) {
            return chrome.i18n.getMessage(key, substitutions) || key;
        }
        // Basic substitution fallback if needed for testing outside extension context
         if (substitutions && typeof substitutions === 'string') return key.replace("$1", substitutions);
         if (substitutions && Array.isArray(substitutions)) {
             let replaced = key;
             substitutions.forEach((sub, i) => { replaced = replaced.replace(`$${i+1}`, sub); });
             return replaced;
         }
        return key;
    } catch (e) {
        console.warn(`i18n Background Error getting key "${key}":`, e);
        return key; // Fallback to key on error
    }
}


// --- Default Prompts (Not translated, user customizable) ---
const DEFAULT_SUMMARY_PROMPT = `Por favor, resume concisamente la siguiente conversación de WhatsApp. Enfócate en los puntos clave y decisiones tomadas, si las hay:\n---\n{messages}\n---\nResumen conciso:`;
const DEFAULT_FOLLOW_UP_PROMPT = `Contexto de WhatsApp relevante (mensajes previos al resumen):
---------------------------------
{waContext}
---------------------------------

Basándote en el contexto anterior (si lo hay) y nuestra conversación actual, responde a la última pregunta del usuario.
Nuestra conversación:
---------------------------------
{aiHistory}
---------------------------------
IA:`;


// --- Function to get settings ---
async function getSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get({
            geminiApiKey: '',
            summaryPrompt: DEFAULT_SUMMARY_PROMPT,
            followUpPrompt: DEFAULT_FOLLOW_UP_PROMPT
        }, (items) => {
            if (chrome.runtime.lastError) {
                console.error("Background: Error loading settings:", chrome.runtime.lastError.message);
                resolve({
                    apiKey: '',
                    summaryPrompt: DEFAULT_SUMMARY_PROMPT,
                    followUpPrompt: DEFAULT_FOLLOW_UP_PROMPT
                });
            } else {
                 resolve({
                     apiKey: items.geminiApiKey || '',
                     summaryPrompt: items.summaryPrompt || DEFAULT_SUMMARY_PROMPT,
                     followUpPrompt: items.followUpPrompt || DEFAULT_FOLLOW_UP_PROMPT
                 });
            }
        });
    });
}


// --- Main Message Listener ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Background: Received message action:", message.action);

    async function handleMessage() {
        const settings = await getSettings();

        // Handle Options Page Request
        if (message.action === "openOptionsPage") {
            console.log("Background: Opening options page.");
            chrome.runtime.openOptionsPage();
            // No response needed for this action
            return; // Exit handler
        }

        // Check API Key for relevant actions
        const needsApiKey = ["processMessagesForSummary", "sendFollowUpMessage"].includes(message.action);
        if (needsApiKey && !settings.apiKey) {
            console.error("Background: Gemini API Key is not configured.");
            const errorMessage = getMsg("errorApiKeyNotConfigured"); // i18n
             // Try to send error back to content script via message
             if (sender.tab && sender.tab.id) {
                  try {
                      // Use a specific action for this error type
                      await chrome.tabs.sendMessage(sender.tab.id, {
                          action: "apiKeyMissingError",
                          error: errorMessage
                      });
                  } catch (error) { console.error("BG: Failed to send API key error to CS:", error.message); }
             }
             // Also send response back if the original message expects one (like processMessagesForSummary)
             if (message.action === "processMessagesForSummary") {
                sendResponse({ success: false, error: errorMessage });
             } else {
                 // For sendFollowUpMessage, we primarily communicate via tabs.sendMessage,
                 // but sending a failure response here might help popup.js if it initiated
                 // (though popup usually triggers 'triggerSummaryFromPopup')
                 // Check if sendResponse is even valid in this context before calling it.
                 // Safest to rely on the tabs.sendMessage above.
             }
             return; // Exit handler
        }


        // Handle Initial Summary Request
        if (message.action === "processMessagesForSummary") {
            const messages = message.data;
            console.log(`Background: Processing ${messages?.length || 0} messages for initial summary.`);
            if (!messages || messages.length === 0) {
                 sendResponse({ success: false, error: "No messages provided." }); // Keep internal errors brief
                 return;
            }
            const promptText = formatMessagesForGeminiSummary(messages, settings.summaryPrompt);

            try {
                const summary = await callGeminiAPI([{ role: 'user', parts: [{ text: promptText }] }], settings.apiKey);
                console.log("Background: Initial summary generated.");
                sendResponse({ success: true, summary: summary }); // Respond async
            } catch (error) {
                console.error("Background: Error calling Gemini for summary:", error);
                // Send the translated/formatted error message back
                sendResponse({ success: false, error: error.message || "Unknown API error" }); // Respond async
            }
            // Flow ends here for this action

        // Handle Follow-up Question
        } else if (message.action === "sendFollowUpMessage") {
            const { history: aiHistory = [], waContext = [] } = message.data;

            if (!aiHistory.length) {
                console.warn("Background: sendFollowUpMessage called without AI history.");
                // No response needed back to content script for this specific warning
                return; // Exit handler
            }

            console.log(`Background: Processing follow-up...`);
            const fullPromptText = buildFollowUpPrompt(waContext, aiHistory, settings.followUpPrompt);

             try {
                 const aiResponse = await callGeminiAPI([{ role: 'user', parts: [{ text: fullPromptText }] }], settings.apiKey);
                 console.log("Background: Follow-up response generated.");
                 // Send response back to content script via tabs.sendMessage
                 if (sender.tab && sender.tab.id) {
                      try {
                          await chrome.tabs.sendMessage(sender.tab.id, { action: "displayAiResponse", data: { response: aiResponse } });
                          console.log("BG: Follow-up response sent via tabs.sendMessage.");
                      } catch (error) {
                           console.error("BG: Error sending follow-up response to tab:", error.message);
                      }
                 } else { console.error("BG: No sender tab ID for follow-up response."); }
                 // NO sendResponse needed here

             } catch (error) {
                 console.error("Background: Error calling Gemini for follow-up:", error);
                 const errorMessage = error.message || "Unknown API error during follow-up"; // Use the error message from callGeminiAPI
                 // Attempt to send error message back to content script
                  if (sender.tab && sender.tab.id) {
                       try {
                           // Use the same action, let content script display it as error
                           await chrome.tabs.sendMessage(sender.tab.id, { action: "displayAiResponse", data: { response: errorMessage } });
                           console.log("BG: Follow-up error message sent via tabs.sendMessage.");
                       } catch (errorMsg) { console.error("BG: Error sending error message to tab:", errorMsg.message); }
                  }
                 // NO sendResponse needed here
             }
            // Flow ends here for this action

        } else {
             console.log("Background: Unhandled action:", message.action);
             // Optionally send a response for unhandled actions if needed by the sender
             // sendResponse({ success: false, error: `Unhandled action: ${message.action}`});
        }
    } // End of async handleMessage

    // Execute the handler
    handleMessage().catch(e => { // Catch any unhandled promise rejections within handleMessage
         console.error("Background: Uncaught error in handleMessage:", e);
         // Try to inform the content script if possible and if a response is expected
         if (message.action === "processMessagesForSummary") {
              try { sendResponse({ success: false, error: "Internal background error." }); } catch (srErr) {}
         } else if (sender.tab?.id) {
             try { chrome.tabs.sendMessage(sender.tab.id, { action: "displayAiResponse", data: { response: "[Internal background error]" } }); } catch (tsErr) {}
         }
    });

    // Return true ONLY if sendResponse will be called asynchronously *by this listener's logic*
    // In this case, only for "processMessagesForSummary".
    // Other actions either don't respond or use tabs.sendMessage.
    const requiresAsyncResponse = (message.action === "processMessagesForSummary");
    // console.log(`Background: Returning ${requiresAsyncResponse} for action: ${message.action}`);
    return requiresAsyncResponse;

}); // End of addListener

// --- Helper Functions ---

/** Formats messages for summary prompt */
function formatMessagesForGeminiSummary(messages, summaryPromptTemplate) {
    let messageString = "";
    if (Array.isArray(messages) && messages.length > 0) {
        messageString = messages.map(msg => {
            const truncatedText = msg.text.length > 350 ? msg.text.substring(0, 347) + "..." : msg.text;
            return `[${msg.sender}]: ${truncatedText}`; // Sender name is already translated by content script
        }).join("\n");
    } else {
        messageString = "No messages provided."; // Internal placeholder
    }
    return summaryPromptTemplate.replace('{messages}', messageString);
}

/** Builds the follow-up prompt */
function buildFollowUpPrompt(waContext, aiHistory, followUpPromptTemplate) {
    let waContextString = "No previous WhatsApp context available."; // Internal placeholder
    if (waContext && waContext.length > 0) {
        waContextString = waContext.map(msg => {
            const truncatedText = msg.text.length > 350 ? msg.text.substring(0, 347) + "..." : msg.text;
            return `[${msg.sender}]: ${truncatedText}`;
        }).join("\n");
        if (waContextString.length > 4000) {
             waContextString = waContextString.substring(0, 3997) + "... (context truncated)";
        }
    }

    let aiHistoryString = "(Start of conversation)"; // Internal placeholder
    if (aiHistory && aiHistory.length > 0) {
        aiHistoryString = aiHistory.map(turn => {
            // Use translated "You" if applicable, otherwise assume AI label doesn't need translation here
            const roleLabel = turn.role === 'user' ? getMsg("textYou") : 'IA';
            return `${roleLabel}: ${turn.text}`;
        }).join("\n");
         if (aiHistoryString.length > 4000) {
              aiHistoryString = "... (history truncated)\n" + aiHistoryString.substring(aiHistoryString.length - 3997);
         }
    }

    let prompt = followUpPromptTemplate.replace('{waContext}', waContextString);
    prompt = prompt.replace('{aiHistory}', aiHistoryString);
    return prompt;
}


/** Calls the Gemini API */
async function callGeminiAPI(contentsPayload, apiKey) {
     if (!apiKey) {
        console.error("Background: callGeminiAPI missing API Key!");
        // Throw translated error
        throw new Error(getMsg("errorApiKeyNotProvidedInternal"));
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:${GENERATE_CONTENT_API}?key=${apiKey}`;

    try {
        console.log("Background: Calling Gemini API...");
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: contentsPayload,
                 safetySettings: [ // Standard safety settings
                     { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                     { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                     { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                     { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                 ]
            }),
            signal: AbortSignal.timeout(60000) // 60s timeout
        });

        const data = await response.json();

        if (!response.ok) {
             console.error("Background: Gemini API Error:", response.status, response.statusText, data);
             const errorDetail = data?.error?.message || JSON.stringify(data);
             // Throw translated errors based on status
             if (response.status === 400 && errorDetail.includes("API key not valid")) {
                 throw new Error(getMsg("errorApiKeyInvalid"));
             }
             if (response.status === 429) {
                  throw new Error(getMsg("errorApiRateLimit"));
             }
             if (response.status >= 500) {
                  throw new Error(getMsg("errorApiServer", [response.status]));
             }
             // Generic translated API error
             throw new Error(getMsg("errorApiGeneric", [response.status, errorDetail]));
        }

        // Extract response text
        let textResponse = '';
        if (data.candidates && data.candidates.length > 0) {
            const candidate = data.candidates[0];
             if (candidate.content?.parts?.length > 0) {
                textResponse = candidate.content.parts.map(part => part.text).join("");
            } else if (candidate.finishReason && candidate.finishReason !== 'STOP') {
                 // Use translated placeholder for non-stop finish
                 textResponse = getMsg("errorApiResponseNotGenerated", [candidate.finishReason]);
                 console.warn(`BG: Finish Reason: ${candidate.finishReason}`, candidate.safetyRatings || '');
                  // Prepend any partial text if available
                  if (candidate.content?.parts?.[0]?.text) {
                     textResponse = candidate.content.parts.map(part => part.text).join("") + "\n" + textResponse;
                  }
            } else {
                 textResponse = getMsg("errorApiResponseEmpty"); // Translated placeholder
                 console.warn("BG: Candidate format issue:", candidate);
            }
        } else if (data.promptFeedback?.blockReason) {
             textResponse = getMsg("errorApiRequestBlocked", [data.promptFeedback.blockReason]); // Translated placeholder
             console.warn("BG: Prompt blocked", data.promptFeedback);
        } else {
            textResponse = getMsg("errorApiResponseUnexpectedFormat"); // Translated placeholder
            console.warn("BG: Response structure issue:", data);
        }
        return textResponse.trim();

    } catch (error) {
        if (error.name === 'TimeoutError') {
             console.error("Background: API call timed out.");
             throw new Error(getMsg("errorApiTimeout")); // Translated timeout error
         }
        console.error("Background: Error in callGeminiAPI:", error);
        // Re-throw error (it should already be translated if it came from status checks)
        throw (error instanceof Error ? error : new Error(String(error.message || error)));
    }
}

console.log("Background script loaded and listening (v0.4.3).");