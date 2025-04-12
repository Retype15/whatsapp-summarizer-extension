// popup.js - MODIFICADO v0.2.0

document.addEventListener('DOMContentLoaded', () => {
    const numberInput = document.getElementById('message-count');
    const summarizeButton = document.getElementById('summarize-button');
    const statusDiv = document.getElementById('status');

    summarizeButton.addEventListener('click', () => {
        const count = parseInt(numberInput.value, 10);
        statusDiv.textContent = 'Solicitando resumen...'; // Estado actualizado

        if (isNaN(count) || count <= 0) {
            statusDiv.textContent = 'Error: Número inválido.';
            // alert("Por favor, introduce un número válido de mensajes (mayor que 0)."); // Alert es redundante
            return;
        }

        chrome.tabs.query({ active: true, currentWindow: true, url: "*://web.whatsapp.com/*" }, (tabs) => {
            if (tabs.length === 0) {
                statusDiv.textContent = 'Error: WhatsApp no activo.';
                // alert("Error: Asegúrate de que WhatsApp Web esté abierto en la pestaña activa.");
                return;
            }

            const tabId = tabs[0].id;
            console.log(`Popup: Enviando 'triggerSummaryFromPopup' a pestaña ${tabId} para ${count} mensajes.`);
            statusDiv.textContent = `Enviando orden para ${count} mensajes...`;

            chrome.tabs.sendMessage(
                tabId,
                { action: "triggerSummaryFromPopup", count: count },
                (response) => {
                    if (chrome.runtime.lastError) {
                        console.error("Popup Error:", chrome.runtime.lastError.message);
                        statusDiv.textContent = 'Error de comunicación.';
                        // alert(...); // El content script ahora muestra errores en el chat
                    } else if (response && response.success) {
                        // La solicitud fue recibida por el content script. El resultado se verá en el chat.
                        console.log("Popup: Content script recibió la orden.");
                        statusDiv.textContent = '¡Orden enviada! Revisa el panel en WhatsApp.';
                        setTimeout(() => window.close(), 2000); // Cierra tras 2 seg
                    } else {
                        // El content script respondió con un error específico al procesar la orden inicial
                        console.log("Popup: Content script reportó un error inicial.", response);
                        statusDiv.textContent = `Error: ${response?.error || 'Desconocido'}`;
                    }
                }
            );
        });
    });

     // Poner foco en el input al abrir
     numberInput.focus();
});