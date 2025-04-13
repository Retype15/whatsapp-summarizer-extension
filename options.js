// options.js - Lógica para la página de opciones v0.4.12 - Fix i18n, Update Models

const apiKeyInput = document.getElementById('apiKey');
const systemInstructionTextarea = document.getElementById('systemInstructionPrompt');
const modelSelector = document.getElementById('modelSelector');
const saveButton = document.getElementById('save');
const statusDiv = document.getElementById('status');
const toggleApiKeyButton = document.getElementById('toggleApiKey');

// --- Helper for i18n ---
function getMsg(key, substitutions = undefined) {
    try {
        if (chrome && chrome.i18n && chrome.i18n.getMessage) {
            return chrome.i18n.getMessage(key, substitutions) || key; // Return key as fallback
        }
        // Provide a very basic fallback for testing outside extension context
        let fallback = key;
         if (substitutions && typeof substitutions === 'string') fallback = key.replace("$1", substitutions);
         else if (substitutions && Array.isArray(substitutions)) {
             substitutions.forEach((sub, i) => { fallback = fallback.replace(`$${i+1}`, sub); });
         }
        console.warn("chrome.i18n not available, returning key/basic fallback:", fallback);
        return fallback;
    } catch (e) {
        console.warn(`i18n Options Error getting key "${key}":`, e);
        return key; // Return key on error
    }
}

// --- Apply translations to the DOM ---
function applyTranslations() {
    document.title = getMsg("optionsTitle"); // Set page title

    const elements = document.querySelectorAll('[data-i18n], [data-i18n-placeholder], [data-i18n-title], [data-i18n-html]');
    elements.forEach(el => {
        if (el.hasAttribute('data-i18n')) {
            const key = el.getAttribute('data-i18n');
            el.textContent = getMsg(key);
        }
        if (el.hasAttribute('data-i18n-placeholder')) {
            const key = el.getAttribute('data-i18n-placeholder');
            el.placeholder = getMsg(key);
        }
        if (el.hasAttribute('data-i18n-title')) {
            const key = el.getAttribute('data-i18n-title');
            el.title = getMsg(key);
        }
         if (el.hasAttribute('data-i18n-html')) { // For elements containing HTML tags
            const key = el.getAttribute('data-i18n-html');
            el.innerHTML = getMsg(key); // Use innerHTML carefully
        }
        // Remove attribute after applying translation (optional)
        // el.removeAttribute('data-i18n');
        // el.removeAttribute('data-i18n-placeholder');
        // el.removeAttribute('data-i18n-title');
        // el.removeAttribute('data-i18n-html');
    });
     // Special case for toggle button initial text
     setApiKeyVisibility(apiKeyInput.type === 'password'); // Set initial text based on type
}


// --- Default Values ---
// Use the value matching the updated default <option> in HTML
const DEFAULT_MODEL_ID = "gemini-1.5-flash"; // Updated Default
const DEFAULT_SYSTEM_INSTRUCTION = getMsg("defaultSystemInstruction"); // Load default instruction text

// --- Funciones ---

// Guarda las opciones en chrome.storage.sync
function saveOptions() {
    const apiKey = apiKeyInput.value.trim();
    const systemInstruction = systemInstructionTextarea.value.trim();
    const selectedModel = modelSelector.value;

    // Validations
    if (apiKey && !apiKey.startsWith('AIzaSy')) { showStatus(getMsg("optionsStatusApiKeyFormatError"), 'error'); return; }
    if (!systemInstruction) { showStatus(getMsg("optionsStatusSystemInstructionError"), 'error'); return; }

    // Validate selected model against current dropdown options dynamically
    const allowedModels = Array.from(modelSelector.options).map(opt => opt.value);
    if (!allowedModels.includes(selectedModel)) {
         showStatus("Error: Invalid model selected.", 'error'); // Basic non-i18n error is fine here
         return;
    }

    chrome.storage.sync.set({
        geminiApiKey: apiKey,
        systemInstructionPrompt: systemInstruction,
        selectedModelId: selectedModel
    }, () => {
        if (chrome.runtime.lastError) { showStatus(getMsg("optionsStatusSaveError", [chrome.runtime.lastError.message]), 'error'); }
        else { showStatus(getMsg("optionsStatusSaveSuccess"), 'success'); restoreOptions(); }
    });
}

// Carga las opciones desde chrome.storage.sync y las muestra en la página
function restoreOptions() {
    chrome.storage.sync.get({
        geminiApiKey: '',
        systemInstructionPrompt: DEFAULT_SYSTEM_INSTRUCTION,
        selectedModelId: DEFAULT_MODEL_ID
    }, (items) => {
         if (chrome.runtime.lastError) {
            console.error("Error loading options:", chrome.runtime.lastError.message);
            showStatus(getMsg("optionsStatusLoadError", [chrome.runtime.lastError.message]), 'error');
            // Populate with defaults on error
            apiKeyInput.value = '';
            systemInstructionTextarea.value = DEFAULT_SYSTEM_INSTRUCTION;
            modelSelector.value = DEFAULT_MODEL_ID;
        } else {
            apiKeyInput.value = items.geminiApiKey || '';
            systemInstructionTextarea.value = items.systemInstructionPrompt || DEFAULT_SYSTEM_INSTRUCTION;

            // Set dropdown value dynamically, checking against current options
            const savedModel = items.selectedModelId || DEFAULT_MODEL_ID;
            const allowedModels = Array.from(modelSelector.options).map(opt => opt.value);
            if (allowedModels.includes(savedModel)) {
                 modelSelector.value = savedModel;
            } else {
                 console.warn(`Saved model ID "${savedModel}" not found in current options, using default.`);
                 modelSelector.value = DEFAULT_MODEL_ID; // Use default if saved is invalid
            }
             console.log("Options loaded:", items);
        }
        // Set initial API key visibility (after potentially loading value)
        setApiKeyVisibility(apiKeyInput.type === 'password');
    });
}

// Muestra un mensaje de estado
function showStatus(message, type = 'info') {
     statusDiv.textContent = message; statusDiv.className = `status-${type}`;
     setTimeout(() => { if (statusDiv.textContent === message) { statusDiv.textContent = ''; statusDiv.className = ''; } }, 4000);
}

// Sets the API Key field type and button text
function setApiKeyVisibility(show) { // Renamed parameter for clarity
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
    setApiKeyVisibility(apiKeyInput.type === 'password'); // Toggle based on current state
}

// --- Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    applyTranslations(); // Apply translations FIRST
    restoreOptions(); // Then restore saved options
});
saveButton.addEventListener('click', saveOptions);
toggleApiKeyButton.addEventListener('click', toggleApiKeyVisibility);