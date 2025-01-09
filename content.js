// Debug logging
const log = (msg) => {
    console.log(`[WhatsApp Export] ${msg}`);
    chrome.runtime.sendMessage({ 
        action: "debugLog", 
        message: msg 
    }).catch(() => {});
};

// Constants
const SELECTORS = {
    CHAT_LIST: {
        container: '#pane-side',  // Updated main container selector
        messages: '[role="row"]',
        mainPanel: '#main'
    },
    MESSAGE: {
        container: '._akbu',
        text: '.selectable-text.copyable-text',
        timestamp: '.x3nfvp2.xxymvpz',
        outgoing: '.message-out',
        incoming: '.message-in'
    },
    CHAT: {
        messageContainer: '.x3psx0u.xwib8y2.xkhd6sd.xrmvbpv',
        messageBox: '[role="application"]',
        messageRow: '[role="row"]',
        // New specific selectors for chat items
        item: 'div._ak8l',
        title: 'span._ao3e'
    },
    LOADING: {
        main: '[role="application"]',
        messageList: '[role="region"]'
    }
};

const CLASSES = {
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

const TIMEOUTS = {
    LOAD: 5000,
    CHAT_SELECT: 2000,
    MESSAGE_LOAD: 2000,
    INIT_RETRY: 1000
};

// Initialization state
let isInitialized = false;

// Helper Functions
const isLoaded = (selector) => {
    const element = document.querySelector(selector);
    return element && element.offsetParent !== null;
};

const getMessages = () => {
    return document.querySelectorAll(SELECTORS.MESSAGE.container);
};

const isChatOpen = () => {
    return document.querySelector(SELECTORS.CHAT.messageContainer) !== null;
};

// Wait for element with timeout
const waitForElement = (selector, timeout = TIMEOUTS.LOAD) => {
    return new Promise((resolve, reject) => {
        const existing = document.querySelector(selector);
        if (existing) {
            resolve(existing);
            return;
        }

        const observer = new MutationObserver((mutations, obs) => {
            const element = document.querySelector(selector);
            if (element) {
                obs.disconnect();
                resolve(element);
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        setTimeout(() => {
            observer.disconnect();
            reject(new Error(`Timeout waiting for ${selector}`));
        }, timeout);
    });
};

// Find first chat element
const findFirstChat = (container) => {
    // First try to find pinned chats (they have the pinned2 icon)
    const allChats = container.querySelectorAll(SELECTORS.CHAT.item);
    if (!allChats || allChats.length === 0) {
        throw new Error('No chat elements found');
    }
    
    // Return the first chat element
    return allChats[0];
};

// Extract chat content
const extractChatContent = () => {
    const messages = getMessages();
    let content = '';
    
    messages.forEach(msg => {
        const text = msg.querySelector(SELECTORS.MESSAGE.text);
        const timestamp = msg.querySelector(`.${CLASSES.MESSAGE.timestamp}`);
        
        if (text) {
            const time = timestamp ? timestamp.textContent.trim() : '';
            const msgText = text.textContent.trim();
            content += time ? `[${time}] ${msgText}\n` : `${msgText}\n`;
        }
    });
    
    return content;
};

// Main automation function
async function automateWhatsAppExport() {
    try {
        log('Starting automation');
        chrome.runtime.sendMessage({ action: "loadingProgress", progress: 10 });
        
        // Wait for chat list container
        const chatListContainer = await waitForElement(SELECTORS.CHAT_LIST.container);
        log('Chat list loaded');
        chrome.runtime.sendMessage({ action: "loadingProgress", progress: 30 });

        // Find and click first chat using updated selector
        const firstChat = findFirstChat(chatListContainer);
        if (!firstChat) {
            throw new Error('No chats found');
        }

        firstChat.click();
        log('Clicked first chat');
        chrome.runtime.sendMessage({ action: "loadingProgress", progress: 50 });

        // Wait for messages to load
        await waitForElement(SELECTORS.CHAT.messageContainer);
        await new Promise(resolve => setTimeout(resolve, TIMEOUTS.MESSAGE_LOAD));
        log('Messages loaded');
        chrome.runtime.sendMessage({ action: "loadingProgress", progress: 70 });

        const content = extractChatContent();
        if (!content) {
            throw new Error('No messages found');
        }

        chrome.runtime.sendMessage({ action: "loadingProgress", progress: 90 });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `whatsapp-export-${timestamp}.txt`;
        a.click();
        URL.revokeObjectURL(url);

        log('Export completed');
        chrome.runtime.sendMessage({ action: "loadingProgress", progress: 100 });
        
    } catch (error) {
        log(`Error: ${error.message}`);
        chrome.runtime.sendMessage({ 
            action: "automationError", 
            error: error.message 
        }).catch(() => {});
    }
}

// Initialize content script
async function initialize() {
    if (isInitialized) return;
    
    try {
        const response = await chrome.runtime.sendMessage({ 
            action: 'contentScriptReady' 
        });
        
        if (response && response.status === 'acknowledged') {
            isInitialized = true;
            log('Content script initialized successfully');
        } else {
            throw new Error('Initialization not acknowledged');
        }
    } catch (error) {
        log(`Initialization error: ${error.message}`);
        setTimeout(initialize, TIMEOUTS.INIT_RETRY);
    }
}

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    log(`Received message: ${request.action}`);
    
    switch(request.action) {
        case "ping":
            sendResponse({ status: 'ready' });
            break;
            
        case "startAutomation":
            if (!isInitialized) {
                sendResponse({ error: 'Content script not initialized' });
                return true;
            }
            
            automateWhatsAppExport().catch(error => {
                log(`Automation error: ${error.message}`);
                chrome.runtime.sendMessage({ 
                    action: "automationError", 
                    error: error.message 
                }).catch(() => {});
            });
            
            sendResponse({ status: 'automation started' });
            break;
    }
    
    return true;
});

// Start initialization
log('Content script loaded');
initialize();