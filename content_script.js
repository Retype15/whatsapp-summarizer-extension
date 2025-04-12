// content_script.js - MODIFICADO v0.4.1 - Contexto WA
console.log("WhatsApp Summarizer: Content script cargado v0.4.1.");

// --- Selectores HTML ---
const MESSAGE_LIST_SELECTOR = '#main';
const MESSAGE_ROW_SELECTOR = 'div[role="row"]';
const MESSAGE_TEXT_SELECTOR = 'span.selectable-text > span';
const MESSAGE_SENDER_SELECTOR_CANDIDATE = 'span[aria-label]';
const OUTGOING_MESSAGE_INDICATOR = 'div.message-out';
const CHAT_HEADER_SELECTOR = 'header[data-testid="conversation-header"]';
const MESSAGE_TIME_SELECTOR = 'span[data-testid="msg-meta"] span[aria-label]';
const HEADER_BUTTONS_CONTAINER_SELECTOR = 'div[data-testid="conversation-header"] > div:nth-child(3)';


// --- Variables Globales ---
let toggleChatButtonInPage = null;
let chatPanel = null;
let chatMessagesDiv = null;
let chatInput = null;
let chatSendButton = null;
let chatClearButton = null;

// Historial de conversación IA { role: 'user' | 'model', text: '...' }
let aiConversationHistory = [];
// Contexto de los mensajes de WhatsApp del último resumen solicitado
let lastWaContext = []; // Almacena { sender: '...', text: '...' }

// --- Funciones de Extracción ---
function extractLastMessages(count) {
    const mainPanel = document.querySelector(MESSAGE_LIST_SELECTOR);
    if (!mainPanel) {
        console.error("Summarizer: No se pudo encontrar el panel principal '#main'.");
        if(chatPanel && !chatPanel.classList.contains('hidden')) {
             showStatusInChat("Error: Panel principal de WhatsApp no encontrado.", "error");
        } else {
             console.error("Summarizer CRITICAL: WhatsApp main panel '#main' not found.");
        }
        return [];
    }
    const messageElements = mainPanel.querySelectorAll(MESSAGE_ROW_SELECTOR);
    if (!messageElements || messageElements.length === 0) {
        console.warn("Summarizer: No se encontraron filas de mensaje.");
        showStatusInChat("No se encontraron mensajes en este chat.", "warning");
        return [];
    }
    console.log(`Summarizer: Found ${messageElements.length} message rows.`);
    const startIndex = Math.max(0, messageElements.length - count);
    const lastMessagesElements = Array.from(messageElements).slice(startIndex);
    console.log(`Summarizer: Extracting last ${lastMessagesElements.length} messages.`);
    const extractedMessages = [];
    lastMessagesElements.forEach((msgRow, index) => {
        let text = 'No encontrado';
        let sender = 'Desconocido';
        const textEl = msgRow.querySelector(MESSAGE_TEXT_SELECTOR);
        if (textEl) {
            text = textEl.textContent.trim();
        } else {
            const rowLabel = msgRow.getAttribute('aria-label');
             if (rowLabel && !rowLabel.match(/^\d{1,2}:\d{2}\s*(a\.m\.|p\.m\.)?$/)) {
                text = `[${rowLabel.replace(':', '').trim()}]`;
            } else {
                 return;
            }
        }
        const isOutgoing = msgRow.querySelector(OUTGOING_MESSAGE_INDICATOR);
        if (isOutgoing) {
            sender = 'Tú';
        } else {
            const potentialSenderEls = msgRow.querySelectorAll(MESSAGE_SENDER_SELECTOR_CANDIDATE);
            const timeEl = msgRow.querySelector(MESSAGE_TIME_SELECTOR);
            let foundSender = false;
            potentialSenderEls.forEach(span => {
                const potentialName = span.textContent.trim();
                const isTimestamp = /^\d{1,2}:\d{2}\s*(a\.m\.|p\.m\.)?$/.test(potentialName);
                if (span !== timeEl && !span.closest('span.selectable-text') && potentialName && !isTimestamp) {
                    sender = potentialName.replace(/:$/, '').trim();
                    foundSender = true;
                    return;
                }
            });
            if (!foundSender) sender = 'Entrante';
        }
        extractedMessages.push({ sender, text });
    });
    return extractedMessages;
}


// --- Funciones de la Interfaz de Chat ---

/** Crea y añade el panel de chat al DOM si no existe */
function createChatInterface() {
    // Evitar doble creación
    if (document.getElementById('summarizer-chat-panel')) {
         console.log("Summarizer: createChatInterface called, but panel already exists.");
         // Reasignar variables globales por si acaso (importante si script se recarga)
         if (!chatPanel) chatPanel = document.getElementById('summarizer-chat-panel');
         if (!chatMessagesDiv) chatMessagesDiv = document.getElementById('summarizer-chat-messages');
         if (!chatInput) chatInput = document.getElementById('summarizer-chat-input');
         if (!chatSendButton) chatSendButton = document.getElementById('summarizer-chat-send-btn');
         if (!chatClearButton) chatClearButton = document.getElementById('summarizer-chat-clear-btn');
         // Reasignar también el botón de opciones si ya existe
         // if (!optionsButton) optionsButton = document.getElementById('summarizer-chat-options-btn'); // Necesitaría variable global
        return;
    }

    console.log("Summarizer: >>> Running createChatInterface <<<");

    chatPanel = document.createElement('div');
    chatPanel.id = 'summarizer-chat-panel';
    chatPanel.classList.add('hidden');

    // --- Cabecera ---
    const header = document.createElement('div');
    header.id = 'summarizer-chat-header';
    const title = document.createElement('h4');
    title.textContent = 'Resumen IA';

    // Grupo de botones derechos
    const headerButtonsGroup = document.createElement('div');
    headerButtonsGroup.classList.add('summarizer-header-buttons'); // Clase para agrupar

    // --- Botón de Opciones (AÑADIDO/INTEGRADO) ---
    const optionsButton = document.createElement('button');
    optionsButton.id = 'summarizer-chat-options-btn'; // Asignar ID si se necesita referenciar
    optionsButton.classList.add('summarizer-header-btn');
    optionsButton.innerHTML = '⚙️'; // Icono de engranaje
    optionsButton.title = 'Abrir configuración';
    optionsButton.style.fontSize = '16px'; // Ajustar tamaño si es necesario
    optionsButton.onclick = () => {
        // Enviar mensaje al background para abrir la página de opciones
        console.log("Summarizer: Requesting options page opening...");
        chrome.runtime.sendMessage({ action: "openOptionsPage" }, (response) => {
             if (chrome.runtime.lastError) {
                 console.error("Summarizer: Error sending openOptionsPage message:", chrome.runtime.lastError.message);
                 // Informar al usuario si falla
                 alert("Error al intentar abrir la configuración. Verifica la consola de la extensión.");
             }
        });
    };
    // Añadir el botón de opciones PRIMERO al grupo
    headerButtonsGroup.appendChild(optionsButton);

    // Botón Limpiar
    chatClearButton = document.createElement('button');
    chatClearButton.id = 'summarizer-chat-clear-btn';
    chatClearButton.classList.add('summarizer-header-btn');
    // Usar icono de papelera simple. Considerar SVG para mejor consistencia.
    // Puedes buscar "trash can unicode" o usar un SVG. '' a veces funciona.
    chatClearButton.innerHTML = '🗑️'; // Emoji de papelera (puede variar entre sistemas)
    chatClearButton.title = 'Limpiar chat y contexto';
    chatClearButton.onclick = handleClearChat;
    headerButtonsGroup.appendChild(chatClearButton); // Añadir después de opciones

    // Botón Cerrar
    const closeButton = document.createElement('button');
    closeButton.id = 'summarizer-chat-close-btn';
    closeButton.classList.add('summarizer-header-btn');
    closeButton.innerHTML = '×'; // Caracter 'x' para cerrar
    closeButton.title = 'Cerrar panel';
    closeButton.onclick = toggleChatPanel;
    headerButtonsGroup.appendChild(closeButton); // Añadir al final del grupo

    // Añadir título y grupo de botones al header
    header.appendChild(title);
    header.appendChild(headerButtonsGroup); // Añadir el grupo completo

    // --- Área de Mensajes ---
    chatMessagesDiv = document.createElement('div');
    chatMessagesDiv.id = 'summarizer-chat-messages';

    // --- Área de Input ---
    const inputArea = document.createElement('div');
    inputArea.id = 'summarizer-chat-input-area';
    chatInput = document.createElement('textarea');
    chatInput.id = 'summarizer-chat-input';
    chatInput.placeholder = 'Pide resumen (ej: "10 msgs") o pregunta...';
    chatInput.rows = 1;
    chatInput.title = 'Escribe tu pregunta o comando aquí (Enter para enviar, Shift+Enter para nueva línea)';
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendChatMessage(); }
    });
     chatInput.addEventListener('input', () => {
         chatInput.style.height = 'auto';
         const scrollHeight = chatInput.scrollHeight;
         const maxHeight = 80; // Definido en CSS
         chatInput.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
     });
    chatSendButton = document.createElement('button');
    chatSendButton.id = 'summarizer-chat-send-btn';
    chatSendButton.title = 'Enviar mensaje';
    chatSendButton.innerHTML = `<svg viewBox="0 0 24 24" height="24" width="24" preserveAspectRatio="xMidYMid meet" version="1.1" x="0px" y="0px" enable-background="new 0 0 24 24" xml:space="preserve"><path fill="currentColor" d="M1.101,21.757L23.8,12.028L1.101,2.3l0.011,7.912l13.623,1.816L1.112,13.845 L1.101,21.757 Z"></path></svg>`;
    chatSendButton.onclick = handleSendChatMessage;
    inputArea.appendChild(chatInput);
    inputArea.appendChild(chatSendButton);

    // --- Ensamblar Panel ---
    chatPanel.appendChild(header);
    chatPanel.appendChild(chatMessagesDiv);
    chatPanel.appendChild(inputArea);

    // --- Añadir al Body ---
    try {
        document.body.appendChild(chatPanel);
        console.log("Summarizer: Chat panel appended to body.");
    } catch (error) {
         console.error("Summarizer: Failed to append chat panel to body!", error);
         return; // Salir si falla la inserción
    }

    // Mensaje inicial se mostrará en toggleChatPanel si es necesario
}

/** Muestra u oculta el panel de chat */
function toggleChatPanel() {
    console.log("Summarizer: >>> Running toggleChatPanel <<<");
    if (!chatPanel) {
        console.log("Summarizer: Chat panel doesn't exist, creating...");
        createChatInterface();
        if (!chatPanel) {
            console.error("Summarizer: Failed to create panel within toggleChatPanel!");
            return;
        }
    }
    if (!document.body.contains(chatPanel)) {
         console.warn("Summarizer: chatPanel variable exists, but element not in DOM. Re-appending.");
         try {
             document.body.appendChild(chatPanel);
             chatPanel.classList.add('hidden'); // Asegurar estado inicial si se re-añade
         } catch (error) {
             console.error("Summarizer: Failed to re-append chat panel!", error);
             return;
         }
     }

    console.log("Summarizer: Toggling 'hidden' class. Current classes:", chatPanel.classList);
    const isNowHidden = chatPanel.classList.toggle('hidden');
    console.log(`Summarizer: Panel is now ${isNowHidden ? 'hidden' : 'visible'}. New classes:`, chatPanel.classList);

    if (!isNowHidden) {
        // Si es la primera vez que se muestra Y el historial está vacío, mostrar saludo
        if (aiConversationHistory.length === 0 && chatMessagesDiv?.childElementCount === 0) {
             displayChatMessage("Hola. Pide un resumen (ej: 'resume 10 mensajes') o haz una pregunta.", "ai", false);
        }
        setTimeout(() => chatInput?.focus(), 50);
    }
}

/** Añade mensaje al panel y opcionalmente al historial lógico */
function displayChatMessage(text, type = 'ai', addToHistory = true) {
    if (!chatMessagesDiv) {
        console.error("Summarizer Error: chatMessagesDiv is null in displayChatMessage.");
        if (chatPanel) chatMessagesDiv = chatPanel.querySelector('#summarizer-chat-messages');
        if (!chatMessagesDiv) {
             console.error("Summarizer CRITICAL: Cannot find chatMessagesDiv.");
             return;
        }
    }
    const messageElement = document.createElement('div');
    messageElement.classList.add('chat-message', `${type}-message`);
    messageElement.textContent = text;
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
                 chatMessagesDiv.removeChild(statusElement);
             }
         }, duration);
     }
}

/** Limpia historial lógico, contexto WA y panel visual */
function handleClearChat() {
    console.log("Summarizer: Clearing chat, AI history, and WA context...");
    aiConversationHistory = []; // Limpiar historial lógico AI
    lastWaContext = []; // Limpiar contexto WA almacenado
    if (chatMessagesDiv) {
        chatMessagesDiv.innerHTML = ''; // Limpiar mensajes visuales
    }
    // YA NO mostramos el mensaje "Chat limpiado..."
    if (chatInput) {
         chatInput.value = '';
         chatInput.style.height = 'auto';
         chatInput.focus();
         // Opcional: Mostrar placeholder de nuevo si se borró
         chatInput.placeholder = 'Pide resumen (ej: "10 msgs") o pregunta...';
    }
}

/** Maneja el envío de un mensaje desde el input del chat */
function handleSendChatMessage() {
    if (!chatInput || !chatInput.value.trim()) return;

    const userMessage = chatInput.value.trim();
    console.log("Summarizer: User message sent:", userMessage);

    // Mostrar y añadir al historial AI
    displayChatMessage(userMessage, 'user', true);
    const currentUserMessageEntry = aiConversationHistory[aiConversationHistory.length - 1]; // Referencia

    chatInput.value = '';
    chatInput.style.height = 'auto';

    // Determinar tipo de solicitud
    const summaryMatch = userMessage.match(/(?:resume|resumen|summary)\s*(?:los|las|the)?\s*(\d+)?/i)
                      || userMessage.match(/(\d+)\s*(?:mensajes|msgs|messages)/i);
    let messageCount = 10;
    let isSummaryRequest = false;

    if (summaryMatch) {
        isSummaryRequest = true;
        if (summaryMatch[1]) {
            const count = parseInt(summaryMatch[1], 10);
            if (!isNaN(count) && count > 0) messageCount = count;
            else showStatusInChat(`Número inválido, usando ${messageCount} mensajes por defecto.`, 'warning', 3000);
        }
         showStatusInChat(`Ok, generando resumen de los últimos ${messageCount} mensajes...`, 'status');
    }

    if (isSummaryRequest) {
        // --- Proceso de Resumen ---
        console.log("Summarizer: Summary request. Clearing AI history (keeping request) and WA context.");
        aiConversationHistory = [currentUserMessageEntry]; // Mantener solo la solicitud actual
        lastWaContext = []; // Limpiar contexto WA previo

        const messagesToProcess = extractLastMessages(messageCount);
        if (!messagesToProcess || messagesToProcess.length === 0) {
            showStatusInChat("No se pudieron extraer mensajes de WhatsApp para resumir.", "error");
            aiConversationHistory = []; // Limpiar también la solicitud si falla extracción
            displayChatMessage("[Error al extraer mensajes de WhatsApp]", "error", false);
            return;
        }

        // Guardar el NUEVO contexto de WA
        lastWaContext = messagesToProcess;
        console.log(`Summarizer: Stored ${lastWaContext.length} WA messages for context.`);

        // Enviar al background SOLO los mensajes de WA para el resumen inicial
        chrome.runtime.sendMessage(
            { action: "processMessagesForSummary", data: messagesToProcess },
            handleBackgroundResponse // Manejará la respuesta y la añadirá al historial AI
        );
    } else {
        // --- Proceso de Pregunta General / Continuación ---
        showStatusInChat(`Enviando pregunta (con contexto) a la IA...`, 'status');

        // Enviar historial AI Y el último contexto WA almacenado
        const historyToSend = [...aiConversationHistory];
        const waContextToSend = [...lastWaContext];

        chrome.runtime.sendMessage(
            {
                action: "sendFollowUpMessage",
                data: {
                     history: historyToSend,
                     waContext: waContextToSend // Enviar contexto WA
                }
            }
        );
    }
}

/** Manejador unificado para respuestas del background (cuando usa sendResponse) */
function handleBackgroundResponse(response) {
     if (chrome.runtime.lastError) {
         console.error("Content Script Error (Receiving from Background):", chrome.runtime.lastError.message);
         showStatusInChat(`Error de comunicación con el servicio: ${chrome.runtime.lastError.message}`, "error");
         return;
     }
    console.log("Content script: Respuesta recibida del background via sendResponse:", response);
    if (response && response.success && (response.summary || response.followUpResponse)) {
        const aiResponseText = response.summary || response.followUpResponse;
        displayChatMessage(aiResponseText, 'ai', true); // Mostrar y añadir al historial
    } else if (response && !response.success && response.error) {
        showStatusInChat(`Error al procesar: ${response.error}`, "error");
    } else {
        showStatusInChat("Respuesta inesperada o fallida del script de fondo.", "error");
    }
}

// --- Lógica de Comunicación (Listener Global) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Content script received message:", message);

    if (message.action === "triggerSummaryFromPopup") {
        console.log(`Content script: Processing 'triggerSummaryFromPopup' for ${message.count} messages.`);
        const count = message.count;
        if (isNaN(count) || count <= 0) {
            sendResponse({ success: false, error: "Invalid count" });
            return false;
        }

        // 1. Asegurar panel visible
        try {
             if (!chatPanel) createChatInterface();
             if (chatPanel.classList.contains('hidden')) toggleChatPanel();
              if (!chatPanel || chatPanel.classList.contains('hidden')) throw new Error("Panel failed to become visible.");
        } catch (error) {
             console.error("Summarizer: Error ensuring panel visibility from popup:", error);
             sendResponse({ success: false, error: "Failed to display chat panel" });
             return false;
        }

        // 2. Limpiar chat (historial AI, contexto WA, panel visual)
        handleClearChat();
        showStatusInChat(`Generando resumen de ${count} mensajes (pedido desde popup)...`, 'status');

        // 3. Extraer mensajes
        const messagesToProcess = extractLastMessages(count);
        if (!messagesToProcess || messagesToProcess.length === 0) {
             showStatusInChat("Falló la extracción de mensajes de WhatsApp.", "error");
            sendResponse({ success: false, error: "Extraction failed" });
            return false;
        }

        // 4. Guardar contexto WA y enviar al background
        lastWaContext = messagesToProcess; // Guardar contexto
        aiConversationHistory = []; // Historial AI empieza vacío para resumen
        console.log(`Summarizer: Stored ${lastWaContext.length} WA messages for context (from popup).`);
        chrome.runtime.sendMessage(
            { action: "processMessagesForSummary", data: messagesToProcess },
            (response) => {
                handleBackgroundResponse(response);
                if (chrome.runtime.lastError) {
                     sendResponse({ success: false, error: chrome.runtime.lastError.message });
                } else {
                     sendResponse({ success: true });
                }
            }
        );
        return true; // Async response

    } else if (message.action === "displayAiResponse") { // Push desde background para seguimiento
         console.log("Content script: Received 'displayAiResponse' from background.");
         if (message.data && typeof message.data.response === 'string') {
              displayChatMessage(message.data.response, 'ai', true);
         } else {
              console.warn("Summarizer: Received 'displayAiResponse' with invalid data:", message.data);
              showStatusInChat("Recibida respuesta inválida de la IA.", "warning");
         }
         return false; // No sendResponse needed
     }
     else {
          console.log("Content script: Received unhandled message action:", message.action);
          return false;
     }
});

// --- Lógica para añadir botón de control en la página (Sin cambios lógicos) ---
function addChatToggleButtonToPage() {
    const targetHeader = document.querySelector(CHAT_HEADER_SELECTOR);
    if (!targetHeader || document.getElementById('summarizer-toggle-button-page')) {
        return !!document.getElementById('summarizer-toggle-button-page');
    }
    console.log("Summarizer: Adding Toggle Chat button to header:", targetHeader);
    toggleChatButtonInPage = document.createElement('button');
    toggleChatButtonInPage.setAttribute('id', 'summarizer-toggle-button-page');
    toggleChatButtonInPage.textContent = 'Chat IA';
    toggleChatButtonInPage.title = 'Abrir/Cerrar panel de Resumen IA';
    toggleChatButtonInPage.addEventListener('click', toggleChatPanel);

    let existingButtonsContainer = targetHeader.querySelector(HEADER_BUTTONS_CONTAINER_SELECTOR)
                                  || targetHeader.querySelector('div[role="toolbar"]');
    if (!existingButtonsContainer) {
         existingButtonsContainer = targetHeader.querySelector('div:last-child:not([class*="avatar"])');
         if (existingButtonsContainer === targetHeader) existingButtonsContainer = null;
    }

     if (existingButtonsContainer && existingButtonsContainer.parentNode === targetHeader) {
        targetHeader.insertBefore(toggleChatButtonInPage, existingButtonsContainer);
        console.log("Summarizer: Toggle Chat button added before existing buttons.");
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

// --- Lógica Principal de Inserción/Eliminación (MutationObserver - Sin cambios) ---
const observerCallback = (mutationsList, observer) => {
    let headerVisible = false; let headerRemoved = false;
    for(const mutation of mutationsList) { /* ... (detection logic) ... */
         if (mutation.type === 'childList') {
             mutation.addedNodes.forEach(node => { if (node.nodeType === Node.ELEMENT_NODE && (node.matches(CHAT_HEADER_SELECTOR) || node.querySelector(CHAT_HEADER_SELECTOR))) { headerVisible = true; } });
             mutation.removedNodes.forEach(node => { if (node.nodeType === Node.ELEMENT_NODE && (node.matches(CHAT_HEADER_SELECTOR) || node.querySelector(CHAT_HEADER_SELECTOR))) { headerRemoved = true; } });
         }
    }
    if (headerVisible && !document.getElementById('summarizer-toggle-button-page')) {
        console.log("Observer: Header detected, ensuring button exists...");
        setTimeout(addChatToggleButtonToPage, 300);
    } else if (headerRemoved || !document.querySelector(CHAT_HEADER_SELECTOR)) {
        console.log("Observer: Header removed or not found, removing controls...");
        removeControlsFromPage();
    }
};

// --- Inicialización ---
console.log("Summarizer: Setting up observer and initial interface creation...");
const observer = new MutationObserver(observerCallback);
const targetNode = document.getElementById('app') || document.body;
if (targetNode) {
    const config = { childList: true, subtree: true };
    observer.observe(targetNode, config);
    console.log("Summarizer: MutationObserver initiated on", targetNode.id || 'body');
    // Crear interfaz (oculta) pronto
    setTimeout(createChatInterface, 1000);
    // Intentar añadir botón después
    setTimeout(addChatToggleButtonToPage, 2000);
} else {
    console.error("Summarizer: Could not find #app or body to initiate MutationObserver.");
    setTimeout(createChatInterface, 3000);
    setTimeout(addChatToggleButtonToPage, 3500);
}

console.log("WhatsApp Summarizer: Content script ready (v0.3.0).");