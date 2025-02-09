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
    },
    MEDIA_ELEMENTS: {
        images: 'img[src^="blob:"], div[style*="background-image"][role="button"]',
        videos: 'video[src^="blob:"]',
        documents: '[data-icon="document"], div[data-testid="document-thumb"]',
        links: 'a[href^="http"], [data-testid="link"], div[role="link"]'
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
const WhatsAppNavigator = {
    async findElementByContent(searchText, options = {}) {
        const {
            role = 'button',
            maxDepth = 4,
            timeout = 5000,
            partial = true
        } = options;

        const normalizedSearch = searchText.toLowerCase();
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            const elements = document.querySelectorAll(`[role="${role}"], [aria-label*="${searchText}"], [title*="${searchText}"]`);
            
            for (const element of elements) {
                const text = element.textContent.toLowerCase();
                if (partial ? text.includes(normalizedSearch) : text === normalizedSearch) {
                    return element;
                }

                // Check nested spans
                const nestedText = Array.from(element.querySelectorAll('span'))
                    .map(span => span.textContent.toLowerCase())
                    .join(' ');
                
                if (partial ? nestedText.includes(normalizedSearch) : nestedText === normalizedSearch) {
                    return element;
                }
            }

            // Traverse DOM for deeply nested content
            const findInNode = (node, depth = 0) => {
                if (depth > maxDepth) return null;
                if (node.nodeType === Node.TEXT_NODE) {
                    const text = node.textContent.toLowerCase();
                    return partial ? text.includes(normalizedSearch) : text === normalizedSearch;
                }
                for (const child of node.childNodes) {
                    if (findInNode(child, depth + 1)) {
                        return node.closest(`[role="${role}"]`) || node;
                    }
                }
                return null;
            };

            const result = findInNode(document.body);
            if (result) return result;

            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return null;
    },

    async simulateNaturalClick(element) {
        const rect = element.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        // Add slight randomization to appear more natural
        const offsetX = Math.random() * 6 - 3;
        const offsetY = Math.random() * 6 - 3;

        const events = [
            new MouseEvent('mouseover', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: centerX + offsetX,
                clientY: centerY + offsetY
            }),
            new MouseEvent('mousedown', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: centerX + offsetX,
                clientY: centerY + offsetY
            }),
            new MouseEvent('mouseup', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: centerX + offsetX,
                clientY: centerY + offsetY
            }),
            new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: centerX + offsetX,
                clientY: centerY + offsetY
            })
        ];

        for (const event of events) {
            element.dispatchEvent(event);
            await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 50));
        }
    }
};


const downloadMedia = async (blob, filename) => {
    chrome.runtime.sendMessage({
        action: "downloadMedia",
        data: {
            url: URL.createObjectURL(blob),
            filename: filename,
            type: blob.type
        }
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

const cleanup = async () => {
    try {
        for (let i = 0; i < 3; i++) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            document.dispatchEvent(new KeyboardEvent('keydown', {
                bubbles: true,
                cancelable: true,
                key: 'Escape',
                code: 'Escape'
            }));
        }

        const mainPanel = document.querySelector('#main');
        if (mainPanel) {
            await WhatsAppNavigator.simulateNaturalClick(mainPanel);
        }
    } catch (error) {
        console.error(`Error during cleanup: ${error.message}`);
    }
};

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




async function processMediaItem(url, chatTitle, index, type) {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        let extension;
        
        switch(type) {
            case 'images':
                extension = '.jpg';
                break;
            case 'videos':
                extension = '.mp4';
                break;
            default:
                extension = '';
        }

        const filename = `${chatTitle}-${type}-${index + 1}${extension}`;
        return { blob, filename };
    } catch (error) {
        log(`Error processing ${type} item: ${error.message}`);
        return null;
    }
}

async function extractMediaContent(chatTitle) {
    const allMedia = {
        images: [],
        videos: [],
        documents: [],
        links: []
    };

    try {
        // Scroll to top first
        await scrollChatToTop();

        // Collect all types of media
        for (const type of Object.keys(allMedia)) {
            const items = await scrollAndCollectMedia(type);
            log(`Found ${items.length} ${type}`);

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                
                switch(type) {
                    case 'images':
                    case 'videos':
                        const processed = await processMediaItem(item, chatTitle, i, type);
                        if (processed) {
                            await downloadMedia(processed.blob, processed.filename);
                            allMedia[type].push({ type, url: item });
                        }
                        break;
                        
                    case 'documents':
                        const downloadButton = await findDownloadButton(item);
                        if (downloadButton) {
                            await WhatsAppNavigator.simulateNaturalClick(downloadButton);
                            allMedia.documents.push({ type: 'document' });
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }
                        break;
                        
                    case 'links':
                        allMedia.links.push(item);
                        break;
                }

                updateProgress(i + 1, items.length, chatTitle);
            }
        }

        // Save links to a file if any were found
        if (allMedia.links.length > 0) {
            const content = allMedia.links.join('\n\n-------------------\n\n');
            const blob = new Blob([content], { type: 'text/plain' });
            await downloadMedia(blob, `${chatTitle}-links.txt`);
        }

    } catch (error) {
        log(`Error in extractMediaContent: ${error.message}`);
        throw error;
    }

    return Object.values(allMedia).flat();
}


async function extractChatContentAndMedia(chatTitle) {
    const mediaContent = {
        images: [],
        videos: [],
        documents: new Set(), // Using Set for document deduplication
        links: new Set()      // Using Set for link deduplication
    };
    
    // Track downloaded documents to prevent duplicates
    const downloadedDocs = new Set();
    let chatContent = '';

    try {
        log(`Starting complete extraction for chat: ${chatTitle}`);
        
        // Scroll to top first to ensure we capture everything
        await scrollChatToTop();

        // First collect all media while scrolling through the chat
        log('Starting media collection...');
        for (const type of Object.keys(mediaContent)) {
            const items = await scrollAndCollectMedia(type);
            log(`Found ${items.length} ${type}`);

            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                
                switch(type) {
                    case 'images':
                    case 'videos':
                        const processed = await processMediaItem(item, chatTitle, i, type);
                        if (processed) {
                            await downloadMedia(processed.blob, processed.filename);
                            mediaContent[type].push({ type, url: item });
                            log(`Processed ${type} item ${i + 1} of ${items.length}`);
                        }
                        break;
                        
                    case 'documents':
                        const downloadButton = await findDownloadButton(item);
                        if (downloadButton) {
                            // Extract document title/name from the button or its parent
                            const docTitle = downloadButton.getAttribute('title') || 
                                           downloadButton.getAttribute('aria-label') ||
                                           downloadButton.textContent ||
                                           'document';
                            
                            // Create a unique identifier for the document
                            const docIdentifier = `${docTitle}-${downloadButton.offsetTop}-${downloadButton.offsetLeft}`;
                            
                            // Only download if we haven't seen this document before
                            if (!downloadedDocs.has(docIdentifier)) {
                                await WhatsAppNavigator.simulateNaturalClick(downloadButton);
                                mediaContent.documents.add(docIdentifier);
                                downloadedDocs.add(docIdentifier);
                                log(`Processed new document: ${docTitle}`);
                                await new Promise(resolve => setTimeout(resolve, 1000));
                            } else {
                                log(`Skipping duplicate document: ${docTitle}`);
                            }
                        }
                        break;
                        
                    case 'links':
                        mediaContent.links.add(item); // Using Set to automatically deduplicate links
                        log(`Processed link ${i + 1} of ${items.length}`);
                        break;
                }

                updateProgress(i + 1, items.length, chatTitle);
            }
        }

        // Save links to a separate file
        if (mediaContent.links.size > 0) {
            log(`Saving ${mediaContent.links.size} unique links to file`);
            const linksContent = Array.from(mediaContent.links).join('\n\n-------------------\n\n');
            const linksBlob = new Blob([linksContent], { type: 'text/plain' });
            await downloadMedia(linksBlob, `${chatTitle}-links.txt`);
        }

        // Now extract all messages
        log('Starting message extraction...');
        const messages = document.querySelectorAll('div.message-in, div.message-out');
        
        // Add chat header with metadata
        chatContent += `\n\n`;
        chatContent += `===========================================\n`;
        chatContent += `Chat Export: ${chatTitle.toUpperCase()}\n`;
        chatContent += `Date Exported: ${new Date().toLocaleDateString('en-GB')}\n`;
        chatContent += `Total Messages: ${messages.length}\n`;
        chatContent += `Media Summary:\n`;
        chatContent += `- Images: ${mediaContent.images.length}\n`;
        chatContent += `- Videos: ${mediaContent.videos.length}\n`;
        chatContent += `- Documents: ${mediaContent.documents.length}\n`;
        chatContent += `- Links: ${mediaContent.links.length}\n`;
        chatContent += `===========================================\n\n`;

        // Process all messages
        messages.forEach((msg, index) => {
            const text = msg.querySelector(SELECTORS.MESSAGE.text);
            const timestamp = msg.querySelector(SELECTORS.MESSAGE.timestamp);
            const isOutgoing = msg.matches('div.message-out');
            
            if (text) {
                const time = timestamp ? timestamp.textContent.trim() : '';
                const msgText = text.textContent.trim();
                const date = new Date().toLocaleDateString('en-GB');
                const sender = isOutgoing ? 'Me' : chatTitle;
                
                // Check if message contains media
                const hasMedia = msg.querySelector(SELECTORS.MEDIA.image) || 
                               msg.querySelector(SELECTORS.MEDIA.video) || 
                               msg.querySelector(SELECTORS.MEDIA.document);
                
                chatContent += `[${date} ${time}]  ${sender}:\n`;
                chatContent += `>>> ${msgText}\n`;
                if (hasMedia) {
                    chatContent += `[Contains media attachment]\n`;
                }
                chatContent += `-------------------------------------------\n\n`;
                
                if (index % 100 === 0) {
                    log(`Processed ${index} messages...`);
                }
            }
        });

        // Save chat content
        log('Saving chat content...');
        const chatBlob = new Blob([chatContent], { type: 'text/plain' });
        await downloadMedia(chatBlob, `${chatTitle}.txt`);

        return {
            success: true,
            chatFilename: `${chatTitle}.txt`,
            mediaContent: {
                images: mediaContent.images.length,
                videos: mediaContent.videos.length,
                documents: mediaContent.documents.length,
                links: mediaContent.links.length
            },
            totalMessages: messages.length
        };

    } catch (error) {
        log(`Error in extractChatContentAndMedia: ${error.message}`);
        throw error;
    }
}

// Update the automateWhatsAppExport function to always extract everything
async function automateWhatsAppExport(selectedChats) {
    try {
        for (let chatTitle of selectedChats) {
            const chat = availableChats.find(c => c.title === chatTitle);
            if (!chat) {
                log(`Chat not found: ${chatTitle}`);
                continue;
            }

            log(`Processing chat: ${chatTitle}`);
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
            message: `Successfully processed ${selectedChats.length} chats with all content`
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

SELECTORS.MEDIA_ELEMENTS.documents = `[role="button"][title*="Download"], .x78zum5[title*="Download"], .icon-doc-pdf, [data-testid="document-thumb"]`;



async function scrollAndCollectMedia(type) {
    const container = document.querySelector(SELECTORS.CHAT.scrollContainer);
    if (!container) throw new Error('Could not find scroll container');

    const mediaItems = new Set();
    let lastHeight = 0;
    let unchangedCount = 0;
    const maxUnchangedCount = 3;

    for (let i = 0; i < 30; i++) {
        if (type === 'documents') {
            const docElements = document.querySelectorAll(SELECTORS.MEDIA_ELEMENTS.documents);
            docElements.forEach(el => {
                const downloadButton = el.closest('[role="button"][title*="Download"]') || el;
                if (downloadButton) mediaItems.add(downloadButton);
            });
        } else {
            const elements = document.querySelectorAll(SELECTORS.MEDIA_ELEMENTS[type]);
            elements.forEach(element => {
                switch(type) {
                    case 'images':
                    case 'videos':
                        const url = element.src || element.style.backgroundImage?.match(/url\("(.+)"\)/)?.[1];
                        if (url?.startsWith('blob:')) mediaItems.add(url);
                        break;
                    case 'links':
                        const link = element.href || element.getAttribute('data-url');
                        if (link?.startsWith('http')) mediaItems.add(link);
                        break;
                }
            });
        }

        container.scrollTop += 1000;
        await new Promise(resolve => setTimeout(resolve, 1000));

        if (container.scrollHeight === lastHeight) {
            unchangedCount++;
            if (unchangedCount >= maxUnchangedCount) break;
        } else {
            unchangedCount = 0;
            lastHeight = container.scrollHeight;
        }
    }

    return Array.from(mediaItems);
}


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

    const clickableElement = container.querySelector('div[role="button"]') || 
                            container.closest('div[role="button"]') ||
                            container;
    
    return clickableElement;
};
log('Content script loaded');
initialize();