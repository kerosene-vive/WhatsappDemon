// whatsapp-selectors.js

export const SELECTORS = {
    // Main Containers
    CHAT_LIST: {
        container: '._amjv',  // Message container class
        messages: '[role="row"]',
        mainPanel: '#main'
    },

    // Message Elements
    MESSAGE: {
        container: '._akbu',  // Message bubble container
        text: '.selectable-text.copyable-text',  // Message text
        timestamp: '.x3nfvp2.xxymvpz', // Message timestamp
        outgoing: '.message-out',
        incoming: '.message-in'
    },

    // Specific Chat Elements
    CHAT: {
        messageContainer: '.x3psx0u.xwib8y2.xkhd6sd.xrmvbpv',  // Container for all messages
        messageBox: '[role="application"]',
        messageRow: '[role="row"]'
    },

    // Loading States
    LOADING: {
        main: '[role="application"]',
        messageList: '[role="region"]'
    }
};

export const CLASSES = {
    MESSAGE: {
        wrapper: '_amjv _aotl',
        text: '_ao3e',
        timestamp: 'x3nfvp2 xxymvpz',
        outgoing: 'message-out',
        incoming: 'message-in'
    },
    
    CHAT: {
        item: '_ak8l',
        text: '_ao3e',
        focus: 'focusable-list-item'
    }
};

export const TIMEOUTS = {
    LOAD: 5000,
    CHAT_SELECT: 2000,
    MESSAGE_LOAD: 2000
};

// Helper function to check if element is fully loaded
export const isLoaded = (selector) => {
    const element = document.querySelector(selector);
    return element && element.offsetParent !== null;
};

// Helper to get all messages
export const getMessages = () => {
    return document.querySelectorAll(SELECTORS.MESSAGE.container);
};

// Helper to check chat state
export const isChatOpen = () => {
    return document.querySelector(SELECTORS.CHAT.messageContainer) !== null;
};