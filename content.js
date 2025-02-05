let isInitialized = false;
let initializationAttempts = 0;
const MAX_INIT_ATTEMPTS = 5;
let debugSkipQRCheck = true; // Skip QR check during development

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
let availableChats = [];
let processingAutomation = false;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch(request.action) {
        case "ping":
            sendResponse({ status: 'ready', initialized: isInitialized });
            break;
        case "getChats":
            sendResponse({ chats: availableChats.map(chat => chat.title) });
            break;
        case "checkLoginStatus":
                const qrCode = document.querySelector('div[data-ref]');
                sendResponse({ needsLogin: !!qrCode });
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
            automateWhatsAppExport(request.selectedChats, request.includeMedia)
                .finally(() => {
                    processingAutomation = false;
                });
            sendResponse({ status: 'automation started' });
            break;
    }
    return true;
});


async function handleMediaDownload(selectedChats, type) {
    if (processingAutomation) {
        throw new Error('Automation already in progress');
    }
    try {
        processingAutomation = true;
        for (let chatTitle of selectedChats) {
            const chat = availableChats.find(c => c.title === chatTitle);
            if (!chat) continue;
            await new Promise(resolve => setTimeout(resolve, TIMEOUTS.CHAT_SELECT));
            simulateClick(chat.clickableElement);
            await waitForElement(SELECTORS.CHAT.messageContainer);
            const mediaContent = await extractMediaContent(chatTitle, type);
            log(`Extracted media from: ${chatTitle} - Found ${mediaContent.length} items`);
            chrome.runtime.sendMessage({ 
                action: "mediaProgress", 
                progress: (selectedChats.indexOf(chatTitle) + 1) / selectedChats.length * 100,
                chat: chatTitle,
                mediaCount: mediaContent.length
            });
        }
        chrome.runtime.sendMessage({ action: "mediaDownloadComplete" });
    } catch (error) {
        chrome.runtime.sendMessage({
            action: "automationError",
            error: error.message
        });
    } finally {
        processingAutomation = false;
    }
}

async function initialize() {
    if (isInitialized) return true;
    if (initializationAttempts >= MAX_INIT_ATTEMPTS) return false;
    
    initializationAttempts++;
 
    try {
        const qrCode = document.querySelector('div[data-ref]');
        const chatList = document.querySelector('#pane-side');
        
        if (qrCode && !chatList) {
            chrome.runtime.sendMessage({ action: 'whatsappLoginRequired' });
            // Keep checking while QR code is present
            setTimeout(() => {
                initializationAttempts--; // Don't count retries while QR code is present
                initialize();
            }, 1000);
            return false;
        }
 
        await verifyEnvironment();
        
        // Wait for chat list to appear
        const chatListLoaded = await waitForElement('#pane-side', 10000).catch(() => null);
        if (!chatListLoaded) {
            setTimeout(initialize, TIMEOUTS.INIT_RETRY);
            return false;
        }
 
        const response = await new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'contentScriptReady' }, resolve);
        });
 
        if (!response || response.status !== 'acknowledged') {
            throw new Error('Initialization not acknowledged');
        }
 
        // Get chats only after we're sure WhatsApp is loaded
        await new Promise(resolve => setTimeout(resolve, 2000));
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
        log(`Initialization error: ${error.message}`);
        if (initializationAttempts < MAX_INIT_ATTEMPTS) {
            setTimeout(initialize, TIMEOUTS.INIT_RETRY);
        }
        return false;
    }
 }

async function automateWhatsAppExport(selectedChats, includeMedia) {
    try {
        for (let chatTitle of selectedChats) {
            const chat = availableChats.find(c => c.title === chatTitle);
            if (!chat) continue;
            await new Promise(resolve => setTimeout(resolve, TIMEOUTS.CHAT_SELECT));
            simulateClick(chat.clickableElement);
            await waitForElement(SELECTORS.CHAT.messageContainer);
            if (includeMedia) {
                const mediaType = typeof includeMedia === 'string' ? includeMedia : 'photo';
                await extractMediaContent(chatTitle, mediaType);
            } else {
                const filename = await extractAndDownloadChat(chatTitle);
                log(`Downloaded chat: ${filename}`);
                chrome.runtime.sendMessage({ 
                    action: "chatProgress", 
                    progress: Math.round((selectedChats.indexOf(chatTitle) + 1) / selectedChats.length * 100),
                    chatTitle 
                });
            }
        }    
        chrome.runtime.sendMessage({ 
            action: includeMedia ? "mediaDownloadComplete" : "exportComplete",
            message: `Successfully processed ${selectedChats.length} chats`
        });
    } catch (error) {
        chrome.runtime.sendMessage({
            action: "automationError",
            error: error.message
        });
    }
}
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
const getChatsList = async () => {
    const chatListContainer = await waitForElement(SELECTORS.CHAT_LIST.container);
    const { clickableAreas, titles } = findTargetChat(chatListContainer);
    return titles.map((title, index) => ({
        title,
        index,
        clickableElement: clickableAreas[index]
    }));
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
    try {
        if (type === 'photo') {
            const mediaDivs = document.querySelectorAll('div.x1xsqp64.x18d0r48');
            let itemsProcessed = 0;
            const totalItems = mediaDivs.length;
            for (const div of mediaDivs) {
                try {
                    const style = div.style.backgroundImage;
                    if (!style || !style.includes('blob:')) continue;
                    const blobUrl = style.match(/blob:([^"]*)/)[0];
                    const response = await fetch(blobUrl);
                    const blob = await response.blob();
                    const filename = `${chatTitle}-${itemsProcessed + 1}${blob.type.includes('video') ? '.mp4' : '.jpg'}`;
                    chrome.runtime.sendMessage({
                        action: "downloadMedia",
                        data: {
                            url: URL.createObjectURL(blob),
                            filename: filename,
                            type: blob.type
                        }
                    });
                    mediaItems.push({ type: blob.type.includes('video') ? 'video' : 'image' });
                    itemsProcessed++;
                    chrome.runtime.sendMessage({
                        action: "mediaProgress",
                        progress: Math.round((itemsProcessed / totalItems) * 100),
                        chat: chatTitle,
                        mediaCount: itemsProcessed
                    });
                } catch (error) {
                    log(`Error processing media item: ${error.message}`);
                }
            }
       }else if (type === 'document') {
            const mediaLink = document.querySelector('button[title="Docs"][role="tab"]');
            simulateClick(mediaLink);
            await new Promise(resolve => setTimeout(resolve, 2000));
            const docContainers = document.querySelectorAll('div[class*="x9f619"][class*="x1u9i22x"]');
            let itemsProcessed = 0;
            const totalItems = docContainers.length;
            for (const container of docContainers) {
                try {
                    const clickableElement = container.querySelector('div[role="button"][class*="x9f619"][class*="x78zum5"]');
                    if (!clickableElement) continue;
                    const nameSpan = container.querySelector('span[class*="x13faqbe"]');
                    const docName = nameSpan ? nameSpan.textContent : `document_${itemsProcessed + 1}`;
                    simulateClick(clickableElement);
                    await new Promise(resolve => setTimeout(resolve, 1500));
                    mediaItems.push({ type: 'document', name: docName });
                    itemsProcessed++;
                    chrome.runtime.sendMessage({
                        action: "mediaProgress",
                        progress: Math.round((itemsProcessed / totalItems) * 100),
                        chat: chatTitle,
                        mediaCount: itemsProcessed
                    });
                } catch (error) {
                    log(`Error processing document: ${error.message}`);
                }
            }
       }else if (type === 'link') {
            const mediaLink = document.querySelector('button[title="Links"][role="tab"]');
            simulateClick(mediaLink);
            await new Promise(resolve => setTimeout(resolve, 2000));
            const linkElements = document.querySelectorAll('a[href^="http"]');
            const uniqueLinks = new Map();
            linkElements.forEach(element => {
                const url = element.href;
                if (!uniqueLinks.has(url)) {
                    uniqueLinks.set(url, element.textContent?.trim() || url);
                }
            });
            if (uniqueLinks.size > 0) {
                const linksContent = Array.from(uniqueLinks.entries())
                    .map(([url]) => `${url}\n\n-------------------`)
                    .join('\n\n');
                const blob = new Blob([linksContent], { type: 'text/plain' });
                const filename = `${chatTitle}-links.txt`;
                chrome.runtime.sendMessage({
                    action: "downloadMedia",
                    data: {
                        url: URL.createObjectURL(blob),
                        filename: filename,
                        type: 'text/plain'
                    }
                });
                mediaItems.push({ type: 'links', count: uniqueLinks.size });
                chrome.runtime.sendMessage({
                    action: "mediaProgress",
                    progress: 100,
                    chat: chatTitle,
                    mediaCount: uniqueLinks.size
                });
            }
        }
    } catch (error) {
        log(`Error in extractMediaContent: ${error.message}`);
        throw error;
    }
    finally {
        try {
            log('Starting force cleanup...');
            const sendEsc = () => {
                document.dispatchEvent(new KeyboardEvent('keydown', {
                    bubbles: true,
                    cancelable: true,
                    key: 'Escape',
                    code: 'Escape',
                    keyCode: 27,
                    which: 27
                }));
            };
            for (let i = 0; i < 3; i++) {
                await new Promise(resolve => setTimeout(resolve, 1000));
                sendEsc();
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
            const mainPanel = document.querySelector('#main');
            if (mainPanel) simulateClick(mainPanel);
        } catch (closeError) {
            log(`Error during cleanup: ${closeError.message}`);
        }
    }
    return mediaItems;
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


log('Content script loaded');
initialize();