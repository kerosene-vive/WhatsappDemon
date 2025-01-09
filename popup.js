document.getElementById('startBtn1').addEventListener('click', async function() {
  const taskGroup = this.closest('.task-group');
  const loadingFill = taskGroup.querySelector('.loading-fill');
  const completionMessage = taskGroup.querySelector('.completion-message');
  const taskName = taskGroup.querySelector('.task-name');
  const playButton = this;

  // Reset to initial state first
  const resetTask = () => {
    loadingFill.style.transition = 'none'; // Disable transition for instant reset
    loadingFill.style.width = '0%';
    completionMessage.classList.remove('show');
    taskName.textContent = 'Initialize Task 1';
    
    // Force a reflow to ensure the transition removal takes effect
    loadingFill.offsetHeight;
    
    // Re-enable transition for next animation
    loadingFill.style.transition = 'width 1.5s ease';
  };

  // If there's a previous completion, reset first
  if (loadingFill.style.width === '100%' || completionMessage.classList.contains('show')) {
    resetTask();
    // Wait a brief moment to show the reset before starting new cycle
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  
  // Start new loading cycle
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
        completionMessage.classList.add('show');
          // Play notification sound
        const audio = document.getElementById('notificationSound');
        audio.play().catch(error => console.log('Error playing sound:', error));
    
        // Show play button again for next cycle
        setTimeout(() => {
          playButton.style.display = 'flex';
        }, 1000);
        
        // Remove listener
        chrome.runtime.onMessage.removeListener(listener);
      }
    }
  });
});