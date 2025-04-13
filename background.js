// background.js - MODIFICADO v0.4.11 - Model Selection, Timeout

// REMOVED: const MODEL_ID = 'gemini-1.5-flash'; // Now loaded from settings
const GENERATE_CONTENT_API = 'generateContent';
const DEFAULT_MODEL_ID = "gemini-2.0-flash"; // Default model if not set

// --- Helper for i18n ---
function getMsg(key, substitutions = undefined) {
    try {
        if (chrome && chrome.i18n && chrome.i18n.getMessage) {
            return chrome.i18n.getMessage(key, substitutions) || key;
        }
        return key; // Basic fallback
    } catch (e) {
        console.warn(`i18n Background Error getting key "${key}":`, e);
        return key;
    }
}

// --- Default System Instruction ---
const DEFAULT_SYSTEM_INSTRUCTION = getMsg("defaultSystemInstruction");

// --- Function to get settings ---
async function getSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get({
            geminiApiKey: '',
            systemInstructionPrompt: DEFAULT_SYSTEM_INSTRUCTION,
            selectedModelId: DEFAULT_MODEL_ID // Load selected model ID
        }, (items) => {
            if (chrome.runtime.lastError) {
                console.error("Background: Error loading settings:", chrome.runtime.lastError.message);
                resolve({ // Return defaults on error
                    apiKey: '',
                    systemInstructionText: DEFAULT_SYSTEM_INSTRUCTION,
                    modelId: DEFAULT_MODEL_ID // Fallback
                });
            } else {
                 // Basic validation if needed, otherwise just use the value or default
                 let modelId = items.selectedModelId || DEFAULT_MODEL_ID;
                 // Optionally validate against a known list if needed
                 // const knownModels = ["gemini-1.5-flash-latest", "gemini-1.5-pro-latest"];
                 // if (!knownModels.includes(modelId)) modelId = DEFAULT_MODEL_ID;

                 resolve({
                     apiKey: items.geminiApiKey || '',
                     systemInstructionText: items.systemInstructionPrompt || DEFAULT_SYSTEM_INSTRUCTION,
                     modelId: modelId // Store loaded/default model ID
                 });
            }
        });
    });
}


// --- Main Message Listener ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Background: Received message action:", message.action);

    async function handleMessage() {
        // ** Load settings at the start of each handler call **
        const settings = await getSettings();

        // Handle Options Page Request
        if (message.action === "openOptionsPage") {
            console.log("Background: Opening options page.");
            chrome.runtime.openOptionsPage();
            return;
        }

        // API Key Check
        const needsApiKey = ["processMessagesForSummary", "sendFollowUpMessage"].includes(message.action);
        if (needsApiKey && !settings.apiKey) {
            console.error("Background: Gemini API Key is not configured.");
            const errorMessage = getMsg("errorApiKeyNotConfigured");
             if (sender.tab && sender.tab.id) {
                  try {
                      await chrome.tabs.sendMessage(sender.tab.id, { action: "apiKeyMissingError", error: errorMessage });
                  } catch (error) { console.error("BG: Failed to send API key error to CS:", error.message); }
             }
             if (message.action === "processMessagesForSummary") { // Only respond if original action expects it
                sendResponse({ success: false, error: errorMessage });
             }
             return;
        }

        // Prepare System Instruction object
        const systemInstructionPayload = {
            parts: [{ text: settings.systemInstructionText }]
        };


        // --- Handle Initial Summary Request ---
        if (message.action === "processMessagesForSummary") {
            const messagesToSummarize = message.data;
            console.log(`Background: Processing ${messagesToSummarize?.length || 0} messages for initial summary.`);
            if (!messagesToSummarize || messagesToSummarize.length === 0) {
                 sendResponse({ success: false, error: "No messages provided." });
                 return;
            }

            const formattedWaMessages = formatMessagesForPayload(messagesToSummarize);
            const firstUserPromptText = `Here is a snippet of a WhatsApp conversation. Please provide a concise summary focusing on key points and decisions:\n---\n${formattedWaMessages}\n---`;

            const contentsPayload = [
                { role: "user", parts: [{ text: firstUserPromptText || "(User provided no text)" }] }
            ];

            try {
                // Pass settings.modelId to the API call
                const summary = await callGeminiAPI(contentsPayload, systemInstructionPayload, settings.apiKey, settings.modelId);
                console.log("Background: Initial summary generated.");
                sendResponse({ success: true, summary: summary });
            } catch (error) {
                console.error("Background: Error calling Gemini for summary:", error);
                sendResponse({ success: false, error: error.message || "Unknown API error" });
            }


        // --- Handle Follow-up Question ---
        } else if (message.action === "sendFollowUpMessage") {
            const { history: aiHistory = [], waContext = [] } = message.data;

             // Basic check: History must exist and end with user
             if (!aiHistory.length || aiHistory[aiHistory.length - 1].role !== 'user') {
                 console.error("Background: Invalid AI history received for follow-up (empty or doesn't end with user).", aiHistory);
                  if (sender.tab?.id) {
                      try { await chrome.tabs.sendMessage(sender.tab.id, { action: "displayAiResponse", data: { response: `[${getMsg("statusErrorGeneric")}: Invalid chat history received]` } }); } catch(e){}
                  }
                 return;
             }


            console.log(`Background: Processing follow-up with ${aiHistory.length} turns and ${waContext.length} WA context messages...`);

            const formattedWaContext = formatMessagesForPayload(waContext);
            const contextPreamble = formattedWaContext
                ? `Background context from the original WhatsApp chat snippet:\n---\n${formattedWaContext}\n---\n\n`
                : "No prior WhatsApp context was provided.\n\n";

            // Revised payload construction
            const fullContents = [];
             fullContents.push({ role: "user", parts: [{ text: contextPreamble + "Now, regarding our conversation:" }] });
             fullContents.push({ role: "model", parts: [{ text: "Understood. I have the original WhatsApp context (if provided). Please proceed with our conversation." }] });
             aiHistory.forEach(turn => {
                 const textContent = turn.text || `(${turn.role} provided no text)`;
                 if (turn.role && (turn.role === 'user' || turn.role === 'model')) {
                     fullContents.push({ role: turn.role, parts: [{ text: textContent }] });
                 } else { console.warn("BG: Skipping turn with invalid role in aiHistory:", turn); }
            });


            // Check if we only have context + placeholder (meaning original history was empty/invalid)
             if (fullContents.length <= 2) {
                 console.error("Background: No valid AI history turns found to add after context.");
                  if (sender.tab?.id) {
                      try { await chrome.tabs.sendMessage(sender.tab.id, { action: "displayAiResponse", data: { response: `[${getMsg("statusErrorGeneric")}: No valid chat history found to process]` } }); } catch(e){}
                  }
                 return;
             }

            // console.log("BG DEBUG: Final Follow-up Contents Structure:", JSON.stringify(fullContents, null, 2));

             try {
                 // Pass settings.modelId to the API call
                 const aiResponse = await callGeminiAPI(fullContents, systemInstructionPayload, settings.apiKey, settings.modelId);
                 console.log("Background: Follow-up response generated.");
                 if (sender.tab?.id) {
                      try { await chrome.tabs.sendMessage(sender.tab.id, { action: "displayAiResponse", data: { response: aiResponse } }); }
                      catch (error) { console.error("BG: Error sending follow-up response to tab:", error.message); }
                 } else { console.error("BG: No sender tab ID for follow-up response."); }

             } catch (error) {
                 console.error("Background: Error calling Gemini for follow-up:", error);
                 const errorMessage = error.message || "Unknown API error during follow-up";
                  if (sender.tab?.id) {
                       try { await chrome.tabs.sendMessage(sender.tab.id, { action: "displayAiResponse", data: { response: errorMessage } }); }
                       catch (errorMsg) { console.error("BG: Error sending error message to tab:", errorMsg.message); }
                  }
             }

        } else {
             console.log("Background: Unhandled action:", message.action);
        }
    } // End of async handleMessage

    handleMessage().catch(e => {
         console.error("Background: Uncaught error in handleMessage:", e);
          const errorMsg = `[${getMsg("statusErrorGeneric")}: Internal background error]`;
         if (message.action === "processMessagesForSummary") {
              try { sendResponse({ success: false, error: errorMsg }); } catch (srErr) {}
         } else if (sender.tab?.id) {
             try { chrome.tabs.sendMessage(sender.tab.id, { action: "displayAiResponse", data: { response: errorMsg } }); } catch (tsErr) {}
         }
    });

    const requiresAsyncResponse = (message.action === "processMessagesForSummary");
    return requiresAsyncResponse;

}); // End of addListener


// --- Helper Function to format WA messages for payload ---
function formatMessagesForPayload(messages) {
    if (!messages || messages.length === 0) {
        return "";
    }
    return messages.map(msg => {
        const sender = msg?.sender || getMsg("textUnknown");
        const text = msg?.text || "";
        const truncatedText = text.length > 500 ? text.substring(0, 497) + "..." : text;
        return `[${sender}]: ${truncatedText}`;
    }).join("\n");
}


// --- Gemini API Call Function (Updated Signature, Timeout) ---
async function callGeminiAPI(contents, systemInstruction, apiKey, modelId = DEFAULT_MODEL_ID) { // Added modelId parameter
     if (!apiKey) { throw new Error(getMsg("errorApiKeyNotProvidedInternal")); }

    // Use the passed modelId or the default
    const effectiveModelId = modelId || DEFAULT_MODEL_ID;
    console.log(`BG: Calling Gemini API with model: ${effectiveModelId}`); // Log the model being used

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${effectiveModelId}:${GENERATE_CONTENT_API}?key=${apiKey}`; // Use effectiveModelId

    // Pre-validation of contents structure
     if (!Array.isArray(contents)) { throw new Error("Internal error: 'contents' must be an array."); }
      if (contents.length === 0 && (!systemInstruction || !systemInstruction.parts || !systemInstruction.parts[0]?.text)){
           throw new Error("Internal error: Cannot call API with empty contents and system instruction.");
      }
     for (let i = 0; i < contents.length; i++) {
         const turn = contents[i];
         if (!turn || typeof turn !== 'object') { throw new Error(`Internal error: Invalid structure for turn ${i} (not an object).`); }
         if (typeof turn.role !== 'string' || !['user', 'model'].includes(turn.role)) { throw new Error(`Internal error: Invalid role "${turn.role}" for turn ${i}.`); }
         if (!turn.parts || !Array.isArray(turn.parts) || turn.parts.length === 0) { console.warn(`BG Warning: 'parts' array is missing or empty for turn ${i}. Fixing.`); contents[i].parts = [{ text: `(${turn.role} provided no text)` }]; }
         else if (typeof turn.parts[0].text !== 'string') { console.warn(`BG Warning: parts[0].text is not a string for turn ${i}. Fixing.`, turn.parts[0]); contents[i].parts[0].text = String(turn.parts[0].text || `(${turn.role} provided no text)`); }
         else if (turn.parts[0].text.trim() === "") { console.warn(`BG Warning: Empty text found in parts for turn ${i}. Fixing.`); contents[i].parts[0].text = `(${turn.role} provided no text)`; }
         delete contents[i].text; // Clean up potential extra property
     }


    const requestBody = {
        contents: contents,
        systemInstruction: systemInstruction,
        safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
        ],
        generationConfig: {
            responseMimeType: "text/plain",
        }
    };

    const MAX_REQUEST_SIZE = 30000;
    let requestBodyString = JSON.stringify(requestBody);

    if (requestBodyString.length > MAX_REQUEST_SIZE) {
        // *** Truncation Logic ***
        console.warn(`BG: Request body size (${requestBodyString.length}) exceeds limit (${MAX_REQUEST_SIZE}). Attempting to truncate history.`);
        const originalContents = requestBody.contents;
        const systemInstructionSize = JSON.stringify(systemInstruction).length;
        const baseBodySize = requestBodyString.length - JSON.stringify(originalContents).length;
        let availableSize = MAX_REQUEST_SIZE - baseBodySize - systemInstructionSize;

        if (availableSize <= 0) { throw new Error("Internal error: Request structure too large."); }

        const truncatedContents = [];
        let currentSize = 0;

        // Always include the first turn
        if (originalContents.length > 0) {
            const firstTurnString = JSON.stringify(originalContents[0]);
            if (currentSize + firstTurnString.length <= availableSize) {
                 truncatedContents.push(originalContents[0]);
                 currentSize += firstTurnString.length;
            } else { throw new Error("Initial context/request is too large to send."); }
        }

        // Add turns from the END backwards
        for (let i = originalContents.length - 1; i > 0; i--) {
             const turnToAdd = originalContents[i];
             const turnString = JSON.stringify(turnToAdd);
             // Ensure we leave space for the '[]' array characters and commas
             if (currentSize + turnString.length + (truncatedContents.length > 1 ? 1 : 0) <= availableSize) {
                 truncatedContents.splice(1, 0, turnToAdd); // Insert after first element
                 currentSize += turnString.length + (truncatedContents.length > 2 ? 1 : 0); // Add comma length approx
             } else { console.log(`BG: Truncation stopped at index ${i}.`); break; }
        }

        if (truncatedContents.length <= 1 && originalContents.length > 1) {
            console.warn("BG: Truncation resulted in only the first turn fitting.");
        }

        requestBody.contents = truncatedContents;
        requestBodyString = JSON.stringify(requestBody);
        console.log(`BG: Truncated history. Final size: ${requestBodyString.length}. Final turns: ${requestBody.contents.length}`);

        if (requestBodyString.length > MAX_REQUEST_SIZE) { throw new Error("Chat history is too large, even after attempting truncation."); }
    }


    // console.log("Background: Sending Final Payload to Gemini API:", requestBodyString);

    try {
        console.log("Background: Calling Gemini API...");
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: requestBodyString,
            // *** INCREASED TIMEOUT ***
            signal: AbortSignal.timeout(210000) // 210 seconds
        });

        const data = await response.json();

        if (!response.ok) {
             console.error("Background: Gemini API Error:", response.status, response.statusText, data);
             const errorDetail = data?.error?.message || JSON.stringify(data);
             if (response.status === 400 && errorDetail.includes("parts must not be empty")) { throw new Error("Gemini API Error: A message part sent to the AI was empty."); }
             if (response.status === 400 && errorDetail.includes("API key not valid")) { throw new Error(getMsg("errorApiKeyInvalid")); }
             if (response.status === 429) { throw new Error(getMsg("errorApiRateLimit")); }
             if (response.status === 400 && errorDetail.includes("User location is not supported")) { throw new Error("Gemini API Error: User location is not supported for this model."); }
             if (response.status === 400 && errorDetail.toLowerCase().includes("request payload size exceeds the limit")) { throw new Error("Gemini API Error: The request is too large (history/context size limit exceeded)."); }
              if (response.status === 400 && errorDetail.toLowerCase().includes("finish reason safety")){ throw new Error(getMsg("errorApiRequestBlocked", ["SAFETY"])); }
             if (response.status >= 500) { throw new Error(getMsg("errorApiServer", [response.status])); }
             throw new Error(getMsg("errorApiGeneric", [response.status, errorDetail]));
        }

        // Extract response text
        let textResponse = '';
        if (data.candidates && data.candidates.length > 0) {
            const candidate = data.candidates[0];
             if (candidate.content?.parts?.length > 0) { textResponse = candidate.content.parts.map(part => part.text).join(""); }
             else if (candidate.finishReason && candidate.finishReason !== 'STOP') { textResponse = getMsg("errorApiResponseNotGenerated", [candidate.finishReason]); console.warn(`BG: Finish Reason: ${candidate.finishReason}`, candidate.safetyRatings || ''); if (candidate.content?.parts?.[0]?.text) { textResponse = candidate.content.parts.map(part => part.text).join("") + "\n" + textResponse; } }
             else if (!candidate.content){ if (candidate.finishReason === 'SAFETY'){ textResponse = getMsg("errorApiRequestBlocked", [candidate.finishReason]); console.warn("BG: Request blocked by safety filters", candidate.safetyRatings); } else { textResponse = getMsg("errorApiResponseEmpty"); console.warn("BG: Candidate content missing, FinishReason:", candidate.finishReason); } }
             else { textResponse = getMsg("errorApiResponseEmpty"); console.warn("BG: Candidate parts missing or empty:", candidate); }
        } else if (data.promptFeedback?.blockReason) { textResponse = getMsg("errorApiRequestBlocked", [data.promptFeedback.blockReason]); console.warn("BG: Prompt blocked (top-level feedback)", data.promptFeedback); }
        else { textResponse = getMsg("errorApiResponseUnexpectedFormat"); console.warn("BG: Unexpected Gemini response structure:", data); }
        return textResponse.trim();

    } catch (error) {
        if (error.name === 'TimeoutError') { console.error("Background: API call timed out."); throw new Error(getMsg("errorApiTimeout")); }
        console.error("Background: Error in callGeminiAPI:", error);
        throw (error instanceof Error ? error : new Error(String(error.message || error)));
    }
}

console.log("Background script loaded and listening (v0.4.11).");