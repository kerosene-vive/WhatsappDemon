// Add functions to the UI namespace
(function() {
    // Get access to other modules
    const { SELECTORS, TIMEOUTS, SCROLL_CONFIG } = window.WhatsAppExporter.constants;
    const { state } = window.WhatsAppExporter;
    const { waitForElement, log, simulateClick } = window.WhatsAppExporter.utils;
    
    // UI Handler functions
    async function enhanceImageLoading(container) {
        const imageSelectors = [
            'img[src^="blob:"]',
            'img[src^="https://"]',
            'img[src=""]',
            'div[style*="background-image"][role="button"]'
        ];
        const images = container.querySelectorAll(imageSelectors.join(', '));
        for (const img of images) {
            try {
                if (img.style.backgroundImage && img.style.backgroundImage !== 'none') {
                    const bgUrl = img.style.backgroundImage.match(/url\(["']?([^"']*)["']?\)/);
                    if (bgUrl && bgUrl[1]) {
                        img.style.backgroundImage = `url('${await loadImage(bgUrl[1])}')`;
                    }
                    continue;
                }
                if (!img.src || img.src.startsWith('blob:') || img.src === '') {
                    const potentialSrcs = [
                        img.getAttribute('data-src'),
                        img.getAttribute('data-original-src'),
                        img.getAttribute('data-url')
                    ];
                    for (const potentialSrc of potentialSrcs) {
                        if (potentialSrc) {
                            img.src = await loadImage(potentialSrc);
                            break;
                        }
                    }
                }
            } catch (error) {
                console.error('Image loading error:', error);
            }
        }
        return container;
    }

    async function loadImage(src) {
        try {
            const response = await fetch(src, {
                mode: 'cors',
                credentials: 'include'
            });
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const blob = await response.blob();
            return URL.createObjectURL(blob);
        } catch (error) {
            console.error('Failed to load image:', src, error);
            return src;
        }
    }

    async function findOldestVisibleDate() {
        const extractDateMethods = [
            () => {
                const elementsToCheck = document.querySelectorAll(
                    '[data-id], .x3nfvp2.xxymvpz, [data-pre-plain-text], ' + 
                    'div[role="row"] > div:first-child, span[dir="auto"], .message-in, .message-out'
                );
                for (const element of elementsToCheck) {
                    const possibleTexts = [
                        element.textContent?.trim(),
                        element.getAttribute('data-pre-plain-text') || '',
                        element.getAttribute('title') || ''
                    ];
                    const dateFormats = [
                        /(\d{2})\/(\d{2})\/(\d{4})/,
                        /(\d{4})-(\d{2})-(\d{2})/,
                        /(\d{2})-(\d{2})-(\d{4})/
                    ];
                    for (const text of possibleTexts) {
                        for (const regex of dateFormats) {
                            const match = text.match(regex);
                            if (match) {
                                let day, month, year;
                                if (regex.source === '(\\d{2})\\/(\\d{2})\\/(\\d{4})') {
                                    [, day, month, year] = match;
                                } else if (regex.source === '(\\d{4})-(\\d{2})-(\\d{2})') {
                                    [, year, month, day] = match;
                                } else {
                                    [, day, month, year] = match;
                                }
                                const parsedDate = new Date(Number(year), Number(month) - 1, Number(day));
                                if (!isNaN(parsedDate.getTime())) {
                                    log(`Date found: ${parsedDate.toLocaleDateString('en-GB')} (from text: ${text})`);
                                    return parsedDate;
                                }
                            }
                        }
                    }
                }
                return null;
            },
            () => {
                const timestampElements = document.querySelectorAll('.x3nfvp2.xxymvpz');
                for (const element of timestampElements) {
                    const titleDate = element.getAttribute('title')?.match(/(\d{2})\/(\d{2})\/(\d{4})/);
                    if (titleDate) {
                        const [_, day, month, year] = titleDate;
                        const parsedDate = new Date(Number(year), Number(month) - 1, Number(day));
                        return parsedDate;
                    }
                }
                return null;
            },
            () => {
                const messages = document.querySelectorAll(SELECTORS.MESSAGE.container);
                if (messages.length > 0) {
                    const checkMessageContext = (message) => {
                        let current = message;
                        while (current) {
                            const textContent = current.textContent?.trim();
                            if (textContent && /^\d{2}\/\d{2}\/\d{4}$/.test(textContent)) {
                                const [day, month, year] = textContent.split('/').map(Number);
                                return new Date(year, month - 1, day);
                            }
                            current = current.previousElementSibling;
                        }
                        return null;
                    };
                    const firstMessageDate = checkMessageContext(messages[0]);
                    if (firstMessageDate) return firstMessageDate;
                    const lastMessageDate = checkMessageContext(messages[messages.length - 1]);
                    if (lastMessageDate) return lastMessageDate;
                }
                return null;
            }
        ];
        for (const method of extractDateMethods) {
            try {
                const date = method();
                if (date) {
                    log(`Oldest date found by method: ${date.toLocaleDateString('en-GB')}`);
                    return date;
                }
            } catch (error) {
                log(`Date extraction method failed: ${error.message}`);
            }
        }
        log('NO DATE FOUND - Debugging information:');
        log('Total messages: ' + document.querySelectorAll(SELECTORS.MESSAGE.container).length);
        const debugTexts = [];
        const elementsToDebug = document.querySelectorAll(
            '[data-id], .x3nfvp2.xxymvpz, [data-pre-plain-text], ' + 
            'div[role="row"] > div:first-child, span[dir="auto"]'
        );
        for (let i = 0; i < Math.min(10, elementsToDebug.length); i++) {
            const el = elementsToDebug[i];
            debugTexts.push({
                text: el.textContent?.trim(),
                attributes: {
                    'data-pre-plain-text': el.getAttribute('data-pre-plain-text'),
                    'title': el.getAttribute('title')
                }
            });
        }
        log('Debug texts: ' + JSON.stringify(debugTexts, null, 2));
        return null;
    }

    async function scrollChatToTop(endDate) {
        const container = document.querySelector(SELECTORS.CHAT.scrollContainer);
        if (!container) {
            log("Chat scroll container not found");
            await new Promise(resolve => setTimeout(resolve, 2000));
            return;
        }
        let prevMessageCount = 0;
        let unchangedIterations = 0;
        let consecutiveScrollFailures = 0;
        let totalScrollFailures = 0;
        let scrollAttempts = 0;
        let stopScrolling = false;
        const targetDate = endDate instanceof Date 
            ? endDate 
            : new Date(endDate);
        log(`Starting to scroll to target date: ${targetDate.toLocaleDateString('en-GB')}`);
        const originalChatTitle = document.querySelector('header span[dir="auto"]')?.textContent?.trim();
        const checkStopScrolling = async () => {
            const oldestDate = await findOldestVisibleDate();
            if (!oldestDate) {
                log('No date found, continuing scroll');
                return false;
            }
            const normalizedTarget = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate());
            const normalizedCurrent = new Date(oldestDate.getFullYear(), oldestDate.getMonth(), oldestDate.getDate());
            const shouldStop = normalizedCurrent <= normalizedTarget;
            if (shouldStop) {
                log(`STOPPING SCROLL: 
                    Oldest date found: ${oldestDate.toLocaleDateString('en-GB')}
                    Target date: ${targetDate.toLocaleDateString('en-GB')}`);
            }
            return shouldStop;
        };
        while (scrollAttempts < 200 && unchangedIterations < 5 && !stopScrolling) {
            scrollAttempts++;
            stopScrolling = await checkStopScrolling();
            if (stopScrolling) {
                log('Stopping scroll process - reached target date range');
                break;
            }
            const loadOlderButtons = document.querySelectorAll('button.x14m1o6m, button.x1b9z3ur');
            let buttonFound = false;
            for (const button of loadOlderButtons) {
                if (button.textContent.includes("Click here to get older messages")) {
                    log("Found 'Load older messages' button, clicking it...");
                    simulateClick(button);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    unchangedIterations = 0;
                    consecutiveScrollFailures = 0;
                    buttonFound = true;
                    break;
                }
            }
            if (scrollAttempts % SCROLL_CONFIG.SCROLL_BATCH_SIZE === 0) {
                log(`Batch pause at attempt ${scrollAttempts} to let the UI respond`);
                await new Promise(resolve => setTimeout(resolve, SCROLL_CONFIG.SCROLL_BATCH_PAUSE));
            }
            const messages = document.querySelectorAll(SELECTORS.MESSAGE.container);
            if (!messages || messages.length === 0) {
                log("No messages found in chat");
                await new Promise(resolve => setTimeout(resolve, 2000));
                continue;
            }
            const currentMessageCount = messages.length;
            if (currentMessageCount > prevMessageCount) {
                log(`Progress: loaded ${currentMessageCount} messages`);
                unchangedIterations = 0;
                consecutiveScrollFailures = 0;
                prevMessageCount = currentMessageCount;
            } else {
                unchangedIterations++;
                log(`No new messages loaded (${unchangedIterations}/5 attempts)`);
                
                if (!buttonFound) {
                    consecutiveScrollFailures++;
                    totalScrollFailures++;
                    log(`Scroll appears stuck: ${consecutiveScrollFailures}/${SCROLL_CONFIG.MAX_CONSECUTIVE_FAILURES} failures`);
                }
            }
            try {
                if (messages[0]) {
                    if (consecutiveScrollFailures === 0) {
                        const scrollVariation = scrollAttempts % 4;
                        if (scrollVariation === 0) {
                            messages[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
                            await new Promise(resolve => setTimeout(resolve, 300));
                            if (container.scrollTop > 1000) {
                                container.scrollTop -= 1000;
                            }
                        } else if (scrollVariation === 1) {
                            container.scrollTop = 0;
                            await new Promise(resolve => setTimeout(resolve, 300));
                        } else if (scrollVariation === 2) {
                            messages[0].scrollIntoView({ block: 'start' });
                            await new Promise(resolve => setTimeout(resolve, 300));
                        } else {
                            messages[0].scrollIntoView({ behavior: 'auto', block: 'center' });
                            await new Promise(resolve => setTimeout(resolve, 300));
                            container.scrollTop = 0;
                        }
                    } else if (consecutiveScrollFailures <= SCROLL_CONFIG.MAX_CONSECUTIVE_FAILURES) {
                        log(`Using alternative scrolling method (attempt ${consecutiveScrollFailures})`);
                        if (consecutiveScrollFailures === 1) {
                            messages[0].scrollIntoView({ block: 'start' });
                            await new Promise(resolve => setTimeout(resolve, 500));
                            container.scrollTop -= 1500;
                        } else if (consecutiveScrollFailures === 2) {
                            log("Clicking near the top to activate scrolling");
                            const topArea = messages[0];
                            if (topArea) {
                                simulateClick(topArea);
                                await new Promise(resolve => setTimeout(resolve, 500));
                            }
                            container.scrollTop = 0;
                            await new Promise(resolve => setTimeout(resolve, 500));
                        } else {
                            log("Using DOM manipulation to unstick scrolling");
                            const originalHeight = container.style.height;
                            const originalOverflow = container.style.overflow;
                            container.style.height = '99%';
                            container.style.overflow = 'hidden';
                            await new Promise(resolve => setTimeout(resolve, 300));
                            container.style.height = originalHeight;
                            container.style.overflow = originalOverflow;
                            await new Promise(resolve => setTimeout(resolve, 300));
                            container.scrollTop = 0;
                        }
                    } else {
                        log("Too many scroll failures, applying emergency scroll reset");
                        const resetSuccessful = await attemptChatReset(originalChatTitle);
                        if (!resetSuccessful) {
                            for (let i = 0; i < 5; i++) {
                                const randomScroll = Math.floor(Math.random() * 1000);
                                container.scrollTop = randomScroll;
                                await new Promise(resolve => setTimeout(resolve, 200));
                            }
                            container.scrollTop = 0;
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }
                        consecutiveScrollFailures = 1;
                    }
                }
            } catch (scrollError) {
                log(`Scroll error: ${scrollError.message}`);
                consecutiveScrollFailures++;
                totalScrollFailures++;
            }
            const randomDelay = Math.floor(Math.random() * 500) + 500;
            await new Promise(resolve => setTimeout(resolve, randomDelay));
            if (totalScrollFailures > SCROLL_CONFIG.MAX_TOTAL_FAILURES) {
                log(`Reached maximum total failures (${totalScrollFailures}), applying last resort recovery`);
                await applyLastResortRecovery(container);
                totalScrollFailures = 0;
            }
            stopScrolling = await checkStopScrolling();
            if (stopScrolling) {
                log('Stopping scroll process - reached target date range');
                break;
            }
        }
        if (scrollAttempts >= 200) {
            log(`Reached maximum scroll attempts (200), continuing with available messages`);
        } else if (unchangedIterations >= 5) {
            log(`Stopped scrolling after ${scrollAttempts} attempts due to no message count changes`);
        } else if (stopScrolling) {
            log(`Stopped scrolling due to reaching target date`);
        }
    }
      
    async function attemptChatReset(chatTitle) {
        if (!chatTitle) {
            log("Can't reset chat - no chat title found");
            return false;
        }
        log(`Attempting to reset chat view for: ${chatTitle}`);
        try {
            const headerBackButton = document.querySelector('[data-icon="back"], [aria-label="Back"]');
            if (headerBackButton) {
                log("Clicking back button to return to chat list");
                simulateClick(headerBackButton);
                await new Promise(resolve => setTimeout(resolve, 1500));
                const chatList = document.querySelector(SELECTORS.CHAT_LIST.container);
                if (chatList) {
                    const chatItems = chatList.querySelectorAll(SELECTORS.CHAT_LIST.messages);
                    let foundChat = null;
                    for (const chat of chatItems) {
                        const titleElement = chat.querySelector(SELECTORS.CHAT.title);
                        const chatTitle = titleElement?.textContent || titleElement?.getAttribute('title');
                        if (chatTitle && chatTitle.includes(chatTitle)) {
                            foundChat = chat;
                            break;
                        }
                    }
                    if (foundChat) {
                        log(`Found original chat, clicking to reopen`);
                        simulateClick(foundChat);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        try {
                            await waitForElement(SELECTORS.CHAT.messageContainer, 5000);
                            log("Successfully reset chat view");
                            return true;
                        } catch (e) {
                            log("Chat loaded but message container not found");
                        }
                    } else {
                        log(`Could not find original chat ${chatTitle} in chat list`);
                    }
                } else {
                    log("Could not find chat list after clicking back");
                }
            } else {
                log("No back button found, trying alternative reset");
                const appWrapper = document.querySelector('#app, .app-wrapper-web');
                if (appWrapper) {
                    appWrapper.style.opacity = '0.99';
                    await new Promise(resolve => setTimeout(resolve, 100));
                    appWrapper.style.opacity = '1';
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    return true;
                }
            }
        } catch (error) {
            log(`Reset chat view error: ${error.message}`);
        }
        
        return false;
    }

    async function applyLastResortRecovery(container) {
        log("Applying last resort recovery techniques");
        try {
            if (container) {
                container.style.display = 'none';
                await new Promise(resolve => setTimeout(resolve, 500));
                container.style.display = '';
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
            const appComponent = document.querySelector('#app');
            if (appComponent) {
                appComponent.classList.add('temp-recovery-class');
                await new Promise(resolve => setTimeout(resolve, 500));
                appComponent.classList.remove('temp-recovery-class');
            }
            const originalZoom = document.body.style.zoom;
            document.body.style.zoom = '99%';
            await new Promise(resolve => setTimeout(resolve, 500));
            document.body.style.zoom = originalZoom || '100%';
            document.dispatchEvent(new Event('resize'));
            window.dispatchEvent(new Event('resize'));
            if (container) {
                for (let i = 0; i < 3; i++) {
                    const rect = container.getBoundingClientRect();
                    const x = rect.left + Math.random() * rect.width;
                    const y = rect.top + Math.random() * rect.height;
                    container.dispatchEvent(new MouseEvent('mousedown', {
                        bubbles: true, cancelable: true, view: window,
                        clientX: x, clientY: y
                    }));
                    await new Promise(resolve => setTimeout(resolve, 100));
                    container.dispatchEvent(new MouseEvent('mouseup', {
                        bubbles: true, cancelable: true, view: window,
                        clientX: x, clientY: y
                    }));
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
            if (container) {
                container.scrollTop = 0;
            }
            log("Last resort recovery completed");
            return true;
        } catch (error) {
            log(`Last resort recovery error: ${error.message}`);
            return false;
        }
    }
    
    // Add all functions to the ui namespace
    window.WhatsAppExporter.ui = {
        enhanceImageLoading,
        loadImage,
        findOldestVisibleDate,
        scrollChatToTop,
        attemptChatReset,
        applyLastResortRecovery
    };
})();