//background.js
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

chrome.runtime.onInstalled.addListener(() => {
  log('Extension installed');
  chrome.sidePanel
      .setOptions({
          path: 'popup.html',
          enabled: true
      })
      .catch(error => log(`Sidepanel setup error: ${error.message}`));
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    log(`Received message: ${request.action}`);
    switch (request.action) {
        case "debugLog":
            log(`Content: ${request.message}`);
            break;
        case "openWhatsApp":
            handleWhatsApp();
            break;
        case "automationError":
            log(`Error: ${request.error}`);
            chrome.runtime.sendMessage(request).catch(() => {});
            break;
        case "contentScriptReady":
            if (sender.tab) {
                tabStates.set(sender.tab.id, STATES.READY);
                log(`Content script ready in tab ${sender.tab.id}`);
                sendResponse({ status: 'acknowledged' });
            }
            break;
        case "loadingProgress":
            chrome.runtime.sendMessage(request).catch(() => {});
            break;
    }
    return true;
  });
  
  
chrome.tabs.onRemoved.addListener((tabId) => {
    tabStates.delete(tabId);
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


async function handleWhatsAppTab(tab, isNew = false) {
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
      await chrome.tabs.sendMessage(tab.id, { 
          action: "startAutomation" 
      });
      tabStates.set(tab.id, STATES.READY);
      return true;
  } catch (error) {
      tabStates.set(tab.id, STATES.ERROR);
      throw new Error(`Tab handling failed: ${error.message}`);
  }
}


async function handleWhatsApp() {
  try {
      const tabs = await chrome.tabs.query({
          url: "https://web.whatsapp.com/*"
      });
      if (tabs.length > 0) {
          log(`Found existing WhatsApp tab: ${tabs[0].id}`);
          await handleWhatsAppTab(tabs[0], false);
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
                      handleWhatsAppTab(newTab, true)
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