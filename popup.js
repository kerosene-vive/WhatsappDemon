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
      loadingFill.offsetHeight;
      loadingFill.style.transition = 'width 1.5s ease';
    };

    if (loadingFill.style.width === '100%' || completionMessage.classList.contains('show')) {
      resetTask();
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    // Disable all buttons during operation
    const buttons = taskGroup.querySelectorAll('.chat-button');
    buttons.forEach(btn => btn.disabled = true);

    loadingFill.style.width = '20%';
    const originalTaskName = taskName.textContent;
    taskName.textContent = `Downloading ${numberOfChats} ${numberOfChats === 1 ? 'chat' : 'chats'}...`;

    chrome.runtime.sendMessage({ 
      action: "openWhatsApp",
      numberOfChats: numberOfChats,
      exportType: exportType
    });

    chrome.runtime.onMessage.addListener(function listener(message) {
      if (message.action === "loadingProgress") {
        loadingFill.style.width = `${message.progress}%`;
        if (statusText && message.status) {
          statusText.textContent = message.status;
        }
        
        if (message.progress === 100) {
          completionMessage.classList.add('show');
          const audio = document.getElementById('notificationSound');
          audio.play().catch(error => console.log('Error playing sound:', error));
          setTimeout(() => {
            buttons.forEach(btn => btn.disabled = false);
            taskName.textContent = originalTaskName;
            completionMessage.classList.remove('show');
            if (statusText) statusText.textContent = '';
          }, 2000);
          chrome.runtime.onMessage.removeListener(listener);
        }
      }
      
      if (message.action === "automationError") {
        buttons.forEach(btn => btn.disabled = false);
        taskName.textContent = originalTaskName;
        if (statusText) statusText.textContent = 'Error occurred. Please try again.';
        chrome.runtime.onMessage.removeListener(listener);
      }
    });
  });
});