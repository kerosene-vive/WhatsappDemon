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
            
            // Disable buttons and checkboxes during processing
            const buttons = taskGroup.querySelectorAll('.chat-button');
            buttons.forEach(btn => {
                btn.disabled = true;
                btn.style.pointerEvents = 'none'; // Prevent clicking during process
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
    const totalMediaItems = new Map(); // Track media items per chat
    
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
                // Track media items for this chat
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
                loadingFill.style.width = '100%';
                loadingFill.style.opacity = '0';
                completionMessage.classList.add('show');
                if (statusText) {
                    const totalMediaCount = Array.from(totalMediaItems.values()).reduce((sum, count) => sum + count, 0);
                    statusText.textContent = totalMediaCount > 0 ? 
                        `Completed! Downloaded ${totalMediaCount} items` : 
                        'All items processed successfully!';
                }
                playNotificationSound();
                
                // Remove the message handler first
                chrome.runtime.onMessage.removeListener(messageHandler);
                
                // Reset the UI state after a delay
                setTimeout(() => {
                    resetUIState();
                    // Re-enable buttons and clear completion state
                    buttons.forEach(btn => {
                        btn.disabled = false;
                        btn.style.pointerEvents = 'auto'; // Ensure buttons are clickable
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
                // Re-enable everything immediately on error
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
        // Ensure all checkboxes are enabled
        document.querySelectorAll('.chat-item input').forEach(checkbox => {
            checkbox.disabled = false;
        });
        loadingFill.style.transition = 'none';
        loadingFill.style.width = '0%';
        loadingFill.style.opacity = '0.1';
        loadingFill.offsetHeight; // Force reflow
        loadingFill.style.transition = 'all 1.5s ease';
    }
}
function playNotificationSound() {
        const audio = document.getElementById('notificationSound');
        if (audio) {
            audio.play().catch(error => console.log('Error playing sound:', error));
        }
}

