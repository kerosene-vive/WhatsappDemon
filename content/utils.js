// Immediately invoked function expression to create a local scope
(function() {
    // Get access to the constants
    const { SELECTORS, TIMEOUTS } = window.WhatsAppExporter.constants;
    
    // Utility functions
    const log = msg => {
        console.log(`[WhatsApp Export] ${msg}`);
        chrome.runtime.sendMessage({ action: "debugLog", message: msg }).catch(() => {});
    };
    
    const downloadMedia = async (blob, filename) => {
        chrome.runtime.sendMessage({
            action: "downloadMedia",
            data: { url: URL.createObjectURL(blob), filename, type: blob.type }
        });
    };
    
    const simulateClick = element => {
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        ['mouseover', 'mousedown', 'mouseup', 'click'].forEach(type => 
            element.dispatchEvent(new MouseEvent(type, {
                bubbles: true, cancelable: true, view: window,
                clientX: x + (Math.random() * 4 - 2),
                clientY: y + (Math.random() * 4 - 2)
            }))
        );
    };
    
    const isElementVisible = (element) => {
        const rect = element.getBoundingClientRect();
        return (
            rect.width > 0 &&
            rect.height > 0 &&
            rect.top < window.innerHeight &&
            rect.left < window.innerWidth
        );
    };
    
    const waitForElement = (selector, timeout = TIMEOUTS.LOAD) => 
        new Promise((resolve, reject) => {
            const checkElement = () => {
                const element = document.querySelector(selector);
                if (element && isElementVisible(element)) {
                    return resolve(element);
                }
                const observer = new MutationObserver((mutations, obs) => {
                    const element = document.querySelector(selector);
                    if (element && isElementVisible(element)) {
                        obs.disconnect();
                        resolve(element);
                    }
                });
                observer.observe(document.body, {
                    childList: true,
                    subtree: true,
                    attributes: true
                });
                setTimeout(() => {
                    observer.disconnect();
                    reject(new Error(`Timeout: ${selector}`));
                }, timeout);
            };
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', checkElement);
            } else {
                checkElement();
            }
    });
    
    const getChatsList = async () => {
        const container = await waitForElement(SELECTORS.CHAT_LIST.container);
        const elements = container.querySelectorAll(SELECTORS.CHAT.item);
        return Array.from(elements)
            .map(chat => {
                const titleSpan = chat.querySelector(SELECTORS.CHAT.title);
                const title = titleSpan?.getAttribute('title');
                if (title) {
                    const gridCell = chat.querySelector(SELECTORS.CHAT.gridCell);
                    const clickableArea = gridCell?.querySelector(SELECTORS.CHAT.clickableArea);
                    if (clickableArea) {
                        return {
                            title,
                            clickableElement: clickableArea
                        };
                    }
                }
                return null;
            })
            .filter(chat => chat !== null);
    };
    
    function generateExportFolderName(chatTitle) {
        const now = new Date();
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const year = now.getFullYear();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const folderName = `Export_${day}-${month}-${year}_${hours}-${minutes}-${seconds}`;
        return `${chatTitle}/${folderName}`;
    }
    
    // Add all utility functions to the global namespace
    window.WhatsAppExporter.utils = {
        log,
        downloadMedia,
        simulateClick,
        isElementVisible,
        waitForElement,
        getChatsList,
        generateExportFolderName
    };
})();