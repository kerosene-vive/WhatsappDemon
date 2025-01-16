//background.js
const TIMEOUTS = {
    SCRIPT_INIT: 2000,
    WHATSAPP_LOAD: 5000,
    CONNECTION_RETRY: 1000,
    MAX_RETRIES: 5
  };
  
  const STATES = {
    INITIAL: 'initial',
    LOADING: 'loading',
    READY: 'ready',
    ERROR: 'error'
  };
  
  const log = (msg) => console.log(`[WhatsApp Exporter] ${msg}`);
  
  const tabStates = new Map();
  
  // Helper function to create PDF content
  async function createPDFContent(content, title) {
      const textContent = `${title}\n\n${content}`;
      return new TextEncoder().encode(textContent);
  }
  
  chrome.runtime.onInstalled.addListener(() => {
      log('Extension installed');
      chrome.sidePanel
          .setOptions({
              path: 'popup.html',
              enabled: true
          })
          .catch(error => log(`Sidepanel setup error: ${error.message}`));
  });
  
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      log(`Received message: ${request.action}`);
      switch (request.action) {
          case "debugLog":
              log(`Content: ${request.message}`);
              break;
          case "openWhatsApp":
              handleWhatsApp(request.numberOfChats);
              break;
          case "automationError":
              log(`Error: ${request.error}`);
              chrome.runtime.sendMessage(request).catch(() => {});
              break;
          case "contentScriptReady":
              if (sender.tab) {
                  tabStates.set(sender.tab.id, STATES.READY);
                  log(`Content script ready in tab ${sender.tab.id}`);
                  sendResponse({ status: 'acknowledged' });
              }
              break;
          case "loadingProgress":
              chrome.runtime.sendMessage(request).catch(() => {});
              break;
          case "processChats":
              processChatsToZip(request.chats)
                  .catch(error => {
                      log(`Error processing chats: ${error.message}`);
                  });
              break;
      }
      return true;
  });
  
  chrome.tabs.onRemoved.addListener((tabId) => {
      tabStates.delete(tabId);
  });
  
  async function injectContentScript(tabId) {
      try {
          await chrome.scripting.executeScript({
              target: { tabId },
              files: ['content.js']
          });
          log(`Content script injection attempted for tab ${tabId}`);
          return true;
      } catch (error) {
          log(`Injection failed: ${error.message}`);
          return false;
      }
  }
  
  async function verifyContentScript(tabId, maxRetries = TIMEOUTS.MAX_RETRIES) {
      for (let i = 0; i < maxRetries; i++) {
          try {
              const response = await chrome.tabs.sendMessage(tabId, { action: 'ping' });
              if (response && response.status === 'ready') {
                  log(`Content script verified in tab ${tabId}`);
                  return true;
              }
          } catch (error) {
              log(`Verification attempt ${i + 1} failed, retrying...`);
              await new Promise(resolve => setTimeout(resolve, TIMEOUTS.CONNECTION_RETRY));
          }
      }
      return false;
  }
  
 // Update the handleWhatsAppTab function to pass the number of chats:
async function handleWhatsAppTab(tab, numberOfChats, isNew = false) {
    try {
        tabStates.set(tab.id, STATES.LOADING);
        await chrome.tabs.update(tab.id, { active: true });
        if (isNew) {
            await new Promise(resolve => setTimeout(resolve, TIMEOUTS.WHATSAPP_LOAD));
        }
        const injected = await injectContentScript(tab.id);
        if (!injected) {
            throw new Error('Failed to inject content script');
        }
        await new Promise(resolve => setTimeout(resolve, TIMEOUTS.SCRIPT_INIT));
        const verified = await verifyContentScript(tab.id);
        if (!verified) {
            throw new Error('Content script verification failed');
        }
        log('Starting automation');
        await chrome.tabs.sendMessage(tab.id, { 
            action: "startAutomation",
            numberOfChats: numberOfChats 
        });
        tabStates.set(tab.id, STATES.READY);
        return true;
    } catch (error) {
        tabStates.set(tab.id, STATES.ERROR);
        throw new Error(`Tab handling failed: ${error.message}`);
    }
}
  
 // Update the handleWhatsApp function to accept numberOfChats:
async function handleWhatsApp(numberOfChats = 1) {
    try {
        const tabs = await chrome.tabs.query({
            url: "https://web.whatsapp.com/*"
        });
        if (tabs.length > 0) {
            log(`Found existing WhatsApp tab: ${tabs[0].id}`);
            await handleWhatsAppTab(tabs[0], numberOfChats, false);
        } else {
            log('Creating new WhatsApp tab');
            const newTab = await chrome.tabs.create({
                url: 'https://web.whatsapp.com',
                active: true
            });
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('Tab load timeout'));
                }, 30000);
                chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
                    if (tabId === newTab.id && info.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener);
                        clearTimeout(timeout);
                        handleWhatsAppTab(newTab, numberOfChats, true)
                            .then(resolve)
                            .catch(reject);
                    }
                });
            });
        }
    } catch (error) {
        log(`Error: ${error.message}`);
        chrome.runtime.sendMessage({ 
            action: "automationError", 
            error: error.message 
        }).catch(() => {});
    }
}

async function processChatsToZip(chats) {
    try {
        // Create ZIP file structure
        const zipHeader = new Uint8Array([
            0x50, 0x4B, 0x03, 0x04, // Local file header signature
            0x0A, 0x00, // Version needed to extract
            0x00, 0x00, // General purpose bit flag
            0x00, 0x00, // Compression method (0 = no compression)
            0x00, 0x00, // File last modification time
            0x00, 0x00, // File last modification date
        ]);

        const allFiles = [];
        let totalSize = 0;
        let centralDirectory = [];
        let offset = 0;

        // Process each chat
        for (const chat of chats) {
            if (!chat.content) continue;

            const textContent = `${chat.title}\n\n${chat.content}`;
            const fileData = new TextEncoder().encode(textContent);
            const safeName = chat.title.replace(/[^a-z0-9]/gi, '_') + '.txt';
            const nameBuffer = new TextEncoder().encode(safeName);

            // Calculate CRC32 for file
            const crc = await calculateCRC32(fileData);

            // Local file header
            const header = new Uint8Array([
                ...zipHeader,
                ...new Uint8Array(crc), // CRC-32
                ...intToBytes(fileData.length, 4), // Compressed size
                ...intToBytes(fileData.length, 4), // Uncompressed size
                ...intToBytes(nameBuffer.length, 2), // File name length
                0x00, 0x00 // Extra field length
            ]);

            // Store central directory entry
            centralDirectory.push({
                header: header,
                nameBuffer: nameBuffer,
                fileData: fileData,
                offset: totalSize
            });

            totalSize += header.length + nameBuffer.length + fileData.length;
        }

        // Create final ZIP buffer
        const finalBuffer = new Uint8Array(totalSize + 1000); // Extra space for central directory
        let currentOffset = 0;

        // Write all file entries
        for (const entry of centralDirectory) {
            finalBuffer.set(entry.header, currentOffset);
            currentOffset += entry.header.length;
            
            finalBuffer.set(entry.nameBuffer, currentOffset);
            currentOffset += entry.nameBuffer.length;
            
            finalBuffer.set(entry.fileData, currentOffset);
            currentOffset += entry.fileData.length;
        }

        // Write central directory
        const cdOffset = currentOffset;
        for (const entry of centralDirectory) {
            // Write central directory header
            const cdHeader = createCentralDirectoryHeader(entry);
            finalBuffer.set(cdHeader, currentOffset);
            currentOffset += cdHeader.length;
        }

        // Write end of central directory record
        const eocd = createEndOfCentralDirectory(centralDirectory.length, cdOffset, currentOffset - cdOffset);
        finalBuffer.set(eocd, currentOffset);
        currentOffset += eocd.length;

        // Create data URL from the ZIP buffer
        const base64Data = btoa(String.fromCharCode.apply(null, finalBuffer.subarray(0, currentOffset)));
        const dataUrl = `data:application/zip;base64,${base64Data}`;

        // Download the ZIP file
        await chrome.downloads.download({
            url: dataUrl,
            filename: 'whatsapp-chats.zip',
            saveAs: true
        });

        log('Successfully created and downloaded ZIP archive');

    } catch (error) {
        log(`Error processing chats: ${error.message}`);
        chrome.runtime.sendMessage({
            action: "automationError",
            error: error.message
        }).catch(() => {});
    }
}

function intToBytes(num, length) {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        bytes[i] = num & 0xFF;
        num = num >>> 8;
    }
    return bytes;
}

async function calculateCRC32(data) {
    let crc = 0xFFFFFFFF;
    const table = generateCRC32Table();
    
    for (const byte of data) {
        crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xFF];
    }
    
    return intToBytes(~crc >>> 0, 4);
}

function generateCRC32Table() {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let crc = i;
        for (let j = 0; j < 8; j++) {
            crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
        }
        table[i] = crc;
    }
    return table;
}

function createCentralDirectoryHeader(entry) {
    // Create central directory header structure
    return new Uint8Array([
        0x50, 0x4B, 0x01, 0x02, // Central directory header signature
        0x14, 0x00, // Version made by
        ...entry.header.subarray(4, 30), // Copy from local header
        0x00, 0x00, // File comment length
        0x00, 0x00, // Disk number start
        0x00, 0x00, // Internal file attributes
        0x00, 0x00, 0x00, 0x00, // External file attributes
        ...intToBytes(entry.offset, 4), // Relative offset of local header
        ...entry.nameBuffer // File name
    ]);
}

function createEndOfCentralDirectory(numEntries, cdOffset, cdSize) {
    return new Uint8Array([
        0x50, 0x4B, 0x05, 0x06, // End of central directory signature
        0x00, 0x00, // Number of this disk
        0x00, 0x00, // Disk where central directory starts
        ...intToBytes(numEntries, 2), // Number of central directory records on this disk
        ...intToBytes(numEntries, 2), // Total number of central directory records
        ...intToBytes(cdSize, 4), // Size of central directory
        ...intToBytes(cdOffset, 4), // Offset of start of central directory
        0x00, 0x00 // Comment length
    ]);
}

log('Background script loaded');