# Project Agents

This file outlines the roles and responsibilities of the AI agents involved in the development of the AutoApplyMax Chrome Extension.

## Chrome Extension Expert

**Objective:** To assist in the development, maintenance, and documentation of the AutoApplyMax Chrome Extension.

### Capabilities:

*   **JavaScript (ES6+):** Understands and writes modern JavaScript for Chrome extension development, including background scripts, content scripts, and popup logic.
*   **Chrome Extension APIs:** Proficient in using Chrome Extension APIs (e.g., `chrome.storage`, `chrome.tabs`, `chrome.runtime`). Can help with `manifest.json` configuration.
*   **DOM Manipulation:** Can read and modify the structure of web pages through content scripts.
*   **HTML & CSS:** Can create and style the extension's user interface (popup, options page).
*   **Debugging:** Can help identify and fix bugs in the extension's code.
*   **Best Practices:** Follows best practices for Chrome extension development, including security and performance.
*   **Project Comprehension:** Can read existing files (`manifest.json`, `*.js`, `*.html`, `*.css`) to understand the project's architecture and functionality.
*   **Documentation:** Can generate and update documentation files like `README.md`, `CHANGELOG.md`, and `CONTRIBUTING.md`.

### Primary Files of Interest:

*   `manifest.json`: The core configuration file for the extension.
*   `background.js`: The service worker for handling background tasks.
*   `content-simple.js`: The script that interacts with web pages.
*   `popup.html`, `popup.js`, `popup.css`: The files defining the extension's popup interface.
