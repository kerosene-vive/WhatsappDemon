// Content script for WhatsApp Web automation
let isInitialized = false;
let initializationAttempts = 0;
const MAX_INIT_ATTEMPTS = 5;

const SELECTORS = {
    CHAT_LIST: {
        container: '#pane-side',
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
        messageContainer: '[role="application"]',
        gridCell: '[role="gridcell"]',
        clickableArea: '._ak8q',
        title: 'span[dir="auto"]',
        item: 'div._ak8l'
    }
};

const TIMEOUTS = {
    LOAD: 5000,
    CHAT_SELECT: 2000,
    MESSAGE_LOAD: 2000,
    INIT_RETRY: 1000
};

const log = (msg) => {
    console.log(`[WhatsApp Export] ${msg}`);
    try {
        chrome.runtime.sendMessage({ 
            action: "debugLog", 
            message: msg 
        });
    } catch (e) {
        console.error('Logging failed:', e);
    }
};

const verifyEnvironment = () => {
    return new Promise((resolve, reject) => {
        if (!window.location.href.includes('web.whatsapp.com')) {
            reject(new Error('Not in WhatsApp Web context'));
            return;
        }
        resolve(true);
    });
};

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
            subtree: true,
            attributes: true,
            characterData: true
        });
        setTimeout(() => {
            observer.disconnect();
            reject(new Error(`Timeout waiting for ${selector}`));
        }, timeout);
    });
};

const findTargetChat = (container) => {
    clickableAreas=[];
    titles=[];
    const allChats = container.querySelectorAll(SELECTORS.CHAT.item);
    if (!allChats || allChats.length === 0) {
        throw new Error('No chat elements found');
    }
    log(`Found ${allChats.length} chat elements`);
    Array.from(allChats).forEach((chat, index) => {
        const titleSpan = chat.querySelector(SELECTORS.CHAT.title);
        log(`Chat ${index + 1} title: ${titleSpan?.getAttribute('title') || 'No title'}`);
    });
    for (const chat of allChats) {
        const titleSpan = chat.querySelector(SELECTORS.CHAT.title);
        const title = titleSpan?.getAttribute('title');
        if (title) {
            const gridCell = chat.querySelector(SELECTORS.CHAT.gridCell);
            const clickableArea = gridCell?.querySelector(SELECTORS.CHAT.clickableArea);
            if (clickableArea) {
                log('Found target chat with matching title');
                clickableAreas.push(clickableArea);
                titles.push(title);
            }
        }
    }
    return { clickableAreas, titles };
};

const simulateClick = (element) => {
    log('Simulating click on element');
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + (rect.width / 2);
    const centerY = rect.top + (rect.height / 2);
    const events = [
        new MouseEvent('mouseover', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: centerX,
            clientY: centerY
        }),
        new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: centerX,
            clientY: centerY
        }),
        new MouseEvent('mouseup', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: centerX,
            clientY: centerY
        }),
        new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: centerX,
            clientY: centerY
        })
    ];
    events.forEach(event => {
        element.dispatchEvent(event);
    });
};

const extractChatContent = () => {
    const messages = document.querySelectorAll(SELECTORS.MESSAGE.container);
    let content = '';
    log(`Found ${messages.length} messages to extract`);
    messages.forEach((msg, index) => {
        const text = msg.querySelector(SELECTORS.MESSAGE.text);
        const timestamp = msg.querySelector(SELECTORS.MESSAGE.timestamp);
        if (text) {
            const time = timestamp ? timestamp.textContent.trim() : '';
            const msgText = text.textContent.trim();
            content += time ? `[${time}] ${msgText}\n` : `${msgText}\n`;
            if (index % 100 === 0) {
                log(`Processed ${index} messages...`);
            }
        }
    });
    return content;
};


async function automateWhatsAppExport() {
    try {
        clickableChats = [];
        chatTitles = [];
        log('Starting automation');
        chrome.runtime.sendMessage({ action: "loadingProgress", progress: 10 });
        const chatListContainer = await waitForElement(SELECTORS.CHAT_LIST.container);
        log('Chat list container loaded');
        chrome.runtime.sendMessage({ action: "loadingProgress", progress: 20 });
        await new Promise(resolve => setTimeout(resolve, 1500));
        log('Waiting completed, searching for target chat');
        chrome.runtime.sendMessage({ action: "loadingProgress", progress: 30 });
        const result = findTargetChat(chatListContainer);
        clickableChats = result.clickableAreas;
        chatTitles = result.titles;
        clickableChat = clickableChats[0];
        chatTitle = chatTitles[0];
        if (!clickableChat) {
            throw new Error('Target chat element not found');
        }
        log('Target chat found, attempting to click');
        chrome.runtime.sendMessage({ action: "loadingProgress", progress: 40 });
        simulateClick(clickableChat);
        log('Clicked target chat');
        chrome.runtime.sendMessage({ action: "loadingProgress", progress: 50 });
        await waitForElement(SELECTORS.CHAT.messageContainer);
        log('Message container found');
        chrome.runtime.sendMessage({ action: "loadingProgress", progress: 60 });
        await new Promise(resolve => setTimeout(resolve, TIMEOUTS.MESSAGE_LOAD));
        log('Waiting for messages completed');
        chrome.runtime.sendMessage({ action: "loadingProgress", progress: 70 });
        const content = extractChatContent();
        if (!content) {
            throw new Error('No messages found');
        }
        log('Content extracted successfully');
        chrome.runtime.sendMessage({ action: "loadingProgress", progress: 80 });
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `whatsapp-${chatTitle}.txt`;
        log('Triggering download');
        chrome.runtime.sendMessage({ action: "loadingProgress", progress: 90 });
        a.click();
        URL.revokeObjectURL(url);
        log('Export completed successfully');
        chrome.runtime.sendMessage({ action: "loadingProgress", progress: 100 });
    } catch (error) {
        log(`Error during automation: ${error.message}`);
        chrome.runtime.sendMessage({
            action: "automationError",
            error: error.message
        }).catch(() => {});
    }
}


async function initialize() {
    if (isInitialized) {
        log('Already initialized');
        return true;
    }
    if (initializationAttempts >= MAX_INIT_ATTEMPTS) {
        log('Max initialization attempts reached');
        return false;
    }
    initializationAttempts++;
    log(`Initialization attempt ${initializationAttempts}`);
    try {
        await verifyEnvironment();
        log('Environment verified');
        const response = await new Promise((resolve) => {
            chrome.runtime.sendMessage(
                { action: 'contentScriptReady' },
                (response) => resolve(response)
            );
        });
        if (!response || response.status !== 'acknowledged') {
            throw new Error('Initialization not acknowledged');
        }
        isInitialized = true;
        log('Content script initialized successfully');
        return true;
    } catch (error) {
        log(`Initialization error: ${error.message}`);
        if (initializationAttempts < MAX_INIT_ATTEMPTS) {
            log('Retrying initialization...');
            setTimeout(initialize, TIMEOUTS.INIT_RETRY);
        }
        return false;
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    log(`Received message: ${request.action}`);
    switch(request.action) {
        case "ping":
            sendResponse({ status: 'ready', initialized: isInitialized });
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
        case "checkStatus":
            sendResponse({ 
                status: 'active',
                initialized: isInitialized,
                attempts: initializationAttempts
            });
            break;
        default:
            sendResponse({ status: 'unknown_action' });
            break;
    }
    return true;
});

log('Content script loaded');
initialize();