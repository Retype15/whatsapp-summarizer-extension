// options.js - Lógica para la página de opciones v0.4.3 - i18n

const apiKeyInput = document.getElementById('apiKey');
const summaryPromptTextarea = document.getElementById('summaryPrompt');
const followUpPromptTextarea = document.getElementById('followUpPrompt');
const saveButton = document.getElementById('save');
const statusDiv = document.getElementById('status');
const toggleApiKeyButton = document.getElementById('toggleApiKey');

// --- Helper for i18n ---
function getMsg(key, substitutions = undefined) {
    try {
        // Check if chrome.i18n is available before using it
        if (chrome && chrome.i18n && chrome.i18n.getMessage) {
            return chrome.i18n.getMessage(key, substitutions) || key;
        } else {
            console.warn("chrome.i18n not available, returning key:", key);
            // Basic substitution fallback if needed for testing outside extension context
             if (substitutions && typeof substitutions === 'string') return key.replace("$1", substitutions);
             if (substitutions && Array.isArray(substitutions)) {
                 let replaced = key;
                 substitutions.forEach((sub, i) => { replaced = replaced.replace(`$${i+1}`, sub); });
                 return replaced;
             }
            return key;
        }
    } catch (e) {
        console.warn(`i18n Options Error getting key "${key}":`, e);
        return key; // Fallback to key on error
    }
}


// --- Valores por Defecto (Keep these as JS defaults) ---
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

    // Validación simple de API Key
    if (apiKey && !apiKey.startsWith('AIzaSy')) {
        showStatus(getMsg("optionsStatusApiKeyFormatError"), 'error'); // i18n
        return;
    }
     // Validación simple de prompts
     if (summaryPrompt && !summaryPrompt.includes('{messages}')) {
         showStatus(getMsg("optionsStatusSummaryPromptPlaceholderError"), 'error'); // i18n
         return;
     }
      if (followUpPrompt && (!followUpPrompt.includes('{waContext}') || !followUpPrompt.includes('{aiHistory}'))) {
         showStatus(getMsg("optionsStatusFollowupPromptPlaceholderError"), 'error'); // i18n
         return;
     }

    chrome.storage.sync.set({
        geminiApiKey: apiKey,
        // Use JS defaults if textareas are empty, prompts themselves are not translated
        summaryPrompt: summaryPrompt || DEFAULT_SUMMARY_PROMPT,
        followUpPrompt: followUpPrompt || DEFAULT_FOLLOW_UP_PROMPT
    }, () => {
        if (chrome.runtime.lastError) {
            showStatus(getMsg("optionsStatusSaveError", [chrome.runtime.lastError.message]), 'error'); // i18n
        } else {
            showStatus(getMsg("optionsStatusSaveSuccess"), 'success'); // i18n
            // Optionally re-populate fields to confirm save (or show defaults if cleared)
            restoreOptions();
        }
    });
}

// Carga las opciones desde chrome.storage.sync y las muestra en la página
function restoreOptions() {
    chrome.storage.sync.get({
        // Defaults to load if not set
        geminiApiKey: '',
        summaryPrompt: DEFAULT_SUMMARY_PROMPT,
        followUpPrompt: DEFAULT_FOLLOW_UP_PROMPT
    }, (items) => {
         if (chrome.runtime.lastError) {
            console.error("Error loading options:", chrome.runtime.lastError.message);
            showStatus(getMsg("optionsStatusLoadError", [chrome.runtime.lastError.message]), 'error'); // i18n
            // Populate with JS defaults on error
            apiKeyInput.value = '';
            summaryPromptTextarea.value = DEFAULT_SUMMARY_PROMPT;
            followUpPromptTextarea.value = DEFAULT_FOLLOW_UP_PROMPT;
        } else {
            apiKeyInput.value = items.geminiApiKey || '';
            // Use loaded value or JS default if loaded value is empty/null
            summaryPromptTextarea.value = items.summaryPrompt || DEFAULT_SUMMARY_PROMPT;
            followUpPromptTextarea.value = items.followUpPrompt || DEFAULT_FOLLOW_UP_PROMPT;
             console.log("Options loaded:", items);
             // Set initial state for visibility toggle
             setApiKeyVisibility(apiKeyInput.type === 'text');
        }
    });
}

// Muestra un mensaje de estado
function showStatus(message, type = 'info') { // type: 'info', 'success', 'error'
    statusDiv.textContent = message;
    statusDiv.className = `status-${type}`;
    setTimeout(() => {
        if (statusDiv.textContent === message) {
            statusDiv.textContent = '';
            statusDiv.className = '';
        }
    }, 4000);
}

// Sets the API Key field type and button text
function setApiKeyVisibility(show) {
    if (show) {
        apiKeyInput.type = 'text';
        toggleApiKeyButton.textContent = getMsg("optionsApiKeyToggleHide"); // i18n
    } else {
        apiKeyInput.type = 'password';
        toggleApiKeyButton.textContent = getMsg("optionsApiKeyToggleShow"); // i18n
    }
}

// Cambia la visibilidad del campo API Key
function toggleApiKeyVisibility() {
    setApiKeyVisibility(apiKeyInput.type === 'password');
}

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    restoreOptions(); // Load options on page load
    // Set static text from HTML's __MSG__ placeholders
    // document.title = getMsg("optionsTitle"); // Can be set via manifest/HTML directly
    // document.querySelector('h1').textContent = getMsg("optionsPageTitle"); // Can be set via HTML directly
});
saveButton.addEventListener('click', saveOptions);
toggleApiKeyButton.addEventListener('click', toggleApiKeyVisibility);