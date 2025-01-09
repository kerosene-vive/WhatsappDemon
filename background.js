// background.js

// Constants
const TIMEOUTS = {
  SCRIPT_INIT: 1000,
  WHATSAPP_LOAD: 5000
};

const STATES = {
  INITIAL: 'initial',
  LOADING: 'loading',
  READY: 'ready',
  ERROR: 'error'
};

// Logging
const log = (msg) => console.log(`[WhatsApp Exporter] ${msg}`);

// Track content script states
const tabStates = new Map();

// Installation handler
chrome.runtime.onInstalled.addListener(() => {
  log('Extension installed');
  chrome.sidePanel
      .setOptions({
          path: 'popup.html',
          enabled: true
      })
      .then(() => {
          chrome.sidePanel.setPanelBehavior({
              openPanelOnActionClick: true
          });
      })
      .catch(error => log(`Sidepanel setup error: ${error.message}`));
});

// Inject content script with retry
async function injectContentScript(tabId, retries = 3) {
  for (let i = 0; i < retries; i++) {
      try {
          await chrome.scripting.executeScript({
              target: { tabId },
              files: ['content.js']
          });
          log(`Content script injected in tab ${tabId}`);
          return true;
      } catch (error) {
          log(`Injection attempt ${i + 1} failed: ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, 1000));
      }
  }
  throw new Error('Failed to inject content script after retries');
}

// Check if content script is responsive
async function checkContentScript(tabId) {
  try {
      await chrome.tabs.sendMessage(tabId, { action: 'ping' });
      return true;
  } catch {
      return false;
  }
}

// Handle WhatsApp tab
async function handleWhatsAppTab(tab, isNew = false) {
  try {
      // Activate tab
      await chrome.tabs.update(tab.id, { active: true });
      
      // Wait if it's a new tab
      if (isNew) {
          await new Promise(resolve => setTimeout(resolve, TIMEOUTS.WHATSAPP_LOAD));
      }
      
      // Check if content script is already working
      const isReady = await checkContentScript(tab.id);
      if (!isReady) {
          await injectContentScript(tab.id);
          await new Promise(resolve => setTimeout(resolve, TIMEOUTS.SCRIPT_INIT));
      }
      
      // Start automation
      log('Starting automation');
      await chrome.tabs.sendMessage(tab.id, { 
          action: "startAutomation" 
      });
      
      return true;
  } catch (error) {
      throw new Error(`Tab handling failed: ${error.message}`);
  }
}

// Main WhatsApp handler
async function handleWhatsApp() {
  try {
      // Check for existing WhatsApp tab
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

          // Wait for tab to load
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
      // Notify popup of error
      chrome.runtime.sendMessage({ 
          action: "automationError", 
          error: error.message 
      }).catch(() => {});
  }
}

// Message listener
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
          // Forward error to popup
          chrome.runtime.sendMessage(request).catch(() => {});
          break;

      case "contentScriptReady":
          if (sender.tab) {
              tabStates.set(sender.tab.id, STATES.READY);
              log(`Content script ready in tab ${sender.tab.id}`);
          }
          break;

      case "loadingProgress":
          // Forward progress to popup
          chrome.runtime.sendMessage(request).catch(() => {});
          break;
  }

  return true;
});

// Tab cleanup
chrome.tabs.onRemoved.addListener((tabId) => {
  tabStates.delete(tabId);
});