document.getElementById('startBtn').addEventListener('click', function() {
    const progressContainer = document.querySelector('.progress-container');
    const progress = document.querySelector('.progress');
    const completionMessage = document.querySelector('.completion-message');
    
    // Show progress bar
    progressContainer.classList.add('active');
    
    // Animate progress
    setTimeout(() => {
      progress.style.width = '100%';
      
      // Show completion message when done
      setTimeout(() => {
        completionMessage.classList.add('show');
      }, 300);
    }, 100);
  });