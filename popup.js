const cleanupPort = chrome.runtime.connect({ name: 'cleanup' });

document.querySelectorAll('.chat-button:not(.disabled)').forEach(button => {
  button.addEventListener('click', async function() {
    const numberOfChats = parseInt(this.dataset.chats);
    const exportType = this.dataset.type;
    const taskGroup = this.closest('.task-group');
    const loadingFill = taskGroup.querySelector('.loading-fill');
    const completionMessage = taskGroup.querySelector('.completion-message');
    const taskName = taskGroup.querySelector('.task-name');
    const statusText = taskGroup.querySelector('.status-text');
    const resetTask = () => {      
      loadingFill.style.transition = 'none';
      loadingFill.style.width = '0%';
      loadingFill.style.opacity = '0.1';
      completionMessage.classList.remove('show');
      if (statusText) statusText.textContent = '';
      loadingFill.offsetHeight;
      loadingFill.style.transition = 'all 1.5s ease';
    };
    if (loadingFill.style.width === '100%' || completionMessage.classList.contains('show')) {
      resetTask();
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    const buttons = taskGroup.querySelectorAll('.chat-button');
    buttons.forEach(btn => btn.disabled = true);
    loadingFill.style.opacity = '0.1';
    loadingFill.style.width = '20%';
    const originalTaskName = taskName.textContent;
    chrome.runtime.sendMessage({ 
      action: "openWhatsApp",
      numberOfChats: numberOfChats,
      includeMedia: exportType === 'media'
    });
    const messageHandler = (message) => {
      switch (message.action) {
        case "loadingProgress":
          break;
        case "chatProgress":
          const chatProgress = message.progress || 0;
          if (chatProgress === 100) {
            handleCompletion();
          }
          break;
        case "mediaProgress":
          break;
        case "exportComplete":
          handleCompletion();
          break;
        case "mediaDownloadComplete":
          handleCompletion();
          break;
        case "automationError":
          handleError();
          break;
      }
    };
    const handleCompletion = () => {
      loadingFill.style.width = '100%';
      loadingFill.style.opacity = '0';
      completionMessage.classList.add('show');
      playNotificationSound();
      setTimeout(() => {
        resetUIState();
      }, 2000);
      chrome.runtime.onMessage.removeListener(messageHandler);
    };
    const handleError = () => {
      resetUIState();
      if (statusText) statusText.textContent = 'Error occurred. Please try again.';
      chrome.runtime.onMessage.removeListener(messageHandler);
    };
    const resetUIState = () => {
      buttons.forEach(btn => btn.disabled = false);
      taskName.textContent = originalTaskName;
      completionMessage.classList.remove('show');
      if (statusText) statusText.textContent = '';
      loadingFill.style.transition = 'none';
      loadingFill.style.width = '0%';
      loadingFill.style.opacity = '0.1';
    };
    const playNotificationSound = () => {
      const audio = document.getElementById('notificationSound');
      if (audio) {
        audio.play().catch(error => console.log('Error playing sound:', error));
      }
    };
    chrome.runtime.onMessage.addListener(messageHandler);
  });
});