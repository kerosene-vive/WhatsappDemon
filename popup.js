document.getElementById('startBtn1').addEventListener('click', async function() {
  const taskGroup = this.closest('.task-group');
  const loadingFill = taskGroup.querySelector('.loading-fill');
  const completionMessage = taskGroup.querySelector('.completion-message');
  const taskName = taskGroup.querySelector('.task-name');
  const playButton = this;
  const resetTask = () => {
    loadingFill.style.transition = 'none';
    loadingFill.style.width = '0%';
    completionMessage.classList.remove('show');
    taskName.textContent = 'Initialize Task 1';
    loadingFill.offsetHeight;
    loadingFill.style.transition = 'width 1.5s ease';
  };
  if (loadingFill.style.width === '100%' || completionMessage.classList.contains('show')) {
    resetTask();
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  playButton.style.display = 'none';
  loadingFill.style.width = '20%';
  taskName.textContent = 'Opening WhatsApp...';
  chrome.runtime.sendMessage({ action: "openWhatsApp" });
  chrome.runtime.onMessage.addListener(function listener(message) {
    if (message.action === "loadingProgress") {
      loadingFill.style.width = `${message.progress}%`;
      if (message.progress === 100) {
        completionMessage.classList.add('show');
        const audio = document.getElementById('notificationSound');
        audio.play().catch(error => console.log('Error playing sound:', error));
        setTimeout(() => {
          playButton.style.display = 'flex';
        }, 1000);
        chrome.runtime.onMessage.removeListener(listener);
      }
    }
  });
});