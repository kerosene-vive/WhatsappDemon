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
        links: 'a[href^="http"], [data-testid="link"], div[role="link"]',
        audio: 'audio, .audio-duration, div[role="button"][data-icon="audio-play"], div[role="button"][data-icon="audio-pause"]'
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

// This function will be called after extractChatContentAndMedia completes
// It takes the fully generated HTML and divides it into monthly segments
async function splitHtmlByMonthYear(fullHtml, chatTitle) {
    // Parse the HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(fullHtml, 'text/html');
    
    // Get the time-capsule-container
    const container = doc.querySelector('#time-capsule-container');
    if (!container) {
        log('Could not find container for splitting');
        return { success: false };
    }
    
    // Helper function to get month name
    function getMonthName(monthNum) {
        const months = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        return months[monthNum - 1];
    }
    
    // Find all date elements and messages, excluding the header
    const allElements = Array.from(container.children).filter((el, index) => {
        // Skip the nostalgic header which should be the first element
        return index > 0 || !el.classList.contains('nostalgic-header');
    });
    
    const monthYearGroups = {};
    let currentMonthYear = null;
    let currentElements = [];
    
    // Group elements by month-year
    for (let i = 0; i < allElements.length; i++) {
        const element = allElements[i];
        // Check if this is a date element
        const dateText = element.textContent?.trim();
        
        if (dateText && /^\d{2}\/\d{2}\/\d{4}$/.test(dateText)) {
            // This is a date element, extract month and year
            const [day, month, year] = dateText.split('/').map(Number);
            const monthYear = `${getMonthName(month)}${year}`;
            
            // If we encounter a new month-year, start a new group
            if (monthYear !== currentMonthYear) {
                if (currentMonthYear && currentElements.length > 0) {
                    // Save previous group
                    monthYearGroups[currentMonthYear] = currentElements;
                }
                
                // Start new group
                currentMonthYear = monthYear;
                currentElements = [element];
            } else {
                // Add to current group
                currentElements.push(element);
            }
        } else if (currentMonthYear) {
            // This is a normal message element, add to current group
            currentElements.push(element);
        }
    }
    
    // Add the last group
    if (currentMonthYear && currentElements.length > 0) {
        monthYearGroups[currentMonthYear] = currentElements;
    }
    
    // Sort month-years chronologically for better organization
    const monthYears = Object.keys(monthYearGroups).sort((a, b) => {
        // Extract year and month index for comparison
        const yearA = parseInt(a.match(/\d{4}$/)[0]);
        const yearB = parseInt(b.match(/\d{4}$/)[0]);
        
        if (yearA !== yearB) return yearA - yearB;
        
        // Same year, compare months
        const monthA = a.replace(/\d{4}$/, '');
        const monthB = b.replace(/\d{4}$/,'');
        const months = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];
        return months.indexOf(monthA) - months.indexOf(monthB);
    });
    
    const results = [];
    
    // Create a monthly HTML file for each month-year group
    for (const monthYear of monthYears) {
        // Create a new document based on the original template
        const monthDoc = parser.parseFromString(fullHtml, 'text/html');
        
        // Get the container
        const monthContainer = monthDoc.querySelector('#time-capsule-container');
        
        // Clear the container while keeping the structure
        while (monthContainer.firstChild) {
            monthContainer.removeChild(monthContainer.firstChild);
        }
        
        // Create a new header for this month-year
        const header = monthDoc.createElement('div');
        header.className = 'nostalgic-header';
        header.textContent = chatTitle+' - '+monthYear;
        
        // Add the header as the first child of the container
        monthContainer.appendChild(header);
        
        // Add all elements for this month-year
        const elements = monthYearGroups[monthYear];
        elements.forEach(element => {
            monthContainer.appendChild(element.cloneNode(true));
        });
        
        // Create HTML string for this month-year
        const monthHtml = monthDoc.documentElement.outerHTML;
        
        // Save as HTML file
        const monthBlob = new Blob([monthHtml], { type: 'text/html' });
        await downloadMedia(monthBlob, `${chatTitle}/${monthYear}.html`);
        
        results.push(monthYear);
        
        log(`Generated monthly segment: ${monthYear} with ${elements.length} elements`);
    }
    
    return {
        success: true,
        monthYears: results,
        count: monthYears.length
    };
}

// Modified version of extractChatContentAndMedia that keeps the original intact
// and adds the monthly division at the end
async function extractChatContentAndMedia(chatTitle, endDate) {
    try {
        await scrollChatToTop(endDate);
        const messagesContainer = document.querySelector(SELECTORS.CHAT.scrollContainer);
        
        async function convertImageToBase64(imageElement) {
            try {
                const response = await fetch(imageElement.src);
                const blob = await response.blob();
                return new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => {
                        const newImg = document.createElement('img');
                        newImg.src = reader.result;
                        for (let attr of imageElement.attributes) {
                            if (attr.name !== 'src') {
                                newImg.setAttribute(attr.name, attr.value);
                            }
                        }
                        resolve(newImg.outerHTML);
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
            } catch (error) {
                console.error('Image conversion error:', error);
                return imageElement.outerHTML;
            }
        }
        
        async function processImagesInContainer(container) {
            const images = container.querySelectorAll('img[src^="blob:"]');
            const processedImages = await Promise.all(
                Array.from(images).map(convertImageToBase64)
            );
            processedImages.forEach((processedImg, index) => {
                images[index].outerHTML = processedImg;
            });
            return container;
        }
        
        // Process and prepare the container with all images converted to base64
        const processedContainer = await processImagesInContainer(messagesContainer.cloneNode(true));
        
        // Get all styles from the document
        const capturedStyles = Array.from(document.styleSheets)
            .map(sheet => {
                try {
                    return Array.from(sheet.cssRules)
                        .map(rule => rule.cssText)
                        .join('\n');
                } catch(e) {
                    return '';
                }
            })
            .join('\n');
        
        // Create a container for the nostalgic header
        const headerHtml = `
            <div class="nostalgic-header">
                ${chatTitle} - WhatsApp Memories
            </div>
        `;
        
        // Create the full HTML export with header INSIDE the container div
        const fullPageHTML = `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>${chatTitle}</title>
            <style>
                ${capturedStyles}
                body, html {
                    margin: 0;
                    padding: 0;
                    height: 100%;
                    overflow: hidden;
                }
                .nostalgic-header {
                    text-align: center;
                    padding: 15px;
                    font-size: 24px;
                    font-weight: bold;
                    border-bottom: 2px solid #ccc;
                    margin-bottom: 10px;
                    position: sticky;
                    top: 0;
                    background: #f0f0f0;
                    z-index: 100;
                }
                #time-capsule-container {
                    height: 100vh;
                    overflow-y: auto;
                    position: relative;
                }
                /* Audio message styling */
                .message-in .audio-player, .message-out .audio-player {
                    border-radius: 7.5px;
                    display: flex;
                    align-items: center;
                    padding: 6px 10px;
                    position: relative;
                }
                .message-in .audio-player {
                    background-color: #fff;
                }
                .message-out .audio-player {
                    background-color: #dcf8c6;
                }
                [data-theme="dark"] .message-in .audio-player {
                    background-color: #063b28;
                }
                [data-theme="dark"] .message-out .audio-player {
                    background-color: #025d4b;
                }
                /* Play button styling */
                .audio-play-button {
                    width: 34px;
                    height: 34px;
                    border-radius: 50%;
                    background-color: #fff;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-right: 10px;
                }
                /* Audio waveform styling */
                .audio-waveform {
                    flex-grow: 1;
                    height: 25px;
                    margin: 0 10px;
                    display: flex;
                    align-items: center;
                }
                .audio-waveform-bar {
                    background-color: #aaa;
                    width: 2px;
                    height: 16px;
                    margin: 0 1px;
                    border-radius: 1px;
                }
                /* Time counter styling */
                .audio-time {
                    font-size: 11px;
                    color: #8696a0;
                    margin-right: 5px;
                    font-weight: 400;
                }
                /* Profile picture in audio messages */
                .audio-player .profile-picture {
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    overflow: hidden;
                    margin-right: 10px;
                }
                /* Ensure images are responsive */
                #time-capsule-container img {
                    max-width: 100%;
                    height: auto;
                    object-fit: contain;
                }
            </style>
        </head>
        <body>
            <div id="time-capsule-container">
                ${headerHtml}
                ${processedContainer.innerHTML}
            </div>
            <script>
                window.onload = function() {
                    document.addEventListener('gesturestart', function (e) {
                        e.preventDefault();
                    });
                }
            </script>
        </body>
        </html>`;
        
        // Save the full HTML export in a folder named after the chat
        const htmlBlob = new Blob([fullPageHTML], { type: 'text/html' });
        await downloadMedia(htmlBlob, `${chatTitle}/Complete.html`);
        
        // Split the HTML into monthly segments
        log('Splitting chat into monthly segments...');
        const splitResult = await splitHtmlByMonthYear(fullPageHTML, chatTitle);
        
        // Return the result with monthly information
        return {
            success: true,
            mediaContent: {
                htmlExport: true,
                imagesEmbedded: true,
                monthlySegments: splitResult.success ? splitResult.count : 0
            },
            totalMessages: document.querySelectorAll('div.message-in, div.message-out').length,
            monthYears: splitResult.success ? splitResult.monthYears : []
        };
    } catch (error) {
        log(`Export error: ${error.message}`);
        throw error;
    }
}

async function scrollChatToTop(endDate) {
    const container = document.querySelector(SELECTORS.CHAT.scrollContainer);
    if (!container) return;
    let prevMessageCount = 0;
    let unchangedIterations = 0;
    const targetDate = new Date(endDate);
    while (unchangedIterations < 3) {
        const messages = document.querySelectorAll(SELECTORS.MESSAGE.container);
        const currentMessageCount = messages.length;
        if (currentMessageCount === prevMessageCount) {
            unchangedIterations++;
        } else {
            unchangedIterations = 0;
            prevMessageCount = currentMessageCount;
        }
        let currentElement = messages[0];
        let dateFound = false;
        while (currentElement && !dateFound) {
            let sibling = currentElement.previousElementSibling;
            while (sibling && !dateFound) {
                const siblingText = sibling.textContent.trim();
                if (/^\d{2}\/\d{2}\/\d{4}$/.test(siblingText)) {
                    const [day, month, year] = siblingText.split('/').map(Number);
                    const messageDate = new Date(year, month - 1, day);
                    if (messageDate < targetDate) {
                        return;
                    }
                    dateFound = true;
                }
                sibling = sibling.previousElementSibling;
            }
            currentElement = currentElement.parentElement;
        }
        messages[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        container.scrollTop -= 1000;
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

async function getMessageDate(message) {
    const dateElement = message.previousElementSibling;
    if (dateElement && dateElement.matches(SELECTORS.MESSAGE.dateHeader)) {
        const dateText = dateElement.textContent.trim();
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateText)) {
            const [day, month, year] = dateText.split('/').map(Number);
            return new Date(year, month - 1, day);
        }
    }
    return null;
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


log('Content script loaded');
initialize();