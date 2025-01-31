let availableChats = [];

document.addEventListener('DOMContentLoaded', () => {
    chrome.runtime.sendMessage({ action: 'initializeWhatsApp' });
});

chrome.runtime.onMessage.addListener((message) => {
    switch (message.action) {
        case 'whatsappReady':
            chrome.runtime.sendMessage({ action: 'getChats' }, response => {
                if (response.chats) {
                    availableChats = response.chats;
                    updateChatSelection();
                }
            });
            break;
        case 'chatsAvailable':
            availableChats = message.chats;
            updateChatSelection();
            break;
        case 'whatsappClosed':
            location.reload();
            break;
    }
});

function updateChatSelection() {
    const container = document.querySelector('.chat-selection') || createChatSelectionUI();
    container.innerHTML = availableChats.map(chat => `
        <div class="chat-item">
            <input type="checkbox" id="${chat}" value="${chat}">
            <label for="${chat}">${chat}</label>
        </div>
    `).join('');
    document.querySelector('.loading-overlay')?.remove();
    initializeButtons();
}

function createChatSelectionUI() {
    const container = document.createElement('div');
    container.className = 'chat-selection';
    document.querySelector('.task-groups').prepend(container);
    return container;
}




const cleanupPort = chrome.runtime.connect({ name: 'cleanup' });



function initializeButtons() {
    document.querySelectorAll('.chat-button:not(.disabled)').forEach(button => {
        button.addEventListener('click', async function() {
          const selectedChats = [...document.querySelectorAll('.chat-item input:checked')].map(input => input.value);
          if (!selectedChats.length) {
              alert('Please select at least one chat');
              return;
          }

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
              selectedChats,
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