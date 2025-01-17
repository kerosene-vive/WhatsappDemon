// Popup event handling
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
      completionMessage.classList.remove('show');
      if (statusText) statusText.textContent = '';
      loadingFill.offsetHeight; // Force reflow
      loadingFill.style.transition = 'width 1.5s ease';
    };

    // Reset if previous task was completed
    if (loadingFill.style.width === '100%' || completionMessage.classList.contains('show')) {
      resetTask();
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // Disable all buttons during operation
    const buttons = taskGroup.querySelectorAll('.chat-button');
    buttons.forEach(btn => btn.disabled = true);

    // Initial UI state
    loadingFill.style.width = '20%';
    const originalTaskName = taskName.textContent;
    const actionText = exportType === 'media' ? 'Downloading media from' : 'Downloading';
    taskName.textContent = `${actionText} ${numberOfChats} ${numberOfChats === 1 ? 'chat' : 'chats'}...`;

    // Send message to background script
    chrome.runtime.sendMessage({ 
      action: "openWhatsApp",
      numberOfChats: numberOfChats,
      includeMedia: exportType === 'media'
    });

    // Setup message listener
    const messageHandler = (message) => {
      switch (message.action) {
        case "loadingProgress":
          loadingFill.style.width = `${message.progress}%`;
          if (statusText && message.status) {
            statusText.textContent = message.status;
          }
          
          if (message.progress === 100) {
            handleCompletion();
          }
          break;

        case "mediaProgress":
          const progress = message.progress || 0;
          loadingFill.style.width = `${progress}%`;
          if (statusText && message.chat) {
            statusText.textContent = `Processing ${message.chat}: ${message.mediaCount} media items found`;
          }
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
    };

    const playNotificationSound = () => {
      const audio = document.getElementById('notificationSound');
      if (audio) {
        audio.play().catch(error => console.log('Error playing sound:', error));
      }
    };

    // Add message listener
    chrome.runtime.onMessage.addListener(messageHandler);
  });
});