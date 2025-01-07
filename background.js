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
  