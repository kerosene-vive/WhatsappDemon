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
    if (loadingFill.style.width === '100%' || completionMessage.classList.contains('show')) {
      resetTask();
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    const buttons = taskGroup.querySelectorAll('.chat-button');
    buttons.forEach(btn => btn.disabled = true);
    loadingFill.style.width = '20%';
    const originalTaskName = taskName.textContent;
    const actionText = exportType === 'media' ? 'Downloading photos from' : 'Downloading';
    taskName.textContent = `${actionText} ${numberOfChats} ${numberOfChats === 1 ? 'chat' : 'chats'}...`;

    chrome.runtime.sendMessage({ 
      action: "openWhatsApp",
      numberOfChats: numberOfChats,
      includeMedia: exportType === 'media'
    });

    const messageHandler = (message) => {
      switch (message.action) {
        case "loadingProgress":
          loadingFill.style.width = `${message.progress}%`;
          if (statusText && message.status) {
            statusText.textContent = message.status;
          }
          break;
        case "chatProgress":
          const chatProgress = message.progress || 0;
          loadingFill.style.width = `${chatProgress}%`;
          if (statusText && message.chatTitle) {
            statusText.textContent = `Downloading chat: ${message.chatTitle}`;
          }
          if (chatProgress === 100) {
            handleCompletion();
          }
          break;
        case "mediaProgress":
          const mediaProgress = message.progress || 0;
          loadingFill.style.width = `${mediaProgress}%`;
          if (statusText && message.chat) {
            statusText.textContent = `Processing ${message.chat}: ${message.mediaCount} media items found`;
          }
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

    chrome.runtime.onMessage.addListener(messageHandler);
  });
});