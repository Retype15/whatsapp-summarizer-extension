// background.js

// API Key de Gemini (¡REEMPLAZAR con tu clave real!  NUNCA la incluyas directamente en el código si lo vas a compartir)
//const GEMINI_API_KEY = 'AIzaSyBNC_SG46la9GyfNih_tKGM8o0ZyvctD9Q'; // TODO:  Usar una forma más segura de gestionar esto.
// background.js - MODIFICADO v0.4.1 - Incluye handler para openOptionsPage

const MODEL_ID = 'gemini-1.5-flash'; // O el modelo que prefieras usar
const GENERATE_CONTENT_API = 'generateContent';

// --- Valores por Defecto para Prompts (usados si no hay nada en storage) ---
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


// --- Función para obtener la configuración guardada ---
async function getSettings() {
    return new Promise((resolve) => {
        chrome.storage.sync.get({
            geminiApiKey: '', // Default: vacío si no se ha guardado
            summaryPrompt: DEFAULT_SUMMARY_PROMPT,
            followUpPrompt: DEFAULT_FOLLOW_UP_PROMPT
        }, (items) => {
            if (chrome.runtime.lastError) {
                console.error("Background: Error loading settings from storage:", chrome.runtime.lastError.message);
                // Devolver defaults en caso de error grave al cargar
                resolve({
                    apiKey: '',
                    summaryPrompt: DEFAULT_SUMMARY_PROMPT,
                    followUpPrompt: DEFAULT_FOLLOW_UP_PROMPT
                });
            } else {
                 // Asegurarse de devolver defaults si los valores cargados son null/undefined/vacíos
                 resolve({
                     apiKey: items.geminiApiKey || '',
                     summaryPrompt: items.summaryPrompt || DEFAULT_SUMMARY_PROMPT,
                     followUpPrompt: items.followUpPrompt || DEFAULT_FOLLOW_UP_PROMPT
                 });
            }
        });
    });
}


// --- Listener Principal de Mensajes ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Background: Received message action:", message.action);

    // Envolver la lógica en una función async para usar await
    async function handleMessage() {
        const settings = await getSettings();

        // --- Manejador para abrir página de opciones ---
        if (message.action === "openOptionsPage") {
            console.log("Background: Opening options page requested.");
            chrome.runtime.openOptionsPage();
            // No se necesita sendResponse ni devolver true desde el listener principal para esto.
            return; // Salir de handleMessage
        }

        // --- Verificar API Key ---
        if (!settings.apiKey && (message.action === "processMessagesForSummary" || message.action === "sendFollowUpMessage")) {
            console.error("Background: Gemini API Key is not configured.");
            const errorMessage = "Error: La API Key de Gemini no está configurada...";
             if (sender.tab && sender.tab.id) {
                  try {
                      await chrome.tabs.sendMessage(sender.tab.id, { action: "displayAiResponse", data: { response: errorMessage } });
                  } catch (error) { console.error("BG: Failed to send API key error:", error.message); }
             }
             // Respondemos al listener original aquí porque la operación falló antes de empezar
             sendResponse({ success: false, error: errorMessage });
             return; // Salir de handleMessage
        }

        // --- Manejador para resumen inicial ---
        if (message.action === "processMessagesForSummary") {
            const messages = message.data;
            console.log(`Background: Processing ${messages?.length || 0} messages for initial summary.`);
            if (!messages || messages.length === 0) {
                 sendResponse({ success: false, error: "No messages provided for summary." });
                 return; // Salir de handleMessage
            }
            const promptText = formatMessagesForGeminiSummary(messages, settings.summaryPrompt);

            try {
                const summary = await callGeminiAPI([{ role: 'user', parts: [{ text: promptText }] }], settings.apiKey);
                console.log("Background: Initial summary generated successfully.");
                // *** LLAMAMOS a sendResponse aquí ***
                sendResponse({ success: true, summary: summary });
            } catch (error) {
                console.error("Background: Error calling Gemini for initial summary:", error);
                // *** LLAMAMOS a sendResponse aquí ***
                sendResponse({ success: false, error: error.message || "Unknown API error" });
            }
             // El flujo termina aquí para esta acción dentro de handleMessage

        // --- Manejador para preguntas de seguimiento ---
        } else if (message.action === "sendFollowUpMessage") {
            const followUpData = message.data;
            const aiHistory = followUpData.history || [];
            const waContext = followUpData.waContext || [];

            if (!aiHistory.length) {
                console.warn("Background: Received sendFollowUpMessage without AI history.");
                // Aunque no hagamos nada, NO debemos llamar a sendResponse si no es necesario
                // sendResponse({ success: false, error: "No AI history provided" }); // Podría causar el error si content script no espera
                return; // Salir de handleMessage
            }

            console.log(`Background: Processing follow-up...`);
            const fullPromptText = buildFollowUpPrompt(waContext, aiHistory, settings.followUpPrompt);

             try {
                 const aiResponse = await callGeminiAPI([{ role: 'user', parts: [{ text: fullPromptText }] }], settings.apiKey);
                 console.log("Background: Follow-up response generated.");
                 // *** USAMOS tabs.sendMessage ***
                 if (sender.tab && sender.tab.id) {
                      try {
                          await chrome.tabs.sendMessage(sender.tab.id, { action: "displayAiResponse", data: { response: aiResponse } });
                          console.log("BG: Follow-up response sent via tabs.sendMessage.");
                      } catch (error) {
                           console.error("BG: Error sending follow-up response to tab:", error.message);
                      }
                 } else {
                      console.error("BG: No sender tab ID for follow-up response.");
                 }
                 // *** NO llamamos a sendResponse aquí después de tabs.sendMessage ***
             } catch (error) {
                 console.error("Background: Error calling Gemini for follow-up:", error);
                 const errorMessage = `Error de la IA: ${error.message}`;
                 // Intentar enviar error al content script via tabs.sendMessage
                  if (sender.tab && sender.tab.id) {
                       try {
                           await chrome.tabs.sendMessage(sender.tab.id, { action: "displayAiResponse", data: { response: errorMessage } });
                           console.log("BG: Error message sent via tabs.sendMessage.");
                       } catch (errorMsg) {
                            console.error("BG: Error sending error message to tab:", errorMsg.message);
                       }
                  }
                 // *** NO llamamos a sendResponse aquí tampoco ***
                 // Si el content script inició esto y esperaba una respuesta vía sendResponse,
                 // ahora no la recibirá, lo cual es correcto ya que la comunicación principal
                 // para esta acción es tabs.sendMessage. El content script debe manejar
                 // esto (mostrando el error recibido por displayAiResponse o un timeout si no llega nada).
             }
             // El flujo termina aquí para esta acción dentro de handleMessage

        // --- Acción no manejada ---
        } else {
             console.log("Background: Unhandled action received:", message.action);
             // No llamar a sendResponse a menos que sea necesario para una acción no manejada específica
        }
    } // Fin de la función async handleMessage

    // Ejecutar el manejador asíncrono, pero NO esperamos que termine aquí
    handleMessage();

    // --- Decisión Final de Devolver True ---
    // SOLO devolvemos true si la acción fue 'processMessagesForSummary',
    // porque esa es la ÚNICA acción dentro de handleMessage que garantizamos
    // que llamará a sendResponse. Para las demás (openOptionsPage, sendFollowUpMessage),
    // no usamos sendResponse como método principal o no lo usamos en absoluto.
    if (message.action === "processMessagesForSummary") {
        console.log("Background: Returning true (async response expected for summary).");
        return true;
    } else {
        console.log(`Background: Returning false (no async response expected via sendResponse for action: ${message.action}).`);
        return false;
    }
    // Alternativa más concisa:
    // const requiresSendResponse = message.action === "processMessagesForSummary";
    // console.log(`Background: Returning ${requiresSendResponse} (async response expected: ${requiresSendResponse})`);
    // return requiresSendResponse;

}); // Fin del addListener

// --- Funciones Auxiliares ---

/** Formatea mensajes de WA usando el prompt de resumen proporcionado */
function formatMessagesForGeminiSummary(messages, summaryPromptTemplate) {
    let messageString = "";
    if (Array.isArray(messages) && messages.length > 0) {
        messageString = messages.map(msg => {
            // Limitar longitud de mensajes individuales para evitar prompts excesivos
            const truncatedText = msg.text.length > 350 ? msg.text.substring(0, 347) + "..." : msg.text;
            return `[${msg.sender}]: ${truncatedText}`;
        }).join("\n");
    } else {
        messageString = "No hay mensajes proporcionados.";
    }
    // Reemplazar placeholder en la plantilla
    return summaryPromptTemplate.replace('{messages}', messageString);
}

/** Construye el prompt de seguimiento usando la plantilla proporcionada */
function buildFollowUpPrompt(waContext, aiHistory, followUpPromptTemplate) {
    let waContextString = "No hay contexto de WhatsApp previo disponible.";
    if (waContext && waContext.length > 0) {
        waContextString = waContext.map(msg => {
            const truncatedText = msg.text.length > 350 ? msg.text.substring(0, 347) + "..." : msg.text;
            return `[${msg.sender}]: ${truncatedText}`;
        }).join("\n");
        // Limitar longitud total del contexto WA si es necesario
        if (waContextString.length > 4000) { // Ejemplo de límite
             waContextString = waContextString.substring(0, 3997) + "... (contexto truncado)";
        }
    }

    let aiHistoryString = "(Inicio de la conversación)";
    if (aiHistory && aiHistory.length > 0) {
        aiHistoryString = aiHistory.map(turn => {
            const roleLabel = turn.role === 'user' ? 'Usuario' : 'IA';
            // No truncar historial IA, es más crucial para el flujo
            return `${roleLabel}: ${turn.text}`;
        }).join("\n");
         // Limitar longitud total del historial IA si es necesario
         if (aiHistoryString.length > 4000) { // Ejemplo de límite
              // Truncar desde el principio para mantener lo más reciente
              aiHistoryString = "... (historial truncado)\n" + aiHistoryString.substring(aiHistoryString.length - 3997);
         }
    }

    // Reemplazar placeholders en la plantilla
    let prompt = followUpPromptTemplate.replace('{waContext}', waContextString);
    prompt = prompt.replace('{aiHistory}', aiHistoryString);

    return prompt;
}


/** Llama a la API de Gemini (AHORA requiere la API Key como argumento) */
async function callGeminiAPI(contentsPayload, apiKey) {
     if (!apiKey) {
        console.error("Background: callGeminiAPI called without API Key!");
        throw new Error("API Key de Gemini no proporcionada internamente.");
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:${GENERATE_CONTENT_API}?key=${apiKey}`;

    try {
        let logPayloadDesc = `Calling Gemini API...`;
        console.log("Background:", logPayloadDesc);
        // console.log("Background: Full Payload:", JSON.stringify({ contents: contentsPayload }, null, 2)); // Debug detallado

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: contentsPayload,
                // Considerar ajustar config/safety según necesidad
                 safetySettings: [
                     { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }, // Ajustar umbrales si es necesario
                     { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                     { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
                     { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
                 ]
            }),
            signal: AbortSignal.timeout(30000) // Timeout de 30 segundos
        });

        const data = await response.json();

        if (!response.ok) {
             console.error("Background: Gemini API Error:", response.status, response.statusText, data);
             const errorDetail = data?.error?.message || JSON.stringify(data);
             if (response.status === 400 && errorDetail.includes("API key not valid")) {
                 throw new Error("Error API Gemini: La API Key configurada no es válida. Revisa las opciones.");
             }
             if (response.status === 429) {
                  throw new Error("Error API Gemini: Se ha excedido la cuota de uso (Rate limit). Inténtalo más tarde.");
             }
             if (response.status >= 500) {
                  throw new Error(`Error API Gemini: Error del servidor (${response.status}). Inténtalo más tarde.`);
             }
             throw new Error(`Error API Gemini: ${response.status} - ${errorDetail}`);
        }

        // console.log("Background: Full Gemini Response:", data); // Debug detallado

        // Extracción robusta de la respuesta
        let textResponse = '';
        if (data.candidates && data.candidates.length > 0) {
            const candidate = data.candidates[0];
             if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
                textResponse = candidate.content.parts.map(part => part.text).join("");
            } else if (candidate.finishReason && candidate.finishReason !== 'STOP') {
                 textResponse = `[Respuesta no generada. Razón: ${candidate.finishReason}]`;
                 console.warn(`BG: Finish Reason: ${candidate.finishReason}`, candidate.safetyRatings ? `Ratings: ${JSON.stringify(candidate.safetyRatings)}` : '');
                  if (candidate.content?.parts?.[0]?.text) { textResponse = candidate.content.parts.map(part => part.text).join("") + "\n" + textResponse; }
            } else {
                 textResponse = "[Respuesta de IA vacía o inesperada]";
                 console.warn("BG: Candidate format issue:", candidate);
            }
        } else if (data.promptFeedback?.blockReason) {
             textResponse = `[Solicitud bloqueada por filtro de seguridad. Razón: ${data.promptFeedback.blockReason}]`;
             console.warn("BG: Prompt blocked", data.promptFeedback);
        } else {
            textResponse = "[Formato de respuesta inesperado de Gemini]";
            console.warn("BG: Response structure issue:", data);
        }
        return textResponse.trim();

    } catch (error) {
        if (error.name === 'TimeoutError') {
             console.error("Background: API call timed out.");
             throw new Error("La solicitud a la IA tardó demasiado en responder (Timeout).");
         }
        console.error("Background: Error in callGeminiAPI:", error);
        // Asegurarse de lanzar siempre un objeto Error
        throw (error instanceof Error ? error : new Error(String(error.message || error)));
    }
}

console.log("Background script loaded and listening (v0.4.1).");