const cleanupPort = chrome.runtime.connect({ name: 'cleanup' });

document.addEventListener('DOMContentLoaded', () => {
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    overlay.innerHTML = '<div class="spinner"></div><div>Connecting to WhatsApp...</div>';
    document.body.appendChild(overlay);
    
    chrome.runtime.sendMessage({ action: 'initializeWhatsApp' });
});

chrome.runtime.onMessage.addListener((message) => {
    switch (message.action) {
        case 'whatsappReady':
            document.querySelector('.loading-overlay').remove();
            initializeButtons();
            break;
        case 'whatsappClosed':
            location.reload();
            break;
    }
});

function initializeButtons() {
    document.querySelectorAll('.chat-button:not(.disabled)').forEach(button => {
        button.addEventListener('click', async function() {
            const numberOfChats = parseInt(this.dataset.chats);
            const exportType = this.dataset.type;
            const exportMedia = this.dataset.mediaType;
            const taskGroup = this.closest('.task-group');
            const loadingFill = taskGroup.querySelector('.loading-fill');
            const completionMessage = taskGroup.querySelector('.completion-message');
            const taskName = taskGroup.querySelector('.task-name');
            const statusText = taskGroup.querySelector('.status-text');
            
            const dataMediaType = exportType === 'text' ? false : exportMedia;
            
            if (loadingFill.style.width === '100%' || completionMessage.classList.contains('show')) {
                resetTask(loadingFill, completionMessage, statusText);
                await new Promise(resolve => setTimeout(resolve, 300));
            }
            
            const buttons = taskGroup.querySelectorAll('.chat-button');
            buttons.forEach(btn => btn.disabled = true);
            
            loadingFill.style.opacity = '0.1';
            loadingFill.style.width = '20%';
            
            const originalTaskName = taskName.textContent;
            
            chrome.runtime.sendMessage({
                action: "startAutomation",
                numberOfChats,
                includeMedia: dataMediaType
            });
            
            const messageHandler = createMessageHandler(loadingFill, completionMessage, buttons, taskName, statusText, originalTaskName);
            chrome.runtime.onMessage.addListener(messageHandler);
        });
    });
}

function resetTask(loadingFill, completionMessage, statusText) {
    loadingFill.style.transition = 'none';
    loadingFill.style.width = '0%';
    loadingFill.style.opacity = '0.1';
    completionMessage.classList.remove('show');
    if (statusText) statusText.textContent = '';
    loadingFill.offsetHeight;
    loadingFill.style.transition = 'all 1.5s ease';
}

function createMessageHandler(loadingFill, completionMessage, buttons, taskName, statusText, originalTaskName) {
    return (message) => {
        switch (message.action) {
            case "chatProgress":
                if (message.progress === 100) {
                    handleCompletion();
                }
                break;
            case "exportComplete":
            case "mediaDownloadComplete":
                handleCompletion();
                break;
            case "automationError":
                handleError();
                break;
        }
    };
    
    function handleCompletion() {
        loadingFill.style.width = '100%';
        loadingFill.style.opacity = '0';
        completionMessage.classList.add('show');
        playNotificationSound();
        setTimeout(resetUIState, 2000);
        chrome.runtime.onMessage.removeListener(messageHandler);
    }
    
    function handleError() {
        resetUIState();
        if (statusText) statusText.textContent = 'Error occurred. Please try again.';
        chrome.runtime.onMessage.removeListener(messageHandler);
    }
    
    function resetUIState() {
        buttons.forEach(btn => btn.disabled = false);
        taskName.textContent = originalTaskName;
        completionMessage.classList.remove('show');
        if (statusText) statusText.textContent = '';
        loadingFill.style.transition = 'none';
        loadingFill.style.width = '0%';
        loadingFill.style.opacity = '0.1';
    }
    
    function playNotificationSound() {
        const audio = document.getElementById('notificationSound');
        if (audio) {
            audio.play().catch(error => console.log('Error playing sound:', error));
        }
    }
}