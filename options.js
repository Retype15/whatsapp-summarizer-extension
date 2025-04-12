// options.js - Lógica para la página de opciones v0.4.0

const apiKeyInput = document.getElementById('apiKey');
const summaryPromptTextarea = document.getElementById('summaryPrompt');
const followUpPromptTextarea = document.getElementById('followUpPrompt');
const saveButton = document.getElementById('save');
const statusDiv = document.getElementById('status');
const toggleApiKeyButton = document.getElementById('toggleApiKey');

// --- Valores por Defecto ---
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

// --- Funciones ---

// Guarda las opciones en chrome.storage.sync
function saveOptions() {
    const apiKey = apiKeyInput.value.trim();
    const summaryPrompt = summaryPromptTextarea.value.trim();
    const followUpPrompt = followUpPromptTextarea.value.trim();

    // Validación simple de API Key (formato básico)
    if (apiKey && !apiKey.startsWith('AIzaSy')) {
        showStatus("Error: La API Key parece tener un formato incorrecto. Debe empezar con 'AIzaSy'.", 'error');
        return;
    }
     // Validación simple de prompts (asegurar placeholders)
     if (summaryPrompt && !summaryPrompt.includes('{messages}')) {
         showStatus("Error: El prompt de resumen DEBE incluir el placeholder {messages}.", 'error');
         return;
     }
      if (followUpPrompt && (!followUpPrompt.includes('{waContext}') || !followUpPrompt.includes('{aiHistory}'))) {
         showStatus("Error: El prompt de seguimiento DEBE incluir los placeholders {waContext} y {aiHistory}.", 'error');
         return;
     }


    chrome.storage.sync.set({
        geminiApiKey: apiKey,
        summaryPrompt: summaryPrompt || DEFAULT_SUMMARY_PROMPT, // Guardar default si está vacío
        followUpPrompt: followUpPrompt || DEFAULT_FOLLOW_UP_PROMPT // Guardar default si está vacío
    }, () => {
        if (chrome.runtime.lastError) {
            showStatus(`Error al guardar: ${chrome.runtime.lastError.message}`, 'error');
        } else {
            showStatus('Configuración guardada correctamente.', 'success');
            // Rellenar campos con valores guardados (o defaults si se borraron)
             restoreOptions();
        }
    });
}

// Carga las opciones desde chrome.storage.sync y las muestra en la página
function restoreOptions() {
    chrome.storage.sync.get({
        // Valores por defecto a obtener si no existen en storage
        geminiApiKey: '',
        summaryPrompt: DEFAULT_SUMMARY_PROMPT,
        followUpPrompt: DEFAULT_FOLLOW_UP_PROMPT
    }, (items) => {
         if (chrome.runtime.lastError) {
            console.error("Error al cargar opciones:", chrome.runtime.lastError.message);
            showStatus(`Error al cargar la configuración: ${chrome.runtime.lastError.message}`, 'error');
            // Rellenar con defaults en caso de error
            apiKeyInput.value = '';
            summaryPromptTextarea.value = DEFAULT_SUMMARY_PROMPT;
            followUpPromptTextarea.value = DEFAULT_FOLLOW_UP_PROMPT;
        } else {
            apiKeyInput.value = items.geminiApiKey || '';
            summaryPromptTextarea.value = items.summaryPrompt || DEFAULT_SUMMARY_PROMPT;
            followUpPromptTextarea.value = items.followUpPrompt || DEFAULT_FOLLOW_UP_PROMPT;
             console.log("Opciones cargadas:", items);
        }

    });
}

// Muestra un mensaje de estado
function showStatus(message, type = 'info') { // type: 'info', 'success', 'error'
    statusDiv.textContent = message;
    statusDiv.className = `status-${type}`; // Aplicar clase CSS
    // Ocultar mensaje después de unos segundos (opcional)
    setTimeout(() => {
        if (statusDiv.textContent === message) { // Solo borrar si es el mismo mensaje
            statusDiv.textContent = '';
            statusDiv.className = '';
        }
    }, 4000);
}

// Cambia la visibilidad del campo API Key
function toggleApiKeyVisibility() {
    if (apiKeyInput.type === 'password') {
        apiKeyInput.type = 'text';
        toggleApiKeyButton.textContent = 'Ocultar';
    } else {
        apiKeyInput.type = 'password';
        toggleApiKeyButton.textContent = 'Mostrar';
    }
}

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', restoreOptions); // Cargar opciones al abrir la página
saveButton.addEventListener('click', saveOptions); // Guardar al hacer clic
toggleApiKeyButton.addEventListener('click', toggleApiKeyVisibility); // Mostrar/ocultar API Key