if (window.whatsappExporterInitialized) {
    chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
      if (request.action === 'ping') {
        sendResponse({ status: 'ready', initialized: true });
        return true;
      }
    });
} else {
window.whatsappExporterInitialized = true;
let isInitialized = false;
let initializationAttempts = 0;
const MAX_INIT_ATTEMPTS = 5;
let availableChats = [];
let processingAutomation = false;
const processedFiles = new Set();

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

function generateExportFolderName(chatTitle) {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const folderName = `Export_${day}-${month}-${year}_${hours}-${minutes}-${seconds}`;
    return `${chatTitle}/${folderName}`;
}

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
            try {
                const chat = availableChats.find(c => c.title === chatTitle);
                if (!chat) {
                    log(`Chat not found: ${chatTitle}`);
                    continue;
                }
                await new Promise((resolve) => {
                    chrome.runtime.sendMessage({ action: "enforceTabFocus" }, resolve);
                });
                await new Promise(resolve => setTimeout(resolve, 1000));
                log(`Clicking on chat: ${chatTitle}`);
                simulateClick(chat.clickableElement);
                await new Promise(resolve => setTimeout(resolve, 2000));
                try {
                    await waitForElement(SELECTORS.CHAT.messageContainer, 5000);
                } catch (waitError) {
                    log(`Error waiting for message container: ${waitError.message}`);
                    simulateClick(chat.clickableElement);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    await waitForElement(SELECTORS.CHAT.messageContainer, 5000);
                }
                const messageContainer = document.querySelector(SELECTORS.CHAT.messageContainer);
                if (!messageContainer) {
                    throw new Error('Message container not found after chat selection');
                }
                const scrollContainer = document.querySelector(SELECTORS.CHAT.scrollContainer);
                if (!scrollContainer) {
                    throw new Error('Scroll container not found');
                }
                const result = await extractChatContentAndMedia(chatTitle, endDate);
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
            } catch (chatError) {
                log(`Error processing chat ${chatTitle}: ${chatError.message}`);
                chrome.runtime.sendMessage({
                    action: "automationError",
                    error: `Error processing chat ${chatTitle}: ${chatError.message}`
                });
            }
        }
        chrome.runtime.sendMessage({ 
            action: "exportComplete",
            message: `Successfully processed ${selectedChats.length} chats`
        });
    } catch (error) {
        log(`Automation error: ${error.message}`);
        chrome.runtime.sendMessage({
            action: "automationError",
            error: error.message
        });
    } finally {
        processingAutomation = false;
    }
}

function ensureDOMReady() {
    const container = document.querySelector(SELECTORS.CHAT.scrollContainer);
    if (!container) {
        throw new Error('Chat container not found. Please ensure WhatsApp is fully loaded.');
    }
    const messageContainer = document.querySelector(SELECTORS.CHAT.messageContainer);
    if (!messageContainer) {
        throw new Error('Message container not found. Please select a chat first.');
    }
    const messages = document.querySelectorAll(SELECTORS.MESSAGE.container);
    if (messages.length === 0) {
        log('No messages found in current chat');
    }
    return true;
}

async function extractChatContentAndMedia(chatTitle, endDate) {
    try {
        await scrollChatToTop(endDate);
        const exportFolder = generateExportFolderName(chatTitle);
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
        
        const processedContainer = await processImagesInContainer(messagesContainer.cloneNode(true));
        
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
        
        const headerHtml = `
            <div class="nostalgic-header">
                ${chatTitle} - WhatsApp Memories
            </div>
        `;
        
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
            </style>
        </head>
        <body>
            <div id="time-capsule-container">
                ${headerHtml}
                ${processedContainer.innerHTML}
            </div>
        </body>
        </html>`;
        

        log('Splitting chat into monthly segments...');
        log('Splitting chat into monthly segments...');
const splitResult = await splitHtmlByMonthYear(fullPageHTML, chatTitle, exportFolder);

log('Preparing chat HTML for PDF conversion...');
const preparedHTML = prepareHTMLForPDF(fullPageHTML);

log('Checking if HTML chunking is needed...');
const htmlChunks = splitHTMLIntoChunks(preparedHTML, 150);

if (htmlChunks.length > 1) {
  log(`Chat split into ${htmlChunks.length} chunks for better PDF conversion`);
}

// Prepare conversion requests for all chunks
const conversionRequests = [];

// Add the complete export if just one chunk
if (htmlChunks.length === 1) {
  conversionRequests.push({
    html: htmlChunks[0],
    filename: `${chatTitle}_Complete_Export`
  });
} else {
  // Add each chunk with part number
  htmlChunks.forEach((chunkHtml, index) => {
    conversionRequests.push({
      html: chunkHtml,
      filename: `${chatTitle}_Complete_Export_Part${index+1}`
    });
  });
}

// Add monthly segments
splitResult.monthlyHTMLs.forEach((monthHtml, index) => {
  const preparedMonthHtml = prepareHTMLForPDF(monthHtml);
  conversionRequests.push({
    html: preparedMonthHtml,
    filename: `${chatTitle}_${splitResult.monthYears[index]}_Export`
  });
});

// Process each conversion request with proper error handling
const conversionResults = await Promise.all(
  conversionRequests.map(request => 
    new Promise((resolve) => {
      log(`Starting PDF conversion for ${request.filename}...`);
      chrome.runtime.sendMessage({
        action: 'convertHTMLToPDF',
        html: request.html,
        chatTitle: request.filename
      }, (response) => {
        if (response && response.status === 'success') {
          log(`PDF conversion successful for ${request.filename}`);
        } else {
          log(`PDF conversion failed for ${request.filename}: ${response?.error || 'Unknown error'}`);
        }
        resolve({
          filename: request.filename,
          ...(response || { status: 'error', message: 'No response from conversion' })
        });
      });
    })
  )
);

// Check for failed conversions
const failedConversions = conversionResults.filter(result => result.status !== 'success');
if (failedConversions.length > 0) {
  log(`Warning: ${failedConversions.length} PDF conversions failed`);
  failedConversions.forEach(failure => {
    log(`- Failed: ${failure.filename}`);
  });
}

return {
  success: true,
  fullPageHTML: fullPageHTML,
  monthlyHTMLs: splitResult.monthlyHTMLs || [],
  mediaContent: {
    htmlExport: true,
    imagesEmbedded: true,
    monthlySegments: splitResult.success ? splitResult.count : 0
  },
  totalMessages: document.querySelectorAll('div.message-in, div.message-out').length,
  monthYears: splitResult.success ? splitResult.monthYears : []
};
} catch (error) {
    log(`Error extracting chat content: ${error.message}`);
    return { success: false, error: error.message };
}
}

async function splitHtmlByMonthYear(fullHtml, chatTitle, exportFolder) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(fullHtml, 'text/html');
    const container = doc.querySelector('#time-capsule-container');
    
    if (!container) {
        log('Could not find container for splitting');
        return { success: false, monthlyHTMLs: [], monthYears: [] };
    }
    
    function getMonthName(monthNum) {
        const months = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
        ];
        return months[monthNum - 1];
    }
    
    const allElements = Array.from(container.children).filter((el, index) => {
        return index > 0 || !el.classList.contains('nostalgic-header');
    });
    
    const monthYearGroups = {};
    let currentMonthYear = null;
    let currentElements = [];
    
    for (let i = 0; i < allElements.length; i++) {
        const element = allElements[i];
        const dateText = element.textContent?.trim();
        
        if (dateText && /^\d{2}\/\d{2}\/\d{4}$/.test(dateText)) {
            const [day, month, year] = dateText.split('/').map(Number);
            const monthYear = `${getMonthName(month)}${year}`;
            
            if (monthYear !== currentMonthYear) {
                if (currentMonthYear && currentElements.length > 0) {
                    monthYearGroups[currentMonthYear] = currentElements;
                }
                currentMonthYear = monthYear;
                currentElements = [element];
            } else {
                currentElements.push(element);
            }
        } else if (currentMonthYear) {
            currentElements.push(element);
        }
    }
    
    if (currentMonthYear && currentElements.length > 0) {
        monthYearGroups[currentMonthYear] = currentElements;
    }
    
    const monthYears = Object.keys(monthYearGroups).sort((a, b) => {
        const yearA = parseInt(a.match(/\d{4}$/)[0]);
        const yearB = parseInt(b.match(/\d{4}$/)[0]);
        
        if (yearA !== yearB) return yearA - yearB;
        
        const monthA = a.replace(/\d{4}$/, '');
        const monthB = b.replace(/\d{4}$/,'');
        
        const months = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];
        
        return months.indexOf(monthA) - months.indexOf(monthB);
    });
    
    const monthlyHTMLs = [];
    const results = [];
    
    for (const monthYear of monthYears) {
        const monthDoc = parser.parseFromString(fullHtml, 'text/html');
        const monthContainer = monthDoc.querySelector('#time-capsule-container');
        
        while (monthContainer.firstChild) {
            monthContainer.removeChild(monthContainer.firstChild);
        }
        
        const header = monthDoc.createElement('div');
        header.className = 'nostalgic-header';
        header.textContent = `${chatTitle} - ${monthYear}`;
        monthContainer.appendChild(header);
        
        const elements = monthYearGroups[monthYear];
        elements.forEach(element => {
            monthContainer.appendChild(element.cloneNode(true));
        });
        
        const monthHtml = monthDoc.documentElement.outerHTML;
        monthlyHTMLs.push(monthHtml);
      
        results.push(monthYear);
        log(`Generated monthly segment: ${monthYear} with ${elements.length} elements`);
    }
    
    return {
        success: true,
        monthYears: results,
        count: monthYears.length,
        monthlyHTMLs: monthlyHTMLs
    };
}

async function scrollChatToTop(endDate) {
    const container = document.querySelector(SELECTORS.CHAT.scrollContainer);
    if (!container) {
        log("Chat scroll container not found");
        await new Promise(resolve => setTimeout(resolve, 2000));
        return;
    }
    let prevMessageCount = 0;
    let unchangedIterations = 0;
    const targetDate = new Date(endDate);
    while (unchangedIterations < 3) {
        const messages = document.querySelectorAll(SELECTORS.MESSAGE.container);
        if (!messages || messages.length === 0) {
            log("No messages found in chat");
            await new Promise(resolve => setTimeout(resolve, 2000));
            return;
        }
        const currentMessageCount = messages.length;
        if (currentMessageCount === prevMessageCount) {
            unchangedIterations++;
        } else {
            unchangedIterations = 0;
            prevMessageCount = currentMessageCount;
        }
        let currentElement = messages[0];
        if (!currentElement) {
            log("First message element not found");
            await new Promise(resolve => setTimeout(resolve, 1000));
            continue;
        }
        let dateFound = false;
        while (currentElement && !dateFound) {
            let sibling = currentElement.previousElementSibling;
            while (sibling && !dateFound) {
                const siblingText = sibling.textContent?.trim() || "";
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
        try {
            if (messages[0]) {
                messages[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                if (container.scrollTop > 1000) {
                    container.scrollTop -= 1000;
                }
            }
        } catch (scrollError) {
            log(`Scroll error: ${scrollError.message}`);
        }
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
    const exportFolder = generateExportFolderName(chatTitle);
    for (const type of Object.keys(mediaContent)) {
        try {
            const items = await scrollAndCollectMedia(type);
            for (let [index, item] of items.entries()) {
                try {
                    switch(type) {
                        case 'images':
                        case 'videos':
                            const ext = type === 'images' ? '.jpg' : '.mp4';
                            const filename = `${exportFolder}/${type}/${index + 1}${ext}`;
                            const response = await fetch(item);
                            const blob = await response.blob();
                            await downloadMedia(blob, filename);
                            mediaContent[type].push(item);
                            break; 
                        case 'documents':
                            const docResult = await processDocument(item, chatTitle, index, exportFolder);
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

async function processDocument(button, chatTitle, index, exportFolder)  {
    const title = button.getAttribute('title') || '';
    const cleanTitle = title.replace(/\s*\(\d+\)\s*/, '');
    const filename = `${exportFolder}/documents/${cleanTitle}`;
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


function prepareHTMLForPDF(htmlContent) {
    try {
      // Add PDF-specific styles without removing existing content
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlContent, 'text/html');
      
      // Add print-friendly styles
      const styleElement = doc.createElement('style');
      styleElement.textContent = `
        @media print {
          body, html {
            height: auto !important;
            overflow: visible !important;
          }
          #time-capsule-container {
            height: auto !important;
            overflow: visible !important;
          }
          .nostalgic-header {
            position: static !important;
            page-break-after: avoid;
          }
          div.message-in, div.message-out {
            page-break-inside: avoid;
          }
        }
      `;
      doc.head.appendChild(styleElement);
      
      return new XMLSerializer().serializeToString(doc);
    } catch (error) {
      log(`HTML preparation error: ${error.message}`);
      return htmlContent; // Return original if preparation fails
    }
}

function splitHTMLIntoChunks(htmlContent, maxMessagesPerChunk = 200) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlContent, 'text/html');
      
      // Find the container with all messages
      const container = doc.querySelector('#time-capsule-container');
      if (!container) {
        return [htmlContent]; // Return original if container not found
      }
      
      // Get the header element
      const header = container.querySelector('.nostalgic-header');
      if (!header) {
        return [htmlContent]; // Return original if header not found
      }
      
      // Count messages
      const messages = container.querySelectorAll('div.message-in, div.message-out');
      if (messages.length <= maxMessagesPerChunk) {
        return [prepareHTMLForPDF(htmlContent)]; // No need to split
      }
      
      // Calculate how many chunks we need
      const chunkCount = Math.ceil(messages.length / maxMessagesPerChunk);
      log(`Splitting chat into ${chunkCount} chunks (${messages.length} messages total)`);
      
      const chunks = [];
      for (let i = 0; i < chunkCount; i++) {
        // Create a new document for this chunk
        const chunkDoc = parser.parseFromString(htmlContent, 'text/html');
        const chunkContainer = chunkDoc.querySelector('#time-capsule-container');
        
        // Clear the container except for the header
        while (chunkContainer.firstChild) {
          chunkContainer.removeChild(chunkContainer.firstChild);
        }
        
        // Clone the header and add to chunk
        const chunkHeader = header.cloneNode(true);
        if (chunkCount > 1) {
          chunkHeader.textContent += ` (Part ${i+1}/${chunkCount})`;
        }
        chunkContainer.appendChild(chunkHeader);
        
        // Add messages for this chunk
        const startIdx = i * maxMessagesPerChunk;
        const endIdx = Math.min((i + 1) * maxMessagesPerChunk, messages.length);
        
        // Find the first message of this chunk
        let firstMessageFound = false;
        let currentElement = messages[startIdx];
        
        // Find the date header for the first message (if any)
        while (currentElement && !firstMessageFound) {
          let sibling = currentElement.previousElementSibling;
          while (sibling) {
            const siblingText = sibling.textContent?.trim() || '';
            if (/^\d{2}\/\d{2}\/\d{4}$/.test(siblingText)) {
              // This is a date header, add it to the chunk
              chunkContainer.appendChild(sibling.cloneNode(true));
              firstMessageFound = true;
              break;
            }
            sibling = sibling.previousElementSibling;
          }
          if (!firstMessageFound) {
            currentElement = currentElement.parentElement;
          }
        }
        
        // Add the messages for this chunk
        for (let j = startIdx; j < endIdx; j++) {
          chunkContainer.appendChild(messages[j].cloneNode(true));
        }
        
        // Prepare the chunk for PDF
        chunks.push(prepareHTMLForPDF(chunkDoc.documentElement.outerHTML));
      }
      
      return chunks;
    } catch (error) {
      log(`HTML chunking error: ${error.message}`);
      return [htmlContent]; // Return original if chunking fails
    }
}

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
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
        // Add this to your existing message listeners
        case "prepareHTMLForPDF":
    try {
        // Ensure a chat is selected
        const messageContainer = document.querySelector(SELECTORS.CHAT.messageContainer);
        if (!messageContainer) {
            sendResponse({ 
                status: 'error', 
                message: 'No chat selected. Please select a chat first.' 
            });
            return true;
        }

        // Get chat title
        const chatTitleElement = document.querySelector(SELECTORS.CHAT.title);
        const chatTitle = chatTitleElement 
            ? chatTitleElement.getAttribute('title') 
            : 'WhatsApp_Chat';

        // Extract chat content and media
        const result = await extractChatContentAndMedia(chatTitle, new Date());
        
        // Prepare conversion requests
        const conversionRequests = [
            {
                html: result.fullPageHTML,
                filename: `${chatTitle}_Complete_Export`
            },
            ...result.monthYears.map((monthYear, index) => ({
                html: result.monthlyHTMLs[index],
                filename: `${chatTitle}_${monthYear}_Export`
            }))
        ];
        
        // Send conversion requests to background script
        const conversionResults = await Promise.all(
            conversionRequests.map(request => 
                new Promise((resolve) => {
                    chrome.runtime.sendMessage({
                        action: 'convertHTMLToPDF',
                        html: request.html,
                        chatTitle: request.filename
                    }, (response) => {
                        resolve({
                            filename: request.filename,
                            ...response
                        });
                    });
                })
            )
        );
        
        // Check conversion results
        const failedConversions = conversionResults.filter(
            result => result.status !== 'success'
        );

        if (failedConversions.length > 0) {
            sendResponse({
                status: 'partial_error',
                message: 'Some PDF conversions failed',
                failures: failedConversions.map(f => f.filename)
            });
        } else {
            sendResponse({ 
                status: 'success', 
                message: 'All PDFs converted successfully',
                pdfs: conversionResults.map(r => r.filename)
            });
        }

        return true; // Allow asynchronous response
    } catch (error) {
        log(`PDF preparation error: ${error.message}`);
        sendResponse({ 
            status: 'error', 
            message: error.message 
        });
        return true;
    }
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
}