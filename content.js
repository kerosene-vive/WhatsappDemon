let isInitialized = false;
let initializationAttempts = 0;
const MAX_INIT_ATTEMPTS = 5;
let debugSkipQRCheck = true;
let availableChats = [];
let processingAutomation = false;
const processedFiles = new Set();
let resizeTimer;

const VIEWPORT = {
    checkInterval: 1000,
    resizeDebounce: 250,
    minWidth: 300
};

const monitorViewport = () => {
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(handleResize, VIEWPORT.resizeDebounce);
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            reinitializeIfNeeded();
        }
    });
};

const handleResize = async () => {
    const viewport = document.querySelector(SELECTORS.CHAT.viewport);
    if (!viewport || viewport.offsetWidth < VIEWPORT.minWidth) {
        await reinitializeIfNeeded();
    }
};

const reinitializeIfNeeded = async () => {
    if (!isInitialized || processingAutomation) {
        isInitialized = false;
        initializationAttempts = 0;
        await initialize();
    }
};

const waitForElement = (selector, timeout = TIMEOUTS.LOAD) => 
    new Promise((resolve, reject) => {
        const checkElement = () => {
            const element = document.querySelector(selector);
            if (element && isElementVisible(element)) {
                return resolve(element);
            }
            const observer = new MutationObserver((mutations, obs) => {
                const element = document.querySelector(selector);
                if (element && isElementVisible(element)) {
                    obs.disconnect();
                    resolve(element);
                }
            });
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true
            });
            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Timeout: ${selector}`));
            }, timeout);
        };
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', checkElement);
        } else {
            checkElement();
        }
});

const isElementVisible = (element) => {
    const rect = element.getBoundingClientRect();
    return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.top < window.innerHeight &&
        rect.left < window.innerWidth
    );
};

async function maximizeWindow() {
    const viewport = document.querySelector(SELECTORS.CHAT.viewport);
    if (!viewport) return false;
    const originalStyles = {
        width: viewport.style.width,
        height: viewport.style.height,
        position: viewport.style.position
    };
    viewport.style.position = 'fixed';
    viewport.style.width = '100vw';
    viewport.style.height = '100vh';
    await new Promise(resolve => setTimeout(resolve, 500));
    return originalStyles;
}

async function restoreWindow(viewport, originalStyles) {
    if (!viewport || !originalStyles) return;
    Object.assign(viewport.style, originalStyles);
}

async function initialize() {
    if (isInitialized || initializationAttempts >= MAX_INIT_ATTEMPTS) return isInitialized;
    initializationAttempts++;
    try {
        const container = document.querySelector(SELECTORS.CHAT.scrollContainer);
        if (container) {
            container.style.height = '100vh';
            container.style.maxHeight = 'none';
            container.style.overflow = 'auto';
        }
        const viewport = document.querySelector(SELECTORS.CHAT.viewport);
        if (viewport) {
            viewport.style.width = '100vw';
            viewport.style.height = '100vh';
            viewport.style.maxHeight = 'none';
            viewport.style.position = 'fixed';
            viewport.style.top = '0';
            viewport.style.left = '0';
        }
        const isVisible = !document.hidden;
        if (!isVisible) {
            setTimeout(initialize, TIMEOUTS.INIT_RETRY);
            return false;
        }
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
        scrollContainer: 'div[tabindex="0"][role="application"]',
        viewport: '#app, .app-wrapper-web',
        visibilityCheck: '[data-testid="chat"]'
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
            endDate = new Date(request.endDate);
            automateWhatsAppExport(request.selectedChats, endDate)
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

async function automateWhatsAppExport(selectedChats, endDate) {
    try {
        for (let chatTitle of selectedChats) {
            const chat = availableChats.find(c => c.title === chatTitle);
            if (!chat) continue;
            await new Promise((resolve) => {
                    chrome.runtime.sendMessage({ action: "enforceTabFocus" }, resolve);
                });
    
            await new Promise(resolve => setTimeout(resolve, TIMEOUTS.CHAT_SELECT));
            simulateClick(chat.clickableElement);
            await waitForElement(SELECTORS.CHAT.messageContainer);
            const result = await extractChatContentAndMedia(chatTitle,endDate);
            chrome.runtime.sendMessage({ 
                action: "exportProgress",
                progress: Math.round((selectedChats.indexOf(chatTitle) + 1) / selectedChats.length * 100),
                chat: chatTitle,
                stats: {
                    messages: result.totalMessages,
                    media: result.mediaContent
                }
            });
            chrome.runtime.sendMessage({ action: "chatProcessed" });
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

async function extractChatContentAndMedia(chatTitle, endDate) {
    try {
        await scrollChatToTop(endDate);
        const [mediaContent, messages] = await Promise.all([
            collectAllMedia(chatTitle, endDate),
            collectMessages(chatTitle)
        ]);
        const messagesBlob = new Blob([messages.content], { type: 'text/plain' });
        await downloadMedia(messagesBlob, `${chatTitle}/chat.txt`);
        if (mediaContent.links.size > 0) {
            const linksContent = Array.from(mediaContent.links).join('\n\n---\n\n');
            const linksBlob = new Blob([linksContent], { type: 'text/plain' });
            await downloadMedia(linksBlob, `${chatTitle}/links.txt`);
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

async function scrollChatToTop(endDate) {
    const container = document.querySelector(SELECTORS.CHAT.scrollContainer);
    if (!container) return;
    
    let lastCount = 0;
    let unchanged = 0;
    const targetDate = new Date(endDate);
    console.log('Starting scroll with target end date:', targetDate.toISOString());
    
    for (let i = 0; i < 30 && unchanged < 3; i++) {
        const messages = document.querySelectorAll(SELECTORS.MESSAGE.container);
        if (messages.length === 0) continue;
        
        // Look for date headers
        let currentElement = messages[0];
        let dateFound = false;
        
        while (currentElement && !dateFound) {
            let sibling = currentElement.previousElementSibling;
            while (sibling && !dateFound) {
                const siblingText = sibling.textContent.trim();
                
                // Check for date in DD/MM/YYYY format
                if (/^\d{2}\/\d{2}\/\d{4}$/.test(siblingText)) {
                    console.log('Found date header:', siblingText);
                    const [day, month, year] = siblingText.split('/').map(Number);
                    const messageDate = new Date(year, month - 1, day);
                    console.log('Parsed message date:', messageDate.toISOString());
                    console.log('Target date:', targetDate.toISOString());
                    
                    // Stop scrolling if we've reached a message older than the target date
                    if (messageDate < targetDate) {
                        console.log('Found message older than target date, stopping scroll');
                        return;
                    }
                    dateFound = true;
                }
                sibling = sibling.previousElementSibling;
            }
            currentElement = currentElement.parentElement;
        }
        
        // Scroll logic
        messages[0]?.scrollIntoView({ behavior: "auto", block: "center" });
        container.scrollTop -= 10000;
        await new Promise(resolve => setTimeout(resolve, 400));
        
        const currentCount = messages.length;
        if (currentCount === lastCount) {
            unchanged++;
            console.log(`Unchanged count: ${unchanged}, current messages: ${currentCount}`);
        } else {
            unchanged = 0;
            lastCount = currentCount;
            console.log(`New messages found, total count: ${currentCount}`);
        }
    }
    
    console.log('Reached max iterations or unchanged limit without finding target date');
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

async function scrollAndCollectMedia(type) {
    const container = document.querySelector(SELECTORS.CHAT.scrollContainer);
    if (!container) throw new Error('No scroll container');
    const mediaItems = new Map();
    let lastHeight = container.scrollHeight;
    let unchangedCount = 0;
    const collectCurrentView = () => {
        const selector = SELECTORS.MEDIA_ELEMENTS[type];
        document.querySelectorAll(selector).forEach(el => {
            if (type === 'documents') {
                const button = el.closest('[role="button"][title*="Download"]') || el;
                if (button) {
                    const title = button.getAttribute('title') || '';
                    const uniqueId = title.replace(/\s*\(\d+\)\s*/, '').trim();
                    if (!mediaItems.has(uniqueId)) {
                        mediaItems.set(uniqueId, button);
                    }
                }
            } else if (type === 'links') {
                const url = el.href || el.getAttribute('data-url');
                if (url?.startsWith('http')) mediaItems.set(url, url);
            } else {
                const url = el.src || el.style.backgroundImage?.match(/url\("(.+)"\)/)?.[1];
                if (url?.startsWith('blob:')) mediaItems.set(url, url);
            }
        });
    };
    container.scrollTop = 0;
    await new Promise(resolve => setTimeout(resolve, 500));
    for (let i = 0; i < 50 && unchangedCount < 5; i++) {
        collectCurrentView();
        container.scrollTop += 500;
        await new Promise(resolve => setTimeout(resolve, 300));
        const currentHeight = container.scrollHeight;
        if (Math.abs(currentHeight - lastHeight) < 10) {
            unchangedCount++;
        } else {
            unchangedCount = 0;
            lastHeight = currentHeight;
        }
    }
    return Array.from(type === 'documents' ? mediaItems.values() : mediaItems.keys());
}

async function collectAllMedia(chatTitle,endDate) {
    const mediaContent = {
        images: [], videos: [],
        documents: new Set(),
        links: new Set()
    };
    await scrollChatToTop(endDate);
    for (const type of Object.keys(mediaContent)) {
        try {
            const items = await scrollAndCollectMedia(type);
            for (let [index, item] of items.entries()) {
                try {
                    switch(type) {
                        case 'images':
                        case 'videos':
                            const ext = type === 'images' ? '.jpg' : '.mp4';
                            const filename = `${chatTitle}/${type}/${index + 1}${ext}`;
                            const response = await fetch(item);
                            const blob = await response.blob();
                            await downloadMedia(blob, filename);
                            mediaContent[type].push(item);
                            break; 
                        case 'documents':
                            const docResult = await processDocument(item, chatTitle, index);
                            if (docResult) mediaContent.documents.add(docResult);
                            await new Promise(resolve => setTimeout(resolve, 200));
                            break;
                        case 'links':
                            mediaContent.links.add(item);
                            break;
                    }
                    updateProgress(index + 1, items.length, chatTitle);
                } catch (error) {
                    log(`Error processing ${type} ${index}: ${error.message}`);
                }
            }
        } catch (error) {
            log(`Error collecting ${type}: ${error.message}`);
        }
    }
    return mediaContent;
}

async function processDocument(button, chatTitle, index) {
    const title = button.getAttribute('title') || '';
    const cleanTitle = title.replace(/\s*\(\d+\)\s*/, '');
    const filename = `${chatTitle}/documents/${cleanTitle}`;
    if (!processedFiles.has(filename)) {
        processedFiles.add(filename);
        await simulateClick(button);
        return filename;
    }
    return null;
}

async function collectMessages(chatTitle) {
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log('Starting message collection...');
    const messages = document.querySelectorAll('div.message-in, div.message-out');
    console.log('Found messages:', messages.length);
    const uniqueMessages = new Set();
    const processedMessages = [];
    const getDateFromRelative = (text, time) => {
        const [hours, minutes] = time.split(':').map(Number);
        const today = new Date();
        today.setHours(hours, minutes, 0, 0);      
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        text = text.toLowerCase().trim();
        if (text === 'yesterday' || text === 'ieri') {
            return yesterday;
        } else if (text === 'today' || text === 'oggi') {
            return today;
        }
        return null;
    };
    const weekdayToDate = (weekday, time) => {
        const weekdays = {
            'sunday': 0, 'monday': 1, 'tuesday': 2, 'wednesday': 3,
            'thursday': 4, 'friday': 5, 'saturday': 6,
            'domenica': 0, 'lunedì': 1, 'martedì': 2, 'mercoledì': 3,
            'giovedì': 4, 'venerdì': 5, 'sabato': 6
        };
        const today = new Date();
        const [hours, minutes] = time.split(':').map(Number);
        const targetWeekday = weekdays[weekday.toLowerCase()];
        if (targetWeekday !== undefined) {
            const diff = targetWeekday - today.getDay();
            const targetDate = new Date(today);
            targetDate.setDate(today.getDate() + diff);
            targetDate.setHours(hours, minutes, 0, 0);
            if (targetDate > today) {
                targetDate.setDate(targetDate.getDate() - 7);
            }
            return targetDate;
        }
        return null;
    };
    const getMessageTimestamp = (dateInfo, time) => {
        if (typeof dateInfo === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(dateInfo)) {
            const [day, month, year] = dateInfo.split('/').map(Number);
            const [hours, minutes] = time.split(':').map(Number);
            return new Date(year, month - 1, day, hours, minutes).getTime();
        } else if (dateInfo instanceof Date) {
            return dateInfo.getTime();
        }
        return null;
    };
    messages.forEach(msg => {
        const text = msg.querySelector('.selectable-text.copyable-text')?.textContent.trim();
        const timeElement = msg.querySelector('.x3nfvp2.xxymvpz');      
        if (text && timeElement) {
            const timeText = timeElement.textContent.trim();
            let dateInfo = null;
            let currentElement = msg;
            while (currentElement && !dateInfo) {
                let sibling = currentElement.previousElementSibling;
                while (sibling && !dateInfo) {
                    const siblingText = sibling.textContent.trim();                    
                    if (/^\d{2}\/\d{2}\/\d{4}$/.test(siblingText)) {
                        dateInfo = siblingText;
                    } else if (/^(yesterday|ieri|today|oggi)$/i.test(siblingText)) {
                        const date = getDateFromRelative(siblingText, timeText);
                        if (date) dateInfo = date;
                    } else if (/^(sunday|monday|tuesday|wednesday|thursday|friday|saturday|domenica|lunedì|martedì|mercoledì|giovedì|venerdì|sabato)$/i.test(siblingText)) {
                        const date = weekdayToDate(siblingText, timeText);
                        if (date) dateInfo = date;
                    }
                    sibling = sibling.previousElementSibling;
                }
                currentElement = currentElement.parentElement;
            }
            if (!dateInfo && timeElement.title) {
                const titleMatch = timeElement.title.match(/(\d{2}\/\d{2}\/\d{4})/);
                if (titleMatch) {
                    dateInfo = titleMatch[1];
                }
            }         
            const timestamp = getMessageTimestamp(dateInfo, timeText);
            if (timestamp) {
                const messageDate = new Date(timestamp).toLocaleDateString('en-GB');
                const messageId = `${timeText}-${msg.matches('div.message-out') ? 'out' : 'in'}-${text.substring(0, 50)}`;
                if (!uniqueMessages.has(messageId)) {
                    uniqueMessages.add(messageId);
                    processedMessages.push({
                        text,
                        time: timeText,
                        date: messageDate,
                        timestamp,
                        type: msg.matches('div.message-out') ? 'out' : 'in',
                        hasMedia: !!msg.querySelector('img[src^="blob:"], video[src^="blob:"], [data-icon="document"]')
                    });
                }
            }
        }
    });
    console.log('Processed messages:', processedMessages.length);
    processedMessages.sort((a, b) => a.timestamp - b.timestamp);
    let content = [
        '\n===========================================',
        `Chat Export: ${chatTitle.toUpperCase()}`,
        `Messages: ${processedMessages.length}`,
        `Date Range: ${processedMessages[0]?.date || 'N/A'} - ${processedMessages[processedMessages.length-1]?.date || 'N/A'}`,
        '===========================================\n\n'
    ].join('\n');
    processedMessages.forEach(msg => {
        content += [
            `[${msg.date} ${msg.time}] ${msg.type === 'out' ? 'Me' : chatTitle}:`,
            `>>> ${msg.text}`,
            msg.hasMedia ? '[Contains media]\n' : '',
            '-------------------------------------------\n\n'
        ].join('\n');
    });
    return {
        content,
        count: processedMessages.length
    };
}

log('Content script loaded');
initialize();