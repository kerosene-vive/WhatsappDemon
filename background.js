chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "playClicked") {
      chrome.tabs.query({url: "https://web.whatsapp.com/*"}, (tabs) => {
        if (tabs.length > 0) {
          chrome.tabs.sendMessage(tabs[0].id, {action: "sendMessage"});
        } else {
          chrome.tabs.create({url: "https://web.whatsapp.com/"}, (tab) => {
            setTimeout(() => {
              chrome.tabs.sendMessage(tab.id, {action: "sendMessage"});
            }, 5000);
          });
        }
      });
    }
  });