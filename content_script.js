// content_script.js - MODIFICADO v0.4.5 - Sender Attribution Fix & Port Closed Fix & i18n
console.log("WhatsApp Summarizer: Content script cargado v0.4.5.");

// --- Selectores HTML (Add selector for copyable-text div) ---
const MESSAGE_LIST_SELECTOR = '#main';
const MESSAGE_ROW_SELECTOR = 'div[role="row"]';
const MESSAGE_TEXT_SELECTOR = 'span.selectable-text.copyable-text'; // The span containing text
const COPYABLE_TEXT_DIV_SELECTOR = 'div.copyable-text'; // The div wrapping text, holding data-pre-plain-text
const OUTGOING_MESSAGE_INDICATOR = 'div.message-out';
const CHAT_HEADER_SELECTOR = 'header[data-testid="conversation-header"]';
const MESSAGE_TIME_SELECTOR_IN_META = 'span[data-testid="msg-meta"] span[aria-label]';
const TIMESTAMP_REGEX = /^\d{1,2}:\d{1,2}\s*(?:a\.m\.|p\.m\.)?$/i;
// Regex to extract sender name from data-pre-plain-text: "[timestamp] Sender Name: "
const PRE_PLAIN_TEXT_SENDER_REGEX = /\[.+?\]\s*([^:]+):\s*$/; // Capture group 1 is the name
const MESSAGE_CONTENT_CONTAINER = 'div.copyable-text'; // Used for context checks
const HEADER_BUTTONS_CONTAINER_SELECTOR = 'div[data-testid="conversation-header"] > div:nth-child(3)';

// --- Variables Globales ---
let toggleChatButtonInPage = null;
let chatPanel = null;
let chatMessagesDiv = null;
let chatInput = null;
let chatSendButton = null;
let chatClearButton = null;
let aiConversationHistory = [];
let lastWaContext = [];

// --- Helper for i18n ---
function getMsg(key, substitutions = undefined) {
    try {
        // Check if chrome.i18n is available before using it
        if (chrome && chrome.i18n && chrome.i18n.getMessage) {
            return chrome.i18n.getMessage(key, substitutions) || key;
        }
        // Basic fallback
        let replaced = key;
        if (substitutions && Array.isArray(substitutions)) {
             substitutions.forEach((sub, i) => { replaced = replaced.replace(`$${i+1}`, sub); });
        } else if (substitutions) { replaced = key.replace('$1', substitutions); }
        return replaced;
    } catch (e) {
        console.warn(`i18n CS Error key "${key}":`, e);
        return key; // Fallback to key on error
    }
}

// --- Funciones de Extracción ---
function extractLastMessages(count) {
    const mainPanel = document.querySelector(MESSAGE_LIST_SELECTOR);
    if (!mainPanel) {
        console.error("Summarizer: Could not find #main panel.");
        if (chatPanel && !chatPanel.classList.contains('hidden')) {
             showStatusInChat(getMsg("errorWhatsAppPanelNotFound"), "error");
        }
        return [];
    }

    const messageElements = mainPanel.querySelectorAll(MESSAGE_ROW_SELECTOR);
    if (!messageElements || messageElements.length === 0) {
        console.warn("Summarizer: No message rows found.");
        if (chatPanel && !chatPanel.classList.contains('hidden')) {
             showStatusInChat(getMsg("errorNoMessagesFound"), "warning");
        }
        return [];
    }

    console.log(`Summarizer: Found ${messageElements.length} potential message rows.`);
    const startIndex = Math.max(0, messageElements.length - count);
    const lastMessagesElements = Array.from(messageElements).slice(startIndex);
    console.log(`Summarizer: Attempting to extract last ${lastMessagesElements.length} messages.`);

    const extractedMessages = [];
    let lastKnownSender = getMsg("textUnknown"); // Tracker initialized for this extraction run

    lastMessagesElements.forEach((msgRow, index) => {
        let text = null;
        let currentSender = null;
        let senderNameExplicitlyFoundThisRow = false;
        let isSystemEvent = false; // Reset flag for each row

        // 1. Check Outgoing
        const isOutgoing = msgRow.querySelector(OUTGOING_MESSAGE_INDICATOR);
        if (isOutgoing) {
            currentSender = getMsg("textYou");
            lastKnownSender = currentSender;
            senderNameExplicitlyFoundThisRow = true;
        } else {
            // 2. Check Incoming - data-pre-plain-text
            const copyableDiv = msgRow.querySelector(COPYABLE_TEXT_DIV_SELECTOR);
            const prePlainText = copyableDiv?.getAttribute('data-pre-plain-text');
            let nameFromPreText = null;

            if (prePlainText) {
                const match = prePlainText.match(PRE_PLAIN_TEXT_SENDER_REGEX);
                if (match && match[1]) {
                    nameFromPreText = match[1].trim();
                     if (nameFromPreText.toLowerCase() === 'whatsapp') nameFromPreText = 'WhatsApp';
                     currentSender = nameFromPreText;
                     lastKnownSender = currentSender;
                     senderNameExplicitlyFoundThisRow = true;
                }
            }

            // 3. If no explicit name found yet, assign last known
            if (!senderNameExplicitlyFoundThisRow) {
                 currentSender = lastKnownSender;
            }
        }

        // 4. Extract Text
        const textEl = msgRow.querySelector(MESSAGE_TEXT_SELECTOR);
        if (textEl) {
            text = textEl.textContent?.trim() || '';
            if (text === '' && textEl.closest('._ahn4, ._ahmw')) { // Media check
                text = getMsg("textMediaFile");
            }
        }

        // 5. Fallback & System Message Check (using aria-label)
        if (text === null || text === '') {
            const rowLabel = msgRow.getAttribute('aria-label')?.trim();
            if (rowLabel && !TIMESTAMP_REGEX.test(rowLabel)) {
                text = `[${rowLabel}]`;
                const rowLabelLower = rowLabel.toLowerCase();
                let systemSenderType = null;

                // --- System Event Identification ---
                if (rowLabelLower.includes('missed voice call') || rowLabelLower.includes('llamada de voz perdida')) {
                    systemSenderType = getMsg("textMissedVoiceCall"); isSystemEvent = true;
                } else if (rowLabelLower.includes('missed video call') || rowLabelLower.includes('videollamada perdida')) {
                    systemSenderType = getMsg("textMissedVideoCall"); isSystemEvent = true;
                } else if (rowLabel.match(/you were added|te añadió|se añadió|created group|creaste el grupo|left|salió|changed the subject|cambió el asunto|changed this group's icon|cambió el ícono de este grupo|security code changed|código de seguridad cambió|^📅\s+/i)) {
                    systemSenderType = getMsg("textSystemMessage"); isSystemEvent = true;
                } else if (rowLabel.match(/messages and calls are end-to-end encrypted|mensajes y llamadas están cifrados/i)) {
                   systemSenderType = getMsg("textSystemMessage"); text = null; isSystemEvent = true; // Ignore text
                } else if (rowLabel.match(/you deleted this message|eliminaste este mensaje/i)) {
                    // Override sender ONLY if it wasn't already explicitly set to 'You'
                    if(currentSender !== getMsg("textYou")) {
                        currentSender = getMsg("textYou");
                        lastKnownSender = currentSender; // Update tracker
                    }
                    text = getMsg("textMessageDeletedByYou");
                    senderNameExplicitlyFoundThisRow = true; // Mark as identified
                } else if (rowLabel.match(/this message was deleted|este mensaje fue eliminado/i)) {
                    text = getMsg("textMessageDeleted");
                    // Keep previously determined sender (lastKnownSender if not explicit)
                }

                // --- Apply System Sender ---
                // Apply if it's a system event AND we didn't already find an explicit sender name this row
                // OR if the explicitly found sender was 'Unknown' (meaning tracker defaulted)
                if (isSystemEvent && systemSenderType && (!senderNameExplicitlyFoundThisRow || currentSender === getMsg("textUnknown"))) {
                    currentSender = systemSenderType;
                    lastKnownSender = currentSender; // Update tracker
                }
            }
        }

        // --- 6. Add to results ---
        // Add if we have text AND (we know the sender OR it's clearly a system message)
        if (text !== null && text !== '' && text !== '[null]') {
             if (currentSender !== getMsg("textUnknown")) { // Stricter check: We MUST know the sender (or have classified it as system)
                extractedMessages.push({ sender: currentSender, text });
                // console.log(`DEBUG Row ${index}: ADDED - Sender: "${currentSender}", Text: "${text.substring(0,50)}..."`);
             } else {
                 // console.log(`DEBUG Row ${index}: SKIPPED - Sender Unknown: "${text}"`);
                 // console.log(`DEBUG Row ${index} HTML: ${msgRow.outerHTML.substring(0, 200)}...`); // Log skipped row HTML for inspection
             }
        } else {
             // console.log(`DEBUG Row ${index}: SKIPPED - No text extracted.`);
        }
    }); // End forEach row

    console.log(`Summarizer: Successfully extracted ${extractedMessages.length} messages.`);
    if (extractedMessages.length === 0 && lastMessagesElements.length > 0) {
        // The specific error message you saw comes from here.
        // It means loops happened, but no rows met the final criteria in step 6.
        console.warn("Summarizer: Found message rows but failed to extract valid content/sender pairs.");
        if (chatPanel && !chatPanel.classList.contains('hidden')) {
            showStatusInChat(getMsg("errorExtractionFailed"), "warning");
        }
    }

    return extractedMessages;
}

// --- Funciones de la Interfaz de Chat --- (No changes needed in these functions from v0.4.3)

/** Crea y añade el panel de chat al DOM si no existe */
function createChatInterface() {
    if (document.getElementById('summarizer-chat-panel')) {
        // Panel already exists, just ensure variables are set
        if (!chatPanel) chatPanel = document.getElementById('summarizer-chat-panel');
        if (!chatMessagesDiv) chatMessagesDiv = document.getElementById('summarizer-chat-messages');
        if (!chatInput) chatInput = document.getElementById('summarizer-chat-input');
        if (!chatSendButton) chatSendButton = document.getElementById('summarizer-chat-send-btn');
        if (!chatClearButton) chatClearButton = document.getElementById('summarizer-chat-clear-btn');
        return;
    }

    console.log("Summarizer: >>> Running createChatInterface <<<");

    chatPanel = document.createElement('div');
    chatPanel.id = 'summarizer-chat-panel';
    chatPanel.classList.add('hidden'); // Start hidden

    // --- Header ---
    const header = document.createElement('div');
    header.id = 'summarizer-chat-header';
    const title = document.createElement('h4');
    title.textContent = getMsg("panelTitle"); // i18n

    // Button Group
    const headerButtonsGroup = document.createElement('div');
    headerButtonsGroup.classList.add('summarizer-header-buttons');

    // Options Button
    const optionsButton = document.createElement('button');
    optionsButton.id = 'summarizer-chat-options-btn';
    optionsButton.classList.add('summarizer-header-btn');
    optionsButton.innerHTML = '⚙️';
    optionsButton.title = getMsg("optionsButtonTitle"); // i18n
    optionsButton.style.fontSize = '16px';
    optionsButton.onclick = () => {
        chrome.runtime.sendMessage({ action: "openOptionsPage" }, (response) => {
             if (chrome.runtime.lastError) {
                 console.error("Summarizer: Error sending openOptionsPage message:", chrome.runtime.lastError.message);
                 alert(getMsg("errorCommunication", [chrome.runtime.lastError.message])); // Basic alert fallback
             }
        });
    };
    headerButtonsGroup.appendChild(optionsButton);

    // Clear Button
    chatClearButton = document.createElement('button');
    chatClearButton.id = 'summarizer-chat-clear-btn';
    chatClearButton.classList.add('summarizer-header-btn');
    chatClearButton.innerHTML = '🗑️';
    chatClearButton.title = getMsg("clearButtonTitle"); // i18n
    chatClearButton.onclick = handleClearChat;
    headerButtonsGroup.appendChild(chatClearButton);

    // Close Button
    const closeButton = document.createElement('button');
    closeButton.id = 'summarizer-chat-close-btn';
    closeButton.classList.add('summarizer-header-btn');
    closeButton.innerHTML = '×';
    closeButton.title = getMsg("closeButtonTitle"); // i18n
    closeButton.onclick = toggleChatPanel;
    headerButtonsGroup.appendChild(closeButton);

    header.appendChild(title);
    header.appendChild(headerButtonsGroup);

    // --- Messages Area ---
    chatMessagesDiv = document.createElement('div');
    chatMessagesDiv.id = 'summarizer-chat-messages';

    // --- Input Area ---
    const inputArea = document.createElement('div');
    inputArea.id = 'summarizer-chat-input-area';
    chatInput = document.createElement('textarea');
    chatInput.id = 'summarizer-chat-input';
    chatInput.placeholder = getMsg("inputPlaceholder"); // i18n
    chatInput.rows = 1;
    chatInput.title = getMsg("inputTitle"); // i18n
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey && !chatInput.disabled) {
             e.preventDefault();
             handleSendChatMessage();
         }
    });
     chatInput.addEventListener('input', () => { // Auto-resize
         chatInput.style.height = 'auto';
         const scrollHeight = chatInput.scrollHeight;
         const maxHeight = 80; // From CSS
         chatInput.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
     });

    chatSendButton = document.createElement('button');
    chatSendButton.id = 'summarizer-chat-send-btn';
    chatSendButton.title = getMsg("sendButtonTitle"); // i18n
    chatSendButton.innerHTML = `<svg viewBox="0 0 24 24" height="24" width="24" preserveAspectRatio="xMidYMid meet" version="1.1" x="0px" y="0px" enable-background="new 0 0 24 24" xml:space="preserve"><path fill="currentColor" d="M1.101,21.757L23.8,12.028L1.101,2.3l0.011,7.912l13.623,1.816L1.112,13.845 L1.101,21.757 Z"></path></svg>`;
    chatSendButton.onclick = handleSendChatMessage;
    inputArea.appendChild(chatInput);
    inputArea.appendChild(chatSendButton);

    // --- Assemble Panel ---
    chatPanel.appendChild(header);
    chatPanel.appendChild(chatMessagesDiv);
    chatPanel.appendChild(inputArea);

    // --- Add to Body ---
    try {
        document.body.appendChild(chatPanel);
        console.log("Summarizer: Chat panel appended to body.");
    } catch (error) {
         console.error("Summarizer: Failed to append chat panel to body!", error);
    }
}

/** Muestra u oculta el panel de chat */
function toggleChatPanel() {
    if (!chatPanel || !document.body.contains(chatPanel)) {
        console.log("Summarizer: Chat panel doesn't exist or not in DOM, creating/re-appending...");
        createChatInterface();
        if (!chatPanel) {
            console.error("Summarizer: Failed to create panel within toggleChatPanel!");
            return;
        }
        if (!document.body.contains(chatPanel)) {
            try { document.body.appendChild(chatPanel); } catch (e) {
                 console.error("Summarizer: Failed to re-append chat panel!", e); return;
            }
        }
    }

    const isCurrentlyHidden = chatPanel.classList.contains('hidden');
    chatPanel.classList.toggle('hidden');
    const isNowVisible = !chatPanel.classList.contains('hidden');
    console.log(`Summarizer: Panel toggled. Was hidden: ${isCurrentlyHidden}, Is visible: ${isNowVisible}.`);

    if (isNowVisible) {
        if (aiConversationHistory.length === 0 && chatMessagesDiv?.childElementCount === 0) {
             displayChatMessage(getMsg("initialGreeting"), "ai", false);
        }
        setTimeout(() => chatInput?.focus(), 50);
    }
}

/** Añade mensaje al panel y opcionalmente al historial lógico */
function displayChatMessage(text, type = 'ai', addToHistory = true) {
    if (!chatMessagesDiv) {
        console.error("Summarizer Error: chatMessagesDiv is null in displayChatMessage.");
        return;
    }
    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message', `${type}-message`);
    messageElement.innerHTML = text.replace(/\n/g, '<br>');
    chatMessagesDiv.appendChild(messageElement);
    chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;

    if (addToHistory && (type === 'user' || type === 'ai')) {
        aiConversationHistory.push({ role: (type === 'ai' ? 'model' : 'user'), text: text });
    }
}

/** Muestra un mensaje de estado o error temporalmente en el chat */
function showStatusInChat(message, type = 'status', duration = 4000) {
     if (!chatMessagesDiv) {
          console.warn("Summarizer: chatMessagesDiv not available for status message:", message);
          return;
     }
     const statusElement = document.createElement('div');
     statusElement.classList.add('chat-message', `${type}-message`);
     statusElement.textContent = message;
     chatMessagesDiv.appendChild(statusElement);
     chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;

     if (duration > 0) {
         setTimeout(() => {
             if (statusElement && statusElement.parentNode === chatMessagesDiv) {
                 try { chatMessagesDiv.removeChild(statusElement); } catch(e){}
             }
         }, duration);
     }
}

/** Limpia historial lógico, contexto WA y panel visual */
function handleClearChat() {
    console.log("Summarizer: Clearing chat, AI history, and WA context...");
    aiConversationHistory = [];
    lastWaContext = [];
    if (chatMessagesDiv) {
        chatMessagesDiv.innerHTML = '';
    }
    if (chatInput) {
         chatInput.value = '';
         chatInput.style.height = 'auto';
         chatInput.placeholder = getMsg("inputPlaceholder");
         chatInput.disabled = false;
         chatInput.focus();
    }
    if (chatSendButton) {
        chatSendButton.disabled = false;
    }
}

/** Maneja el envío de un mensaje desde el input del chat */
function handleSendChatMessage() {
    if (!chatInput || !chatInput.value.trim() || chatInput.disabled) return;

    const userMessage = chatInput.value.trim();
    console.log("Summarizer: User message sent:", userMessage);

    displayChatMessage(userMessage, 'user', true);
    const currentUserMessageEntry = aiConversationHistory[aiConversationHistory.length - 1];

    const originalPlaceholder = getMsg("inputPlaceholder");
    chatInput.value = '';
    chatInput.style.height = 'auto';
    chatInput.placeholder = getMsg("inputPlaceholderWaiting");
    chatInput.disabled = true;
    chatSendButton.disabled = true;

    // --- Request Type Detection ---
    const summaryMatch = userMessage.match(/(?:resume|resumen|summary)\s*(?:los|las|the)?\s*(\d+)\s*(?:mensajes|msgs|messages)?/i)
                      || userMessage.match(/(\d+)\s*(?:mensajes|msgs|messages)/i);
    let messageCount = 10;
    let isSummaryRequest = false;

    if (summaryMatch) {
        isSummaryRequest = true;
        const countStr = summaryMatch[1];
        if (countStr) {
            const count = parseInt(countStr, 10);
            if (!isNaN(count) && count > 0) {
                messageCount = count;
            } else {
                 showStatusInChat(getMsg("statusInvalidCount", [countStr, messageCount]), 'warning', 3000);
            }
        }
         showStatusInChat(getMsg("statusGeneratingSummary", [messageCount]), 'status');
    } else {
         showStatusInChat(getMsg("statusSendingQuery"), 'status');
    }

    // Function to re-enable UI components
    const cleanupUI = () => {
        if(chatInput) {
            chatInput.placeholder = originalPlaceholder;
            chatInput.disabled = false;
            chatInput.focus();
        }
        if(chatSendButton) {
            chatSendButton.disabled = false;
        }
    };

    // --- Process Request ---
    if (isSummaryRequest) {
        console.log("Summarizer: Summary request. Clearing AI history (keeping request) and WA context.");
        aiConversationHistory = [currentUserMessageEntry];
        lastWaContext = [];

        const messagesToProcess = extractLastMessages(messageCount);
        if (!messagesToProcess || messagesToProcess.length === 0) {
            const errorMsg = getMsg("errorExtractionFailed");
            showStatusInChat(errorMsg, "error");
            aiConversationHistory = [];
            displayChatMessage(`[${getMsg("statusErrorGeneric")}: ${errorMsg}]`, "error", false);
            cleanupUI();
            return;
        }

        lastWaContext = messagesToProcess;
        console.log(`Summarizer: Stored ${lastWaContext.length} WA messages for context.`);

        chrome.runtime.sendMessage(
            { action: "processMessagesForSummary", data: messagesToProcess },
            (response) => {
                handleBackgroundResponse(response); // Displays result/error
                cleanupUI();
            }
        );
    } else { // Follow-up question
        const historyToSend = [...aiConversationHistory];
        const waContextToSend = [...lastWaContext];
        console.log(`Summarizer: Sending follow-up with ${historyToSend.length} AI history and ${waContextToSend.length} WA context.`);

        chrome.runtime.sendMessage(
            { action: "sendFollowUpMessage", data: { history: historyToSend, waContext: waContextToSend } },
            (response) => { // Catches immediate errors + ignores expected "port closed"
                 if (chrome.runtime.lastError) {
                     if (chrome.runtime.lastError.message?.includes("closed before a response was received")) {
                         console.log("Summarizer: sendMessage port closed as expected for follow-up.");
                     } else {
                         console.error("Summarizer: Unexpected runtime error sending follow-up:", chrome.runtime.lastError.message);
                         const errMsg = getMsg("errorCommunication", [chrome.runtime.lastError.message]);
                         showStatusInChat(errMsg, "error");
                         displayChatMessage(`[${getMsg("statusErrorGeneric")}: ${errMsg}]`, "error", false);
                         cleanupUI(); // Cleanup on unexpected errors
                     }
                 } else if (response && !response.success) {
                     console.error("Summarizer: Background reported immediate error on follow-up:", response.error);
                     const errMsg = getMsg("errorProcessing", [response.error]);
                     showStatusInChat(errMsg, "error");
                     displayChatMessage(`[${getMsg("statusErrorGeneric")}: ${errMsg}]`, "error", false);
                     cleanupUI();
                 }
                 // No cleanupUI here otherwise - wait for displayAiResponse message
            }
        );
    }
}

/** Manejador unificado para respuestas del background (cuando usa sendResponse - primarily for summary) */
function handleBackgroundResponse(response) {
     if (chrome.runtime.lastError) {
         console.error("Content Script Error receiving via sendResponse:", chrome.runtime.lastError.message);
         const errorMsg = getMsg("errorCommunication", [chrome.runtime.lastError.message]);
         showStatusInChat(errorMsg, "error");
         displayChatMessage(`[${getMsg("statusErrorGeneric")}: ${errorMsg}]`, "error", false);
         return;
     }

    console.log("Content script: Response received via sendResponse:", response);
    if (response && response.success && response.summary) {
        displayChatMessage(response.summary, 'ai', true);
    } else if (response && !response.success && response.error) {
        // Use the error message directly from the background (it should be translated there)
        const errorMsg = response.error || getMsg("errorUnexpectedResponse");
        showStatusInChat(errorMsg, "error");
        displayChatMessage(`[${getMsg("statusErrorGeneric")}: ${errorMsg}]`, "error", false);
    } else {
        const errorMsg = getMsg("errorUnexpectedResponse");
        showStatusInChat(errorMsg, "error");
         displayChatMessage(`[${getMsg("statusErrorGeneric")}: ${errorMsg}]`, "error", false);
    }
}

// --- Lógica de Comunicación (Listener Global) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Content script received message:", message.action);

    const cleanupUI = () => { // Local helper for listener scope
        if(chatInput) {
            chatInput.placeholder = getMsg("inputPlaceholder");
            chatInput.disabled = false;
            if (!chatPanel?.classList.contains('hidden')) {
                 chatInput.focus();
             }
        }
        if(chatSendButton) {
            chatSendButton.disabled = false;
        }
    };

    if (message.action === "triggerSummaryFromPopup") {
        const count = message.count;
        if (isNaN(count) || count <= 0) {
            sendResponse({ success: false, error: getMsg("popupErrorInvalidNumber") });
            return false;
        }

        try { // Ensure panel visible
             if (!chatPanel || !document.body.contains(chatPanel)) createChatInterface();
             if (chatPanel.classList.contains('hidden')) toggleChatPanel();
             if (!chatPanel || chatPanel.classList.contains('hidden')) throw new Error("Panel creation/visibility failed.");
        } catch (error) {
             console.error("Summarizer: Error ensuring panel visibility from popup:", error);
             sendResponse({ success: false, error: getMsg("errorPanelDisplayFailed") });
             return false;
        }

        handleClearChat();
        showStatusInChat(getMsg("statusGeneratingSummary", [count]), 'status');
        if(chatInput) chatInput.disabled = true;
        if(chatSendButton) chatSendButton.disabled = true;

        const messagesToProcess = extractLastMessages(count);
        if (!messagesToProcess || messagesToProcess.length === 0) {
             const errorMsg = getMsg("errorExtractionFailed");
             showStatusInChat(errorMsg, "error");
             displayChatMessage(`[${getMsg("statusErrorGeneric")}: ${errorMsg}]`, "error", false);
             cleanupUI();
             sendResponse({ success: false, error: errorMsg });
             return false;
        }

        lastWaContext = messagesToProcess;
        aiConversationHistory = [];
        console.log(`Summarizer: Stored ${lastWaContext.length} WA msgs for context (from popup).`);

        chrome.runtime.sendMessage(
            { action: "processMessagesForSummary", data: messagesToProcess },
            (response) => {
                handleBackgroundResponse(response);
                cleanupUI();
                if (chrome.runtime.lastError) {
                     sendResponse({ success: false, error: getMsg("errorCommunication", [chrome.runtime.lastError.message]) });
                } else {
                     sendResponse({ success: response.success, error: response.error });
                }
            }
        );
        return true; // Async response to popup

    } else if (message.action === "displayAiResponse") { // Pushed from background for follow-up
         console.log("Content script: Received 'displayAiResponse' from background.");
         if (message.data && typeof message.data.response === 'string') {
             // Check if it's an error message (should be pre-formatted by background)
             const isError = message.data.response.startsWith(`[${getMsg("statusErrorGeneric")}`);
              displayChatMessage(message.data.response, isError ? 'error' : 'ai', !isError);
              if (isError) {
                 showStatusInChat(getMsg("statusErrorGeneric") + " (IA)", "error", 4000); // Show brief status
              }
         } else {
              const errorMsg = getMsg("errorInvalidApiResponse");
              console.warn("Summarizer: Received 'displayAiResponse' with invalid data:", message.data);
              showStatusInChat(errorMsg, "warning");
              displayChatMessage(`[${getMsg("statusErrorGeneric")}: ${errorMsg}]`, "error", false);
         }
         cleanupUI(); // Re-enable UI AFTER getting response/error
         return false;

     } else if (message.action === "apiKeyMissingError") {
          console.error("Summarizer: Background reported API Key is missing.");
          const errorMsg = message.error || getMsg("errorApiKeyNotConfigured");
          showStatusInChat(errorMsg, "error", 6000);
          displayChatMessage(`[${getMsg("statusErrorGeneric")}: ${errorMsg}]`, "error", false);
          cleanupUI();
          return false;
     }
     else {
          console.log("Content script: Received unhandled message action:", message.action);
          return false;
     }
});

// --- Lógica para añadir botón de control en la página ---
function addChatToggleButtonToPage() {
    const targetHeader = document.querySelector(CHAT_HEADER_SELECTOR);
    if (!targetHeader || document.getElementById('summarizer-toggle-button-page')) {
        return !!document.getElementById('summarizer-toggle-button-page');
    }
    console.log("Summarizer: Adding Toggle Chat button to header:", targetHeader);

    toggleChatButtonInPage = document.createElement('button');
    toggleChatButtonInPage.setAttribute('id', 'summarizer-toggle-button-page');
    toggleChatButtonInPage.textContent = getMsg("toggleButtonText");
    toggleChatButtonInPage.title = getMsg("toggleButtonTitle");
    toggleChatButtonInPage.addEventListener('click', toggleChatPanel);

    // Find insertion point
    let existingButtonsContainer = targetHeader.querySelector(HEADER_BUTTONS_CONTAINER_SELECTOR);
    if (!existingButtonsContainer) existingButtonsContainer = targetHeader.querySelector('div[role="toolbar"]');
    // Add more fallbacks if WA changes structure

     if (existingButtonsContainer && existingButtonsContainer.parentNode === targetHeader) {
        const firstButton = existingButtonsContainer.querySelector('button, div[role="button"]');
        if (firstButton) {
            existingButtonsContainer.insertBefore(toggleChatButtonInPage, firstButton);
             console.log("Summarizer: Toggle Chat button inserted before existing buttons.");
        } else {
             existingButtonsContainer.appendChild(toggleChatButtonInPage);
             console.log("Summarizer: Toggle Chat button appended to button container.");
        }
    } else {
        targetHeader.appendChild(toggleChatButtonInPage);
        console.warn("Summarizer: Suitable button container not found. Appending button to header end.");
    }
    return true;
}

function removeControlsFromPage() {
    if (toggleChatButtonInPage && toggleChatButtonInPage.parentNode) {
        toggleChatButtonInPage.parentNode.removeChild(toggleChatButtonInPage);
        console.log("Summarizer: Toggle Chat button removed.");
    }
    toggleChatButtonInPage = null;
}

// --- Lógica Principal de Inserción/Eliminación (MutationObserver) ---
let observer = null;

const observerCallback = (mutationsList, obs) => {
    let headerAppeared = false;
    const headerCurrentlyExists = !!document.querySelector(CHAT_HEADER_SELECTOR);
    const buttonExists = !!document.getElementById('summarizer-toggle-button-page');

    for (const mutation of mutationsList) {
        if (mutation.type === 'childList') {
            for (const node of mutation.addedNodes) {
                if (node.nodeType === Node.ELEMENT_NODE && (node.matches?.(CHAT_HEADER_SELECTOR) || node.querySelector?.(CHAT_HEADER_SELECTOR))) {
                     headerAppeared = true; break;
                }
            }
             if (headerAppeared) break;
        }
    }

     // --- Action ---
     if ((headerAppeared || headerCurrentlyExists) && !buttonExists) {
         console.log("Observer: Header detected, ensuring button exists...");
         setTimeout(addChatToggleButtonToPage, 500);
     }
     else if (!headerCurrentlyExists && buttonExists) {
         console.log("Observer: Header not found, removing controls...");
         removeControlsFromPage();
     }
};

// --- Inicialización ---
function initializeObserver() {
    if (observer) {
        console.log("Summarizer: Disconnecting existing observer before re-initializing.");
        observer.disconnect();
    }

    console.log("Summarizer: Setting up observer and initial interface creation...");
    observer = new MutationObserver(observerCallback);
    const targetNode = document.getElementById('app') || document.body;

    if (targetNode) {
        const config = { childList: true, subtree: true };
        observer.observe(targetNode, config);
        console.log("Summarizer: MutationObserver initiated on", targetNode.id || 'body');
        setTimeout(createChatInterface, 500);
        setTimeout(() => {
            if (document.querySelector(CHAT_HEADER_SELECTOR)) {
                addChatToggleButtonToPage();
            }
        }, 1500);
    } else {
        console.error("Summarizer: Could not find #app or body to initiate MutationObserver.");
        setTimeout(createChatInterface, 3000);
        setTimeout(addChatToggleButtonToPage, 3500);
    }
}

initializeObserver(); // Start

console.log("WhatsApp Summarizer: Content script ready (v0.4.5).");