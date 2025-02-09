let isInitialized = false;
let initializationAttempts = 0;
const MAX_INIT_ATTEMPTS = 5;
let debugSkipQRCheck = true;
let availableChats = [];
let processingAutomation = false;

const SELECTORS = {
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
        scrollContainer: 'div[tabindex="0"][role="application"]'
    },
    MEDIA_ELEMENTS: {
        images: 'img[src^="blob:"], div[style*="background-image"][role="button"]',
        videos: 'video[src^="blob:"]',
        documents: '[role="button"][title*="Download"], .x78zum5[title*="Download"], .icon-doc-pdf, [data-testid="document-thumb"]',
        links: 'a[href^="http"], [data-testid="link"], div[role="link"]'
    }
};

const TIMEOUTS = {
    LOAD: 1000,
    CHAT_SELECT: 100,
    MESSAGE_LOAD: 100,
    MEDIA_LOAD: 100,
    INIT_RETRY: 50,
    DOWNLOAD_WAIT: 50,
    SCROLL_INTERVAL: 100,
    SCROLL_ATTEMPTS: 100
};


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch(request.action) {
        case "ping":
            sendResponse({ status: 'ready', initialized: isInitialized });
            break;
        case "getChats":
            sendResponse({ chats: availableChats.map(chat => chat.title) });
            break;
        case "checkLoginStatus":
            sendResponse({ needsLogin: !!document.querySelector('div[data-ref]') });
            break;
        case "startAutomation":
            if (processingAutomation) {
                sendResponse({ error: 'Automation already in progress' });
                return true;
            }
            if (!isInitialized) {
                sendResponse({ error: 'Content script not initialized' });
                return true;
            }
            processingAutomation = true;
            automateWhatsAppExport(request.selectedChats)
                .finally(() => processingAutomation = false);
            sendResponse({ status: 'automation started' });
            break;
    }
    return true;
});


async function initialize() {
    if (isInitialized || initializationAttempts >= MAX_INIT_ATTEMPTS) return isInitialized;
    initializationAttempts++;
    try {
        const qrCode = document.querySelector('div[data-ref]');
        const chatList = document.querySelector('#pane-side');
        if (qrCode && !chatList) {
            chrome.runtime.sendMessage({ action: 'whatsappLoginRequired' });
            setTimeout(() => { initializationAttempts--; initialize(); }, 1000);
            return false;
        }
        if (!await waitForElement('#pane-side', 10000)) {
            setTimeout(initialize, TIMEOUTS.INIT_RETRY);
            return false;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
        availableChats = await getChatsList();
        if (availableChats.length === 0) {
            setTimeout(initialize, TIMEOUTS.INIT_RETRY);
            return false;
        }
        chrome.runtime.sendMessage({ 
            action: 'chatsAvailable', 
            chats: availableChats.map(chat => chat.title)
        });
        isInitialized = true;
        return true;
    } catch (error) {
        log(`Init error: ${error.message}`);
        if (initializationAttempts < MAX_INIT_ATTEMPTS) {
            setTimeout(initialize, TIMEOUTS.INIT_RETRY);
        }
        return false;
    }
}


async function automateWhatsAppExport(selectedChats) {
    try {
        for (let chatTitle of selectedChats) {
            const chat = availableChats.find(c => c.title === chatTitle);
            if (!chat) continue;
            await new Promise(resolve => setTimeout(resolve, TIMEOUTS.CHAT_SELECT));
            simulateClick(chat.clickableElement);
            await waitForElement(SELECTORS.CHAT.messageContainer);
            const result = await extractChatContentAndMedia(chatTitle);
            chrome.runtime.sendMessage({ 
                action: "exportProgress",
                progress: Math.round((selectedChats.indexOf(chatTitle) + 1) / selectedChats.length * 100),
                chat: chatTitle,
                stats: {
                    messages: result.totalMessages,
                    media: result.mediaContent
                }
            });
        }
        chrome.runtime.sendMessage({ 
            action: "exportComplete",
            message: `Successfully processed ${selectedChats.length} chats`
        });
    } catch (error) {
        chrome.runtime.sendMessage({
            action: "automationError",
            error: error.message
        });
    }
}


async function collectMessages(chatTitle) {
    const messages = document.querySelectorAll('div.message-in, div.message-out');
    let content = [
        '\n===========================================',
        `Chat Export: ${chatTitle.toUpperCase()}`,
        `Date: ${new Date().toLocaleDateString('en-GB')}`,
        `Messages: ${messages.length}`,
        '===========================================\n\n'
    ].join('\n');
    messages.forEach(msg => {
        const text = msg.querySelector(SELECTORS.MESSAGE.text);
        const time = msg.querySelector(SELECTORS.MESSAGE.timestamp)?.textContent.trim() || '';
        if (text) {
            content += [
                `[${new Date().toLocaleDateString('en-GB')} ${time}] ${msg.matches('div.message-out') ? 'Me' : chatTitle}:`,
                `>>> ${text.textContent.trim()}`,
                msg.querySelector('img[src^="blob:"], video[src^="blob:"], [data-icon="document"]') ? '[Contains media]\n' : '',
                '-------------------------------------------\n\n'
            ].join('\n');
        }
    });
    return { content, count: messages.length };
}


async function extractChatContentAndMedia(chatTitle) {
    try {
        await scrollChatToTop();
        const [mediaContent, messages] = await Promise.all([
            collectAllMedia(chatTitle),
            collectMessages(chatTitle)
        ]);
        const messagesBlob = new Blob([messages.content], { type: 'text/plain' });
        await downloadMedia(messagesBlob, `${chatTitle}/${chatTitle}.txt`);
        if (mediaContent.links.size > 0) {
            const linksContent = Array.from(mediaContent.links).join('\n\n---\n\n');
            const linksBlob = new Blob([linksContent], { type: 'text/plain' });
            await downloadMedia(linksBlob, `${chatTitle}/${chatTitle}-links.txt`);
        }
        return {
            success: true,
            mediaContent: {
                images: mediaContent.images.length,
                videos: mediaContent.videos.length,
                documents: mediaContent.documents.size,
                links: mediaContent.links.size
            },
            totalMessages: messages.count
        };
    } catch (error) {
        throw error;
    }
}


async function scrollAndCollectMedia(type) {
    const container = document.querySelector(SELECTORS.CHAT.scrollContainer);
    if (!container) throw new Error('No scroll container');
    const mediaItems = new Set();
    let lastHeight = 0;
    let unchangedCount = 0;
    const collectCurrentView = () => {
        const selector = SELECTORS.MEDIA_ELEMENTS[type];
        document.querySelectorAll(selector).forEach(el => {
            if (type === 'documents') {
                const button = el.closest('[role="button"][title*="Download"]') || el;
                if (button) mediaItems.add(button);
            } else {
                const url = el.src || el.href || 
                           el.style.backgroundImage?.match(/url\("(.+)"\)/)?.[1] ||
                           el.getAttribute('data-url');
                if (url?.startsWith(type === 'links' ? 'http' : 'blob:')) {
                    mediaItems.add(url);
                }
            }
        });
    };
    for (let i = 0; i < 30 && unchangedCount < 3; i++) {
        collectCurrentView();
        container.scrollTop += 1000;
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (container.scrollHeight === lastHeight) unchangedCount++;
        else {
            unchangedCount = 0;
            lastHeight = container.scrollHeight;
        }
    }

    return Array.from(mediaItems);
}


async function scrollChatToTop() {
    const container = document.querySelector(SELECTORS.CHAT.scrollContainer);
    if (!container) return;
    let lastCount = 0;
    let unchanged = 0;
    for (let i = 0; i < 30 && unchanged < 3; i++) {
        const messages = document.querySelectorAll(SELECTORS.MESSAGE.container);
        messages[0]?.scrollIntoView({ behavior: "auto", block: "center" });
        container.scrollTop -= 10000;
        await new Promise(resolve => setTimeout(resolve, 400));
        const currentCount = messages.length;
        if (currentCount === lastCount) unchanged++;
        else {
            unchanged = 0;
            lastCount = currentCount;
        }
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
}


function processMessages(messages, chatTitle, mediaContent) {
    let content = [
        '\n\n===========================================',
        `Chat Export: ${chatTitle.toUpperCase()}`,
        `Date: ${new Date().toLocaleDateString('en-GB')}`,
        `Messages: ${messages.length}`,
        'Media Summary:',
        `- Images: ${mediaContent.images.length}`,
        `- Videos: ${mediaContent.videos.length}`,
        `- Documents: ${mediaContent.documents.size}`,
        `- Links: ${mediaContent.links.size}`,
        '===========================================\n\n'
    ].join('\n');
    messages.forEach(msg => {
        const text = msg.querySelector(SELECTORS.MESSAGE.text);
        const time = msg.querySelector(SELECTORS.MESSAGE.timestamp)?.textContent.trim() || '';
        if (text) {
            content += [
                `[${new Date().toLocaleDateString('en-GB')} ${time}] ${msg.matches('div.message-out') ? 'Me' : chatTitle}:`,
                `>>> ${text.textContent.trim()}`,
                msg.querySelector('img[src^="blob:"], video[src^="blob:"], [data-icon="document"]') ? '[Contains media]\n' : '',
                '-------------------------------------------\n\n'
            ].join('\n');
        }
    });
    return content;
}


const log = msg => {
    console.log(`[WhatsApp Export] ${msg}`);
    chrome.runtime.sendMessage({ action: "debugLog", message: msg }).catch(() => {});
};


const downloadMedia = async (blob, filename) => {
    chrome.runtime.sendMessage({
        action: "downloadMedia",
        data: { url: URL.createObjectURL(blob), filename, type: blob.type }
    });
};


const updateProgress = (current, total, chatTitle) => {
    chrome.runtime.sendMessage({
        action: "mediaProgress",
        progress: Math.round((current / total) * 100),
        chat: chatTitle,
        mediaCount: current
    });
};


const simulateClick = element => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    ['mouseover', 'mousedown', 'mouseup', 'click'].forEach(type => 
        element.dispatchEvent(new MouseEvent(type, {
            bubbles: true, cancelable: true, view: window,
            clientX: x + (Math.random() * 4 - 2),
            clientY: y + (Math.random() * 4 - 2)
        }))
    );
};


const waitForElement = (selector, timeout = TIMEOUTS.LOAD) => 
        new Promise((resolve, reject) => {
            const element = document.querySelector(selector);
            if (element) return resolve(element);
            const observer = new MutationObserver((_, obs) => {
                const element = document.querySelector(selector);
                if (element) {
                    obs.disconnect();
                    resolve(element);
                }
            });
            observer.observe(document.body, {
                childList: true, subtree: true,
                attributes: true, characterData: true
            });
            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Timeout: ${selector}`));
            }, timeout);
});


async function processMediaItem(url, chatTitle, index, type) {
        try {
            const response = await fetch(url);
            const blob = await response.blob();
            return {
                blob,
                filename: `${chatTitle}/${type}/${index + 1}${type === 'images' ? '.jpg' : '.mp4'}`
            };
        } catch (error) {
            log(`Media processing error: ${error.message}`);
            return null;
        }
}


const getChatsList = async () => {
    const container = await waitForElement(SELECTORS.CHAT_LIST.container);
    const elements = container.querySelectorAll(SELECTORS.CHAT.item);
    return Array.from(elements)
        .map(chat => {
            const titleSpan = chat.querySelector(SELECTORS.CHAT.title);
            const title = titleSpan?.getAttribute('title');
            if (title) {
                const gridCell = chat.querySelector(SELECTORS.CHAT.gridCell);
                const clickableArea = gridCell?.querySelector(SELECTORS.CHAT.clickableArea);
                if (clickableArea) {
                    return {
                        title,
                        clickableElement: clickableArea
                    };
                }
            }
            return null;
        })
        .filter(chat => chat !== null);
};


const findDownloadButton = async (container) => {
    const downloadSelectors = [
        'span[data-icon="download"]',
        'button[aria-label*="Download"]',
        'div[role="button"]:has(span[data-icon="download"])',
        'div[title*="Download"]',
        '[data-testid="download"]'
    ];
    for (const selector of downloadSelectors) {
        const button = container.querySelector(selector) || document.querySelector(selector);
        if (button) return button;
    }
    return container.querySelector('div[role="button"]') || 
           container.closest('div[role="button"]') ||
           container;
};


async function collectAllMedia(chatTitle) {
    const mediaContent = {
        images: [], videos: [],
        documents: new Set(), links: new Set()
    };
    await Promise.all(Object.keys(mediaContent).map(async type => {
        const items = await scrollAndCollectMedia(type);
        await Promise.all(items.map(async (item, index) => {
            try {
                switch(type) {
                    case 'images':
                    case 'videos':
                        const response = await fetch(item);
                        const blob = await response.blob();
                        const ext = type === 'images' ? '.jpg' : '.mp4';
                        const filename = `${chatTitle}/${type}/${index + 1}${ext}`;
                        await downloadMedia(blob, filename);
                        mediaContent[type].push(item);
                        break;
                    case 'documents':
                        const button = await findDownloadButton(item);
                        if (button) {
                            const docId = `${button.getAttribute('title') || 'doc'}-${index}`;
                            if (!mediaContent.documents.has(docId)) {
                                await simulateClick(button);
                                mediaContent.documents.add(docId);
                                await new Promise(resolve => setTimeout(resolve, 100));
                            }
                        }
                        break;  
                    case 'links':
                        mediaContent.links.add(item);
                        break;
                }
                updateProgress(index + 1, items.length, chatTitle);
            } catch (error) {
                log(`Error processing ${type} ${index}: ${error.message}`);
            }
        }));
    }));
    return mediaContent;
}

log('Content script loaded');
initialize();