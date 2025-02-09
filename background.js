const TIMEOUTS = {
    SCRIPT_INIT: 2000,
    WHATSAPP_LOAD: 5000,
    CONNECTION_RETRY: 1000,
    MAX_RETRIES: 5,
    TAB_OPERATION: 3000
};
const STATES = {
    INITIAL: 'initial',
    LOADING: 'loading',
    READY: 'ready',
    ERROR: 'error',
    MINIMIZED: 'minimized'
};
const log = (msg) => console.log(`[WhatsApp Exporter] ${msg}`);
let whatsappTabId = null;
let originalTabId = null;
const tabStates = new Map();
const processedDownloads = new Set();

chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Side panel initialization error:', error));


async function saveCurrentTab() {
    try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab?.id) {
            originalTabId = activeTab.id;
            return true;
        }
    } catch (error) {
        log(`Error saving current tab: ${error.message}`);
    }
    return false;
}


async function restoreOriginalTab() {
    if (originalTabId) {
        try {
            const tab = await chrome.tabs.get(originalTabId);
            if (tab) {
                await chrome.tabs.update(originalTabId, { active: true });
                return true;
            }
        } catch (error) {
            log(`Error restoring original tab: ${error.message}`);
        }
    }
    return false;
}


async function injectContentScript(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js']
        });
        return true;
    } catch (error) {
        log(`Content script injection error: ${error.message}`);
        return false;
    }
}


async function verifyContentScript(tabId, maxRetries = TIMEOUTS.MAX_RETRIES) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
            if (response?.status === 'ready') {
                return true;
            }
        } catch (error) {
            await new Promise(resolve => setTimeout(resolve, TIMEOUTS.CONNECTION_RETRY));
        }
    }
    return false;
}


async function handleWhatsAppTab(tab, isNew = false) {
    try {
        tabStates.set(tab.id, STATES.LOADING);
        if (isNew) {
            await new Promise(resolve => setTimeout(resolve, TIMEOUTS.WHATSAPP_LOAD));
            
            // Check login status
            try {
                const loginStatus = await chrome.tabs.sendMessage(tab.id, { 
                    action: 'checkLoginStatus' 
                });
                
                if (loginStatus?.needsLogin) {
                    chrome.runtime.sendMessage({ 
                        action: 'whatsappLoginRequired' 
                    });
                    tabStates.set(tab.id, STATES.LOADING);
                    return false;
                }
            } catch (error) {
                console.log('Login check failed:', error);
            }
        }
 
        if (!await injectContentScript(tab.id)) {
            throw new Error('Content script injection failed');
        }
 
        await new Promise(resolve => setTimeout(resolve, TIMEOUTS.SCRIPT_INIT));
        
        if (!await verifyContentScript(tab.id)) {
            throw new Error('Content script verification failed');
        }
 
        whatsappTabId = tab.id;
        tabStates.set(tab.id, STATES.READY);
        return true;
 
    } catch (error) {
        tabStates.set(tab.id, STATES.ERROR);
        throw error;
    }
 }


async function handleWhatsApp() {
    try {
        await saveCurrentTab();
        const existingTabs = await chrome.tabs.query({
            url: "https://web.whatsapp.com/*"
        });
        if (existingTabs.length > 0) {
            const tab = existingTabs[0];
            await handleWhatsAppTab(tab, false);
            return true;
        }
        const newTab = await chrome.tabs.create({
            url: 'https://web.whatsapp.com',
            active: false
        });
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Tab load timeout'));
            }, 30000);
            chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
                if (tabId === newTab.id && info.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    clearTimeout(timeout);
                    handleWhatsAppTab(newTab, true)
                        .then(resolve)
                        .catch(reject);
                }
            });
        });
    } catch (error) {
        chrome.runtime.sendMessage({ 
            action: "automationError", 
            error: error.message 
        });
        throw error;
    }
}


async function forwardMessage(request, sender) {
    if (!sender.tab || sender.tab.id !== whatsappTabId) return;
    
    try {
        await chrome.runtime.sendMessage(request);
    } catch (error) {
        if (!error.message.includes('disconnected')) {
            throw error;
        }
    }
}

// Aggiungi questa variabile per la coda dei download
let downloadQueue = Promise.resolve();

async function handleDownload(request) {
    if (!request.data) return;
    const downloadKey = `${request.data.filename}-${request.data.url}`;
    if (processedDownloads.has(downloadKey)) return;
    processedDownloads.add(downloadKey);
    
    try {
        await chrome.downloads.download({
            url: request.data.url,
            filename: request.data.filename,
            saveAs: false
        });
    } catch (error) {
        log(`Download error: ${error.message}`);
        throw error;
    }
}

function queueDownload(request) {
    downloadQueue = downloadQueue.then(() => handleDownload(request))
        .catch(error => log(`Download queue error: ${error.message}`));
    return downloadQueue;
}

// Il listener completo modificato
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    log(`Received message: ${request.action}`);
    switch (request.action) {
        case "initializeWhatsApp":
            handleWhatsApp()
                .then(() => sendResponse({ status: 'ready' }))
                .catch(error => sendResponse({ 
                    status: 'error', 
                    message: error.message 
                }));
            return true;

        case "startAutomation":
            if (whatsappTabId) {
                chrome.tabs.sendMessage(whatsappTabId, request)
                    .then(() => sendResponse({ status: 'automation started' }))
                    .catch(error => sendResponse({ 
                        status: 'error', 
                        message: error.message 
                    }));
            } else {
                sendResponse({ 
                    status: 'error', 
                    message: 'WhatsApp tab not initialized' 
                });
            }
            return true;

        case "chatsAvailable":
            chrome.runtime.sendMessage(request).catch(() => {});
            break;

        case "contentScriptReady":
            if (sender.tab) {
                tabStates.set(sender.tab.id, STATES.READY);
                whatsappTabId = sender.tab.id;
                chrome.runtime.sendMessage({ action: 'whatsappReady' });
                sendResponse({ status: 'acknowledged' });
            }
            break;

        case "downloadChat":
        case "downloadMedia":
            if (!request.data) {
                sendResponse({ status: 'error', message: 'No download data provided' });
                return true;
            }
            queueDownload(request)
                .then(() => sendResponse({ status: 'download started' }))
                .catch(error => sendResponse({ 
                    status: 'error', 
                    message: error.message 
                }));
            return true;

        case "automationComplete":
            restoreOriginalTab()
                .then(() => {
                    // Reset download queue after completion
                    downloadQueue = Promise.resolve();
                    processedDownloads.clear();
                    sendResponse({ status: 'complete' });
                })
                .catch(error => sendResponse({ 
                    status: 'error', 
                    message: error.message 
                }));
            return true;

        case "mediaProgress":
        case "exportProgress":
        case "exportComplete":
        case "automationError":
        case "debugLog":
        case "whatsappLoginRequired":
            if (!sender.tab || sender.tab.id === whatsappTabId) {
                chrome.runtime.sendMessage(request).catch(() => {});
            }
            break;

        default:
            if (!sender.tab || sender.tab.id === whatsappTabId) {
                chrome.runtime.sendMessage(request).catch(() => {});
            }
            break;
    }
    return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
    if (whatsappTabId === tabId) {
        whatsappTabId = null;
        chrome.runtime.sendMessage({ action: 'whatsappClosed' });
        restoreOriginalTab().catch(error => 
            log(`Error restoring tab after WhatsApp close: ${error.message}`));
    }
    tabStates.delete(tabId);
});

chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'cleanup') {
        port.onDisconnect.addListener(async () => {
            if (whatsappTabId) {
                try {
                    await chrome.tabs.remove(whatsappTabId);
                    await restoreOriginalTab();
                } catch (error) {
                    log(`Cleanup error: ${error.message}`);
                }
            }
        });
    }
});

log('Background script loaded');