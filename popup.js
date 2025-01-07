document.getElementById('testBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({action: "playClicked"});
  });