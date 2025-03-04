if (window.whatsappExporterInitialized) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
const SCROLL_CONFIG = {
    MAX_CONSECUTIVE_FAILURES: 3,
    MAX_TOTAL_FAILURES: 15,
    SCROLL_BATCH_SIZE: 30,
    SCROLL_BATCH_PAUSE: 2000,
    DATE_CHECK_INTERVAL: 10
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
        visibilityCheck: '[data-testid="chat"]',
        loadOlderButton: 'button.x14m1o6m, button.x1b9z3ur'
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

async function splitHtmlByMonthYear(fullHtml, chatTitle, exportFolder) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(fullHtml, 'text/html');
    const container = doc.querySelector('#time-capsule-container');
    if (!container) {
        log('Could not find container for splitting');
        return { success: false };
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
    const results = [];
    for (const monthYear of monthYears) {
        const monthDoc = parser.parseFromString(fullHtml, 'text/html');
        const monthContainer = monthDoc.querySelector('#time-capsule-container');
        while (monthContainer.firstChild) {
            monthContainer.removeChild(monthContainer.firstChild);
        }
        const header = monthDoc.createElement('div');
        header.className = 'nostalgic-header';
        header.textContent = chatTitle+' - '+monthYear;
        monthContainer.appendChild(header);
        const elements = monthYearGroups[monthYear];
        elements.forEach(element => {
            monthContainer.appendChild(element.cloneNode(true));
        });
        const monthHtml = monthDoc.documentElement.outerHTML;
        const monthBlob = new Blob([monthHtml], { type: 'text/html' });
        await downloadMedia(monthBlob, `${exportFolder}/${monthYear}.html`);
        results.push(monthYear);
        log(`Generated monthly segment: ${monthYear} with ${elements.length} elements`);
    }
    return {
        success: true,
        monthYears: results,
        count: monthYears.length
    };
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
                <span class="header-emoji">💫</span> ${chatTitle} <span class="header-emoji">💭</span>
            </div>
        `;
        const fullPageHTML = `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <title>${chatTitle}</title>
            <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
            <style>
                ${capturedStyles}
                :root {
                    --bg-color: #f0f2f5;
                    --header-bg: #d9fdd3;
                    --header-text: #0b806a;
                    --bubble-in: #ffffff;
                    --bubble-out: #d9fdd3;
                    --text-color: #111b21;
                    --meta-text: #667781;
                    --border-radius: 12px;
                    --shadow: 0 1px 3px rgba(0,0,0,0.08);
                }
                [data-theme="dark"] {
                    --bg-color: #111b21;
                    --header-bg: #202c33;
                    --header-text: #00a884;
                    --bubble-in: #202c33;
                    --bubble-out: #005c4b;
                    --text-color: #e9edef;
                    --meta-text: #8696a0;
                }
                body, html {
                    margin: 0;
                    padding: 0;
                    height: 100%;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                    background-color: var(--bg-color);
                    color: var(--text-color);
                    line-height: 1.5;
                    -webkit-text-size-adjust: 100%;
                }
                .nostalgic-header {
                    text-align: center;
                    padding: 15px 10px;
                    font-size: 20px;
                    font-weight: bold;
                    border-bottom: 1px solid rgba(0,0,0,0.1);
                    margin-bottom: 10px;
                    position: fixed;
                    top: 0;
                    left: 0;
                    right: 0;
                    width: 100%;
                    background: var(--header-bg);
                    z-index: 100;
                    color: var(--header-text);
                    box-shadow: var(--shadow);
                    border-radius: 0;
                    transform: translateZ(0);
                    will-change: transform;
                    -webkit-backface-visibility: hidden;
                    backface-visibility: hidden;
                    letter-spacing: 0.5px;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                }
                .header-emoji {
                    font-size: 18px;
                    margin: 0 6px;
                    animation: float 2s infinite ease-in-out alternate;
                }
                
                @keyframes float {
                    0% { transform: translateY(0px); }
                    100% { transform: translateY(-3px); }
                }
                #time-capsule-container {
                    max-width: 600px;
                    margin: 0 auto;
                    height: 100vh;
                    overflow-y: auto;
                    position: relative;
                    padding: 0 10px;
                    box-sizing: border-box;
                    scroll-behavior: smooth;
                    -webkit-overflow-scrolling: touch;
                }
                /* Message bubble improvements */
                .message-in, .message-out {
                    margin: 8px 0 !important;
                    padding: 8px 12px !important;
                    border-radius: var(--border-radius) !important;
                    box-shadow: var(--shadow) !important;
                    max-width: 80% !important;
                    word-wrap: break-word !important;
                    position: relative !important;
                }
                .message-in {
                    background-color: var(--bubble-in) !important;
                    margin-right: auto !important;
                    border-top-left-radius: 0 !important;
                }
                .message-out {
                    background-color: var(--bubble-out) !important;
                    margin-left: auto !important;
                    border-top-right-radius: 0 !important;
                }
                /* Message meta (time, status) */
                .message-meta {
                    font-size: 11px !important;
                    color: var(--meta-text) !important;
                    text-align: right !important;
                    margin-top: 3px !important;
                }
                /* Audio message styling */
                .message-in .audio-player, .message-out .audio-player {
                    border-radius: 10px;
                    display: flex;
                    align-items: center;
                    padding: 8px 12px;
                    position: relative;
                }
                .message-in .audio-player {
                    background-color: var(--bubble-in);
                }
                .message-out .audio-player {
                    background-color: var(--bubble-out);
                }
                /* Play button styling */
                .audio-play-button {
                    width: 36px;
                    height: 36px;
                    border-radius: 50%;
                    background-color: var(--header-text);
                    color: white;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-right: 12px;
                    cursor: pointer;
                    transition: transform 0.2s;
                }
                .audio-play-button:active {
                    transform: scale(0.95);
                }
                /* Audio waveform styling */
                .audio-waveform {
                    flex-grow: 1;
                    height: 28px;
                    margin: 0 10px;
                    display: flex;
                    align-items: center;
                }
                .audio-waveform-bar {
                    background-color: var(--meta-text);
                    width: 2px;
                    height: 16px;
                    margin: 0 1px;
                    border-radius: 1px;
                }
                /* Time counter styling */
                .audio-time {
                    font-size: 12px;
                    color: var(--meta-text);
                    margin-right: 5px;
                    font-weight: 400;
                }
                /* Profile picture styling */
                .profile-picture {
                    width: 36px;
                    height: 36px;
                    border-radius: 50%;
                    overflow: hidden;
                    margin-right: 10px;
                    border: 2px solid var(--header-text);
                }
                /* Ensure images are responsive */
                #time-capsule-container img {
                    max-width: 100%;
                    height: auto;
                    object-fit: contain;
                    border-radius: 8px;
                }
                /* Date separators */
                .chat-date-separator {
                    text-align: center;
                    margin: 16px 0;
                    position: relative;
                }
                .chat-date-text {
                    background: var(--header-bg);
                    padding: 5px 10px;
                    border-radius: 12px;
                    font-size: 12px;
                    display: inline-block;
                    box-shadow: var(--shadow);
                    color: var(--header-text);
                    font-weight: 500;
                }
                /* Theme toggle */
                .theme-toggle {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    width: 40px;
                    height: 40px;
                    border-radius: 50%;
                    background: var(--header-bg);
                    color: var(--header-text);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.2);
                    cursor: pointer;
                    z-index: 1000;
                    border: none;
                }
                /* Kawaii elements */
                .message-in::before, .message-out::before {
                    content: '';
                    position: absolute;
                    width: 0;
                    height: 0;
                    border-style: solid;
                }
                .message-in::before {
                    border-width: 0 10px 10px 0;
                    border-color: transparent var(--bubble-in) transparent transparent;
                    top: 0;
                    left: -10px;
                }
                .message-out::before {
                    border-width: 0 0 10px 10px;
                    border-color: transparent transparent transparent var(--bubble-out);
                    top: 0;
                    right: -10px;
                }
                @media (max-width: 600px) {
                    .message-in, .message-out {
                        max-width: 85% !important;
                    }
                }
            </style>
        </head>
        <body>
            ${headerHtml}
            <div id="time-capsule-container">
                <div style="padding-top: 60px;"></div>
                ${processedContainer.innerHTML}
            </div>
            <button class="theme-toggle" id="themeToggle">
                <i class="fas fa-moon"></i>
            </button>
            <script>
                window.onload = function() {
                    // Prevent pinch zoom on mobile
                    document.addEventListener('gesturestart', function(e) {
                        e.preventDefault();
                    });
                    
                    // Add date separators
                    function addDateSeparators() {
                        const messages = document.querySelectorAll('div.message-in, div.message-out');
                        let currentDate = '';
                        
                        messages.forEach(message => {
                            const dateMeta = message.querySelector('[data-pre-plain]');
                            if (dateMeta) {
                                const dateText = dateMeta.getAttribute('data-pre-plain');
                                const dateMatch = dateText.match(/\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}/);
                                
                                if (dateMatch && dateMatch[0] !== currentDate) {
                                    currentDate = dateMatch[0];
                                    const separator = document.createElement('div');
                                    separator.className = 'chat-date-separator';
                                    separator.innerHTML = \`<span class="chat-date-text">🗓️ \${currentDate} 🗓️</span>\`;
                                    message.parentNode.insertBefore(separator, message);
                                }
                            }
                        });
                    }
                    
                    // Theme toggle functionality
                    const themeToggle = document.getElementById('themeToggle');
                    const icon = themeToggle.querySelector('i');
                    
                    themeToggle.addEventListener('click', function() {
                        document.body.setAttribute('data-theme', 
                            document.body.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
                        
                        icon.className = document.body.getAttribute('data-theme') === 'dark' 
                            ? 'fas fa-sun' 
                            : 'fas fa-moon';
                    });
                    
                    // Fix audio player appearance
                    const audioPlayers = document.querySelectorAll('.audio-player');
                    audioPlayers.forEach(player => {
                        // Add play button icon if missing
                        const playButton = player.querySelector('.audio-play-button');
                        if (playButton && !playButton.querySelector('i')) {
                            playButton.innerHTML = '<i class="fas fa-play"></i>';
                        }
                        
                        // Ensure waveform has bars
                        const waveform = player.querySelector('.audio-waveform');
                        if (waveform && waveform.children.length === 0) {
                            for (let i = 0; i < 20; i++) {
                                const bar = document.createElement('div');
                                bar.className = 'audio-waveform-bar';
                                bar.style.height = \`\${Math.floor(Math.random() * 20) + 5}px\`;
                                waveform.appendChild(bar);
                            }
                        }
                    });
                    
                    // Add message timestamps class for styling
                    document.querySelectorAll('[data-pre-plain]').forEach(meta => {
                        meta.classList.add('message-meta');
                    });
                    
                    // Run setup functions
                    addDateSeparators();
                }
            </script>
        </body>
        </html>`;
        log('Splitting chat into monthly segments...');
        const splitResult = await splitHtmlByMonthYear(fullPageHTML, chatTitle, exportFolder);
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
  
async function findOldestVisibleDate() {
    const extractDateMethods = [
        () => {
            const elementsToCheck = document.querySelectorAll(
                '[data-id], .x3nfvp2.xxymvpz, [data-pre-plain-text], ' + 
                'div[role="row"] > div:first-child, span[dir="auto"], .message-in, .message-out'
            );
            
            for (const element of elementsToCheck) {
                const possibleTexts = [
                    element.textContent?.trim(),
                    element.getAttribute('data-pre-plain-text') || '',
                    element.getAttribute('title') || ''
                ];
                const dateFormats = [
                    /(\d{2})\/(\d{2})\/(\d{4})/,
                    /(\d{4})-(\d{2})-(\d{2})/,
                    /(\d{2})-(\d{2})-(\d{4})/
                ];
                for (const text of possibleTexts) {
                    for (const regex of dateFormats) {
                        const match = text.match(regex);
                        if (match) {
                            let day, month, year;
                            if (regex.source === '(\\d{2})\\/(\\d{2})\\/(\\d{4})') {
                                [, day, month, year] = match;
                            } else if (regex.source === '(\\d{4})-(\\d{2})-(\\d{2})') {
                                [, year, month, day] = match;
                            } else {
                                [, day, month, year] = match;
                            }
                            const parsedDate = new Date(Number(year), Number(month) - 1, Number(day));
                            if (!isNaN(parsedDate.getTime())) {
                                log(`Date found: ${parsedDate.toLocaleDateString('en-GB')} (from text: ${text})`);
                                return parsedDate;
                            }
                        }
                    }
                }
            }
            return null;
        },
        () => {
            const timestampElements = document.querySelectorAll('.x3nfvp2.xxymvpz');
            for (const element of timestampElements) {
                const titleDate = element.getAttribute('title')?.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                if (titleDate) {
                    const [_, day, month, year] = titleDate;
                    const parsedDate = new Date(Number(year), Number(month) - 1, Number(day));
                    return parsedDate;
                }
            }
            return null;
        },
        () => {
            const messages = document.querySelectorAll(SELECTORS.MESSAGE.container);
            if (messages.length > 0) {
                const checkMessageContext = (message) => {
                    let current = message;
                    while (current) {
                        const textContent = current.textContent?.trim();
                        if (textContent && /^\d{2}\/\d{2}\/\d{4}$/.test(textContent)) {
                            const [day, month, year] = textContent.split('/').map(Number);
                            return new Date(year, month - 1, day);
                        }
                        current = current.previousElementSibling;
                    }
                    return null;
                };
                const firstMessageDate = checkMessageContext(messages[0]);
                if (firstMessageDate) return firstMessageDate;
                const lastMessageDate = checkMessageContext(messages[messages.length - 1]);
                if (lastMessageDate) return lastMessageDate;
            }
            return null;
        }
    ];
    for (const method of extractDateMethods) {
        try {
            const date = method();
            if (date) {
                log(`Oldest date found by method: ${date.toLocaleDateString('en-GB')}`);
                return date;
            }
        } catch (error) {
            log(`Date extraction method failed: ${error.message}`);
        }
    }
    log('NO DATE FOUND - Debugging information:');
    log('Total messages: ' + document.querySelectorAll(SELECTORS.MESSAGE.container).length);
    const debugTexts = [];
    const elementsToDebug = document.querySelectorAll(
        '[data-id], .x3nfvp2.xxymvpz, [data-pre-plain-text], ' + 
        'div[role="row"] > div:first-child, span[dir="auto"]'
    );
    for (let i = 0; i < Math.min(10, elementsToDebug.length); i++) {
        const el = elementsToDebug[i];
        debugTexts.push({
            text: el.textContent?.trim(),
            attributes: {
                'data-pre-plain-text': el.getAttribute('data-pre-plain-text'),
                'title': el.getAttribute('title')
            }
        });
    }
    log('Debug texts: ' + JSON.stringify(debugTexts, null, 2));
    return null;
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
    let consecutiveScrollFailures = 0;
    let totalScrollFailures = 0;
    let scrollAttempts = 0;
    let stopScrolling = false;
    const targetDate = endDate instanceof Date 
        ? endDate 
        : new Date(endDate);
    log(`Starting to scroll to target date: ${targetDate.toLocaleDateString('en-GB')}`);
    const originalChatTitle = document.querySelector('header span[dir="auto"]')?.textContent?.trim();
    const checkStopScrolling = async () => {
        const oldestDate = await findOldestVisibleDate();
        if (!oldestDate) {
            log('No date found, continuing scroll');
            return false;
        }
        const normalizedTarget = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
        const normalizedCurrent = new Date(oldestDate.getFullYear(), oldestDate.getMonth(), oldestDate.getDate());
        const shouldStop = normalizedCurrent <= normalizedTarget;
        if (shouldStop) {
            log(`STOPPING SCROLL: 
                Oldest date found: ${oldestDate.toLocaleDateString('en-GB')}
                Target date: ${targetDate.toLocaleDateString('en-GB')}`);
        }
        return shouldStop;
    };
    while (scrollAttempts < 200 && unchangedIterations < 5 && !stopScrolling) {
        scrollAttempts++;
        stopScrolling = await checkStopScrolling();
        if (stopScrolling) {
            log('Stopping scroll process - reached target date range');
            break;
        }
        const loadOlderButtons = document.querySelectorAll('button.x14m1o6m, button.x1b9z3ur');
        let buttonFound = false;
        for (const button of loadOlderButtons) {
            if (button.textContent.includes("Click here to get older messages")) {
                log("Found 'Load older messages' button, clicking it...");
                simulateClick(button);
                await new Promise(resolve => setTimeout(resolve, 2000));
                unchangedIterations = 0;
                consecutiveScrollFailures = 0;
                buttonFound = true;
                break;
            }
        }
        if (scrollAttempts % SCROLL_CONFIG.SCROLL_BATCH_SIZE === 0) {
            log(`Batch pause at attempt ${scrollAttempts} to let the UI respond`);
            await new Promise(resolve => setTimeout(resolve, SCROLL_CONFIG.SCROLL_BATCH_PAUSE));
        }
        const messages = document.querySelectorAll(SELECTORS.MESSAGE.container);
        if (!messages || messages.length === 0) {
            log("No messages found in chat");
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
        }
        const currentMessageCount = messages.length;
        if (currentMessageCount > prevMessageCount) {
            log(`Progress: loaded ${currentMessageCount} messages`);
            unchangedIterations = 0;
            consecutiveScrollFailures = 0;
            prevMessageCount = currentMessageCount;
        } else {
            unchangedIterations++;
            log(`No new messages loaded (${unchangedIterations}/5 attempts)`);
            
            if (!buttonFound) {
                consecutiveScrollFailures++;
                totalScrollFailures++;
                log(`Scroll appears stuck: ${consecutiveScrollFailures}/${SCROLL_CONFIG.MAX_CONSECUTIVE_FAILURES} failures`);
            }
        }
        try {
            if (messages[0]) {
                if (consecutiveScrollFailures === 0) {
                    const scrollVariation = scrollAttempts % 4;
                    if (scrollVariation === 0) {
                        messages[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                        await new Promise(resolve => setTimeout(resolve, 300));
                        if (container.scrollTop > 1000) {
                            container.scrollTop -= 1000;
                        }
                    } else if (scrollVariation === 1) {
                        container.scrollTop = 0;
                        await new Promise(resolve => setTimeout(resolve, 300));
                    } else if (scrollVariation === 2) {
                        messages[0].scrollIntoView({ block: 'start' });
                        await new Promise(resolve => setTimeout(resolve, 300));
                    } else {
                        messages[0].scrollIntoView({ behavior: 'auto', block: 'center' });
                        await new Promise(resolve => setTimeout(resolve, 300));
                        container.scrollTop = 0;
                    }
                } else if (consecutiveScrollFailures <= SCROLL_CONFIG.MAX_CONSECUTIVE_FAILURES) {
                    log(`Using alternative scrolling method (attempt ${consecutiveScrollFailures})`);
                    
                    if (consecutiveScrollFailures === 1) {
                        messages[0].scrollIntoView({ block: 'start' });
                        await new Promise(resolve => setTimeout(resolve, 500));
                        container.scrollTop -= 1500;
                    } else if (consecutiveScrollFailures === 2) {
                        log("Clicking near the top to activate scrolling");
                        const topArea = messages[0];
                        if (topArea) {
                            simulateClick(topArea);
                            await new Promise(resolve => setTimeout(resolve, 500));
                        }
                        container.scrollTop = 0;
                        await new Promise(resolve => setTimeout(resolve, 500));
                    } else {
                        log("Using DOM manipulation to unstick scrolling");
                        const originalHeight = container.style.height;
                        const originalOverflow = container.style.overflow;
                        container.style.height = '99%';
                        container.style.overflow = 'hidden';
                        await new Promise(resolve => setTimeout(resolve, 300));
                        container.style.height = originalHeight;
                        container.style.overflow = originalOverflow;
                        await new Promise(resolve => setTimeout(resolve, 300));
                        container.scrollTop = 0;
                    }
                } else {
                    log("Too many scroll failures, applying emergency scroll reset");
                    const resetSuccessful = await attemptChatReset(originalChatTitle);
                    if (!resetSuccessful) {
                        for (let i = 0; i < 5; i++) {
                            const randomScroll = Math.floor(Math.random() * 1000);
                            container.scrollTop = randomScroll;
                            await new Promise(resolve => setTimeout(resolve, 200));
                        }
                        container.scrollTop = 0;
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                    consecutiveScrollFailures = 1;
                }
            }
        } catch (scrollError) {
            log(`Scroll error: ${scrollError.message}`);
            consecutiveScrollFailures++;
            totalScrollFailures++;
        }
        const randomDelay = Math.floor(Math.random() * 500) + 500;
        await new Promise(resolve => setTimeout(resolve, randomDelay));
        if (totalScrollFailures > SCROLL_CONFIG.MAX_TOTAL_FAILURES) {
            log(`Reached maximum total failures (${totalScrollFailures}), applying last resort recovery`);
            await applyLastResortRecovery(container);
            totalScrollFailures = 0;
        }
        stopScrolling = await checkStopScrolling();
        if (stopScrolling) {
            log('Stopping scroll process - reached target date range');
            break;
        }
    }
    if (scrollAttempts >= 200) {
        log(`Reached maximum scroll attempts (200), continuing with available messages`);
    } else if (unchangedIterations >= 5) {
        log(`Stopped scrolling after ${scrollAttempts} attempts due to no message count changes`);
    } else if (stopScrolling) {
        log(`Stopped scrolling due to reaching target date`);
    }
}
  
async function attemptChatReset(chatTitle) {
      if (!chatTitle) {
          log("Can't reset chat - no chat title found");
          return false;
      }
      log(`Attempting to reset chat view for: ${chatTitle}`);
      try {
          const headerBackButton = document.querySelector('[data-icon="back"], [aria-label="Back"]');
          if (headerBackButton) {
              log("Clicking back button to return to chat list");
              simulateClick(headerBackButton);
              await new Promise(resolve => setTimeout(resolve, 1500));
              const chatList = document.querySelector(SELECTORS.CHAT_LIST.container);
              if (chatList) {
                  const chatItems = chatList.querySelectorAll(SELECTORS.CHAT_LIST.messages);
                  let foundChat = null;
                  for (const chat of chatItems) {
                      const titleElement = chat.querySelector(SELECTORS.CHAT.title);
                      const chatTitle = titleElement?.textContent || titleElement?.getAttribute('title');
                      if (chatTitle && chatTitle.includes(chatTitle)) {
                          foundChat = chat;
                          break;
                      }
                  }
                  if (foundChat) {
                      log(`Found original chat, clicking to reopen`);
                      simulateClick(foundChat);
                      await new Promise(resolve => setTimeout(resolve, 2000));
                      try {
                          await waitForElement(SELECTORS.CHAT.messageContainer, 5000);
                          log("Successfully reset chat view");
                          return true;
                      } catch (e) {
                          log("Chat loaded but message container not found");
                      }
                  } else {
                      log(`Could not find original chat ${chatTitle} in chat list`);
                  }
              } else {
                  log("Could not find chat list after clicking back");
              }
          } else {
              log("No back button found, trying alternative reset");
              const appWrapper = document.querySelector('#app, .app-wrapper-web');
              if (appWrapper) {
                  // Force a repaint
                  appWrapper.style.opacity = '0.99';
                  await new Promise(resolve => setTimeout(resolve, 100));
                  appWrapper.style.opacity = '1';
                  await new Promise(resolve => setTimeout(resolve, 1000));
                  
                  return true;
              }
          }
      } catch (error) {
          log(`Reset chat view error: ${error.message}`);
      }
      
      return false;
}

async function applyLastResortRecovery(container) {
      log("Applying last resort recovery techniques");
      try {
          if (container) {
              container.style.display = 'none';
              await new Promise(resolve => setTimeout(resolve, 500));
              container.style.display = '';
              await new Promise(resolve => setTimeout(resolve, 1000));
          }
          const appComponent = document.querySelector('#app');
          if (appComponent) {
              appComponent.classList.add('temp-recovery-class');
              await new Promise(resolve => setTimeout(resolve, 500));
              appComponent.classList.remove('temp-recovery-class');
          }
          const originalZoom = document.body.style.zoom;
          document.body.style.zoom = '99%';
          await new Promise(resolve => setTimeout(resolve, 500));
          document.body.style.zoom = originalZoom || '100%';
          document.dispatchEvent(new Event('resize'));
          window.dispatchEvent(new Event('resize'));
          if (container) {
              for (let i = 0; i < 3; i++) {
                  const rect = container.getBoundingClientRect();
                  const x = rect.left + Math.random() * rect.width;
                  const y = rect.top + Math.random() * rect.height;
                  container.dispatchEvent(new MouseEvent('mousedown', {
                      bubbles: true, cancelable: true, view: window,
                      clientX: x, clientY: y
                  }));
                  await new Promise(resolve => setTimeout(resolve, 100));
                  container.dispatchEvent(new MouseEvent('mouseup', {
                      bubbles: true, cancelable: true, view: window,
                      clientX: x, clientY: y
                  }));
                  await new Promise(resolve => setTimeout(resolve, 100));
              }
          }
          if (container) {
              container.scrollTop = 0;
          }
          log("Last resort recovery completed");
          return true;
      } catch (error) {
          log(`Last resort recovery error: ${error.message}`);
          return false;
      }
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

}