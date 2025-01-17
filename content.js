// Content script for WhatsApp Web automation with media support
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
        item: 'div._ak8l'
    }
};

const TIMEOUTS = {
    LOAD: 5000,
    CHAT_SELECT: 2000,
    MESSAGE_LOAD: 2000,
    MEDIA_LOAD: 3000,
    INIT_RETRY: 1000,
    DOWNLOAD_WAIT: 1000
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

const downloadMedia = async (mediaElement, type, timestamp) => {
    return new Promise(async (resolve, reject) => {
        try {
            if (!mediaElement.src) {
                reject(new Error('No source found for media element'));
                return;
            }

            const response = await fetch(mediaElement.src);
            const blob = await response.blob();
            
            const timeString = timestamp || new Date().toISOString();
            const extension = type.startsWith('image') ? '.jpg' : 
                            type.startsWith('video') ? '.mp4' : '.bin';
            const filename = `whatsapp_media_${timeString.replace(/[^0-9]/g, '')}${extension}`;

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

const extractMediaContent = async () => {
    const mediaItems = [];
    log('Starting media extraction');

    // Process images
    const images = document.querySelectorAll(SELECTORS.MEDIA.image);
    for (const img of images) {
        try {
            const timestamp = img.closest(SELECTORS.MESSAGE.container)
                ?.querySelector(SELECTORS.MESSAGE.timestamp)?.textContent;
            await downloadMedia(img, 'image/jpeg', timestamp);
            mediaItems.push({ type: 'image', timestamp });
        } catch (error) {
            log(`Error downloading image: ${error.message}`);
        }
    }

    // Process videos
    const videos = document.querySelectorAll(SELECTORS.MEDIA.video);
    for (const video of videos) {
        try {
            const timestamp = video.closest(SELECTORS.MESSAGE.container)
                ?.querySelector(SELECTORS.MESSAGE.timestamp)?.textContent;
            await downloadMedia(video, 'video/mp4', timestamp);
            mediaItems.push({ type: 'video', timestamp });
        } catch (error) {
            log(`Error downloading video: ${error.message}`);
        }
    }

    // Process documents
    const documents = document.querySelectorAll(SELECTORS.MEDIA.document);
    for (const doc of documents) {
        try {
            const downloadButton = doc.querySelector(SELECTORS.MEDIA.downloadButton);
            if (downloadButton) {
                const timestamp = doc.closest(SELECTORS.MESSAGE.container)
                    ?.querySelector(SELECTORS.MESSAGE.timestamp)?.textContent;
                downloadButton.click();
                mediaItems.push({ type: 'document', timestamp });
                await new Promise(resolve => setTimeout(resolve, TIMEOUTS.DOWNLOAD_WAIT));
            }
        } catch (error) {
            log(`Error downloading document: ${error.message}`);
        }
    }

    return mediaItems;
};

async function automateWhatsAppExport(numberOfChats = 1, includeMedia = false) {
    try {
        log('Starting automation');
        chrome.runtime.sendMessage({ action: "loadingProgress", progress: 10 });
        
        const chatListContainer = await waitForElement(SELECTORS.CHAT_LIST.container);
        log('Chat list container loaded');
        chrome.runtime.sendMessage({ action: "loadingProgress", progress: 20 });
        
        const { clickableAreas: clickableChats, titles: chatTitles } = findTargetChat(chatListContainer);
        const allContents = [];
        const exportedChats = Math.min(clickableChats.length, numberOfChats);
        
        for (let i = 0; i < exportedChats; i++) {
            const clickableChat = clickableChats[i];
            const chatTitle = chatTitles[i];
            
            await new Promise(resolve => setTimeout(resolve, TIMEOUTS.CHAT_SELECT));
            simulateClick(clickableChat);
            
            await waitForElement(SELECTORS.CHAT.messageContainer);
            await new Promise(resolve => setTimeout(resolve, TIMEOUTS.MESSAGE_LOAD));
            
            const textContent = extractChatContent();
            let mediaContent = [];
            
            if (includeMedia) {
                await new Promise(resolve => setTimeout(resolve, TIMEOUTS.MEDIA_LOAD));
                mediaContent = await extractMediaContent();
            }
            
            allContents.push({
                title: chatTitle,
                content: textContent,
                media: includeMedia ? mediaContent : []
            });
            
            log(`Extracted content from: ${chatTitle}`);
            chrome.runtime.sendMessage({ 
                action: "loadingProgress", 
                progress: 20 + (60 * ((i + 1) / clickableChats.length)) 
            });
        }

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
            sendResponse({ status: 'text automation started' });
            break;
            
        case "startMediaDownload":
            if (!isInitialized) {
                sendResponse({ error: 'Content script not initialized' });
                return true;
            }
            const chatCount = request.numberOfChats || 1;
            log('Starting media download automation');
            
            // Create an async function to handle the media download process
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
                        
                        const mediaContent = await extractMediaContent();
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