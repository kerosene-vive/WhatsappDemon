// Main.js - Main entry point and message handler

// Check if already initialized to prevent duplicate loading
if (window.whatsappExporterInitialized) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'ping') {
            sendResponse({ status: 'ready', initialized: true });
            return true;
        }
    });
} else {
    // Set initialization flag to prevent duplicate initialization
    window.whatsappExporterInitialized = true;
    
    // Get references to state and functions
    const { state } = window.WhatsAppExporter;
    const { log } = window.WhatsAppExporter.utils;
    const { initialize, automateWhatsAppExport } = window.WhatsAppExporter.automation;
    
    // Set up message listener
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        switch(request.action) {
            case "ping":
                sendResponse({ status: 'ready', initialized: state.isInitialized });
                break;
            case "getChats":
                sendResponse({ chats: state.availableChats.map(chat => chat.title) });
                break;
            case "checkLoginStatus":
                sendResponse({ needsLogin: !!document.querySelector('div[data-ref]') });
                break;
            case "startAutomation":
                if (state.processingAutomation) {
                    sendResponse({ error: 'Automation already in progress' });
                    return true;
                }
                if (!state.isInitialized) {
                    sendResponse({ error: 'Content script not initialized' });
                    return true;
                }
                state.processingAutomation = true;
                state.endDate = new Date(request.endDate);
                automateWhatsAppExport(request.selectedChats, state.endDate)
                    .finally(() => state.processingAutomation = false);
                sendResponse({ status: 'automation started' });
                break;
        }
        return true;
    });
    
    // Initialize the extension
    log('Content script loaded');
    initialize();
}