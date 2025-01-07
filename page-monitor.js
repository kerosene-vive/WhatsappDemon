document.addEventListener('click', (e) => {
    if (e.target.tagName === 'BUTTON' && e.target.getAttribute('aria-label')?.includes('Play')) {
      chrome.runtime.sendMessage({action: "playClicked"});
    }
  });