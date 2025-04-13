// options.js - Lógica para la página de opciones v0.4.5 - System Instruction
const apiKeyInput = document.getElementById('apiKey');
// REMOVE: const summaryPromptTextarea = document.getElementById('summaryPrompt');
// REMOVE: const followUpPromptTextarea = document.getElementById('followUpPrompt');
const systemInstructionTextarea = document.getElementById('systemInstructionPrompt'); // NEW
const saveButton = document.getElementById('save');
const statusDiv = document.getElementById('status');
const toggleApiKeyButton = document.getElementById('toggleApiKey');

// --- Helper for i18n ---
function getMsg(key, substitutions = undefined) {
    try {
        if (chrome && chrome.i18n && chrome.i18n.getMessage) {
            return chrome.i18n.getMessage(key, substitutions) || key;
        }
        // Fallback logic...
        return key;
    } catch (e) {
        console.warn(`i18n Options Error getting key "${key}":`, e);
        return key;
    }
}

// --- Default System Instruction (Get from messages.json) ---
const DEFAULT_SYSTEM_INSTRUCTION = getMsg("defaultSystemInstruction");

// --- Funciones ---

// Guarda las opciones en chrome.storage.sync
function saveOptions() {
    const apiKey = apiKeyInput.value.trim();
    const systemInstruction = systemInstructionTextarea.value.trim(); // NEW

    // Validación simple de API Key
    if (apiKey && !apiKey.startsWith('AIzaSy')) {
        showStatus(getMsg("optionsStatusApiKeyFormatError"), 'error');
        return;
    }
    // Validate System Instruction (cannot be empty)
    if (!systemInstruction) { // NEW validation
        showStatus(getMsg("optionsStatusSystemInstructionError"), 'error');
        return;
    }

    chrome.storage.sync.set({
        geminiApiKey: apiKey,
        systemInstructionPrompt: systemInstruction // Use new storage key
        // REMOVE: summaryPrompt, followUpPrompt keys
    }, () => {
        if (chrome.runtime.lastError) {
            showStatus(getMsg("optionsStatusSaveError", [chrome.runtime.lastError.message]), 'error');
        } else {
            showStatus(getMsg("optionsStatusSaveSuccess"), 'success');
            restoreOptions(); // Refresh display
        }
    });
}

// Carga las opciones desde chrome.storage.sync y las muestra en la página
function restoreOptions() {
    chrome.storage.sync.get({
        // Defaults to load if not set
        geminiApiKey: '',
        systemInstructionPrompt: DEFAULT_SYSTEM_INSTRUCTION // Use new key and default
        // REMOVE: summaryPrompt, followUpPrompt keys
    }, (items) => {
         if (chrome.runtime.lastError) {
            console.error("Error loading options:", chrome.runtime.lastError.message);
            showStatus(getMsg("optionsStatusLoadError", [chrome.runtime.lastError.message]), 'error');
            // Populate with defaults on error
            apiKeyInput.value = '';
            systemInstructionTextarea.value = DEFAULT_SYSTEM_INSTRUCTION; // NEW
        } else {
            apiKeyInput.value = items.geminiApiKey || '';
            systemInstructionTextarea.value = items.systemInstructionPrompt || DEFAULT_SYSTEM_INSTRUCTION; // NEW
             console.log("Options loaded:", items);
             setApiKeyVisibility(apiKeyInput.type === 'text');
        }
    });
}

// Muestra un mensaje de estado
function showStatus(message, type = 'info') {
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
        toggleApiKeyButton.textContent = getMsg("optionsApiKeyToggleHide");
    } else {
        apiKeyInput.type = 'password';
        toggleApiKeyButton.textContent = getMsg("optionsApiKeyToggleShow");
    }
}

// Cambia la visibilidad del campo API Key
function toggleApiKeyVisibility() {
    setApiKeyVisibility(apiKeyInput.type === 'password');
}

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', restoreOptions);
saveButton.addEventListener('click', saveOptions);
toggleApiKeyButton.addEventListener('click', toggleApiKeyVisibility);