chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel
      .setOptions({
        path: 'popup.html',
        enabled: true
      })
      .then(() => {
        chrome.sidePanel.setPanelBehavior({
          openPanelOnActionClick: true
        });
      });
  });
  
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "openWhatsApp") {
      // First check if WhatsApp is already open
      chrome.tabs.query({
        url: "https://web.whatsapp.com/*"
      }, (tabs) => {
        if (tabs.length > 0) {
          // WhatsApp is already open, use the first instance
          const existingTab = tabs[0];
          
          // Send immediate completion message
          chrome.runtime.sendMessage({
            action: "loadingProgress",
            progress: 100
          });
        } else {
          // No WhatsApp tab found, create new one
          chrome.tabs.create({
            url: 'https://web.whatsapp.com',
            active: false
          }, (newTab) => {
            // Monitor tab loading state
            chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
              if (tabId === newTab.id) {
                if (info.status === 'loading') {
                  chrome.runtime.sendMessage({
                    action: "loadingProgress",
                    progress: 50
                  });
                } 
                else if (info.status === 'complete') {
                  chrome.runtime.sendMessage({
                    action: "loadingProgress",
                    progress: 100
                  });
                  // Remove listener once complete
                  chrome.tabs.onUpdated.removeListener(listener);
                }
              }
            });
          });
        }
      });
      return true;
    }
  });