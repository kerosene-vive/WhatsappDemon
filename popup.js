let availableChats = [];
const cleanupPort = chrome.runtime.connect({ name: 'cleanup' });

document.addEventListener('DOMContentLoaded', () => {
    chrome.runtime.sendMessage({ action: 'initializeWhatsApp' });
    
    const mainDownload = document.getElementById('mainDownload');
    mainDownload.addEventListener('click', () => {
        document.body.classList.add('loading');
        const loadingCircle = document.createElement('div');
loadingCircle.className = 'loading-circle';
document.querySelector('.main-content').appendChild(loadingCircle);
        const loadingOverlay = document.createElement('div');
        loadingOverlay.className = 'loading-overlay';
        document.querySelector('.main-content').appendChild(loadingOverlay);
        document.querySelector('.main-content').classList.add('loading');
        const taskType = document.getElementById('taskType').value;
        if (taskType) {
            const targetButton = document.querySelector(`#${taskType}-export .chat-button`);
            if (targetButton) targetButton.click();
        }
    });
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
            buttons.forEach(btn => {
                btn.disabled = true;
                btn.style.pointerEvents = 'none';
            });
            document.querySelectorAll('.chat-item input').forEach(checkbox => {
                checkbox.disabled = true;
            });
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
    let totalChatsProcessed = 0;
    const totalMediaItems = new Map();
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
            case "mediaProgress":
                if (message.chat && typeof message.mediaCount === 'number') {
                    totalMediaItems.set(message.chat, message.mediaCount);
                }
                if (statusText && message.chat) {
                    const totalItemsForChat = totalMediaItems.get(message.chat) || 0;
                    statusText.textContent = `Processing ${message.chat}: ${message.mediaCount}/${totalItemsForChat} items`;
                }
                loadingFill.style.width = `${message.progress}%`;
                break;
            case "exportComplete":
            case "mediaDownloadComplete":
                document.body.classList.remove('loading');
    document.querySelector('.main-content').classList.remove('loading');
    document.querySelector('.loading-overlay')?.remove();


                document.querySelector('.loading-overlay')?.remove();
                completionMessage.classList.add('show');
                if (statusText) {
                    const totalMediaCount = Array.from(totalMediaItems.values()).reduce((sum, count) => sum + count, 0);
                    statusText.textContent = totalMediaCount > 0 ? 
                        `Completed! Downloaded ${totalMediaCount} items` : 
                        'All items processed successfully!';
                }
                playNotificationSound();
                chrome.runtime.onMessage.removeListener(messageHandler);
                setTimeout(() => {
                    resetUIState();
                    buttons.forEach(btn => {
                        btn.disabled = false;
                        btn.style.pointerEvents = 'auto';
                    });
                    document.querySelectorAll('.chat-item input').forEach(checkbox => {
                        checkbox.disabled = false;
                    });
                    completionMessage.classList.remove('show');
                    loadingFill.style.opacity = '0.1';
                    loadingFill.style.width = '0%';
                }, 2000);
                break;
            case "automationError":
                chrome.runtime.onMessage.removeListener(messageHandler);
                resetUIState();
                if (statusText) {
                    statusText.textContent = 'Error occurred. Please try again.';
                }
                buttons.forEach(btn => {
                    btn.disabled = false;
                    btn.style.pointerEvents = 'auto';
                });
                document.querySelectorAll('.chat-item input').forEach(checkbox => {
                    checkbox.disabled = false;
                });
                break;
        }
};

function resetUIState() {
        buttons.forEach(btn => btn.disabled = false);
        taskName.textContent = originalTaskName;
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
}

function playNotificationSound() {
        const audio = document.getElementById('notificationSound');
        if (audio) {
            audio.play().catch(error => console.log('Error playing sound:', error));
        }
}

