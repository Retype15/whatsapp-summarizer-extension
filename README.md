# WhatsApp Summarizer AI 💬🧠

[![License](https://img.shields.io/badge/License-Custom%20Non--Commercial-blue.svg)](LICENCE) <!-- Consider updating if you choose a standard license -->
[![Version](https://img.shields.io/badge/Version-0.4.12-brightgreen.svg)](manifest.json) <!-- Update version manually -->
[![Language](https://img.shields.io/badge/Language-EN%20%7C%20ES-orange.svg)](_locales/)

Summarize and interact with your WhatsApp Web chats using the power of Google Gemini AI, directly within an integrated chat panel.

<!-- Optional: Add a screenshot or GIF here -->
<!-- ![Extension Screenshot](link/to/your/screenshot.png) -->

## ✨ Features

*   **AI-Powered Summaries:** Quickly get concise summaries of recent messages in any chat.
*   **Conversational AI:** Ask follow-up questions based on the summary, the WhatsApp message context, and your ongoing chat with the AI.
*   **Integrated Panel:** Interact with the AI through a convenient panel that appears directly on the WhatsApp Web interface.
*   **Configurable AI:**
    *   Requires your own Google Gemini API Key for processing.
    *   Select your preferred Gemini model (1.5 Flash, 1.5 Pro, etc.).
    *   Customize the AI's behavior with a System Instruction prompt.
*   **Markdown Support:** AI responses are rendered with basic Markdown formatting (bold, italics, code, lists).
*   **Copy Functionality:** Easily copy the text content of any message in the AI chat panel.
*   **Multi-language:** Available in English and Spanish (UI based on browser language).
*   **Privacy Focused:**
    *   **No user data collected or stored by the extension.** Chat content is processed for summarization/response and then discarded.
    *   Requires user-provided API key for AI interaction.
    *   Open Source for transparency (Verify the code yourself!).

## ⚙️ Installation

As this extension is not yet on the Chrome Web Store, follow these steps to install it manually:

1.  **Download/Clone:** Download this repository as a ZIP file and extract it, or clone the repository using Git:
    ```bash
    git clone https://github.com/YOUR_USERNAME/YOUR_REPOSITORY_NAME.git
    ```
    (Replace `YOUR_USERNAME/YOUR_REPOSITORY_NAME` with your actual GitHub details)
2.  **Open Chrome Extensions:** Open Google Chrome, type `chrome://extensions` in the address bar, and press Enter.
3.  **Enable Developer Mode:** Toggle the "Developer mode" switch in the top-right corner ON.
4.  **Load Unpacked:** Click the "Load unpacked" button that appears.
5.  **Select Folder:** Navigate to the directory where you downloaded/cloned the repository and select the *root folder* of the extension (the one containing `manifest.json`).
6.  **Done!** The WhatsApp Summarizer AI extension should now appear in your list of extensions and be active.

## 🚀 Usage

1.  **Open WhatsApp Web:** Navigate to `web.whatsapp.com` and log in.
2.  **Open a Chat:** Select any individual or group chat.
3.  **Activate Panel:**
    *   Click the **"AI Chat"** (or translated equivalent) button that appears in the chat header (next to the contact/group name).
    *   Alternatively, click the extension's icon in your Chrome toolbar and use the popup (primarily for triggering initial summaries).
4.  **Interact:** The AI chat panel will appear on the page.
    *   **Request Summary:** Type commands like `summarize 10 messages`, `resume 25 msgs`, etc.
    *   **Ask Questions:** After a summary, ask follow-up questions like "Who mentioned the meeting?" or "What was decided about the project?". You can also ask general questions based on the summarized context.
    *   **Copy Messages:** Hover over any message in the AI panel and click the clipboard icon (📄) that appears in the top-right corner to copy its text.

## 🔧 Configuration

Before using the AI features, you **must** configure your API key.

1.  **Get API Key:** Obtain a free API key for the Gemini API from [Google AI Studio](https://aistudio.google.com/app/apikey).
2.  **Access Options:**
    *   Right-click the WhatsApp Summarizer AI extension icon in your Chrome toolbar and select "Options".
    *   *Alternatively*, open the AI chat panel on WhatsApp Web and click the settings icon (⚙️) in the panel header.
3.  **Configure Settings:**
    *   **Google Gemini API Key:** Paste your API key obtained from Google AI Studio.
    *   **Select Gemini Model:** Choose the AI model you want to use from the dropdown. The available options include:
        *   `gemini-1.5-flash` (Default, fast)
        *   `gemini-1.5-pro` (More capable)
        *   `gemini-1.5-flash-latest`
        *   `gemini-1.5-pro-latest`
        *   `gemini-1.0-pro`
        *(Note: Availability and performance of models can vary).*
    *   **System Instruction:** Provide general instructions to guide the AI's role, tone, and task focus (e.g., "You are a helpful assistant summarizing chats concisely").
4.  **Save:** Click "Save Settings".

## 📸 Screenshots

*(It's highly recommended to add screenshots here!)*

*   [Screenshot of the "AI Chat" button in the WhatsApp header]
*   [Screenshot of the AI chat panel open next to a WhatsApp chat]
*   [Screenshot of a summary generated in the panel]
*   [Screenshot of the Options page]

## 💻 Technology Stack

*   JavaScript (ES6+)
*   HTML5 / CSS3
*   Chrome Extension APIs (Manifest V3)
*   Google Gemini API

## 🔒 Privacy

This extension is designed with privacy as a top priority.
*   It **does not collect, store, or transmit any personal user data or chat content** outside of the necessary interaction with the Google Gemini API (using *your* API key).
*   Chat content is processed in real-time for summaries/responses and is not retained by the extension.
*   The extension is open source, allowing anyone to inspect the code.

Please review the full [Privacy Policy](PRIVACY_POLICY.md) for details.

## 📄 License

This project is licensed under a custom non-commercial license. Please see the [LICENCE](LICENCE) file for full details.

**Key Terms:**
*   Free to use, copy, modify, and distribute for **non-commercial purposes**.
*   Commercial use requires explicit written permission from the copyright holder ([reynierramos280@gmail.com](mailto:reynierramos280@gmail.com)).
*   The original copyright notice and permission notice must be included.
*   Derivative versions must specify modifications and maintain original privacy protections.
*   Absolutely **no user data collection** is permitted in any version or derivative.

## 🤝 Contributing

Contributions, issues, and feature requests are welcome!

1.  **Issues:** Please check if your issue already exists before creating a new one. Provide detailed information, including steps to reproduce, browser version, and any console errors.
2.  **Pull Requests:**
    *   Fork the repository.
    *   Create a new branch (`git checkout -b feature/YourFeature`).
    *   Make your changes.
    *   Commit your changes (`git commit -m 'Add some feature'`).
    *   Push to the branch (`git push origin feature/YourFeature`).
    *   Open a Pull Request.

## 📞 Contact

Reynier Ramos - [reynierramos280@gmail.com](mailto:reynierramos280@gmail.com)

Project Link: [https://github.com/YOUR_USERNAME/YOUR_REPOSITORY_NAME](https://github.com/YOUR_USERNAME/YOUR_REPOSITORY_NAME) *(<- Update this link!)*

---