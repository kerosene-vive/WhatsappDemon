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
    MEDIA: {
        image: 'img[src^="blob:"]',
        video: 'video[src^="blob:"]',
        document: '._2VSMU',
        downloadButton: '._2qitd',
        mediaViewerContainer: '._3YS_f._2A1R8',
        closeViewerButton: '._3RUBq button'
    },
    CHAT: {
        messageContainer: '[role="application"]',
        gridCell: '[role="gridcell"]',
        clickableArea: '._ak8q',
        title: 'span[dir="auto"]',
        item: 'div._ak8l',
        scrollContainer: 'div[tabindex="0"][role="application"]'
    }
};
const TIMEOUTS = {
    LOAD: 5000,
    CHAT_SELECT: 1100,
    MESSAGE_LOAD: 1000,
    MEDIA_LOAD: 1000,
    INIT_RETRY: 100,
    DOWNLOAD_WAIT: 100,
    SCROLL_INTERVAL: 100,
    SCROLL_ATTEMPTS: 100
};
const MIME_TYPES = {
    IMAGE: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    VIDEO: ['video/mp4', 'video/webm'],
    DOCUMENT: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
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
const scrollChatToTop = async () => {
    log('Starting to scroll chat history');
    const scrollContainer = document.querySelector(SELECTORS.CHAT.scrollContainer);
    if (!scrollContainer) {
        log('Could not find scroll container');
        return;
    }
    log('Found scroll container, starting scroll');
    let lastMessageCount = 0;
    let unchangedCount = 0;
    const maxAttempts = 30;
    for (let i = 0; i < maxAttempts; i++) {
        const messages = document.querySelectorAll(SELECTORS.MESSAGE.container);
        const firstMessage = messages[0];
        if (!firstMessage) {
            log('No messages found');
            break;
        }
        const currentCount = messages.length;
        log(`Scroll attempt ${i + 1}, current messages: ${currentCount}`);
        firstMessage.scrollIntoView({ behavior: "auto", block: "center" });
        scrollContainer.scrollTop -= 10000;
        await new Promise(resolve => setTimeout(resolve, 400));
        if (currentCount === lastMessageCount) {
            unchangedCount++;
            if (unchangedCount >= 3) {
                log('No more messages loading, stopping scroll');
                break;
            }
        } else {
            unchangedCount = 0;
            lastMessageCount = currentCount;
            log(`New messages loaded, total: ${currentCount}`);
        }
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
    log('Finished scrolling');
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
const downloadMedia = async (mediaElement, type, timestamp, chatTitle, index) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!mediaElement.src) {
                reject(new Error('No source found for media element'));
                return;
            }
            const response = await fetch(mediaElement.src);
            const blob = await response.blob();
            const extension = type.startsWith('image') ? '.jpg' : 
                            type.startsWith('video') ? '.mp4' : '.bin';
            const filename = `photo_${chatTitle}${index}${extension}`;
            chrome.runtime.sendMessage({
                action: "downloadMedia",
                data: {
                    url: URL.createObjectURL(blob),
                    filename: filename,
                    type: type
                }
            });
            resolve(filename);
        } catch (error) {
            reject(error);
        }
    });
};
const extractMediaContent = async (chatTitle, type) => {
    await new Promise(resolve => setTimeout(resolve, TIMEOUTS.MEDIA_LOAD));
    const menuButton = document.querySelector('.xr9ek0c');
    if (!menuButton) throw new Error('Could not find menu button');
    simulateClick(menuButton);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const infoButton = document.querySelector('div[aria-label*="info"]');
    if (!infoButton) throw new Error('Could not find info button');
    simulateClick(infoButton);
    await new Promise(resolve => setTimeout(resolve, 1000));
    const mediaLink = document.querySelector('div.x12lumcd span.x1xhoq4m');
    if (!mediaLink) {
        log('No media section found, continuing...');
        return [];
    }
    simulateClick(mediaLink);
    await new Promise(resolve => setTimeout(resolve, 3000));
    const mediaItems = [];
    if (type === 'photo') {
        const mediaDivs = document.querySelectorAll('div.x1xsqp64.x18d0r48');
        if (!mediaDivs.length) {
            log('No media items found, continuing...');
            return [];
        }
        let index = 1;
        for (const div of mediaDivs) {
            try {
                const style = div.style.backgroundImage;
                if (!style || !style.includes('blob:')) continue;
                const blobUrl = style.match(/blob:([^"]*)/)[0];
                const response = await fetch(blobUrl);
                const blob = await response.blob();
                const filename = `${chatTitle}-${index}${blob.type.includes('video') ? '.mp4' : '.jpg'}`;
                chrome.runtime.sendMessage({
                    action: "downloadMedia",
                    data: {
                        url: URL.createObjectURL(blob),
                        filename: filename,
                        type: blob.type
                    }
                });
                mediaItems.push({ type: blob.type.includes('video') ? 'video' : 'image' });
                log(`Downloaded media item ${index}`);
                index++;
            } catch (error) {
                log(`Error downloading media item ${index}: ${error.message}`);
            }
        }
        return mediaItems;
    }
    else if (type === 'document') {
        log('Extracting document media');
        return [];
    }
    else if (type === 'link') {
        log('Extracting link media');
        return [];
    }
 };
const extractAndDownloadChat = async (chatTitle) => {
    await new Promise(resolve => setTimeout(resolve, TIMEOUTS.MESSAGE_LOAD));
    await scrollChatToTop();
    const messages = document.querySelectorAll('div.message-in, div.message-out');
    let content = '';
    content += `\n\n`;
    content += `                  ===========================================\n`;
    content += `                                   ${chatTitle.toUpperCase()}\n`;
    content += `                  ===========================================\n\n`;
    messages.forEach((msg, index) => {
        const text = msg.querySelector(SELECTORS.MESSAGE.text);
        const timestamp = msg.querySelector(SELECTORS.MESSAGE.timestamp);
        const isOutgoing = msg.matches('div.message-out');
        if (text) {
            const time = timestamp ? timestamp.textContent.trim() : '';
            const msgText = text.textContent.trim();
            const date = new Date().toLocaleDateString('en-GB');
            const sender = isOutgoing ? 'Me' : chatTitle;
            content += `[${date} ${time}]  ${sender}:\n`;
            content += `>>> ${msgText}\n\n`;
            content += `-------------------------------------------\n\n`;
            if (index % 100 === 0) {
                log(`Processed ${index} messages...`);
            }
        }
    });
    const filename = `${chatTitle}.txt`;
    const blob = new Blob([content], { type: 'text/plain' });
    chrome.runtime.sendMessage({
        action: "downloadChat",
        data: {
            url: URL.createObjectURL(blob),
            filename: filename
        }
    });
    return filename;
};


async function automateWhatsAppExport(numberOfChats = 1) {
    try {
        log('Starting automation');
        chrome.runtime.sendMessage({ action: "loadingProgress", progress: 10 });
        const chatListContainer = await waitForElement(SELECTORS.CHAT_LIST.container);
        log('Chat list container loaded');
        chrome.runtime.sendMessage({ action: "loadingProgress", progress: 20 });
        const { clickableAreas: clickableChats, titles: chatTitles } = findTargetChat(chatListContainer);
        const exportedChats = Math.min(clickableChats.length, numberOfChats);
        for (let i = 0; i < exportedChats; i++) {
            const clickableChat = clickableChats[i];
            const chatTitle = chatTitles[i];
            await new Promise(resolve => setTimeout(resolve, TIMEOUTS.CHAT_SELECT));
            simulateClick(clickableChat);
            await waitForElement(SELECTORS.CHAT.messageContainer);
            let filename;
            filename = await extractAndDownloadChat(chatTitle);
            log(`Downloaded chat: ${filename}`);
            chrome.runtime.sendMessage({ 
                action: "chatProgress", 
                progress: Math.round((i + 1) / exportedChats * 100),
                chatTitle: chatTitle 
            });
        }
        log('Export completed successfully');
        chrome.runtime.sendMessage({ 
            action: "exportComplete",
            message: `Successfully exported ${exportedChats} chats`
        });
    } catch (error) {
        log(`Error during automation: ${error.message}`);
        chrome.runtime.sendMessage({
            action: "automationError",
            error: error.message
        });
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
            sendResponse({ status: 'text automation started' });
            break;
        case "startMediaDownload":
            if (!isInitialized) {
                sendResponse({ error: 'Content script not initialized' });
                return true;
            }
            const chatCount = request.numberOfChats || 1;
            const type = request.includeMedia;
            const handleMediaDownload = async () => {
                try {
                    const chatListContainer = await waitForElement(SELECTORS.CHAT_LIST.container);
                    const { clickableAreas: clickableChats, titles: chatTitles } = findTargetChat(chatListContainer);
                    const exportedChats = Math.min(clickableChats.length, chatCount);
                    for (let i = 0; i < exportedChats; i++) {
                        const clickableChat = clickableChats[i];
                        const chatTitle = chatTitles[i];
                        await new Promise(resolve => setTimeout(resolve, TIMEOUTS.CHAT_SELECT));
                        simulateClick(clickableChat);
                        await waitForElement(SELECTORS.CHAT.messageContainer);
                        await new Promise(resolve => setTimeout(resolve, TIMEOUTS.MEDIA_LOAD));
                        const mediaContent = await extractMediaContent(chatTitle, type);
                        log(`Extracted media from: ${chatTitle} - Found ${mediaContent.length} items`);
                        chrome.runtime.sendMessage({ 
                            action: "mediaProgress", 
                            progress: (i + 1) / exportedChats * 100,
                            chat: chatTitle,
                            mediaCount: mediaContent.length
                        });
                    }
                    log('Media download completed successfully');
                    chrome.runtime.sendMessage({ action: "mediaDownloadComplete" });
                } catch (error) {
                    log(`Error during media download: ${error.message}`);
                    chrome.runtime.sendMessage({
                        action: "automationError",
                        error: error.message
                    }).catch(() => {});
                }
            };
            handleMediaDownload();
            sendResponse({ status: 'media download started' });
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