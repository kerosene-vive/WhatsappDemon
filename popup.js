document.getElementById('startBtn1').addEventListener('click', async function() {
  const taskGroup = this.closest('.task-group');
  const loadingFill = taskGroup.querySelector('.loading-fill');
  const completionMessage = taskGroup.querySelector('.completion-message');
  const taskName = taskGroup.querySelector('.task-name');
  const playButton = this;
  
  // Hide button and start initial loading
  playButton.style.display = 'none';
  loadingFill.style.width = '20%';
  taskName.textContent = 'Opening WhatsApp...';
  
  // Send message to open WhatsApp
  chrome.runtime.sendMessage({ action: "openWhatsApp" });
  
  // Listen for loading updates
  chrome.runtime.onMessage.addListener(function listener(message) {
    if (message.action === "loadingProgress") {
      loadingFill.style.width = `${message.progress}%`;
      
      if (message.progress === 100) {
        // Show completion
        taskName.textContent = 'Initialize Task 1';
        completionMessage.classList.add('show');
        // Remove listener
        chrome.runtime.onMessage.removeListener(listener);
      }
    }
  });
});