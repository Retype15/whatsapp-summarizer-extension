// popup.js - MODIFICADO v0.4.5 - i18n
console.log("Popup script loaded v0.4.5");

// Helper for i18n
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
    } catch (e) { console.warn(`i18n Popup Error key "${key}":`, e); return key; }
}


document.addEventListener('DOMContentLoaded', () => {
    // Set text from locales
    document.querySelector('h3').textContent = getMsg("popupTitle");
    document.querySelector('label[for="message-count"]').textContent = getMsg("popupMessageCountLabel");
    const numberInput = document.getElementById('message-count');
    const summarizeButton = document.getElementById('summarize-button');
    summarizeButton.textContent = getMsg("popupSummarizeButton");
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = getMsg("popupStatusReady");


    summarizeButton.addEventListener('click', () => {
        const count = parseInt(numberInput.value, 10);
        statusDiv.textContent = getMsg("popupStatusRequesting"); // i18n
        statusDiv.classList.remove('error'); // Clear previous error styling

        if (isNaN(count) || count <= 0) {
            statusDiv.textContent = getMsg("popupErrorInvalidNumber"); // i18n
            statusDiv.classList.add('error');
            return;
        }

        chrome.tabs.query({ active: true, currentWindow: true, url: "*://web.whatsapp.com/*" }, (tabs) => {
            if (tabs.length === 0) {
                statusDiv.textContent = getMsg("popupErrorWhatsAppNotActive"); // i18n
                statusDiv.classList.add('error');
                return;
            }

            const tabId = tabs[0].id;
            console.log(`Popup: Sending 'triggerSummaryFromPopup' to tab ${tabId} for ${count} messages.`);
            statusDiv.textContent = getMsg("popupStatusSending", [count]); // i18n with substitution

            chrome.tabs.sendMessage(
                tabId,
                { action: "triggerSummaryFromPopup", count: count },
                (response) => {
                    // Check lastError first
                    if (chrome.runtime.lastError) {
                        console.error("Popup Error sending message:", chrome.runtime.lastError.message);
                        statusDiv.textContent = getMsg("popupErrorCommunication"); // i18n
                        statusDiv.classList.add('error');
                    } else if (response && response.success) {
                        // Content script successfully processed the request (or at least started)
                        console.log("Popup: Content script received the order successfully.");
                        statusDiv.textContent = getMsg("popupStatusSent"); // i18n
                        statusDiv.classList.remove('error');
                        setTimeout(() => window.close(), 2000);
                    } else {
                        // Content script reported an error OR response format was unexpected
                        console.log("Popup: Content script reported an error or response invalid.", response);
                        // Use the error message provided by the content script (which should be translated)
                        const errorDetail = response?.error || getMsg("textUnknown"); // Use Unknown if error is missing
                        statusDiv.textContent = getMsg("popupErrorContentScript", [errorDetail]); // i18n error prefix + details
                        statusDiv.classList.add('error');
                    }
                }
            );
        });
    });

     numberInput.focus();
});
