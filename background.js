const TIMEOUTS = {
    SCRIPT_INIT: 2000,
    WHATSAPP_LOAD: 5000,
    CONNECTION_RETRY: 1000,
    MAX_RETRIES: 5
};
const STATES = {
    INITIAL: 'initial',
    LOADING: 'loading',
    READY: 'ready',
    ERROR: 'error'
};
const log = (msg) => console.log(`[WhatsApp Exporter] ${msg}`);
const tabStates = new Map();
let whatsappTabId = null;

chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'cleanup') {
        port.onDisconnect.addListener(() => {
            if (whatsappTabId) {
                chrome.tabs.remove(whatsappTabId)
                    .then(() => log('WhatsApp tab closed on extension shutdown'))
                    .catch(error => log(`Error closing tab: ${error.message}`));
            }
        });
    }
});

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    log(`Received message: ${request.action}`);
    switch (request.action) {
        case "debugLog":
            log(`Content: ${request.message}`);
            break; 
        case "openWhatsApp":
            handleWhatsApp(request.numberOfChats, request.includeMedia);
            break;  
        case "automationError":
            log(`Error: ${request.error}`);
            chrome.runtime.sendMessage(request).catch(() => {});
            break;
        case "contentScriptReady":
            if (sender.tab) {
                tabStates.set(sender.tab.id, STATES.READY);
                whatsappTabId = sender.tab.id;
                log(`Content script ready in tab ${sender.tab.id}`);
                sendResponse({ status: 'acknowledged' });
            }
            break;
        case "loadingProgress":
        case "mediaProgress":
            chrome.runtime.sendMessage(request).catch(() => {});
            break;
        case "downloadChat":
            if (request.data) {
                chrome.downloads.download({
                    url: request.data.url,
                    filename: request.data.filename,
                    saveAs: false
                }).catch(error => log(`Chat download error: ${error.message}`));
            }
            break;
        case "chatProgress":
        case "exportComplete":
            chrome.runtime.sendMessage(request).catch(() => {});
            break;
        case "downloadMedia":
            if (request.data) {
                chrome.downloads.download({
                    url: request.data.url,
                    filename: request.data.filename,
                    saveAs: false
                }).catch(error => log(`Download error: ${error.message}`));
            }
            break;
        case "mediaDownloadComplete":
            chrome.runtime.sendMessage(request).catch(() => {});
            break;
    }
    return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
    tabStates.delete(tabId);
    if (whatsappTabId === tabId) {
        whatsappTabId = null;
    }
});


async function injectContentScript(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js']
        });
        log(`Content script injection attempted for tab ${tabId}`);
        return true;
    } catch (error) {
        log(`Injection failed: ${error.message}`);
        return false;
    }
}


async function verifyContentScript(tabId, maxRetries = TIMEOUTS.MAX_RETRIES) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
            if (response && response.status === 'ready') {
                log(`Content script verified in tab ${tabId}`);
                return true;
            }
        } catch (error) {
            log(`Verification attempt ${i + 1} failed, retrying...`);
            await new Promise(resolve => setTimeout(resolve, TIMEOUTS.CONNECTION_RETRY));
        }
    }
    return false;
}


async function handleWhatsAppTab(tab, numberOfChats, includeMedia = false, isNew = false) {
    try {
        tabStates.set(tab.id, STATES.LOADING);
        await chrome.tabs.update(tab.id, { active: true });
        if (isNew) {
            await new Promise(resolve => setTimeout(resolve, TIMEOUTS.WHATSAPP_LOAD));
        }
        const injected = await injectContentScript(tab.id);
        if (!injected) {
            throw new Error('Failed to inject content script');
        }
        await new Promise(resolve => setTimeout(resolve, TIMEOUTS.SCRIPT_INIT));
        const verified = await verifyContentScript(tab.id);
        if (!verified) {
            throw new Error('Content script verification failed');
        }
        log('Starting automation');
        log(includeMedia);
        await chrome.tabs.sendMessage(tab.id, { 
            action: includeMedia ? "startMediaDownload" : "startAutomation",
            numberOfChats: numberOfChats,
            includeMedia: includeMedia
        });
        tabStates.set(tab.id, STATES.READY);
        return true;
    } catch (error) {
        tabStates.set(tab.id, STATES.ERROR);
        throw new Error(`Tab handling failed: ${error.message}`);
    }
}


async function handleWhatsApp(numberOfChats = 1, includeMedia = false) {
    try {
        const tabs = await chrome.tabs.query({
            url: "https://web.whatsapp.com/*"
        });
        if (tabs.length > 0) {
            log(`Found existing WhatsApp tab: ${tabs[0].id}`);
            await handleWhatsAppTab(tabs[0], numberOfChats, includeMedia, false);
        } else {
            log('Creating new WhatsApp tab');
            const newTab = await chrome.tabs.create({
                url: 'https://web.whatsapp.com',
                active: true
            });
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Tab load timeout'));
                }, 30000);
                chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
                    if (tabId === newTab.id && info.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener);
                        clearTimeout(timeout);
                        handleWhatsAppTab(newTab, numberOfChats, includeMedia, true)
                            .then(resolve)
                            .catch(reject);
                    }
                });
            });
        }
    } catch (error) {
        log(`Error: ${error.message}`);
        chrome.runtime.sendMessage({ 
            action: "automationError", 
            error: error.message 
        }).catch(() => {});
    }
}

log('Background script loaded');