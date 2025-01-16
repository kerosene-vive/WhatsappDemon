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
    const clickableAreas = [];
    const titles = [];
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

async function automateWhatsAppExport(numberOfChats = 1) {
    try {
        log('Starting automation');
        chrome.runtime.sendMessage({ action: "loadingProgress", progress: 10 });
        const chatListContainer = await waitForElement(SELECTORS.CHAT_LIST.container);
        log('Chat list container loaded');
        chrome.runtime.sendMessage({ action: "loadingProgress", progress: 20 });
        const { clickableAreas: clickableChats, titles: chatTitles } = findTargetChat(chatListContainer);
        const allContents = [];
        exportedChats = Math.min(clickableChats.length, numberOfChats);
        for (let i = 0; i < exportedChats; i++) {
            const clickableChat = clickableChats[i];
            const chatTitle = chatTitles[i];
            
            await new Promise(resolve => setTimeout(resolve, TIMEOUTS.CHAT_SELECT));
            simulateClick(clickableChat);
            
            await waitForElement(SELECTORS.CHAT.messageContainer);
            await new Promise(resolve => setTimeout(resolve, TIMEOUTS.MESSAGE_LOAD));
            
            const content = extractChatContent();
            if (content) {
                allContents.push({
                    title: chatTitle,
                    content: content
                });
                log(`Extracted content from: ${chatTitle}`);
            }
            
            chrome.runtime.sendMessage({ 
                action: "loadingProgress", 
                progress: 20 + (60 * ((i + 1) / clickableChats.length)) 
            });
        }

        // Send the extracted content to background script for processing
        chrome.runtime.sendMessage({
            action: "processChats",
            chats: allContents
        });
        
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
            const numberOfChats = request.numberOfChats || 1;
            automateWhatsAppExport(numberOfChats).catch(error => {
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