let availableChats = [];
const cleanupPort = chrome.runtime.connect({ name: 'cleanup' });


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

// UI Overlay Functions
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

// Chat Selection Functions
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

// Date Selection Functions
function createDateSelectionUI() {
    const dateSelection = document.createElement('div');
    dateSelection.className = 'date-selection';
    
    dateSelection.innerHTML = `
        <div class="date-selection-content">
            <h3>Select Date Range</h3>
            <div class="date-field">
                <label>From:</label>
                <div class="month-year-select">
                    <select id="startMonth" required>
                        ${generateMonthOptions()}
                    </select>
                    <select id="startYear" required>
                        ${generateYearOptions()}
                    </select>
                </div>
            </div>
            <div class="date-field">
                <label>To:</label>
                <div class="month-year-select">
                    <select id="endMonth" required>
                        ${generateMonthOptions()}
                    </select>
                    <select id="endYear" required>
                        ${generateYearOptions()}
                    </select>
                </div>
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
    
    setDefaultDateValues(dateSelection);
    setupDateSelectionListeners(dateSelection);
    return dateSelection;
}

function generateMonthOptions() {
    const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return months.map((month, index) => 
        `<option value="${index + 1}">${month}</option>`
    ).join('');
}

function generateYearOptions() {
    const currentYear = new Date().getFullYear();
    const startYear = 2009;
    let options = '';
    for (let year = currentYear; year >= startYear; year--) {
        options += `<option value="${year}">${year}</option>`;
    }
    return options;
}

function setDefaultDateValues(dateSelection) {
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();
    
    const endMonth = dateSelection.querySelector('#endMonth');
    const endYear = dateSelection.querySelector('#endYear');
    const startMonth = dateSelection.querySelector('#startMonth');
    const startYear = dateSelection.querySelector('#startYear');
    
    endMonth.value = currentMonth.toString();
    endYear.value = currentYear.toString();
    
    if (currentMonth === 1) {
        startMonth.value = "12";
        startYear.value = (currentYear - 1).toString();
    } else {
        startMonth.value = (currentMonth - 1).toString();
        startYear.value = currentYear.toString();
    }
}

function setupDateSelectionListeners(dateSelection) {
    const confirmBtn = dateSelection.querySelector('.confirm-dates');
    const cancelBtn = dateSelection.querySelector('.cancel-dates');
    
    const startMonth = dateSelection.querySelector('#startMonth');
    const startYear = dateSelection.querySelector('#startYear');
    const endMonth = dateSelection.querySelector('#endMonth');
    const endYear = dateSelection.querySelector('#endYear');

    confirmBtn.addEventListener('click', () => {
        try {
            const startDate = getFirstDayOfMonth(
                parseInt(startYear.value),
                parseInt(startMonth.value)
            );
            const endDate = getLastDayOfMonth(
                parseInt(endYear.value),
                parseInt(endMonth.value)
            );
            
            if (!isValidDate(startDate) || !isValidDate(endDate)) {
                alert('Invalid date selection');
                return;
            }
            
            if (startDate > endDate) {
                alert('Start date cannot be after end date');
                return;
            }

            const selectedChats = [...document.querySelectorAll('.chat-item input:checked')]
                .map(input => input.value);

            dateSelection.classList.remove('show');
            document.body.classList.add('loading');
            
            const formattedStartDate = formatDateForAPI(startDate);
            const formattedEndDate = formatDateForAPI(endDate);
            
            startMessageDownload(selectedChats, {
                startDate: formattedStartDate,
                endDate: formattedEndDate,
                displayRange: {
                    start: startDate.toLocaleDateString(),
                    end: endDate.toLocaleDateString()
                }
            });
        } catch (error) {
            console.error('Date processing error:', error);
            alert('Error processing dates. Please try again.');
        }
    });

    [startMonth, startYear, endMonth, endYear].forEach(element => {
        element.addEventListener('change', () => {
            validateDateRange(startMonth, startYear, endMonth, endYear, confirmBtn);
        });
    });

    cancelBtn.addEventListener('click', () => {
        dateSelection.classList.remove('show');
        document.querySelector('.chat-selection')?.classList.remove('hidden');
        document.querySelector('#mainDownload')?.classList.remove('hidden');
    });
}

// Date Utility Functions
function isValidDate(date) {
    return date instanceof Date && !isNaN(date);
}

function validateDateRange(startMonth, startYear, endMonth, endYear, confirmBtn) {
    try {
        const start = new Date(startYear.value, startMonth.value - 1);
        const end = new Date(endYear.value, endMonth.value - 1);
        
        if (!isValidDate(start) || !isValidDate(end)) {
            confirmBtn.disabled = true;
            return;
        }
        
        if (start > end) {
            confirmBtn.disabled = true;
            alert('Start date cannot be after end date');
        } else {
            confirmBtn.disabled = false;
        }
    } catch (error) {
        console.error('Date validation error:', error);
        confirmBtn.disabled = true;
    }
}

function getFirstDayOfMonth(year, month) {
    const date = new Date(year, month - 1, 1);
    if (!isValidDate(date)) {
        throw new Error('Invalid date created');
    }
    return date;
}

function getLastDayOfMonth(year, month) {
    const date = new Date(year, month, 0);
    if (!isValidDate(date)) {
        throw new Error('Invalid date created');
    }
    return date;
}

function formatDateForAPI(date) {
    if (!isValidDate(date)) {
        throw new Error('Invalid date for API formatting');
    }
    
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// Message Handling
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
    safelyRemoveClass(document.body, 'loading');
    safelyRemoveClass('.main-content', 'loading');
    
    document.querySelector('.date-selection')?.classList.remove('show');
    safelyRemoveClass('.chat-selection', 'hidden');
    safelyRemoveClass('#mainDownload', 'hidden');

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

// UI Utility Functions
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

// ... [Previous code remains the same until resetUIState function]

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
        checkbox.checked = false;
    });
    
    if (loadingFill) {
        loadingFill.style.transition = 'none';
        loadingFill.style.width = '0%';
        loadingFill.style.opacity = '0.1';
        loadingFill.offsetHeight;
        loadingFill.style.transition = 'all 1.5s ease';
    }
    
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

// Message Listeners
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

// Download Functions
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
    
    // Send the automation request with date range
    chrome.runtime.sendMessage({
        action: "startAutomation",
        selectedChats,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        displayRange: dateRange.displayRange,
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

// UI Validation Functions
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

// Cleanup on unload
window.addEventListener('unload', () => {
    cleanupPort.disconnect();
});

// Initialize when popup loads
document.addEventListener('DOMContentLoaded', () => {
    initializeUI();
    setupEventListeners();
});