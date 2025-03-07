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

function showPhoneRequirementDisclaimer(selectedTimeRange) {
    if (selectedTimeRange !== '6month' && selectedTimeRange !== 'year') {
      return Promise.resolve(true);
    }
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.style.position = 'fixed';
      overlay.style.top = '0';
      overlay.style.left = '0';
      overlay.style.width = '100%';
      overlay.style.height = '100%';
      overlay.style.backgroundColor = 'rgba(0,0,0,0.7)';
      overlay.style.zIndex = '9999';
      overlay.style.display = 'flex';
      overlay.style.alignItems = 'center';
      overlay.style.justifyContent = 'center';
      const box = document.createElement('div');
      box.style.backgroundColor = 'white';
      box.style.padding = '20px';
      box.style.borderRadius = '8px';
      box.style.maxWidth = '400px';
      box.style.textAlign = 'left';
      box.innerHTML = `
        <h3 style="color:#075E54;margin-top:0;font-size:18px">⚠️ Keep WhatsApp Open on Your Phone</h3>
        <div style="text-align:right;margin-top:20px">
          <button id="cancel-disclaimer" style="background:#f1f1f1;border:none;padding:10px 18px;margin-right:10px;border-radius:4px;cursor:pointer;font-size:16px">Cancel</button>
          <button id="confirm-disclaimer" style="background:#128C7E;color:white;border:none;padding:10px 18px;border-radius:4px;cursor:pointer;font-size:16px">I Understand</button>
        </div>
      `;
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      document.getElementById('cancel-disclaimer').addEventListener('click', () => {
        document.body.removeChild(overlay);
        resolve(false);
      });
      document.getElementById('confirm-disclaimer').addEventListener('click', () => {
        document.body.removeChild(overlay);
        resolve(true);
      });
    });
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


function isValidDate(date) {
    return date instanceof Date && !isNaN(date);
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

function createDateSelectionUI() {
    const dateSelection = document.createElement('div');
    dateSelection.className = 'date-selection';
    
    // Simplified HTML without the bottom labels
    dateSelection.innerHTML = `
        <div class="date-selection-content">
            <h3 class="time-range-title">Time Range</h3>
            <div class="month-value-display">Months: <span id="monthValue">1</span></div>
            <div class="half-circle-container">
                <div class="half-circle-track">
                    <div class="half-circle-fill"></div>
                </div>
                <div class="half-circle-thumb"></div>
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
    
    setupHalfCircleSlider(dateSelection);
    setupDateSelectionListeners(dateSelection);
    
    return dateSelection;
}

function setupHalfCircleSlider(dateSelection) {
    const container = dateSelection.querySelector('.half-circle-track');
    const thumb = dateSelection.querySelector('.half-circle-thumb');
    const fill = dateSelection.querySelector('.half-circle-fill');
    const monthValue = dateSelection.querySelector('#monthValue');
    let currentValue = 1; // Start at 1 month
    const maxValue = 12;
    const minValue = 1;
    
    // Force immediate rendering before setting position
    setTimeout(() => {
        setSliderToValue(1);
    }, 0);
    
    function setSliderToValue(value) {
        currentValue = value;
        monthValue.textContent = value;
        
        // Calculate percentage based on value (1=0%, 12=100%)
        const percentage = ((value - minValue) / (maxValue - minValue)) * 100;
        
        // Position the thumb using the percentage
        positionThumbAtPercentage(percentage);
    }
    
    function positionThumbAtPercentage(percentage) {
        // Convert percentage to radians (0% = PI, 100% = 0)
        const radians = (1 - percentage / 100) * Math.PI;
        
        // Calculate position
        const radius = (container.offsetWidth / 2) - 15;
        const centerX = container.offsetWidth / 2;
        const centerY = container.offsetHeight;
        
        const x = centerX + radius * Math.cos(radians);
        const y = centerY - radius * Math.sin(radians);
        
        // Position the thumb
        thumb.style.left = `${x}px`;
        thumb.style.top = `${y}px`;
        
        // Update the fill with the fixed function
        updateFill(x, y, centerX, centerY, radius);
    }
    
    function updateFill(x, y, centerX, centerY, radius) {
        const angle = Math.atan2(centerY - y, x - centerX);
    
        // Create the SVG path for a clean arc
        const startX = centerX - radius; // Left edge
        const startY = centerY;
        
        // Use the SVG arc command to create a perfect semi-circle slice
        fill.style.clipPath = `path('M ${centerX} ${centerY} L ${startX} ${startY} A ${radius} ${radius} 0 0 1 ${x} ${y} Z')`;
    }
    
    // Event handlers for dragging
    let isDragging = false;
    
    thumb.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isDragging = true;
    });
    
    container.addEventListener('mousedown', (e) => {
        e.preventDefault();
        isDragging = true;
        updatePositionFromEvent(e);
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        e.preventDefault();
        updatePositionFromEvent(e);
    });
    
    document.addEventListener('mouseup', () => {
        isDragging = false;
    });
    
    // Touch support
    thumb.addEventListener('touchstart', (e) => {
        e.preventDefault();
        isDragging = true;
    });
    
    container.addEventListener('touchstart', (e) => {
        e.preventDefault();
        isDragging = true;
        updatePositionFromEvent(e);
    });
    
    document.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        e.preventDefault();
        updatePositionFromEvent(e);
    });
    
    document.addEventListener('touchend', () => {
        isDragging = false;
    });
    
    function updatePositionFromEvent(e) {
        const rect = container.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height;
        
        // Get position
        const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
        const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
        
        const x = clientX - rect.left - centerX;
        const y = centerY - (clientY - rect.top);
        
        // Calculate angle
        let angle = Math.atan2(y, x);
        
        // Handle positions below the center line
        if (y < 0) {
            if (x < 0) {
                angle = 0; // Force to leftmost position (1 month)
            } else {
                angle = Math.PI; // Force to rightmost position (12 months)
            }
        }
        
        // Constrain angle
        angle = Math.max(0, Math.min(Math.PI, angle));
        
        // Deadzone at extremes
        if (angle < 0.1) angle = 0;
        if (angle > Math.PI - 0.1) angle = Math.PI;
        
        // Convert to percentage
        const percentage = (1 - (angle / Math.PI)) * 100;
        
        // Calculate value
        const newValue = Math.max(minValue, Math.min(maxValue, 
                          Math.round(minValue + (percentage / 100) * (maxValue - minValue))));
        
        if (newValue !== currentValue) {
            setSliderToValue(newValue);
        }
    }
    
    // Function to get the current value
    container.getValue = function() {
        return currentValue;
    };
}

function setupDateSelectionListeners(dateSelection) {
    const confirmBtn = dateSelection.querySelector('.confirm-dates');
    const cancelBtn = dateSelection.querySelector('.cancel-dates');
    const halfCircleTrack = dateSelection.querySelector('.half-circle-track');
    
    confirmBtn.addEventListener('click', async () => {
      try {
        const selectedMonths = halfCircleTrack.getValue ? halfCircleTrack.getValue() : 1;
        const selectedTimeRange = getTimeRangeFromMonths(selectedMonths);
        const shouldContinue = await showPhoneRequirementDisclaimer(selectedTimeRange);
        if (!shouldContinue) {
          return;
        }
        const endDate = calculateEndDate(selectedTimeRange);
        const selectedChats = [...document.querySelectorAll('.chat-item input:checked')]
            .map(input => input.value);
        dateSelection.classList.remove('show');
        document.body.classList.add('loading');
        startMessageDownload(selectedChats, {
          endDate: formatDateForAPI(endDate),
          displayRange: {
            end: endDate.toLocaleDateString()
          }
        });
      } catch (error) {
        console.error('Date processing error:', error);
        alert('Error processing dates. Please try again.');
      }
    });
    
    cancelBtn.addEventListener('click', () => {
      dateSelection.classList.remove('show');
      document.querySelector('.chat-selection')?.classList.remove('hidden');
      document.querySelector('#mainDownload')?.classList.remove('hidden');
    });
}
// Helper function to convert month count to time range format
function getTimeRangeFromMonths(months) {
    if (months === 1) return '1month';
    if (months === 6) return '6month';
    if (months === 12) return 'year';
    return `${months}month`;  // Custom format
}

function calculateEndDate(range) {
    const currentDate = new Date();
    let endDate = new Date();
    let months = parseInt(range.replace('month', ''));
    endDate.setMonth(currentDate.getMonth() - (months + 1));
    if (!isValidDate(endDate)) {
        throw new Error('Invalid date calculated');
    }
    endDate = getLastDayOfMonth(endDate.getFullYear(), endDate.getMonth() + 1);
    return endDate;
}

// Helper function to get the last day of a month
function getLastDayOfMonth(year, month) {
    // month is 1-based in this context
    const date = new Date(year, month, 0);
    if (!isValidDate(date)) {
        throw new Error('Invalid date created');
    }
    return date;
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

window.addEventListener('unload', () => {
    cleanupPort.disconnect();
});

document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = `
    .date-selection-content {
        text-align: center;
        padding: 20px;
    }
    
    .time-range-title {
        color: #4a6f8b;
        font-size: 22px;
        margin-bottom: 20px;
        text-align: center;
        font-weight: 500;
    }
    
    .month-value-display {
        font-size: 18px;
        font-weight: 500;
        margin-bottom: 15px;
        color: #128C7E;
    }
    
    #monthValue {
        font-size: 28px;
        font-weight: bold;
        color: #128C7E;
    }
    
    .half-circle-container {
        position: relative;
        width: 240px;
        height: 140px;
        margin: 0 auto 30px;
    }
    
    .half-circle-track {
        position: absolute;
        width: 240px;
        height: 120px;
        background: #f1f1f1;
        border-top-left-radius: 120px;
        border-top-right-radius: 120px;
        box-shadow: inset 0 2px 5px rgba(0,0,0,0.1);
        cursor: pointer;
        overflow: visible;
        left: 0;
        bottom: 0;
    }
    
    .half-circle-fill {
    position: absolute;
    width: 100%;
    height: 100%;
    background: #128C7E;
    opacity: 0.7;
    pointer-events: none;
}
    
    .half-circle-thumb {
        position: absolute;
        width: 24px;
        height: 24px;
        background: #ffffff;
        border: 3px solid #128C7E;
        border-radius: 50%;
        transform: translate(-50%, -50%);
        cursor: grab;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        z-index: 10;
        left: 0;
        bottom: 120px;
    }
    
    .half-circle-thumb:active {
        cursor: grabbing;
    }
    
    .date-actions {
        display: flex;
        justify-content: center;
        gap: 10px;
    }
    
    .confirm-dates {
        background: #128C7E;
        color: white;
        border: none;
        padding: 12px 24px;
        border-radius: 5px;
        font-size: 16px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.3s;
    }
    
    .confirm-dates:hover {
        background: #0e6c5f;
    }
    
    .cancel-dates {
        background: #e9e9e9;
        border: none;
        padding: 12px 24px;
        border-radius: 5px;
        font-size: 16px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.3s;
    }
    
    .cancel-dates:hover {
        background: #dcdcdc;
    }
`;
    document.head.appendChild(style);
    
    initializeUI();
    setupEventListeners();
});