// content_script.js - MODIFICADO v0.4.11 - Markdown, Copy Button

console.log("WhatsApp Summarizer: Content script cargado v0.4.11.");

// --- Selectores HTML ---
const MESSAGE_LIST_SELECTOR = '#main';
const MESSAGE_ROW_SELECTOR = 'div[role="row"]';
const MESSAGE_TEXT_SELECTOR = 'span.selectable-text.copyable-text';
const COPYABLE_TEXT_DIV_SELECTOR = 'div.copyable-text';
const OUTGOING_MESSAGE_INDICATOR = 'div.message-out';
const CHAT_HEADER_SELECTOR = 'header[data-testid="conversation-header"]';
const MESSAGE_TIME_SELECTOR_IN_META = 'span[data-testid="msg-meta"] span[aria-label]';
const TIMESTAMP_REGEX = /^\d{1,2}:\d{1,2}\s*(?:a\.m\.|p\.m\.)?$/i;
const PRE_PLAIN_TEXT_SENDER_REGEX = /\[.+?\]\s*([^:]+):\s*$/;
const MESSAGE_CONTENT_CONTAINER = 'div.copyable-text';
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
        if (chrome && chrome.i18n && chrome.i18n.getMessage) {
            return chrome.i18n.getMessage(key, substitutions) || key;
        }
        return key;
    } catch (e) {
        console.warn(`i18n CS Error getting key "${key}":`, e);
        return key;
    }
}

// --- Simple Markdown Parser ---
function simpleMarkdownToHtml(markdownText) {
    if (!markdownText) return '';

    let html = markdownText;

    // Escape HTML outside code blocks first
    html = html.replace(/</g, '<').replace(/>/g, '>');

    // Code blocks (``` lang\n code \n``` or ```\n code \n```)
    html = html.replace(/```(\w*)\n?([\s\S]*?)\n?```/g, (match, lang, code) => {
        const languageClass = lang ? ` class="language-${lang}"` : '';
        // Re-escape inside code block specifically
        const escapedCode = code.replace(/</g, '<').replace(/>/g, '>');
        return `<pre><code${languageClass}>${escapedCode.trim()}</code></pre>`;
    });

    // Inline code (`text`) - Done after code blocks
    html = html.replace(/`([^`]+?)`/g, (match, code) => {
        const escapedCode = code.replace(/</g, '<').replace(/>/g, '>');
        return `<code>${escapedCode}</code>`;
    });


    // Bold (**text**)
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    // Italics (*text* or _text_) - Improved regex
    html = html.replace(/(?<!\\)[*_](.*?)(?<!\\)[*_]/g, '<i>$1</i>');

    // Unordered lists (* item or - item)
    const lines = html.split('\n');
    let inList = false;
    const processedLines = lines.map(line => {
        let trimmedLine = line.trim();
        let listMatch = trimmedLine.match(/^(\s*)([\*\-])\s+(.*)/); // Check for *, - with optional indentation

        if (listMatch) {
            let indentation = listMatch[1].length; // We might use this later for nested lists
            let itemContent = listMatch[3];
            if (!inList) {
                inList = true;
                return `<ul><li>${itemContent}</li>`; // Start list
            } else {
                return `<li>${itemContent}</li>`; // Continue list
            }
        } else {
            if (inList) {
                inList = false;
                return `</ul>${line}`; // End list and add current line
            } else {
                return line; // Not in a list
            }
        }
    });
     if (inList) { // Close list if the last line was an item
        processedLines.push('</ul>');
     }
     html = processedLines.join('\n'); // Rejoin lines first

    // Convert remaining newlines to <br> AFTER list processing
    // Be careful not to add <br> inside <pre> tags
     const parts = html.split(/(<pre>[\s\S]*?<\/pre>)/); // Split by <pre> blocks
     html = parts.map((part, index) => {
         if (index % 2 === 1) { // It's a <pre> block
             return part;
         } else { // It's outside a <pre> block
             return part.replace(/\n/g, '<br>');
         }
     }).join('');


     // Clean up potential artifacts
     html = html.replace(/<br>\s*<br>/g, '<br>'); // Collapse double breaks
     html = html.replace(/<\/ul><br>/g, '</ul>'); // Remove break after list
     html = html.replace(/<br><ul>/g, '<ul>');   // Remove break before list
     html = html.replace(/^<br>|<br>$/g, '');   // Remove leading/trailing breaks

    return html;
}


// --- Funciones de Extracción ---
function extractLastMessages(count) {
     const mainPanel = document.querySelector(MESSAGE_LIST_SELECTOR);
    if (!mainPanel) { console.error("Summarizer: Could not find #main panel."); if (chatPanel && !chatPanel.classList.contains('hidden')) { showStatusInChat(getMsg("errorWhatsAppPanelNotFound"), "error"); } return []; }
    const messageElements = mainPanel.querySelectorAll(MESSAGE_ROW_SELECTOR);
    if (!messageElements || messageElements.length === 0) { console.warn("Summarizer: No message rows found."); if (chatPanel && !chatPanel.classList.contains('hidden')) { showStatusInChat(getMsg("errorNoMessagesFound"), "warning"); } return []; }

    console.log(`Summarizer: Found ${messageElements.length} potential message rows.`);
    const startIndex = Math.max(0, messageElements.length - count);
    const lastMessagesElements = Array.from(messageElements).slice(startIndex);
    console.log(`Summarizer: Attempting to extract last ${lastMessagesElements.length} messages.`);

    const extractedMessages = [];
    let lastKnownSender = getMsg("textUnknown");

    lastMessagesElements.forEach((msgRow, index) => {
        let text = null; let currentSender = null; let senderNameExplicitlyFoundThisRow = false; let isSystemEvent = false;
        const isOutgoing = msgRow.querySelector(OUTGOING_MESSAGE_INDICATOR);
        if (isOutgoing) { currentSender = getMsg("textYou"); lastKnownSender = currentSender; senderNameExplicitlyFoundThisRow = true; }
        else {
            const copyableDiv = msgRow.querySelector(COPYABLE_TEXT_DIV_SELECTOR);
            const prePlainText = copyableDiv?.getAttribute('data-pre-plain-text'); let nameFromPreText = null;
            if (prePlainText) { const match = prePlainText.match(PRE_PLAIN_TEXT_SENDER_REGEX); if (match && match[1]) { nameFromPreText = match[1].trim(); if (nameFromPreText.toLowerCase() === 'whatsapp') nameFromPreText = 'WhatsApp'; currentSender = nameFromPreText; lastKnownSender = currentSender; senderNameExplicitlyFoundThisRow = true; } }
            if (!senderNameExplicitlyFoundThisRow) { currentSender = lastKnownSender; }
        }
        const textEl = msgRow.querySelector(MESSAGE_TEXT_SELECTOR);
        if (textEl) { text = textEl.textContent?.trim() || ''; if (text === '' && textEl.closest('._ahn4, ._ahmw')) { text = getMsg("textMediaFile"); } }
        if (text === null || text === '') {
            const rowLabel = msgRow.getAttribute('aria-label')?.trim();
            if (rowLabel && !TIMESTAMP_REGEX.test(rowLabel)) {
                text = `[${rowLabel}]`; const rowLabelLower = rowLabel.toLowerCase(); let systemSenderType = null;
                if (rowLabelLower.includes('missed voice call') || rowLabelLower.includes('llamada de voz perdida')) { systemSenderType = getMsg("textMissedVoiceCall"); isSystemEvent = true; }
                else if (rowLabelLower.includes('missed video call') || rowLabelLower.includes('videollamada perdida')) { systemSenderType = getMsg("textMissedVideoCall"); isSystemEvent = true; }
                else if (rowLabel.match(/you were added|te añadió|se añadió|created group|creaste el grupo|left|salió|changed the subject|cambió el asunto|changed this group's icon|cambió el ícono de este grupo|security code changed|código de seguridad cambió|^📅\s+/i)) { systemSenderType = getMsg("textSystemMessage"); isSystemEvent = true; }
                else if (rowLabel.match(/messages and calls are end-to-end encrypted|mensajes y llamadas están cifrados/i)) { systemSenderType = getMsg("textSystemMessage"); text = null; isSystemEvent = true; }
                else if (rowLabel.match(/you deleted this message|eliminaste este mensaje/i)) { if(currentSender !== getMsg("textYou")) { currentSender = getMsg("textYou"); lastKnownSender = currentSender; } text = getMsg("textMessageDeletedByYou"); senderNameExplicitlyFoundThisRow = true; }
                else if (rowLabel.match(/this message was deleted|este mensaje fue eliminado/i)) { text = getMsg("textMessageDeleted"); }
                if (isSystemEvent && systemSenderType && (!senderNameExplicitlyFoundThisRow || currentSender === getMsg("textUnknown"))) { currentSender = systemSenderType; lastKnownSender = currentSender; }
            }
        }
        if (text !== null && text !== '' && text !== '[null]') {
             if (currentSender === null || currentSender === undefined) { currentSender = getMsg("textUnknown"); }
             extractedMessages.push({ sender: currentSender, text });
        }
    }); // End forEach

    console.log(`Summarizer: Successfully extracted ${extractedMessages.length} messages.`);
    if (extractedMessages.length === 0 && lastMessagesElements.length > 0) { console.warn("Summarizer: Found message rows but failed to extract any valid text content."); if (chatPanel && !chatPanel.classList.contains('hidden')) { showStatusInChat(getMsg("errorExtractionFailed"), "warning"); } }
    return extractedMessages;
 }


// --- Funciones de la Interfaz de Chat ---

/** Crea y añade el panel de chat al DOM si no existe */
function createChatInterface() {
    if (document.getElementById('summarizer-chat-panel')) { /* ... Ensure vars set ... */ return; }
    console.log("Summarizer: >>> Running createChatInterface <<<");
    chatPanel = document.createElement('div'); chatPanel.id = 'summarizer-chat-panel'; chatPanel.classList.add('hidden');
    const header = document.createElement('div'); header.id = 'summarizer-chat-header'; const title = document.createElement('h4'); title.textContent = getMsg("panelTitle");
    const headerButtonsGroup = document.createElement('div'); headerButtonsGroup.classList.add('summarizer-header-buttons');
    const optionsButton = document.createElement('button'); optionsButton.id = 'summarizer-chat-options-btn'; optionsButton.classList.add('summarizer-header-btn'); optionsButton.innerHTML = '⚙️'; optionsButton.title = getMsg("optionsButtonTitle"); optionsButton.style.fontSize = '16px';
    optionsButton.onclick = () => { chrome.runtime.sendMessage({ action: "openOptionsPage" }, (response) => { if (chrome.runtime.lastError) { console.error("Summarizer: Error sending openOptionsPage message:", chrome.runtime.lastError.message); alert(getMsg("errorCommunication", [chrome.runtime.lastError.message])); } }); };
    headerButtonsGroup.appendChild(optionsButton);
    chatClearButton = document.createElement('button'); chatClearButton.id = 'summarizer-chat-clear-btn'; chatClearButton.classList.add('summarizer-header-btn'); chatClearButton.innerHTML = '🗑️'; chatClearButton.title = getMsg("clearButtonTitle"); chatClearButton.onclick = handleClearChat; headerButtonsGroup.appendChild(chatClearButton);
    const closeButton = document.createElement('button'); closeButton.id = 'summarizer-chat-close-btn'; closeButton.classList.add('summarizer-header-btn'); closeButton.innerHTML = '×'; closeButton.title = getMsg("closeButtonTitle"); closeButton.onclick = toggleChatPanel; headerButtonsGroup.appendChild(closeButton);
    header.appendChild(title); header.appendChild(headerButtonsGroup);
    chatMessagesDiv = document.createElement('div'); chatMessagesDiv.id = 'summarizer-chat-messages';
    const inputArea = document.createElement('div'); inputArea.id = 'summarizer-chat-input-area';
    chatInput = document.createElement('textarea'); chatInput.id = 'summarizer-chat-input'; chatInput.placeholder = getMsg("inputPlaceholder"); chatInput.rows = 1; chatInput.title = getMsg("inputTitle");
    chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter' && !e.shiftKey && !chatInput.disabled) { e.preventDefault(); handleSendChatMessage(); } });
    chatInput.addEventListener('input', () => { chatInput.style.height = 'auto'; const scrollHeight = chatInput.scrollHeight; const maxHeight = 80; chatInput.style.height = `${Math.min(scrollHeight, maxHeight)}px`; });
    chatSendButton = document.createElement('button'); chatSendButton.id = 'summarizer-chat-send-btn'; chatSendButton.title = getMsg("sendButtonTitle");
    chatSendButton.innerHTML = `<svg viewBox="0 0 24 24" height="24" width="24" preserveAspectRatio="xMidYMid meet" version="1.1" x="0px" y="0px" enable-background="new 0 0 24 24" xml:space="preserve"><path fill="currentColor" d="M1.101,21.757L23.8,12.028L1.101,2.3l0.011,7.912l13.623,1.816L1.112,13.845 L1.101,21.757 Z"></path></svg>`;
    chatSendButton.onclick = handleSendChatMessage; inputArea.appendChild(chatInput); inputArea.appendChild(chatSendButton);
    chatPanel.appendChild(header); chatPanel.appendChild(chatMessagesDiv); chatPanel.appendChild(inputArea);
    try { document.body.appendChild(chatPanel); console.log("Summarizer: Chat panel appended to body."); } catch (error) { console.error("Summarizer: Failed to append chat panel to body!", error); }
}

/** Muestra u oculta el panel de chat */
function toggleChatPanel() {
    if (!chatPanel || !document.body.contains(chatPanel)) { createChatInterface(); if (!chatPanel) { return; } if (!document.body.contains(chatPanel)) { try { document.body.appendChild(chatPanel); } catch (e) { return; } } }
    const isCurrentlyHidden = chatPanel.classList.contains('hidden'); chatPanel.classList.toggle('hidden'); const isNowVisible = !chatPanel.classList.contains('hidden');
    console.log(`Summarizer: Panel toggled. Was hidden: ${isCurrentlyHidden}, Is visible: ${isNowVisible}.`);
    if (isNowVisible) { if (aiConversationHistory.length === 0 && chatMessagesDiv?.childElementCount === 0) { displayChatMessage(getMsg("initialGreeting"), "ai", false); } setTimeout(() => chatInput?.focus(), 50); }
}


/** Añade mensaje al panel y opcionalmente al historial lógico */
function displayChatMessage(text, type = 'ai', addToHistory = true) {
    if (!chatMessagesDiv) { console.error("Summarizer Error: chatMessagesDiv is null."); return; }

    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message', `${type}-message`);
    const messageContent = document.createElement('div'); // Wrapper for content
    messageContent.classList.add('message-content-wrapper'); // Add class for styling if needed

    // Apply Markdown Parsing for AI messages
    if (type === 'ai') {
        messageContent.innerHTML = simpleMarkdownToHtml(text);
    } else {
        // For user, system, error messages, just escape HTML and convert newlines
        const escapedText = text.replace(/</g, '<').replace(/>/g, '>');
        messageContent.innerHTML = escapedText.replace(/\n/g, '<br>');
    }
    messageElement.appendChild(messageContent); // Add content wrapper

    // Add Copy Button (only if text is not empty)
    if (text && text.trim() !== "") {
        const copyButton = document.createElement('button');
        copyButton.classList.add('summarizer-copy-btn');
        copyButton.innerHTML = '📄'; // Copy icon
        copyButton.title = getMsg("copyButtonTitle");
        const originalTitle = copyButton.title;
        let tooltipTimeout = null;

        copyButton.addEventListener('click', (e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(text) // Copy the raw original text
                .then(() => {
                    console.log('Text copied to clipboard');
                    copyButton.innerHTML = '✅'; // Feedback
                    copyButton.title = getMsg("copySuccessTooltip");
                    if (tooltipTimeout) clearTimeout(tooltipTimeout);
                    tooltipTimeout = setTimeout(() => {
                        copyButton.innerHTML = '📄';
                        copyButton.title = originalTitle;
                    }, 1500);
                })
                .catch(err => {
                    console.error('Failed to copy text: ', err);
                    copyButton.title = "Copy failed"; // Basic error feedback
                     if (tooltipTimeout) clearTimeout(tooltipTimeout);
                     tooltipTimeout = setTimeout(() => { copyButton.title = originalTitle; }, 1500);
                });
        });
        messageElement.appendChild(copyButton); // Add button next to content
    }

    chatMessagesDiv.appendChild(messageElement);
    chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight; // Auto-scroll

    // Add raw text to logical history
    if (addToHistory && (type === 'user' || type === 'ai')) {
        aiConversationHistory.push({ role: (type === 'ai' ? 'model' : 'user'), text: text });
    }
}


/** Muestra un mensaje de estado o error temporalmente en el chat */
function showStatusInChat(message, type = 'status', duration = 4000) {
     if (!chatMessagesDiv) { console.warn("Summarizer: chatMessagesDiv not available for status:", message); return; }
     const statusElement = document.createElement('div'); statusElement.classList.add('chat-message', `${type}-message`); statusElement.textContent = message;
     chatMessagesDiv.appendChild(statusElement); chatMessagesDiv.scrollTop = chatMessagesDiv.scrollHeight;
     if (duration > 0) { setTimeout(() => { if (statusElement && statusElement.parentNode === chatMessagesDiv) { try { chatMessagesDiv.removeChild(statusElement); } catch (e) {} } }, duration); }
}

/** Limpia historial lógico, contexto WA y panel visual */
function handleClearChat() {
    console.log("Summarizer: Clearing chat..."); aiConversationHistory = []; lastWaContext = [];
    if (chatMessagesDiv) { chatMessagesDiv.innerHTML = ''; }
    if (chatInput) { chatInput.value = ''; chatInput.style.height = 'auto'; chatInput.placeholder = getMsg("inputPlaceholder"); chatInput.disabled = false; chatInput.focus(); }
    if (chatSendButton) { chatSendButton.disabled = false; }
}

/** Maneja el envío de un mensaje desde el input del chat */
function handleSendChatMessage() {
    if (!chatInput || !chatInput.value.trim() || chatInput.disabled) return;
    const userMessage = chatInput.value.trim(); console.log("Summarizer: User message sent:", userMessage);
    displayChatMessage(userMessage, 'user', true); const currentUserMessageEntry = aiConversationHistory[aiConversationHistory.length - 1];
    const originalPlaceholder = getMsg("inputPlaceholder"); chatInput.value = ''; chatInput.style.height = 'auto'; chatInput.placeholder = getMsg("inputPlaceholderWaiting"); chatInput.disabled = true; chatSendButton.disabled = true;
    const summaryMatch = userMessage.match(/(?:resume|resumen|summary)\s*(?:los|las|the)?\s*(\d+)\s*(?:mensajes|msgs|messages)?/i) || userMessage.match(/(\d+)\s*(?:mensajes|msgs|messages)/i);
    let messageCount = 10; let isSummaryRequest = false;
    if (summaryMatch) { isSummaryRequest = true; const countStr = summaryMatch[1]; if (countStr) { const count = parseInt(countStr, 10); if (!isNaN(count) && count > 0) { messageCount = count; } else { showStatusInChat(getMsg("statusInvalidCount", [countStr, messageCount]), 'warning', 3000); } } showStatusInChat(getMsg("statusGeneratingSummary", [messageCount]), 'status'); }
    else { showStatusInChat(getMsg("statusSendingQuery"), 'status'); }
    const cleanupUI = () => { if(chatInput) { chatInput.placeholder = originalPlaceholder; chatInput.disabled = false; chatInput.focus(); } if(chatSendButton) { chatSendButton.disabled = false; } };
    if (isSummaryRequest) {
        console.log("Summarizer: Summary request."); aiConversationHistory = [currentUserMessageEntry]; lastWaContext = [];
        const messagesToProcess = extractLastMessages(messageCount);
        if (!messagesToProcess || messagesToProcess.length === 0) { const errorMsg = getMsg("errorExtractionFailed"); showStatusInChat(errorMsg, "error"); aiConversationHistory = []; displayChatMessage(`[${getMsg("statusErrorGeneric")}: ${errorMsg}]`, "error", false); cleanupUI(); return; }
        lastWaContext = messagesToProcess; console.log(`Summarizer: Stored ${lastWaContext.length} WA messages for context.`);
        chrome.runtime.sendMessage( { action: "processMessagesForSummary", data: messagesToProcess }, (response) => { handleBackgroundResponse(response); cleanupUI(); } );
    } else {
        const historyToSend = [...aiConversationHistory]; const waContextToSend = [...lastWaContext]; console.log(`Summarizer: Sending follow-up...`);
        chrome.runtime.sendMessage( { action: "sendFollowUpMessage", data: { history: historyToSend, waContext: waContextToSend } }, (response) => { if (chrome.runtime.lastError) { if (chrome.runtime.lastError.message?.includes("closed before a response was received")) { console.log("Summarizer: sendMessage port closed as expected for follow-up."); } else { console.error("Summarizer: Unexpected runtime error sending follow-up:", chrome.runtime.lastError.message); const errMsg = getMsg("errorCommunication", [chrome.runtime.lastError.message]); showStatusInChat(errMsg, "error"); displayChatMessage(`[${getMsg("statusErrorGeneric")}: ${errMsg}]`, "error", false); cleanupUI(); } } else if (response && !response.success) { console.error("Summarizer: Background reported immediate error on follow-up:", response.error); const errMsg = getMsg("errorProcessing", [response.error]); showStatusInChat(errMsg, "error"); displayChatMessage(`[${getMsg("statusErrorGeneric")}: ${errMsg}]`, "error", false); cleanupUI(); } } );
    }
}

/** Manejador unificado para respuestas del background (summary response) */
function handleBackgroundResponse(response) {
     if (chrome.runtime.lastError) { console.error("CS Error receiving via sendResponse:", chrome.runtime.lastError.message); const errorMsg = getMsg("errorCommunication", [chrome.runtime.lastError.message]); showStatusInChat(errorMsg, "error"); displayChatMessage(`[${getMsg("statusErrorGeneric")}: ${errorMsg}]`, "error", false); return; }
    console.log("CS: Response received via sendResponse:", response);
    if (response && response.success && response.summary) { displayChatMessage(response.summary, 'ai', true); }
    else if (response && !response.success && response.error) { const errorMsg = response.error || getMsg("errorUnexpectedResponse"); showStatusInChat(errorMsg, "error"); displayChatMessage(`[${getMsg("statusErrorGeneric")}: ${errorMsg}]`, "error", false); }
    else { const errorMsg = getMsg("errorUnexpectedResponse"); showStatusInChat(errorMsg, "error"); displayChatMessage(`[${getMsg("statusErrorGeneric")}: ${errorMsg}]`, "error", false); }
}

// --- Lógica de Comunicación (Listener Global) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("CS received message:", message.action);
    const cleanupUI = () => { if(chatInput) { chatInput.placeholder = getMsg("inputPlaceholder"); chatInput.disabled = false; if (!chatPanel?.classList.contains('hidden')) { chatInput.focus(); } } if(chatSendButton) { chatSendButton.disabled = false; } };
    if (message.action === "triggerSummaryFromPopup") {
        const count = message.count; if (isNaN(count) || count <= 0) { sendResponse({ success: false, error: getMsg("popupErrorInvalidNumber") }); return false; }
        try { if (!chatPanel || !document.body.contains(chatPanel)) createChatInterface(); if (chatPanel.classList.contains('hidden')) toggleChatPanel(); if (!chatPanel || chatPanel.classList.contains('hidden')) throw new Error("Panel creation/visibility failed."); } catch (error) { console.error("Summarizer: Error ensuring panel visibility:", error); sendResponse({ success: false, error: getMsg("errorPanelDisplayFailed") }); return false; }
        handleClearChat(); showStatusInChat(getMsg("statusGeneratingSummary", [count]), 'status'); if(chatInput) chatInput.disabled = true; if(chatSendButton) chatSendButton.disabled = true;
        const messagesToProcess = extractLastMessages(count);
        if (!messagesToProcess || messagesToProcess.length === 0) { const errorMsg = getMsg("errorExtractionFailed"); showStatusInChat(errorMsg, "error"); displayChatMessage(`[${getMsg("statusErrorGeneric")}: ${errorMsg}]`, "error", false); cleanupUI(); sendResponse({ success: false, error: errorMsg }); return false; }
        lastWaContext = messagesToProcess; aiConversationHistory = []; console.log(`Summarizer: Stored ${lastWaContext.length} WA msgs for context (from popup).`);
        chrome.runtime.sendMessage( { action: "processMessagesForSummary", data: messagesToProcess }, (response) => { handleBackgroundResponse(response); cleanupUI(); if (chrome.runtime.lastError) { sendResponse({ success: false, error: getMsg("errorCommunication", [chrome.runtime.lastError.message]) }); } else { sendResponse({ success: response.success, error: response.error }); } } );
        return true; // Async response expected
    } else if (message.action === "displayAiResponse") {
         console.log("CS: Received 'displayAiResponse'.");
         if (message.data?.response) { const isError = message.data.response.startsWith(`[${getMsg("statusErrorGeneric")}`) || message.data.response.includes(getMsg("errorAiError", "")); displayChatMessage(message.data.response, isError ? 'error' : 'ai', !isError); if (isError) { showStatusInChat(getMsg("statusErrorGeneric") + " (IA)", "error", 4000); } }
         else { const errorMsg = getMsg("errorInvalidApiResponse"); console.warn("CS: Invalid 'displayAiResponse' data:", message.data); showStatusInChat(errorMsg, "warning"); displayChatMessage(`[${getMsg("statusErrorGeneric")}: ${errorMsg}]`, "error", false); }
         cleanupUI(); return false; // No response needed
     } else if (message.action === "apiKeyMissingError") {
          console.error("CS: Background reported API Key missing."); const errorMsg = message.error || getMsg("errorApiKeyNotConfigured"); showStatusInChat(errorMsg, "error", 6000); displayChatMessage(`[${getMsg("statusErrorGeneric")}: ${errorMsg}]`, "error", false); cleanupUI(); return false;
     } else { console.log("CS: Unhandled message action:", message.action); return false; }
});

// --- Lógica para añadir botón de control en la página ---
function addChatToggleButtonToPage() {
    const targetHeader = document.querySelector(CHAT_HEADER_SELECTOR); if (!targetHeader || document.getElementById('summarizer-toggle-button-page')) { return !!document.getElementById('summarizer-toggle-button-page'); }
    console.log("Summarizer: Adding Toggle Chat button."); toggleChatButtonInPage = document.createElement('button'); toggleChatButtonInPage.setAttribute('id', 'summarizer-toggle-button-page'); toggleChatButtonInPage.textContent = getMsg("toggleButtonText"); toggleChatButtonInPage.title = getMsg("toggleButtonTitle"); toggleChatButtonInPage.addEventListener('click', toggleChatPanel);
    let existingButtonsContainer = targetHeader.querySelector(HEADER_BUTTONS_CONTAINER_SELECTOR); if (!existingButtonsContainer) existingButtonsContainer = targetHeader.querySelector('div[role="toolbar"]'); if (!existingButtonsContainer) existingButtonsContainer = targetHeader.querySelector('div > span > div[role="button"], div > div[role="button"]')?.parentNode;
     if (existingButtonsContainer && existingButtonsContainer.parentNode === targetHeader) { const firstButton = existingButtonsContainer.querySelector('button, div[role="button"]'); if (firstButton) { existingButtonsContainer.insertBefore(toggleChatButtonInPage, firstButton); } else { existingButtonsContainer.appendChild(toggleChatButtonInPage); } console.log("Summarizer: Toggle button added to container."); }
     else { targetHeader.appendChild(toggleChatButtonInPage); console.warn("Summarizer: Button container not found, appending to header end."); }
    return true;
}
function removeControlsFromPage() { if (toggleChatButtonInPage?.parentNode) { toggleChatButtonInPage.parentNode.removeChild(toggleChatButtonInPage); console.log("Summarizer: Toggle button removed."); } toggleChatButtonInPage = null; }

// --- Lógica Principal de Inserción/Eliminación (MutationObserver) ---
let observer = null;
const observerCallback = (mutationsList, obs) => {
    let headerAppeared = false; const headerCurrentlyExists = !!document.querySelector(CHAT_HEADER_SELECTOR); const buttonExists = !!document.getElementById('summarizer-toggle-button-page');
    // if (headerCurrentlyExists && buttonExists) { return; } // Optimization removed for potential header replacement case
    for (const mutation of mutationsList) { if (mutation.type === 'childList') { for (const node of mutation.addedNodes) { if (node.nodeType === Node.ELEMENT_NODE && (node.matches?.(CHAT_HEADER_SELECTOR) || node.querySelector?.(CHAT_HEADER_SELECTOR))) { headerAppeared = true; break; } } if (headerAppeared) break; } }
     if ((headerAppeared || headerCurrentlyExists) && !buttonExists) { console.log("Observer: Header detected, ensuring button exists..."); setTimeout(addChatToggleButtonToPage, 500); }
     else if (!headerCurrentlyExists && buttonExists) { console.log("Observer: Header not found, removing controls..."); removeControlsFromPage(); }
};

// --- Inicialización ---
function initializeObserver() {
    if (observer) { console.log("Summarizer: Disconnecting existing observer."); observer.disconnect(); }
    console.log("Summarizer: Setting up observer..."); observer = new MutationObserver(observerCallback); const targetNode = document.getElementById('app') || document.body;
    if (targetNode) { const config = { childList: true, subtree: true }; observer.observe(targetNode, config); console.log("Summarizer: Observer initiated on", targetNode.id || 'body'); setTimeout(createChatInterface, 500); setTimeout(() => { if (document.querySelector(CHAT_HEADER_SELECTOR)) { addChatToggleButtonToPage(); } }, 1500); }
    else { console.error("Summarizer: Target node not found for observer."); setTimeout(createChatInterface, 3000); setTimeout(addChatToggleButtonToPage, 3500); }
}
initializeObserver();
console.log("WhatsApp Summarizer: Content script ready (v0.4.11).");