// Chat extraction module
(function() {
    // Get access to other modules
    const { SELECTORS } = window.WhatsAppExporter.constants;
    const { log, downloadMedia, generateExportFolderName } = window.WhatsAppExporter.utils;
    const { enhanceImageLoading, scrollChatToTop } = window.WhatsAppExporter.ui;
    
    async function splitHtmlByMonthYear(fullHtml, chatTitle, exportFolder) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(fullHtml, 'text/html');
        const container = doc.querySelector('#time-capsule-container');
        if (!container) {
            log('Could not find container for splitting');
            return { success: false };
        }
        function getMonthName(monthNum) {
            const months = [
                'January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'
            ];
            return months[monthNum - 1];
        }
        function parseDate(dateString) {
            const [day, month, year] = dateString.split('/').map(Number);
            return new Date(year, month - 1, day);
        }
        const allElements = Array.from(container.children).filter((el, index) => {
            return index > 0 || !el.classList.contains('nostalgic-header');
        });
        const monthYearGroups = {};
        let currentMonthYear = null;
        let currentElements = [];
        let monthDetails = {
            firstMessageDate: null,
            lastMessageDate: null,
            firstActualDay: null,
            lastActualDay: null
        };
        for (let i = 0; i < allElements.length; i++) {
            const element = allElements[i];
            const dateText = element.textContent?.trim();
            if (dateText && /^\d{2}\/\d{2}\/\d{4}$/.test(dateText)) {
                const currentDate = parseDate(dateText);
                const monthYear = `${getMonthName(currentDate.getMonth() + 1)}${currentDate.getFullYear()}`;
                if (monthYear !== currentMonthYear) {
                    if (currentMonthYear && currentElements.length > 0 && monthDetails.firstMessageDate) {
                        monthYearGroups[currentMonthYear] = {
                            elements: currentElements,
                            details: {...monthDetails}
                        };
                    }
                    currentMonthYear = monthYear;
                    currentElements = [element];
                    monthDetails = {
                        firstMessageDate: currentDate,
                        lastMessageDate: currentDate,
                        firstActualDay: currentDate.getDate(),
                        lastActualDay: currentDate.getDate()
                    };
                } else {
                    currentElements.push(element);
                    monthDetails.lastMessageDate = currentDate;
                    monthDetails.lastActualDay = currentDate.getDate();
                }
            } else if (currentMonthYear) {
                currentElements.push(element);
            }
        }
        if (currentMonthYear && currentElements.length > 0 && monthDetails.firstMessageDate) {
            monthYearGroups[currentMonthYear] = {
                elements: currentElements,
                details: {...monthDetails}
            };
        }
        const monthYears = Object.keys(monthYearGroups).sort((a, b) => {
            const yearA = parseInt(a.match(/\d{4}$/)[0]);
            const yearB = parseInt(b.match(/\d{4}$/)[0]);
            if (yearA !== yearB) return yearA - yearB;
            const monthA = a.replace(/\d{4}$/, '');
            const monthB = b.replace(/\d{4}$/,'');
            const months = ['January', 'February', 'March', 'April', 'May', 'June',
                          'July', 'August', 'September', 'October', 'November', 'December'];
            return months.indexOf(monthA) - months.indexOf(monthB);
        });
        const completeMonths = {};
        const sortedMonthYears = [...monthYears].sort((a, b) => {
            const yearA = parseInt(a.match(/\d{4}$/)[0]);
            const yearB = parseInt(b.match(/\d{4}$/)[0]);
            if (yearA !== yearB) return yearA - yearB;
            const monthA = a.replace(/\d{4}$/, '');
            const monthB = b.replace(/\d{4}$/,'');
            const months = ['January', 'February', 'March', 'April', 'May', 'June',
                          'July', 'August', 'September', 'October', 'November', 'December'];
            return months.indexOf(monthA) - months.indexOf(monthB);
        });
        const monthToIndex = {};
        const months = ['January', 'February', 'March', 'April', 'May', 'June',
                      'July', 'August', 'September', 'October', 'November', 'December'];
        months.forEach((month, index) => {
            monthToIndex[month] = index;
        });
        if (sortedMonthYears.length > 0) {
            const earliestMonth = sortedMonthYears[0];
            log(`Earliest found month: ${earliestMonth}`);
        }
        for (let i = 0; i < sortedMonthYears.length; i++) {
            const currentMonthYear = sortedMonthYears[i];
            const currentYearStr = currentMonthYear.match(/\d{4}$/)[0];
            const currentYear = parseInt(currentYearStr);
            const currentMonth = currentMonthYear.replace(/\d{4}$/, '');
            const currentMonthIndex = monthToIndex[currentMonth];
            let prevMonthIndex = currentMonthIndex - 1;
            let prevYear = currentYear;
            if (prevMonthIndex < 0) {
                prevMonthIndex = 11;
                prevYear = currentYear - 1;
            }
            const prevMonth = months[prevMonthIndex];
            const prevMonthYear = `${prevMonth}${prevYear}`;
            if (monthYearGroups[prevMonthYear]) {
                completeMonths[currentMonthYear] = true;
                log(`Marking ${currentMonthYear} as complete because previous month ${prevMonthYear} is present`);
            } else {
                    log(`Month ${currentMonthYear} does not have previous month ${prevMonthYear} - marking as incomplete`);
            }
        }
        if (sortedMonthYears.length > 0) {
            const mostRecentMonth = sortedMonthYears[sortedMonthYears.length - 1];
            const messageCount = monthYearGroups[mostRecentMonth].elements.filter(el => 
                el.classList && (el.classList.contains('message-in') || el.classList.contains('message-out'))
            ).length;
            if (!completeMonths[mostRecentMonth] && messageCount >= 10) {
                completeMonths[mostRecentMonth] = true;
                log(`Marking most recent month ${mostRecentMonth} as complete because it has ${messageCount} messages`);
            }
        }
        const results = [];
        const processedMonths = [];
        for (const monthYear of monthYears) {
            if (completeMonths[monthYear]) {
                const { elements } = monthYearGroups[monthYear];
                const monthDoc = parser.parseFromString(fullHtml, 'text/html');
                const monthContainer = monthDoc.querySelector('#time-capsule-container');
                while (monthContainer.firstChild) {
                    monthContainer.removeChild(monthContainer.firstChild);
                }
                const header = monthDoc.createElement('div');
                header.className = 'nostalgic-header';
                header.textContent = `${chatTitle} - ${monthYear}`;
                monthContainer.appendChild(header);
                elements.forEach(element => {
                    monthContainer.appendChild(element.cloneNode(true));
                });
                const monthHtml = monthDoc.documentElement.outerHTML;
                const monthBlob = new Blob([monthHtml], { type: 'text/html' });
                await downloadMedia(monthBlob, `${exportFolder}/${monthYear}.html`);
                results.push(monthYear);
                processedMonths.push(monthYear);
                log(`Generated monthly segment: ${monthYear} (Complete)`);
            } else {
                log(`Skipping incomplete month: ${monthYear}`);
            }
        }
        return {
            success: results.length > 0,
            monthYears: processedMonths,
            count: results.length
        };
    }
    
    async function extractChatContentAndMedia(chatTitle, endDate) {
        try {
            await scrollChatToTop(endDate);
            const exportFolder = generateExportFolderName(chatTitle);
            const messagesContainer = document.querySelector(SELECTORS.CHAT.scrollContainer);
            async function convertImageToBase64(imageElement) {
                try {
                    const response = await fetch(imageElement.src);
                    const blob = await response.blob();
                    return new Promise((resolve, reject) => {
                        const reader = new FileReader();
                        reader.onloadend = () => {
                            const newImg = document.createElement('img');
                            newImg.src = reader.result;
                            for (let attr of imageElement.attributes) {
                                if (attr.name !== 'src') {
                                    newImg.setAttribute(attr.name, attr.value);
                                }
                            }
                            resolve(newImg.outerHTML);
                        };
                        reader.onerror = reject;
                        reader.readAsDataURL(blob);
                    });
                } catch (error) {
                    console.error('Image conversion error:', error);
                    return imageElement.outerHTML;
                }
            }
            async function processImagesInContainer(container) {
                const images = container.querySelectorAll('img[src^="blob:"]');
                const processedImages = await Promise.all(
                    Array.from(images).map(convertImageToBase64)
                );
                processedImages.forEach((processedImg, index) => {
                    images[index].outerHTML = processedImg;
                });
                return container;
            }
            const processedContainer = await enhanceImageLoading(
                await processImagesInContainer(messagesContainer.cloneNode(true))
            );
            const capturedStyles = Array.from(document.styleSheets)
                .map(sheet => {
                    try {
                        return Array.from(sheet.cssRules)
                            .map(rule => rule.cssText)
                            .join('\n');
                    } catch(e) {
                        return '';
                    }
                })
                .join('\n');
            
            const headerHtml = `
        <div class="nostalgic-header">
            <span class="header-emoji">💫</span> ${chatTitle} <span class="header-emoji">💭</span>
        </div>
    `;
    const fullPageHTML = `<!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <title>${chatTitle}</title>
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
        <style>
            ${capturedStyles}
    :root {
        --bg-color: #F8EAC8;;
        --header-bg: #039be5; /* Celeste vivace */
        --header-text: #ffffff;
        --bubble-in: #ffffff;
        --bubble-out: #dcf8c6;
        --text-color: #303030;
        --meta-text: #8c8c8c;
        --border-radius: 7px;
        --shadow: none;
    }
    
    body, html {
        margin: 0;
        padding: 0;
        height: 100%;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        background-color: var(--bg-color);
        color: var(--text-color);
        line-height: 1.5;
        -webkit-text-size-adjust: 100%;
    }
    
    .nostalgic-header {
        text-align: center;
        padding: 15px 10px;
        font-size: 20px;
        font-weight: normal;
        border-bottom: none;
        margin-bottom: 10px;
        position: relative;
        background: var(--header-bg);
        z-index: 100;
        color: var(--header-text);
        box-shadow: none;
        border-radius: 0;
        letter-spacing: 0.5px;
        display: flex;
        justify-content: center;
        align-items: center;
        text-shadow: none;
    }
    
    .header-emoji {
        display: none;
    }
    
    #time-capsule-container {
        max-width: 600px;
        margin: 0 auto;
        height: 100vh;
        overflow-y: auto;
        position: relative;
        padding: 0 6px;
        box-sizing: border-box;
        scroll-behavior: smooth;
        -webkit-overflow-scrolling: touch;
        padding-top: 5px;
    }
    
    /* Soluzione radicale per rimuovere i rettangoli - selettori più specifici */
    div.message-in, div.message-out,
    .message-in, .message-out,
    #time-capsule-container div.message-in, #time-capsule-container div.message-out {
        border: none !important;
        margin: 2px 0 !important;
        padding: 8px 12px !important;
        border-radius: var(--border-radius) !important;
        box-shadow: none !important;
        max-width: 80% !important;
        word-wrap: break-word !important;
        position: relative !important;
        outline: none !important;
        background-clip: padding-box !important;
    }
    
    .message-in {
        background-color: var(--bubble-in) !important;
        margin-right: auto !important;
        border-top-left-radius: var(--border-radius) !important;
    }
    
    .message-out {
        background-color: var(--bubble-out) !important;
        margin-left: auto !important;
        border-top-right-radius: var(--border-radius) !important;
    }
    
    /* Rimuovi tutti i div e span contenitori aggiuntivi */
    .message-in > div, .message-out > div,
    .message-in > span, .message-out > span {
        border: none !important;
        background: transparent !important;
        box-shadow: none !important;
        outline: none !important;
        margin: 0 !important;
        padding: 0 !important;
    }
    
    /* Elimina rettangoli */
    *[data-id], *[data-testid], *[role="row"], *[role="gridcell"] {
        border: none !important;
        background: transparent !important;
        box-shadow: none !important;
        outline: none !important;
    }
    
    /* Message meta (time, status) */
    .message-meta {
        font-size: 10.5px !important;
        color: var(--meta-text) !important;
        text-align: right !important;
        margin-top: 1px !important;
        background: transparent !important;
    }
    
    /* Audio message styling */
    .message-in .audio-player, .message-out .audio-player {
        border-radius: 10px;
        display: flex;
        align-items: center;
        padding: 8px 12px;
        position: relative;
    }
    
    .message-in .audio-player {
        background-color: var(--bubble-in);
    }
    
    .message-out .audio-player {
        background-color: var(--bubble-out);
    }
    
    /* Play button styling */
    .audio-play-button {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        background-color: var(--header-bg);
        color: white;
        display: flex;
        align-items: center;
        justify-content: center;
        margin-right: 12px;
        cursor: pointer;
        transition: transform 0.2s;
    }
    
    .audio-play-button:active {
        transform: scale(0.95);
    }
    
    /* Audio waveform styling */
    .audio-waveform {
        flex-grow: 1;
        height: 28px;
        margin: 0 10px;
        display: flex;
        align-items: center;
    }
    
    .audio-waveform-bar {
        background-color: var(--meta-text);
        width: 2px;
        height: 16px;
        margin: 0 1px;
        border-radius: 1px;
    }
    
    /* Time counter styling */
    .audio-time {
        font-size: 12px;
        color: var(--meta-text);
        margin-right: 5px;
        font-weight: 400;
    }
    
    /* Profile picture styling */
    .profile-picture {
        width: 36px;
        height: 36px;
        border-radius: 50%;
        overflow: hidden;
        margin-right: 10px;
        border: 2px solid var(--header-bg);
    }
    
    /* Ensure images are responsive */
    #time-capsule-container img {
        max-width: 100%;
        height: auto;
        object-fit: contain;
        border-radius: 8px;
    }
    
    /* Date separators */
    .chat-date-separator {
        text-align: center;
        margin: 8px 0;
        position: relative;
        border: none !important;
        background: transparent !important;
        display: none;
    }
    
    .chat-date-text {
        background: #d4dbdc;
        padding: 5px 10px;
        border-radius: 12px;
        font-size: 12.5px;
        display: inline-block;
        box-shadow: none;
        color: #303030;
        font-weight: normal;
        border: none !important;
    }
    
    /* Remove theme toggle button */
    .theme-toggle {
        display: none !important;
    }
    
    /* Remove bubble speech tails */
    .message-in::before, .message-out::before {
        display: none !important;
        content: none !important;
    }
    
    /* Floating date indicator */
    .floating-date-indicator {
        position: fixed;
        top: 70px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(3, 155, 229, 0.85);
        color: white;
        padding: 6px 12px;
        border-radius: 16px;
        font-size: 14px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
        z-index: 1000;
        transition: opacity 0.3s ease, transform 0.3s ease;
        opacity: 0;
        pointer-events: none;
        text-align: center;
        max-width: 90%;
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        display: flex;
        align-items: center;
        justify-content: center;
    }
    
    .floating-date-indicator.visible {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
    }
    
    .floating-date-indicator.hiding {
        opacity: 0;
        transform: translateX(-50%) translateY(-10px);
    }
    
    .date-icon {
        margin-right: 6px;
    }
    
    /* Large side date display */
    .side-date-display {
        position: fixed;
        right: 10px;
        top: 50%;
        transform: translateY(-50%) scale(0.9);
        background: rgba(3, 155, 229, 0.9);
        color: white;
        padding: 15px;
        border-radius: 12px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        text-align: center;
        z-index: 1000;
        box-shadow: 0 2px 20px rgba(0, 0, 0, 0.25);
        opacity: 0;
        transition: opacity 0.3s ease, transform 0.3s ease;
        pointer-events: none;
        backdrop-filter: blur(4px);
        -webkit-backdrop-filter: blur(4px);
        border: 1px solid rgba(255, 255, 255, 0.2);
    }
    
    .side-date-display.visible {
        opacity: 1;
        transform: translateY(-50%) scale(1);
    }
    
    .side-date-display.hiding {
        opacity: 0;
        transform: translateY(-50%) scale(0.9);
    }
    
    .side-date-content {
        display: flex;
        flex-direction: column;
        align-items: center;
    }
    
    .side-date-day {
        font-size: 32px;
        font-weight: bold;
        line-height: 1;
        margin-bottom: 5px;
    }
    
    .side-date-month-year {
        font-size: 14px;
        text-transform: uppercase;
        font-weight: 500;
    }
    
    /* Persistent Apple-style date header */
    .persistent-date-header {
        position: sticky;
        top: 0;
        left: 0;
        right: 0;
        padding: 8px 0;
        text-align: center;
        z-index: 200;
        margin: 8px auto;
        max-width: 180px;
        transition: all 0.3s ease;
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
    }
    
    .persistent-date-text {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        background: rgba(150, 150, 150, 0.3);
        color: #000;
        font-size: 13px;
        font-weight: 500;
        padding: 4px 10px;
        border-radius: 18px;
        box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        letter-spacing: 0.3px;
        border: 0.5px solid rgba(100, 100, 100, 0.1);
    }
    
    .calendar-emoji {
        margin-right: 5px;
        font-size: 14px;
    }
    
    @media (max-width: 600px) {
        .side-date-display {
            right: 5px;
            padding: 10px;
        }
        
        .side-date-day {
            font-size: 24px;
        }
        
        .side-date-month-year {
            font-size: 12px;
        }
    }
    
    #time-capsule-container * {
        border: none !important;
        box-shadow: none !important;
        outline: none !important;
    }
    
    /* Riapplica gli stili per i messaggi dopo aver rimosso tutti i bordi */
    #time-capsule-container div.message-in {
        background-color: var(--bubble-in) !important;
        border-radius: var(--border-radius) !important;
        margin: 4px 0 !important;
        margin-right: auto !important;
        padding: 8px 12px !important;
        max-width: 80% !important;
    }
    
    #time-capsule-container div.message-out {
        background-color: var(--bubble-out) !important;
        border-radius: var(--border-radius) !important;
        margin: 4px 0 !important;
        margin-left: auto !important;
        padding: 8px 12px !important;
        max-width: 80% !important;
    }
    
    @media (max-width: 600px) {
        #time-capsule-container div.message-in, 
        #time-capsule-container div.message-out {
            max-width: 85% !important;
        }
    }
    
    /* Disable animations */
    @keyframes float {
        0% { transform: none; }
        100% { transform: none; }
    }
        </style>
    </head>
    <body>     
        <div id="floating-date-indicator" class="floating-date-indicator">
            <span class="date-icon">🗓️</span>
            <span id="current-date-text">Loading...</span>
        </div>
        <div id="side-date-display" class="side-date-display">
            <div class="side-date-content">
                <div class="side-date-day">01</div>
                <div class="side-date-month-year">JAN 2023</div>
            </div>
        </div>
        <div id="time-capsule-container">
            ${headerHtml}
            ${processedContainer.innerHTML}
        </div>
        <script>
        window.onload = function() {
            // Prevent pinch zoom on mobile
            document.addEventListener('gesturestart', function(e) {
                e.preventDefault();
            });
            
            // Initialize the UI
            initializeUI();
        }
    
        // Function to add sticky date headers with language detection
        function addDateSeparators() {
            const container = document.getElementById('time-capsule-container');
            const messages = document.querySelectorAll('div.message-in, div.message-out');
            let currentDate = '';
            const dateElements = [];
            
            // If we already have date headers, remove them
            const existingHeaders = document.querySelectorAll('.persistent-date-header');
            existingHeaders.forEach(header => header.remove());
            
            // Helper function to detect language from date format
            function detectLanguage(dateStr) {
                // Check if it's an Italian format (usually DD/MM/YYYY)
                // or English format (could be MM/DD/YYYY)
                // For simplicity, we'll assume DD/MM/YYYY for both but use browser language
                // as the default formatting choice
                const userLang = navigator.language || navigator.userLanguage;
                return userLang.startsWith('it') ? 'it' : 'en';
            }
            
            // Helper function to format date according to language
            function formatDate(dateStr, language) {
                const [day, month, year] = dateStr.split('/').map(part => part.trim());
                
                // Month names in Italian and English
                const monthNames = {
                    'it': [
                        'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
                        'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
                    ],
                    'en': [
                        'January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'
                    ]
                };
                
                const monthIndex = parseInt(month) - 1;
                const monthName = monthNames[language][monthIndex];
                
                // Format based on language
                if (language === 'it') {
                    return \`\${day} \${monthName} \${year}\`;
                } else {
                    return \`\${monthName} \${day}, \${year}\`;
                }
            }
            
            // Process all messages and add date headers
            messages.forEach(message => {
                const dateMeta = message.querySelector('[data-pre-plain]');
                if (dateMeta) {
                    const dateText = dateMeta.getAttribute('data-pre-plain');
                    const dateMatch = dateText.match(/\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}/);
                    
                    if (dateMatch && dateMatch[0] !== currentDate) {
                        currentDate = dateMatch[0];
                        
                        // Detect language from date or interface
                        const language = detectLanguage(currentDate);
                        const formattedDate = formatDate(currentDate, language);
                        
                        // Create a sticky header for this date
                        const dateHeader = document.createElement('div');
                        dateHeader.className = 'persistent-date-header';
                        dateHeader.innerHTML = \`
                            <div class="persistent-date-text">
                                <span class="calendar-emoji">📅</span>
                                <span>\${formattedDate}</span>
                            </div>
                        \`;
                        
                        // Store date information as a data attribute for easier retrieval
                        const [day, month, year] = currentDate.split('/');
                        dateHeader.setAttribute('data-date', \`\${day},\${month},\${year},\${language}\`);
                        
                        // Insert the header at the position of this message
                        message.parentNode.insertBefore(dateHeader, message);
                        
                        dateElements.push({
                            element: dateHeader,
                            dateText: currentDate,
                            language: language,
                            formattedDate: {
                                day: day,
                                month: month,
                                year: year,
                                fullText: formattedDate
                            }
                        });
                    }
                }
            });
            
            return dateElements;
        }
    
        // Set up improved date indicators with language support
        function setupFloatingDateIndicator() {
            const container = document.getElementById('time-capsule-container');
            
            // We no longer need the floating indicator since headers are persistent
            const floatingIndicator = document.getElementById('floating-date-indicator');
            if (floatingIndicator) {
                floatingIndicator.style.display = 'none';
            }
            
            const sideDateDisplay = document.getElementById('side-date-display');
            if (!sideDateDisplay) return;
            
            const sideDateDay = sideDateDisplay.querySelector('.side-date-day');
            const sideDateMonthYear = sideDateDisplay.querySelector('.side-date-month-year');
            
            // Get all date headers
            const dateHeaders = document.querySelectorAll('.persistent-date-header');
            if (dateHeaders.length === 0) return;
            
            // Month abbreviations in both languages
            const monthAbbr = {
                'it': ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'],
                'en': ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
            };
            
            // Add custom data for each header
            const dateElements = Array.from(dateHeaders).map(header => {
                const headerData = header.getAttribute('data-date');
                if (headerData) {
                    const [day, month, year, language] = headerData.split(',');
                    return {
                        element: header,
                        position: 0, // Will be updated
                        formattedDate: {
                            day: day,
                            monthYear: \`\${monthAbbr[language || 'en'][parseInt(month) - 1]} \${year}\`
                        }
                    };
                }
                
                // Fallback if data attribute isn't available (shouldn't happen with our implementation)
                return {
                    element: header,
                    position: 0,
                    formattedDate: {
                        day: "??",
                        monthYear: "???"
                    }
                };
            });
            
            let sideDateTimeout;
            let currentDateIndex = -1;
            let isScrolling = false;
            
            // Function to update the position information
            function updatePositions() {
                dateElements.forEach(item => {
                    item.position = item.element.getBoundingClientRect().top;
                });
            }
            
            // Function to determine which date is currently visible
            function determineVisibleDate() {
                updatePositions();
                
                // Find the last date that has passed the top of the viewport + header height
                const headerHeight = 50; // Approximate height of the header
                const visibleIndex = dateElements.findIndex(item => item.position > headerHeight);
                
                // If we found a visible date, use the one just before it (or the first if none before)
                const activeIndex = visibleIndex > 0 ? visibleIndex - 1 : (visibleIndex === -1 ? dateElements.length - 1 : 0);
                
                // Only update if the date has changed
                if (currentDateIndex !== activeIndex || isScrolling) {
                    currentDateIndex = activeIndex;
                    const activeDate = dateElements[activeIndex];
                    
                    // Update the side date display
                    sideDateDay.textContent = activeDate.formattedDate.day;
                    sideDateMonthYear.textContent = activeDate.formattedDate.monthYear;
                    
                    // Show the side indicator (only while scrolling)
                    sideDateDisplay.classList.add('visible');
                    sideDateDisplay.classList.remove('hiding');
                    
                    // Set timeout to hide the side indicator after scrolling stops
                    clearTimeout(sideDateTimeout);
                    sideDateTimeout = setTimeout(() => {
                        sideDateDisplay.classList.add('hiding');
                        sideDateDisplay.classList.remove('visible');
                    }, 2000);
                }
            }
            
            // Add scroll event listener with throttling
            let scrollTimeout;
            container.addEventListener('scroll', () => {
                isScrolling = true;
                clearTimeout(scrollTimeout);
                
                // Use requestAnimationFrame to limit the number of calculations
                requestAnimationFrame(determineVisibleDate);
                
                // Reset scrolling flag after scrolling stops
                scrollTimeout = setTimeout(() => {
                    isScrolling = false;
                }, 150);
            });
            
            // Make the side date display appear on initial load
            setTimeout(() => {
                // Initialize on load
                determineVisibleDate();
                
                // Explicitly show the side date on initial load
                sideDateDisplay.classList.add('visible');
                sideDateDisplay.classList.remove('hiding');
                
                // Hide after a few seconds
                setTimeout(() => {
                    sideDateDisplay.classList.add('hiding');
                    sideDateDisplay.classList.remove('visible');
                }, 4000);
            }, 500);
        }
    
        // Call the setup function after adding date separators
        function initializeUI() {
            addDateSeparators();
            setupFloatingDateIndicator();
            
            // Set up other UI elements (keep your existing code here)
            const audioPlayers = document.querySelectorAll('.audio-player');
            audioPlayers.forEach(player => {
                // Add play button icon if missing
                const playButton = player.querySelector('.audio-play-button');
                if (playButton && !playButton.querySelector('i')) {
                    playButton.innerHTML = '<i class="fas fa-play"></i>';
                }
                
                // Ensure waveform has bars
                const waveform = player.querySelector('.audio-waveform');
                if (waveform && waveform.children.length === 0) {
                    for (let i = 0; i < 20; i++) {
                        const bar = document.createElement('div');
                        bar.className = 'audio-waveform-bar';
                        bar.style.height = \`\${Math.floor(Math.random() * 20) + 5}px\`;
                        waveform.appendChild(bar);
                    }
                }
            });
            
            // Add message timestamps class for styling
            document.querySelectorAll('[data-pre-plain]').forEach(meta => {
                meta.classList.add('message-meta');
            });
        }
        </script>
    </body>
    </html>`;
            log('Splitting chat into monthly segments...');
            const splitResult = await splitHtmlByMonthYear(fullPageHTML, chatTitle, exportFolder);
            return {
                success: true,
                mediaContent: {
                    htmlExport: true,
                    imagesEmbedded: true,
                    monthlySegments: splitResult.success ? splitResult.count : 0
                },
                totalMessages: document.querySelectorAll('div.message-in, div.message-out').length,
                monthYears: splitResult.success ? splitResult.monthYears : []
            };
        } catch (error) {
            log(`Export error: ${error.message}`);
            throw error;
        }
    }
    
    // Add functions to the chat extraction namespace
    window.WhatsAppExporter.chat = {
        splitHtmlByMonthYear,
        extractChatContentAndMedia
    };
})();