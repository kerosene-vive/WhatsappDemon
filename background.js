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
let downloadQueue = Promise.resolve();
const log = (msg) => console.log(`[WhatsApp Exporter] ${msg}`);
let whatsappTabId = null;
let originalTabId = null;
let automationInProgress = false;
const tabStates = new Map();
const processedDownloads = new Set();
let focusInterval = null;
let automationActive = false;
let focusRetryCount = 0;
const MAX_FOCUS_RETRIES = 3;

async function enforceWhatsAppTabFocus() {
    if (!automationActive || !whatsappTabId) {
        clearFocusInterval();
        return;
    }
    try {
        let whatsappTab;
        try {
            whatsappTab = await chrome.tabs.get(whatsappTabId);
            if (!whatsappTab) {
                log("WhatsApp tab no longer exists");
                clearFocusInterval();
                return;
            }
        } catch (error) {
            log(`WhatsApp tab error: ${error.message}`);
            whatsappTabId = null;
            clearFocusInterval();
            return;
        }
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab) {
            log("No active tab found, focusing WhatsApp tab directly");
            try {
                await chrome.tabs.update(whatsappTabId, { active: true });
                await chrome.windows.update(whatsappTab.windowId, { focused: true });
                focusRetryCount = 0;
            } catch (focusError) {
                log(`Direct focus error: ${focusError.message}`);
                focusRetryCount++;
            }
            return;
        }
        if (activeTab.id !== whatsappTabId) {
            log(`Active tab (${activeTab.id}) is not WhatsApp tab (${whatsappTabId}), switching focus`);
            try {
                await chrome.tabs.update(whatsappTabId, { active: true });
                await chrome.windows.update(whatsappTab.windowId, { focused: true });
                focusRetryCount = 0;
            } catch (error) {
                focusRetryCount++;
                log(`Focus retry ${focusRetryCount}/${MAX_FOCUS_RETRIES}: ${error.message}`);
                if (focusRetryCount >= MAX_FOCUS_RETRIES) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    focusRetryCount = 0;
                } else {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
        } else {
            try {
                await chrome.windows.update(whatsappTab.windowId, { focused: true });
            } catch (error) {
                log(`Window focus error: ${error.message}`);
            }
            focusRetryCount = 0;
        }
    } catch (error) {
        console.error('Focus enforcement error:', error);
        focusRetryCount++;
        if (focusRetryCount >= MAX_FOCUS_RETRIES) {
            clearFocusInterval();
        }
    }
}

function startFocusInterval() {
    clearFocusInterval();
    automationActive = true;
    focusInterval = setInterval(enforceWhatsAppTabFocus, 1000);
}

function clearFocusInterval() {
    if (focusInterval) {
        clearInterval(focusInterval);
        focusInterval = null;
    }
    automationActive = false;
}

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

async function injectContentScript(tabId) {
    try {
        try {
            const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
            if (response?.status === 'ready') {
                log('Content script already loaded and ready');
                return true;
            }
        } catch (pingError) {
            log('Content script not detected, will inject');
        }
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js']
        });
        log('Content script injected successfully');
        return true;
    } catch (error) {
        log(`Content script injection error: ${error.message}`);
        return false;
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
            await chrome.tabs.update(tab.id, { active: true });
            await chrome.windows.update(tab.windowId, { focused: true });
            await new Promise(resolve => setTimeout(resolve, 1000));
            await handleWhatsAppTab(tab, false);
            return true;
        }
        const newTab = await chrome.tabs.create({
            url: 'https://web.whatsapp.com',
            active: true  // Make it active immediately
        });
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Tab load timeout'));
            }, 30000);
            chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
                if (tabId === newTab.id && info.status === 'complete') {
                    chrome.tabs.onUpdated.removeListener(listener);
                    clearTimeout(timeout);
                    chrome.tabs.update(newTab.id, { active: true })
                        .then(() => chrome.windows.update(newTab.windowId, { focused: true }))
                        .then(() => new Promise(resolve => setTimeout(resolve, 1000)))
                        .then(() => handleWhatsAppTab(newTab, true))
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
        if (request.action === "exportProgress" && request.stats?.dateRange) {
            request.stats.dateRange = {
                end: new Date(request.stats.dateRange.end).toLocaleDateString()
            };
        }
        await chrome.runtime.sendMessage(request);
    } catch (error) {
        if (!error.message.includes('disconnected')) {
            throw error;
        }
    }
}

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

chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('Side panel initialization error:', error));

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
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
        try {
            const tab = await chrome.tabs.get(whatsappTabId);
            if (!tab) {
                sendResponse({ 
                    status: 'error', 
                    message: 'WhatsApp tab not found' 
                });
                return true;
            }
            await chrome.tabs.update(whatsappTabId, { active: true });
            await chrome.windows.update(tab.windowId, { focused: true });
            await new Promise(resolve => setTimeout(resolve, 1500));
            try {
                const pingResponse = await chrome.tabs.sendMessage(whatsappTabId, { action: 'ping' });
                if (pingResponse?.status !== 'ready') {
                    throw new Error('Content script not ready');
                }
            } catch (pingError) {
                await injectContentScript(whatsappTabId);
                await new Promise(resolve => setTimeout(resolve, TIMEOUTS.SCRIPT_INIT));
                try {
                    const retryResponse = await chrome.tabs.sendMessage(whatsappTabId, { action: 'ping' });
                    if (retryResponse?.status !== 'ready') {
                        throw new Error('Content script initialization failed');
                    }
                } catch (retryError) {
                    sendResponse({ 
                        status: 'error', 
                        message: 'WhatsApp page not ready. Please refresh the page and try again.' 
                    });
                    return true;
                }
            }
            startFocusInterval();
            try {
                await chrome.tabs.sendMessage(whatsappTabId, {
                    action: 'startAutomation',
                    selectedChats: request.selectedChats,
                    endDate: request.endDate,
                    includeMedia: request.includeMedia
                });
                sendResponse({ status: 'automation started' });
            } catch (error) {
                clearFocusInterval();
                sendResponse({ 
                    status: 'error', 
                    message: error.message 
                });
            }
        } catch (error) {
            sendResponse({ 
                status: 'error', 
                message: `Error focusing WhatsApp tab: ${error.message}` 
            });
        }
    } else {
        sendResponse({ 
            status: 'error', 
            message: 'WhatsApp tab not initialized' 
        });
    }
    return true;
        case "enforceTabFocus":
            enforceWhatsAppTabFocus()
                .then(() => sendResponse({ status: 'focus enforced' }));
            return true;
        case "chatProcessed":
            if (!automationActive) {
                startFocusInterval();
            }
            sendResponse({ status: 'acknowledged' });
            break;
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
            clearFocusInterval();
            restoreOriginalTab()
                .then(() => {
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
            chrome.runtime.sendMessage(request).catch(() => {});
            break;
        case "exportComplete":
            clearFocusInterval();
            chrome.runtime.sendMessage(request).catch(() => {});
            restoreOriginalTab().catch(error => 
                log(`Error restoring tab: ${error.message}`));
            break;
        case "automationError":
            clearFocusInterval();
            chrome.runtime.sendMessage(request).catch(() => {});
            restoreOriginalTab().catch(error => 
                log(`Error restoring tab: ${error.message}`));
            break;
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