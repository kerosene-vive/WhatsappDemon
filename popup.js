let availableChats = [];
const cleanupPort = chrome.runtime.connect({ name: 'cleanup' });

function createLoadingOverlay(needsLogin = false) {
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    
    document.querySelector('.chat-selection')?.classList.add('hidden');
    document.querySelector('#mainDownload')?.classList.add('hidden');
    
    if (needsLogin) {
        const message = document.createElement('div');
        message.className = 'login-message';
        message.innerHTML = `
            <div class="back-arrow">←</div>
            <h2>Please Log Into WhatsApp</h2>
            <p>Open WhatsApp on your phone:</p>
            <ol>
                <li>Tap Menu or Settings</li>
                <li>Select Linked Devices</li>
                <li>Scan the QR code</li>
            </ol>
        `;
        overlay.appendChild(message);
    } else {
        const spinner = document.createElement('div');
        spinner.className = 'loading-spinner';
        overlay.appendChild(spinner);
    }
    
    document.body.appendChild(overlay);
    return overlay;
}

document.addEventListener('DOMContentLoaded', () => {
    const loadingOverlay = createLoadingOverlay();
    chrome.runtime.sendMessage({ action: 'initializeWhatsApp' });
    
    const mainDownload = document.getElementById('mainDownload');
    mainDownload.addEventListener('click', () => {
        const selectedChats = [...document.querySelectorAll('.chat-item input:checked')].map(input => input.value);
        if (!selectedChats.length) {
            alert('Please select at least one chat');
            return;
        }

        document.body.classList.add('loading');
        const loadingCircle = document.createElement('div');
        loadingCircle.className = 'loading-circle';
        document.querySelector('.main-content').appendChild(loadingCircle);
        
        const loadingOverlay = document.createElement('div');
        loadingOverlay.className = 'loading-overlay';
        document.querySelector('.main-content').appendChild(loadingOverlay);
        document.querySelector('.main-content').classList.add('loading');

        startMessageDownload(selectedChats);
    });
});

async function startMessageDownload(selectedChats) {
    const taskGroup = document.getElementById('text-export');
    const loadingFill = taskGroup.querySelector('.loading-fill');
    const completionMessage = taskGroup.querySelector('.completion-message');
    const statusText = taskGroup.querySelector('.status-text');

    if (loadingFill.style.width === '100%' || completionMessage.classList.contains('show')) {
        resetTask(loadingFill, completionMessage, statusText);
        await new Promise(resolve => setTimeout(resolve, 300));
    }

    document.querySelectorAll('.chat-item input').forEach(checkbox => {
        checkbox.disabled = true;
    });

    loadingFill.style.opacity = '0.1';
    loadingFill.style.width = '20%';

    chrome.runtime.sendMessage({
        action: "startAutomation",
        selectedChats,
        includeMedia: false
    });

    const messageHandler = createMessageHandler(loadingFill, completionMessage, [], null, statusText, '');
    chrome.runtime.onMessage.addListener(messageHandler);
}

chrome.runtime.onMessage.addListener((message) => {
    switch (message.action) {
        case 'whatsappReady':
            document.querySelector('.loading-overlay')?.remove();
            createLoadingOverlay(false);

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
            document.querySelector('.loading-overlay')?.remove();
            break;
        case 'whatsappClosed':
            location.reload();
            break;
        case 'whatsappLoginRequired':
            document.querySelector('.loading-overlay')?.remove();
            createLoadingOverlay(true);
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
    
    document.querySelector('.chat-selection')?.classList.remove('hidden');
    document.querySelector('#mainDownload')?.classList.remove('hidden');
}

function createChatSelectionUI() {
    const container = document.createElement('div');
    container.className = 'chat-selection';
    document.querySelector('.main-content').appendChild(container);
    return container;
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
    let totalChatsProcessed = 0;
    return function messageHandler(message) {
        switch (message.action) {
            case "chatProgress":
                loadingFill.style.width = `${message.progress}%`;
                if (statusText && message.chatTitle) {
                    statusText.textContent = `Processing: ${message.chatTitle}`;
                }
                if (message.progress === 100) {
                    totalChatsProcessed++;
                }
                break;
            case "exportComplete":
                document.body.classList.remove('loading');
                document.querySelector('.main-content').classList.remove('loading');
                document.querySelector('.loading-overlay')?.remove();
                
                completionMessage.classList.add('show');
                if (statusText) {
                    statusText.textContent = 'All messages downloaded successfully!';
                }
                playNotificationSound();
                chrome.runtime.onMessage.removeListener(messageHandler);
                
                setTimeout(() => {
                    resetUIState(buttons, taskName, statusText, loadingFill, originalTaskName);
                    document.querySelectorAll('.chat-item input').forEach(checkbox => {
                        checkbox.disabled = false;
                    });
                    completionMessage.classList.remove('show');
                }, 2000);
                break;
            case "automationError":
                chrome.runtime.onMessage.removeListener(messageHandler);
                resetUIState(buttons, taskName, statusText, loadingFill, originalTaskName);
                if (statusText) {
                    statusText.textContent = 'Error occurred. Please try again.';
                }
                document.querySelectorAll('.chat-item input').forEach(checkbox => {
                    checkbox.disabled = false;
                });
                break;
        }
    };
}

function resetUIState(buttons, taskName, statusText, loadingFill, originalTaskName) {
    if (buttons) {
        buttons.forEach(btn => btn.disabled = false);
    }
    if (taskName) {
        taskName.textContent = originalTaskName;
    }
    if (statusText) {
        statusText.textContent = '';
    }
    document.querySelectorAll('.chat-item input').forEach(checkbox => {
        checkbox.disabled = false;
    });
    loadingFill.style.transition = 'none';
    loadingFill.style.width = '0%';
    loadingFill.style.opacity = '0.1';
    loadingFill.offsetHeight;
    loadingFill.style.transition = 'all 1.5s ease';
}

function playNotificationSound() {
    const audio = document.getElementById('notificationSound');
    if (audio) {
        audio.play().catch(error => console.log('Error playing sound:', error));
    }
}