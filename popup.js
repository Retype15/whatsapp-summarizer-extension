// popup.js - MODIFICADO v0.4.3 - i18n

// Helper for i18n
function getMsg(key, substitutions = undefined) {
    try {
        return chrome.i18n.getMessage(key, substitutions) || key;
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

        if (isNaN(count) || count <= 0) {
            statusDiv.textContent = getMsg("popupErrorInvalidNumber"); // i18n
            return;
        }

        chrome.tabs.query({ active: true, currentWindow: true, url: "*://web.whatsapp.com/*" }, (tabs) => {
            if (tabs.length === 0) {
                statusDiv.textContent = getMsg("popupErrorWhatsAppNotActive"); // i18n
                return;
            }

            const tabId = tabs[0].id;
            console.log(`Popup: Sending 'triggerSummaryFromPopup' to tab ${tabId} for ${count} messages.`);
            statusDiv.textContent = getMsg("popupStatusSending", [count]); // i18n with substitution

            chrome.tabs.sendMessage(
                tabId,
                { action: "triggerSummaryFromPopup", count: count },
                (response) => {
                    if (chrome.runtime.lastError) {
                        console.error("Popup Error:", chrome.runtime.lastError.message);
                        statusDiv.textContent = getMsg("popupErrorCommunication"); // i18n
                    } else if (response && response.success) {
                        console.log("Popup: Content script received the order.");
                        statusDiv.textContent = getMsg("popupStatusSent"); // i18n
                        setTimeout(() => window.close(), 2000);
                    } else {
                        console.log("Popup: Content script reported an error initial.", response);
                        // Use the error message provided by the content script (which should also be translated)
                        statusDiv.textContent = `${getMsg("statusErrorGeneric")}: ${response?.error || getMsg("textUnknown")}`; // i18n error prefix
                    }
                }
            );
        });
    });

     numberInput.focus();
});