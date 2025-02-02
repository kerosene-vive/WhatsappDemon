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
const processedDownloads = new Set();

chrome.runtime.onConnect.addListener((port) => {
    if (port.name === 'cleanup') {
        port.onDisconnect.addListener(() => {
            if (whatsappTabId) {
                chrome.tabs.remove(whatsappTabId)
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
          case "initializeWhatsApp":
              handleWhatsApp()
                  .then(() => sendResponse({ status: 'ready' }))
                  .catch(error => sendResponse({ status: 'error', message: error.message }));
              return true;
          case "startAutomation":
              if (whatsappTabId) {
                  chrome.tabs.sendMessage(whatsappTabId, request);
              }
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
              if (request.data) {
                  const downloadKey = `${request.data.filename}-${request.data.url}`;
                  if (!processedDownloads.has(downloadKey)) {
                      processedDownloads.add(downloadKey);
                      chrome.downloads.download({
                          url: request.data.url,
                          filename: request.data.filename,
                          saveAs: false
                      });
                  }
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
    }
    tabStates.delete(tabId);
});


async function injectContentScript(tabId) {
    try {
        await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js']
        });
        return true;
    } catch (error) {
        return false;
    }
}


async function verifyContentScript(tabId, maxRetries = TIMEOUTS.MAX_RETRIES) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
            if (response?.status === 'ready') return true;
        } catch (error) {
            await new Promise(resolve => setTimeout(resolve, TIMEOUTS.CONNECTION_RETRY));
        }
    }
    return false;
}


async function handleWhatsAppTab(tab, isNew = false) {
    try {
        tabStates.set(tab.id, STATES.LOADING);
        await chrome.tabs.update(tab.id, { active: true });
        if (isNew) {
            await new Promise(resolve => setTimeout(resolve, TIMEOUTS.WHATSAPP_LOAD));
        }
        if (!await injectContentScript(tab.id)) {
            throw new Error('Content script injection failed');
        }
        await new Promise(resolve => setTimeout(resolve, TIMEOUTS.SCRIPT_INIT));
        if (!await verifyContentScript(tab.id)) {
            throw new Error('Content script verification failed');
        }
        tabStates.set(tab.id, STATES.READY);
        return true;
    } catch (error) {
        tabStates.set(tab.id, STATES.ERROR);
        throw error;
    }
}


async function handleWhatsApp() {
    try {
        const tabs = await chrome.tabs.query({
            url: "https://web.whatsapp.com/*"
        });
        
        if (tabs.length > 0) {
            await handleWhatsAppTab(tabs[0], false);
            return true;
        }
        const newTab = await chrome.tabs.create({
            url: 'https://web.whatsapp.com',
            active: true
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

log('Background script loaded');