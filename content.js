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

    async clickPath(steps) {
        for (const step of steps) {
            const {
                text,
                alternativeText = [],
                timeout = 5000,
                waitAfterClick = 1000,
                required = true
            } = typeof step === 'string' ? { text: step } : step;

            const searchTexts = [text, ...alternativeText];
            let element = null;

            for (const searchText of searchTexts) {
                element = await this.findElementByContent(searchText, { timeout });
                if (element) break;
            }

            if (!element && required) {
                throw new Error(`Failed to find element containing: ${searchTexts.join(' or ')}`);
            }

            if (element) {
                await this.simulateNaturalClick(element);
                await new Promise(resolve => setTimeout(resolve, waitAfterClick));
            }
        }
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
    },

    async navigateToMedia(type = 'photo') {
        const navigationSteps = [
            {
                text: 'Menu',
                alternativeText: ['More options', 'Additional options'],
                waitAfterClick: 1500
            },
            {
                text: 'info',
                alternativeText: ['Contact info', 'Group info', 'Information'],
                waitAfterClick: 1500
            },
            {
                text: 'Media',
                alternativeText: ['Media, links and docs', 'Photos and videos'],
                waitAfterClick: 1500
            }
        ];

        try {
            await this.clickPath(navigationSteps);
        } catch (error) {
            // Fallback: Try direct media tab access
            const mediaSelectors = [
                '[data-testid="media-gallery"]',
                '[data-testid="row-video"]',
                'div[role="button"]:has(span:contains("Media"))',
                'div[title*="Media"]'
            ];

            for (const selector of mediaSelectors) {
                const element = document.querySelector(selector);
                if (element) {
                    await this.simulateNaturalClick(element);
                    return;
                }
            }

            throw new Error('Failed to navigate to media section');
        }
    }
};

const findMediaElements = async () => {
    const selectors = [
        'div.x1xsqp64.x18d0r48',
        'div[role="button"][data-testid="media-canvas"]',
        'div[role="button"]:has(img[src^="blob"])',
        'div[style*="background-image"][role="button"]'
    ];

    for (const selector of selectors) {
        const elements = document.querySelectorAll(selector);
        if (elements.length > 0) return Array.from(elements);
    }
    
    throw new Error('No media elements found');
};
const extractMediaUrl = async (div) => {
    // Try background image
    const bgStyle = div.style.backgroundImage;
    if (bgStyle?.includes('blob:')) {
        return bgStyle.match(/blob:([^"]*)/)[0];
    }

    // Try image or video element
    const mediaElement = div.querySelector('img[src^="blob"], video[src^="blob"]');
    if (mediaElement?.src) {
        return mediaElement.src;
    }

    // Try data attributes
    const blobUrl = div.dataset.blobUrl || div.querySelector('[data-blob-url]')?.dataset.blobUrl;
    if (blobUrl?.startsWith('blob:')) {
        return blobUrl;
    }

    return null;
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

async function automateWhatsAppExport(selectedChats, includeMedia) {
    try {
        for (let chatTitle of selectedChats) {
            const chat = availableChats.find(c => c.title === chatTitle);
            if (!chat) continue;

            await new Promise(resolve => setTimeout(resolve, TIMEOUTS.CHAT_SELECT));
            simulateClick(chat.clickableElement);
            await waitForElement(SELECTORS.CHAT.messageContainer);

            if (includeMedia) {
                const mediaContent = await extractMediaContent(chatTitle);
                log(`Extracted media from: ${chatTitle} - Found ${mediaContent.length} items`);
            } else {
                const filename = await extractAndDownloadChat(chatTitle);
                log(`Downloaded chat: ${filename}`);
            }

            chrome.runtime.sendMessage({ 
                action: includeMedia ? "mediaProgress" : "chatProgress",
                progress: Math.round((selectedChats.indexOf(chatTitle) + 1) / selectedChats.length * 100),
                chat: chatTitle,
                mediaCount: includeMedia ? mediaContent?.length : 0
            });
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

const findAndClickTab = async (type) => {
    const tabSearchPatterns = {
        'document': {
            selectors: [
                'button[title="Docs"][role="tab"]',
                'button[aria-label*="Document"]',
                '[data-testid="document-tab"]',
                '[data-tab="documents"]'
            ],
            textPatterns: ['Docs', 'Documents', 'Files', 'DOC']
        },
        'link': {
            selectors: [
                'button[title="Links"][role="tab"]',
                'button[aria-label*="Link"]',
                '[data-testid="link-tab"]',
                '[data-tab="links"]'
            ],
            textPatterns: ['Links', 'URLs', 'Web Links']
        }
    };

    const patterns = tabSearchPatterns[type];
    if (!patterns) return false;

    // Try direct selectors first
    for (const selector of patterns.selectors) {
        const element = document.querySelector(selector);
        if (element) {
            await WhatsAppNavigator.simulateNaturalClick(element);
            return true;
        }
    }

    // Try finding by text content
    for (const text of patterns.textPatterns) {
        const buttons = Array.from(document.querySelectorAll('button, [role="tab"]'));
        const button = buttons.find(b => b.textContent?.includes(text));
        if (button) {
            await WhatsAppNavigator.simulateNaturalClick(button);
            return true;
        }
    }

    // Deep DOM search
    const deepSearchResult = await WhatsAppNavigator.findElementByContent(patterns.textPatterns[0], {
        role: 'tab',
        maxDepth: 6,
        timeout: 3000,
        partial: true
    });

    if (deepSearchResult) {
        await WhatsAppNavigator.simulateNaturalClick(deepSearchResult);
        return true;
    }

    // Last resort: find any clickable element containing the text
    const allElements = document.querySelectorAll('[role="button"], button, [class*="tab"]');
    for (const text of patterns.textPatterns) {
        for (const element of allElements) {
            if (element.textContent?.toLowerCase().includes(text.toLowerCase())) {
                await WhatsAppNavigator.simulateNaturalClick(element);
                return true;
            }
        }
    }

    return false;
};

SELECTORS.MEDIA_ELEMENTS.documents = `[role="button"][title*="Download"], .x78zum5[title*="Download"], .icon-doc-pdf, [data-testid="document-thumb"]`;

async function processDocuments(container) {
    const downloadButton = container.closest('[role="button"][title*="Download"]') || container;
    
    if (downloadButton) {
        const events = ['mouseover', 'mousedown', 'mouseup', 'click'];
        const rect = downloadButton.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;

        for (const eventType of events) {
            downloadButton.dispatchEvent(new MouseEvent(eventType, {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX: centerX,
                clientY: centerY
            }));
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        await new Promise(resolve => setTimeout(resolve, 2500));
        return true;
    }
    return false;
}

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

const processLinks = async (chatTitle, mediaItems) => {
    try {
        if (!await findAndClickTab('link')) {
            throw new Error('Could not find links tab');
        }
        await new Promise(resolve => setTimeout(resolve, 2000));

        const links = new Set();
        const linkSelectors = [
            'a[href^="http"]',
            '[data-testid="link"]',
            'div[role="link"]',
            '[class*="link-preview"]'
        ];

        for (const selector of linkSelectors) {
            const elements = document.querySelectorAll(selector);
            elements.forEach(element => {
                const url = element.href || element.getAttribute('data-url') || element.getAttribute('href');
                if (url?.startsWith('http')) {
                    links.add(url);
                }
            });
        }

        if (links.size > 0) {
            const content = Array.from(links)
                .map(url => `${url}\n\n-------------------`)
                .join('\n\n');
            const blob = new Blob([content], { type: 'text/plain' });
            await downloadMedia(blob, `${chatTitle}-links.txt`);
            mediaItems.push({ type: 'links', count: links.size });
            updateProgress(1, 1, chatTitle);
        }
    } catch (error) {
        log(`Error in processLinks: ${error.message}`);
    }
};

const findDocumentContainers = async () => {
    const containerSelectors = [
        'div[data-testid="document-thumb"]',
        'div[role="gridcell"]',
        'div[data-icon="document"]',
        'div[class*="document"]',
        'div[class*="x9f619"][class*="x1u9i22x"]',
        'div[class*="x78zum5"]'
    ];

    for (const selector of containerSelectors) {
        const containers = document.querySelectorAll(selector);
        if (containers.length > 0) return Array.from(containers);
    }

    // Fallback: find by content patterns
    const documentPatterns = ['PDF', '.pdf', '.doc', '.docx', '.txt'];
    const allElements = document.querySelectorAll('div[role="gridcell"], div[role="row"]');
    return Array.from(allElements).filter(el => 
        documentPatterns.some(pattern => 
            el.textContent?.toLowerCase().includes(pattern.toLowerCase())
        )
    );
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

    const clickableElement = container.querySelector('div[role="button"]') || 
                            container.closest('div[role="button"]') ||
                            container;
    
    return clickableElement;
};
log('Content script loaded');
initialize();