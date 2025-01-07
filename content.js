function waitForElement(selector) {
    return new Promise(resolve => {
      if (document.querySelector(selector)) {
        return resolve(document.querySelector(selector));
      }
  
      const observer = new MutationObserver(mutations => {
        if (document.querySelector(selector)) {
          observer.disconnect();
          resolve(document.querySelector(selector));
        }
      });
  
      observer.observe(document.body, {
        childList: true,
        subtree: true
      });
    });
  }
  
  chrome.runtime.onMessage.addListener(async (request) => {
    if (request.action === "sendMessage") {
      const searchInput = await waitForElement('div[title="Search input textbox"]');
      searchInput.click();
      
      const textEvent = new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertText',
        data: 'g jjacopo'
      });
      searchInput.dispatchEvent(textEvent);
      
      const contact = await waitForElement('span[title="g jjacopo"]');
      contact.click();
      
      const messageInput = await waitForElement('div[title="Type a message"]');
      messageInput.textContent = "hello";
      messageInput.dispatchEvent(new InputEvent('input', { bubbles: true }));
      
      const sendButton = document.querySelector('span[data-icon="send"]');
      sendButton.click();
    }
  });