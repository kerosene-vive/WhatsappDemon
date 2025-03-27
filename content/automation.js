// Automation module
(function() {
    // Get access to other modules
    const { SELECTORS, TIMEOUTS } = window.WhatsAppExporter.constants;
    const { state } = window.WhatsAppExporter;
    const { log, waitForElement, simulateClick, getChatsList } = window.WhatsAppExporter.utils;
    const { extractChatContentAndMedia } = window.WhatsAppExporter.chat;
    
    // Automation functions
    async function initialize() {
        if (state.isInitialized || state.initializationAttempts >= state.MAX_INIT_ATTEMPTS) return state.isInitialized;
        state.initializationAttempts++;
        try {
            const qrCode = document.querySelector('div[data-ref]');
            const chatList = document.querySelector('#pane-side');
            if (qrCode && !chatList) {
                chrome.runtime.sendMessage({ action: 'whatsappLoginRequired' });
                setTimeout(() => { state.initializationAttempts--; initialize(); }, 1000);
                return false;
            }
            if (!await waitForElement('#pane-side', 10000)) {
                setTimeout(initialize, TIMEOUTS.INIT_RETRY);
                return false;
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
            state.availableChats = await getChatsList();
            if (state.availableChats.length === 0) {
                setTimeout(initialize, TIMEOUTS.INIT_RETRY);
                return false;
            }
            chrome.runtime.sendMessage({ 
                action: 'chatsAvailable', 
                chats: state.availableChats.map(chat => chat.title)
            });
            state.isInitialized = true;
            return true;
        } catch (error) {
            log(`Init error: ${error.message}`);
            if (state.initializationAttempts < state.MAX_INIT_ATTEMPTS) {
                setTimeout(initialize, TIMEOUTS.INIT_RETRY);
            }
            return false;
        }
    }

    async function automateWhatsAppExport(selectedChats, endDate) {
        try {
            for (let chatTitle of selectedChats) {
                try {
                    const chat = state.availableChats.find(c => c.title === chatTitle);
                    if (!chat) {
                        log(`Chat not found: ${chatTitle}`);
                        continue;
                    }
                    await new Promise((resolve) => {
                        chrome.runtime.sendMessage({ action: "enforceTabFocus" }, resolve);
                    });
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    log(`Clicking on chat: ${chatTitle}`);
                    simulateClick(chat.clickableElement);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    try {
                        await waitForElement(SELECTORS.CHAT.messageContainer, 5000);
                    } catch (waitError) {
                        log(`Error waiting for message container: ${waitError.message}`);
                        simulateClick(chat.clickableElement);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        await waitForElement(SELECTORS.CHAT.messageContainer, 5000);
                    }
                    const messageContainer = document.querySelector(SELECTORS.CHAT.messageContainer);
                    if (!messageContainer) {
                        throw new Error('Message container not found after chat selection');
                    }
                    const scrollContainer = document.querySelector(SELECTORS.CHAT.scrollContainer);
                    if (!scrollContainer) {
                        throw new Error('Scroll container not found');
                    }
                    const result = await extractChatContentAndMedia(chatTitle, endDate);
                    chrome.runtime.sendMessage({ 
                        action: "exportProgress",
                        progress: Math.round((selectedChats.indexOf(chatTitle) + 1) / selectedChats.length * 100),
                        chat: chatTitle,
                        stats: {
                            messages: result.totalMessages,
                            media: result.mediaContent
                        }
                    });
                    chrome.runtime.sendMessage({ action: "chatProcessed" });
                } catch (chatError) {
                    log(`Error processing chat ${chatTitle}: ${chatError.message}`);
                    chrome.runtime.sendMessage({
                        action: "automationError",
                        error: `Error processing chat ${chatTitle}: ${chatError.message}`
                    });
                }
            }
            chrome.runtime.sendMessage({ 
                action: "exportComplete",
                message: `Successfully processed ${selectedChats.length} chats`
            });
        } catch (error) {
            log(`Automation error: ${error.message}`);
            chrome.runtime.sendMessage({
                action: "automationError",
                error: error.message
            });
        } finally {
            state.processingAutomation = false;
        }
    }
    
    // Add functions to the automation namespace
    window.WhatsAppExporter.automation = {
        initialize,
        automateWhatsAppExport
    };
})();