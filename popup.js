document.querySelectorAll('.chat-button:not(.disabled)').forEach(button => {
  button.addEventListener('click', async function() {
    const numberOfChats = parseInt(this.dataset.chats);
    const taskGroup = this.closest('.task-group');
    const loadingFill = taskGroup.querySelector('.loading-fill');
    const completionMessage = taskGroup.querySelector('.completion-message');
    const taskName = taskGroup.querySelector('.task-name');
    const buttonGroup = taskGroup.querySelector('.button-group');

    const resetTask = () => {      
      loadingFill.style.transition = 'none';
      loadingFill.style.width = '0%';
      completionMessage.classList.remove('show');
      taskName.textContent = 'Download Chats';
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
    taskName.textContent = `Downloading ${numberOfChats} ${numberOfChats === 1 ? 'chat' : 'chats'}...`;

    chrome.runtime.sendMessage({ 
      action: "openWhatsApp",
      numberOfChats: numberOfChats 
    });

    chrome.runtime.onMessage.addListener(function listener(message) {
      if (message.action === "loadingProgress") {
        loadingFill.style.width = `${message.progress}%`;
        
        if (message.progress === 100) {
          completionMessage.classList.add('show');
          const audio = document.getElementById('notificationSound');
          audio.play().catch(error => console.log('Error playing sound:', error));
          
          // Re-enable buttons and reset text after completion
          setTimeout(() => {
            buttons.forEach(btn => btn.disabled = false);
            taskName.textContent = 'Download Chats';
            completionMessage.classList.remove('show');
          }, 2000); // Wait 2 seconds before resetting
          
          chrome.runtime.onMessage.removeListener(listener);
        }
      }
      
      if (message.action === "automationError") {
        // Re-enable buttons on error
        buttons.forEach(btn => btn.disabled = false);
        taskName.textContent = 'Download Chats';
        chrome.runtime.onMessage.removeListener(listener);
      }
    });
  });
});