// Create a global namespace for your extension
window.WhatsAppExporter = window.WhatsAppExporter || {};

// Store state variables in the global object
window.WhatsAppExporter.state = {
    isInitialized: false,
    initializationAttempts: 0,
    MAX_INIT_ATTEMPTS: 5,
    availableChats: [],
    processingAutomation: false,
    endDate: null  // Add this line
};

// Store constants in the global object
window.WhatsAppExporter.constants = {
    SCROLL_CONFIG: {
        MAX_CONSECUTIVE_FAILURES: 3,
        MAX_TOTAL_FAILURES: 15,
        SCROLL_BATCH_SIZE: 1200,
        SCROLL_BATCH_PAUSE: 5,
        DATE_CHECK_INTERVAL: 5
    },
    
    SELECTORS: {
        CHAT_LIST: { container: '#pane-side', messages: '[role="row"]', mainPanel: '#main' },
        MESSAGE: {
            container: '._akbu',
            text: '.selectable-text.copyable-text',
            timestamp: '.x3nfvp2.xxymvpz',
            outgoing: '.message-out',
            incoming: '.message-in'
        },
        CHAT: {
            messageContainer: '[role="application"]',
            gridCell: '[role="gridcell"]',
            clickableArea: '._ak8q',
            title: 'span[dir="auto"]',
            item: 'div._ak8l',
            scrollContainer: 'div[tabindex="0"][role="application"]',
            viewport: '#app, .app-wrapper-web',
            visibilityCheck: '[data-testid="chat"]',
            loadOlderButton: 'button.x14m1o6m, button.x1b9z3ur'
        },
        MEDIA_ELEMENTS: {
            images: 'img[src^="blob:"], div[style*="background-image"][role="button"]',
            videos: 'video[src^="blob:"]',
            documents: '[role="button"][title*="Download"], .x78zum5[title*="Download"], .icon-doc-pdf, [data-testid="document-thumb"]',
            links: 'a[href^="http"], [data-testid="link"], div[role="link"]',
            audio: 'audio, .audio-duration, div[role="button"][data-icon="audio-play"], div[role="button"][data-icon="audio-pause"]'
        }
    },
    
    TIMEOUTS: {
        LOAD: 1000,
        CHAT_SELECT: 100,
        MESSAGE_LOAD: 100,
        MEDIA_LOAD: 100,
        INIT_RETRY: 50,
        DOWNLOAD_WAIT: 50,
        SCROLL_INTERVAL: 100,
        SCROLL_ATTEMPTS: 100
    }
};

// Create empty objects for functions that will be added from other files
window.WhatsAppExporter.utils = {};
window.WhatsAppExporter.ui = {};
window.WhatsAppExporter.chat = {};
window.WhatsAppExporter.automation = {};

// Add initialization flag to prevent duplicate initialization
window.whatsappExporterInitialized = window.whatsappExporterInitialized || false;