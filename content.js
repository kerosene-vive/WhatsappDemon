// content-script.js

// Selectors and Constants
const SELECTORS = {
    CHAT_LIST: {
        container: '._amjv',
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
        messageRow: '[role="row"]'
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
    MESSAGE_LOAD: 2000
};

// Debug logging
const log = (msg) => {
    console.log(`[WhatsApp Export] ${msg}`);
    chrome.runtime.sendMessage({ 
        action: "debugLog", 
        message: msg 
    });
};

// Wait for an element with guaranteed existence
const waitForElement = (selector, timeout = TIMEOUTS.LOAD) => {
    return new Promise((resolve, reject) => {
        // Check if element already exists
        const existing = document.querySelector(selector);
        if (existing) {
            resolve(existing);
            return;
        }

        // Create observer to watch for element
        const observer = new MutationObserver((mutations, obs) => {
            const element = document.querySelector(selector);
            if (element) {
                obs.disconnect();
                resolve(element);
            }
        });

        // Start observing with a timeout
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        // Set timeout
        setTimeout(() => {
            observer.disconnect();
            reject(new Error(`Timeout waiting for ${selector}`));
        }, timeout);
    });
};

// Extract chat content
const extractChatContent = () => {
    const messages = document.querySelectorAll(SELECTORS.MESSAGE.container);
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
        
        // Wait for chat list
        const chatList = await waitForElement(SELECTORS.CHAT_LIST.container);
        log('Chat list loaded');
        chrome.runtime.sendMessage({ action: "loadingProgress", progress: 30 });

        // Find first chat and click it
        const firstChat = chatList.querySelector(`.${CLASSES.CHAT.item}`);
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

        // Extract and save content
        const content = extractChatContent();
        if (!content) {
            throw new Error('No messages found');
        }

        chrome.runtime.sendMessage({ action: "loadingProgress", progress: 90 });

        // Download file
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
        });
    }
}

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    log(`Received message: ${request.action}`);
    
    if (request.action === "ping") {
        sendResponse({ status: 'ready' });
        return true;
    }
    
    if (request.action === "startAutomation") {
        automateWhatsAppExport();
        return true;
    }
});

// Signal that content script is ready
log('Content script loaded');
chrome.runtime.sendMessage({ action: 'contentScriptReady' });