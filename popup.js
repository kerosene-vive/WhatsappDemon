let availableChats = [];
const cleanupPort = chrome.runtime.connect({ name: 'cleanup' });

document.addEventListener('DOMContentLoaded', () => {
    initializeUI();
    setupEventListeners();
});

function initializeUI() {
    createLoadingOverlay();
    chrome.runtime.sendMessage({ action: 'initializeWhatsApp' });
}

function setupEventListeners() {
    const mainDownload = document.getElementById('mainDownload');
    if (mainDownload) {
        mainDownload.addEventListener('click', handleDownloadClick);
    }
}


function cleanupOverlays() {
    document.querySelectorAll('.loading-circle:not(:first-child)').forEach(el => el.remove());
    document.querySelectorAll('.loading-overlay:not(:first-child)').forEach(el => el.remove());
}

function createLoadingOverlay(needsLogin = false) {
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    safelyAddClass('.chat-selection', 'hidden');
    safelyAddClass('#mainDownload', 'hidden');
    if (needsLogin) {
        overlay.appendChild(createLoginMessage());
    } else {
        const spinner = document.createElement('div');
        spinner.className = 'loading-spinner';
        overlay.appendChild(spinner);
    }
    document.body.appendChild(overlay);
    return overlay;
}

function createLoginMessage() {
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
    return message;
}



function validateElements(elements) {
    return elements.loadingFill && elements.completionMessage && elements.statusText;
}

function needsReset(elements) {
    return elements.loadingFill.style.width === '100%' || 
           elements.completionMessage.classList.contains('show');
}

async function resetUI(elements) {
    resetTask(elements.loadingFill, elements.completionMessage, elements.statusText);
    await new Promise(resolve => setTimeout(resolve, 300));
}

function updateUIForDownload(elements) {
    document.querySelectorAll('.chat-item input').forEach(checkbox => {
        checkbox.disabled = true;
    });
    if (elements.mainContent) {
        elements.mainContent.classList.add('loading');
    }
    elements.loadingFill.style.opacity = '0.1';
    elements.loadingFill.style.width = '20%';
}

function createMessageHandler(loadingFill, completionMessage, buttons, taskName, statusText, originalTaskName) {
    let totalChatsProcessed = 0;
    return function messageHandler(message) {
        switch (message.action) {
            case "chatProgress":
                handleChatProgress(message, loadingFill, statusText, totalChatsProcessed);
                break;
                
            case "exportComplete":
                handleExportComplete(completionMessage, statusText, buttons, taskName, loadingFill, originalTaskName, messageHandler);
                break;
                
            case "automationError":
                handleAutomationError(statusText, buttons, taskName, loadingFill, originalTaskName, messageHandler);
                break;
        }
    };
}

function handleChatProgress(message, loadingFill, statusText, totalChatsProcessed) {
    if (loadingFill && typeof message.progress === 'number') {
        loadingFill.style.width = `${message.progress}%`;
    }
    if (statusText && message.chatTitle) {
        statusText.textContent = `Processing: ${message.chatTitle}`;
    }
    if (message.progress === 100) {
        totalChatsProcessed++;
    }
}


document.addEventListener('DOMContentLoaded', () => {
    initializeUI();
    setupEventListeners();
});

function initializeUI() {
    createLoadingOverlay();
    chrome.runtime.sendMessage({ action: 'initializeWhatsApp' });
}

function setupEventListeners() {
    const mainDownload = document.getElementById('mainDownload');
    if (mainDownload) {
        mainDownload.addEventListener('click', handleDownloadClick);
    }
}


function cleanupOverlays() {
    document.querySelectorAll('.loading-circle:not(:first-child)').forEach(el => el.remove());
    document.querySelectorAll('.loading-overlay:not(:first-child)').forEach(el => el.remove());
}

function createLoadingOverlay(needsLogin = false) {
    const overlay = document.createElement('div');
    overlay.className = 'loading-overlay';
    safelyAddClass('.chat-selection', 'hidden');
    safelyAddClass('#mainDownload', 'hidden');
    if (needsLogin) {
        overlay.appendChild(createLoginMessage());
    } else {
        const spinner = document.createElement('div');
        spinner.className = 'loading-spinner';
        overlay.appendChild(spinner);
    }
    document.body.appendChild(overlay);
    return overlay;
}

function createLoginMessage() {
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
    return message;
}



function validateElements(elements) {
    return elements.loadingFill && elements.completionMessage && elements.statusText;
}

function needsReset(elements) {
    return elements.loadingFill.style.width === '100%' || 
           elements.completionMessage.classList.contains('show');
}

async function resetUI(elements) {
    resetTask(elements.loadingFill, elements.completionMessage, elements.statusText);
    await new Promise(resolve => setTimeout(resolve, 300));
}

function updateUIForDownload(elements) {
    document.querySelectorAll('.chat-item input').forEach(checkbox => {
        checkbox.disabled = true;
    });
    if (elements.mainContent) {
        elements.mainContent.classList.add('loading');
    }
    elements.loadingFill.style.opacity = '0.1';
    elements.loadingFill.style.width = '20%';
}

function createMessageHandler(loadingFill, completionMessage, buttons, taskName, statusText, originalTaskName) {
    let totalChatsProcessed = 0;
    return function messageHandler(message) {
        switch (message.action) {
            case "chatProgress":
                handleChatProgress(message, loadingFill, statusText, totalChatsProcessed);
                break;
                
            case "exportComplete":
                handleExportComplete(completionMessage, statusText, buttons, taskName, loadingFill, originalTaskName, messageHandler);
                break;
                
            case "automationError":
                handleAutomationError(statusText, buttons, taskName, loadingFill, originalTaskName, messageHandler);
                break;
        }
    };
}

function handleChatProgress(message, loadingFill, statusText, totalChatsProcessed) {
    if (loadingFill && typeof message.progress === 'number') {
        loadingFill.style.width = `${message.progress}%`;
    }
    if (statusText && message.chatTitle) {
        statusText.textContent = `Processing: ${message.chatTitle}`;
    }
    if (message.progress === 100) {
        totalChatsProcessed++;
    }
}
function handleAutomationError(statusText, buttons, taskName, loadingFill, originalTaskName, messageHandler) {
    safelyRemoveClass(document.body, 'loading');
    safelyRemoveClass('.main-content', 'loading');
    
    // Reset both UIs
    document.querySelector('.date-selection')?.classList.remove('show');
    safelyRemoveClass('.chat-selection', 'hidden');
    safelyRemoveClass('#mainDownload', 'hidden');
    
    chrome.runtime.onMessage.removeListener(messageHandler);
    resetUIState(buttons, taskName, statusText, loadingFill, originalTaskName);
    
    if (statusText) {
        statusText.textContent = 'Error occurred. Please try again.';
    }
}

function handleExportComplete(completionMessage, statusText, buttons, taskName, loadingFill, originalTaskName, messageHandler) {
    // Remove loading states
    safelyRemoveClass(document.body, 'loading');
    safelyRemoveClass('.main-content', 'loading');
    
    // Reset both UIs
    document.querySelector('.date-selection')?.classList.remove('show');
    safelyRemoveClass('.chat-selection', 'hidden');
    safelyRemoveClass('#mainDownload', 'hidden');

    // Re-enable checkboxes
    document.querySelectorAll('.chat-item input').forEach(checkbox => {
        checkbox.disabled = false;
        checkbox.checked = false;
    });

    if (statusText) {
        statusText.textContent = 'All messages downloaded successfully!';
    }

    playNotificationSound();
    chrome.runtime.onMessage.removeListener(messageHandler);

    resetUIState(buttons, taskName, statusText, loadingFill, originalTaskName);
}

function safelyAddClass(selector, className) {
    const element = document.querySelector(selector);
    if (element) {
        element.classList.add(className);
    }
}

function safelyRemoveClass(selectorOrElement, className) {
    const element = typeof selectorOrElement === 'string' 
        ? document.querySelector(selectorOrElement)
        : selectorOrElement;
    if (element) {
        element.classList.remove(className);
    }
}

function resetTask(loadingFill, completionMessage, statusText) {
    if (!loadingFill || !completionMessage) return;
    loadingFill.style.transition = 'none';
    loadingFill.style.width = '0%';
    loadingFill.style.opacity = '0.1';
    completionMessage.classList.remove('show');
    if (statusText) statusText.textContent = '';
    loadingFill.offsetHeight;
    loadingFill.style.transition = 'all 1.5s ease';
}

function resetUIState(buttons, taskName, statusText, loadingFill, originalTaskName) {
    if (buttons) {
        buttons.forEach(btn => {
            if (btn) btn.disabled = false;
        });
    }
    if (taskName && originalTaskName) {
        taskName.textContent = originalTaskName;
    }
    if (statusText) {
        statusText.textContent = '';
    }
    
    // Reset checkboxes
    document.querySelectorAll('.chat-item input').forEach(checkbox => {
        checkbox.disabled = false;
        checkbox.checked = false;
    });
    
    // Reset loading bar
    if (loadingFill) {
        loadingFill.style.transition = 'none';
        loadingFill.style.width = '0%';
        loadingFill.style.opacity = '0.1';
        loadingFill.offsetHeight;
        loadingFill.style.transition = 'all 1.5s ease';
    }
    
    // Reset UIs
    document.querySelector('.date-selection')?.classList.remove('show');
    safelyRemoveClass('.chat-selection', 'hidden');
    safelyRemoveClass('#mainDownload', 'hidden');
}

function playNotificationSound() {
    const audio = document.getElementById('notificationSound');
    if (audio) {
        audio.play().catch(error => console.log('Error playing sound:', error));
    }
}

chrome.runtime.onMessage.addListener((message) => {
    switch (message.action) {
        case 'whatsappReady':
            handleWhatsAppReady();
            break;
        case 'chatsAvailable':
            handleChatsAvailable(message.chats);
            break;
        case 'whatsappClosed':
            location.reload();
            break;
        case 'whatsappLoginRequired':
            handleLoginRequired();
            break;
    }
});

function handleWhatsAppReady() {
    document.querySelector('.loading-overlay')?.remove();
    createLoadingOverlay(false);
    chrome.runtime.sendMessage({ action: 'getChats' }, response => {
        if (response.chats) {
            availableChats = response.chats;
            updateChatSelection();
        }
    });
}

function handleChatsAvailable(chats) {
    availableChats = chats;
    updateChatSelection();
    document.querySelector('.loading-overlay')?.remove();
}

function handleLoginRequired() {
    document.querySelector('.loading-overlay')?.remove();
    createLoadingOverlay(true);
}

function updateChatSelection() {
    const container = document.querySelector('.chat-selection') || createChatSelectionUI();
    container.innerHTML = availableChats.map(chat => `
        <div class="chat-item">
            <input type="checkbox" id="${chat}" value="${chat}">
            <label for="${chat}">${chat}</label>
        </div>
    `).join('');
    
    document.querySelector('.loading-overlay')?.remove();
    safelyRemoveClass('.chat-selection', 'hidden');
    safelyRemoveClass('#mainDownload', 'hidden');
}

function createChatSelectionUI() {
    const container = document.createElement('div');
    container.className = 'chat-selection';
    document.querySelector('.main-content')?.appendChild(container);
    return container;
}

function createDateSelectionUI() {
    const dateSelection = document.createElement('div');
    dateSelection.className = 'date-selection';
    dateSelection.innerHTML = `
        <div class="date-selection-content">
            <h3>Select Date Range</h3>
            <div class="date-field">
                <label for="startDate">From:</label>
                <input type="date" id="startDate" required>
            </div>
            <div class="date-field">
                <label for="endDate">To:</label>
                <input type="date" id="endDate" required>
            </div>
            <div class="date-actions">
                <button class="confirm-dates">Start Export</button>
                <button class="cancel-dates">Back</button>
            </div>
        </div>
    `;
    
    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
        mainContent.appendChild(dateSelection);
    }
    
    setupDateSelectionListeners(dateSelection);
    return dateSelection;
}

function setupDateSelectionListeners(dateSelection) {
    const confirmBtn = dateSelection.querySelector('.confirm-dates');
    const cancelBtn = dateSelection.querySelector('.cancel-dates');
    const startDate = dateSelection.querySelector('#startDate');
    const endDate = dateSelection.querySelector('#endDate');

    confirmBtn.addEventListener('click', () => {
        if (!startDate.value || !endDate.value) {
            alert('Please select both start and end dates');
            return;
        }

        const selectedChats = [...document.querySelectorAll('.chat-item input:checked')]
            .map(input => input.value);

        dateSelection.classList.remove('show');
        document.body.classList.add('loading');
        
        startMessageDownload(selectedChats, {
            startDate: startDate.value,
            endDate: endDate.value
        });
    });

    cancelBtn.addEventListener('click', () => {
        dateSelection.classList.remove('show');
        document.querySelector('.chat-selection')?.classList.remove('hidden');
        document.querySelector('#mainDownload')?.classList.remove('hidden');
    });
}

function handleDownloadClick() {
    const selectedChats = [...document.querySelectorAll('.chat-item input:checked')]
        .map(input => input.value);
    if (!selectedChats.length) {
        alert('Please select at least one chat');
        return;
    }

    let dateSelection = document.querySelector('.date-selection');
    if (!dateSelection) {
        dateSelection = createDateSelectionUI();
    }

    document.querySelector('.chat-selection')?.classList.add('hidden');
    document.querySelector('#mainDownload')?.classList.add('hidden');
    dateSelection.classList.add('show');
}

async function startMessageDownload(selectedChats, dateRange) {
    const elements = {
        loadingFill: document.querySelector('.loading-fill'),
        completionMessage: document.querySelector('.completion-message'),
        statusText: document.querySelector('.status-text'),
        mainContent: document.querySelector('.main-content')
    };

    if (!validateElements(elements)) {
        console.error('Required UI elements not found');
        return;
    }

    if (needsReset(elements)) {
        await resetUI(elements);
    }

    updateUIForDownload(elements);
    
    chrome.runtime.sendMessage({
        action: "startAutomation",
        selectedChats,
        startDate: dateRange?.startDate,
        endDate: dateRange?.endDate,
        includeMedia: false
    });

    const messageHandler = createMessageHandler(
        elements.loadingFill,
        elements.completionMessage,
        [],
        null,
        elements.statusText,
        ''
    );
    
    chrome.runtime.onMessage.addListener(messageHandler);
}

function handleAutomationError(statusText, buttons, taskName, loadingFill, originalTaskName, messageHandler) {
    safelyRemoveClass(document.body, 'loading');
    safelyRemoveClass('.main-content', 'loading');
    chrome.runtime.onMessage.removeListener(messageHandler);
    resetUIState(buttons, taskName, statusText, loadingFill, originalTaskName);
    if (statusText) {
        statusText.textContent = 'Error occurred. Please try again.';
    }
}

function safelyAddClass(selector, className) {
    const element = document.querySelector(selector);
    if (element) {
        element.classList.add(className);
    }
}

function safelyRemoveClass(selectorOrElement, className) {
    const element = typeof selectorOrElement === 'string' 
        ? document.querySelector(selectorOrElement)
        : selectorOrElement;
    if (element) {
        element.classList.remove(className);
    }
}

function resetTask(loadingFill, completionMessage, statusText) {
    if (!loadingFill || !completionMessage) return;
    loadingFill.style.transition = 'none';
    loadingFill.style.width = '0%';
    loadingFill.style.opacity = '0.1';
    completionMessage.classList.remove('show');
    if (statusText) statusText.textContent = '';
    loadingFill.offsetHeight;
    loadingFill.style.transition = 'all 1.5s ease';
}

function resetUIState(buttons, taskName, statusText, loadingFill, originalTaskName) {
    if (buttons) {
        buttons.forEach(btn => {
            if (btn) btn.disabled = false;
        });
    }
    if (taskName && originalTaskName) {
        taskName.textContent = originalTaskName;
    }
    if (statusText) {
        statusText.textContent = '';
    }
    document.querySelectorAll('.chat-item input').forEach(checkbox => {
        checkbox.disabled = false;
    });
    if (loadingFill) {
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

chrome.runtime.onMessage.addListener((message) => {
    switch (message.action) {
        case 'whatsappReady':
            handleWhatsAppReady();
            break;
        case 'chatsAvailable':
            handleChatsAvailable(message.chats);
            break;
        case 'whatsappClosed':
            location.reload();
            break;
        case 'whatsappLoginRequired':
            handleLoginRequired();
            break;
    }
});

function handleWhatsAppReady() {
    document.querySelector('.loading-overlay')?.remove();
    createLoadingOverlay(false);
    chrome.runtime.sendMessage({ action: 'getChats' }, response => {
        if (response.chats) {
            availableChats = response.chats;
            updateChatSelection();
        }
    });
}

function handleChatsAvailable(chats) {
    availableChats = chats;
    updateChatSelection();
    document.querySelector('.loading-overlay')?.remove();
}

function handleLoginRequired() {
    document.querySelector('.loading-overlay')?.remove();
    createLoadingOverlay(true);
}

function updateChatSelection() {
    const container = document.querySelector('.chat-selection') || createChatSelectionUI();
    container.innerHTML = availableChats.map(chat => `
        <div class="chat-item">
            <input type="checkbox" id="${chat}" value="${chat}">
            <label for="${chat}">${chat}</label>
        </div>
    `).join('');
    
    document.querySelector('.loading-overlay')?.remove();
    safelyRemoveClass('.chat-selection', 'hidden');
    safelyRemoveClass('#mainDownload', 'hidden');
}

function createChatSelectionUI() {
    const container = document.createElement('div');
    container.className = 'chat-selection';
    document.querySelector('.main-content')?.appendChild(container);
    return container;
}

// Add this function to create the date selection UI
function createDateSelectionUI() {
    const dateSelection = document.createElement('div');
    dateSelection.className = 'date-selection';
    dateSelection.innerHTML = `
        <div class="date-selection-content">
            <h3>Select Date Range</h3>
            <div class="date-field">
                <label for="startDate">From:</label>
                <input type="date" id="startDate" required>
            </div>
            <div class="date-field">
                <label for="endDate">To:</label>
                <input type="date" id="endDate" required>
            </div>
            <div class="date-actions">
                <button class="confirm-dates">Start Export</button>
                <button class="cancel-dates">Back</button>
            </div>
        </div>
    `;
    
    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
        mainContent.appendChild(dateSelection);
    }
    
    setupDateSelectionListeners(dateSelection);
    return dateSelection;
}

// Add this function to handle date selection listeners
function setupDateSelectionListeners(dateSelection) {
    const confirmBtn = dateSelection.querySelector('.confirm-dates');
    const cancelBtn = dateSelection.querySelector('.cancel-dates');
    const startDate = dateSelection.querySelector('#startDate');
    const endDate = dateSelection.querySelector('#endDate');

    confirmBtn.addEventListener('click', () => {
        if (!startDate.value || !endDate.value) {
            alert('Please select both start and end dates');
            return;
        }

        const selectedChats = [...document.querySelectorAll('.chat-item input:checked')]
            .map(input => input.value);

        dateSelection.classList.remove('show');
        document.body.classList.add('loading');
        
        startMessageDownload(selectedChats, {
            startDate: startDate.value,
            endDate: endDate.value
        });
    });

    cancelBtn.addEventListener('click', () => {
        dateSelection.classList.remove('show');
        document.querySelector('.chat-selection')?.classList.remove('hidden');
        document.querySelector('#mainDownload')?.classList.remove('hidden');
    });
}

// Modify your handleDownloadClick function
function handleDownloadClick() {
    const selectedChats = [...document.querySelectorAll('.chat-item input:checked')]
        .map(input => input.value);
    if (!selectedChats.length) {
        alert('Please select at least one chat');
        return;
    }

    let dateSelection = document.querySelector('.date-selection');
    if (!dateSelection) {
        dateSelection = createDateSelectionUI();
    }

    document.querySelector('.chat-selection')?.classList.add('hidden');
    document.querySelector('#mainDownload')?.classList.add('hidden');
    dateSelection.classList.add('show');
}

// Modify your startMessageDownload function
async function startMessageDownload(selectedChats, dateRange) {
    const elements = {
        loadingFill: document.querySelector('.loading-fill'),
        completionMessage: document.querySelector('.completion-message'),
        statusText: document.querySelector('.status-text'),
        mainContent: document.querySelector('.main-content')
    };

    if (!validateElements(elements)) {
        console.error('Required UI elements not found');
        return;
    }

    if (needsReset(elements)) {
        await resetUI(elements);
    }

    updateUIForDownload(elements);
    
    chrome.runtime.sendMessage({
        action: "startAutomation",
        selectedChats,
        startDate: dateRange?.startDate,
        endDate: dateRange?.endDate,
        includeMedia: false
    });

    const messageHandler = createMessageHandler(
        elements.loadingFill,
        elements.completionMessage,
        [],
        null,
        elements.statusText,
        ''
    );
    
    chrome.runtime.onMessage.addListener(messageHandler);
}