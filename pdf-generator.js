// Listen for messages from the background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'generatePDF') {
      generatePDF(request.html, request.filename)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ 
          status: 'error', 
          message: error.message 
        }));
      return true; // Keep the messaging channel open for async response
    }
  });
  
  // Function to generate PDF using html2pdf
  async function generatePDF(html, filename) {
    try {
      // Update status
      chrome.runtime.sendMessage({
        action: 'pdfConversionProgress',
        progress: 20,
        processingId: filename,
        message: 'Preparing document...'
      });
      
      // Get the container
      const container = document.getElementById('content-container');
      
      // Set the HTML content
      container.innerHTML = html;
      
      // Update status
      chrome.runtime.sendMessage({
        action: 'pdfConversionProgress',
        progress: 40,
        processingId: filename,
        message: 'Generating PDF...'
      });
      
      // Generate PDF
      const pdfBlob = await html2pdf()
        .set({
          margin: 1,
          filename: `${filename}.pdf`,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { 
            scale: 2,
            useCORS: true
          },
          jsPDF: { 
            unit: 'in', 
            format: 'letter', 
            orientation: 'portrait' 
          }
        })
        .from(container)
        .outputPdf('blob');
      
      // Update status
      chrome.runtime.sendMessage({
        action: 'pdfConversionProgress',
        progress: 80,
        processingId: filename,
        message: 'PDF generated, preparing download...'
      });
      
      // Create download URL
      const url = URL.createObjectURL(pdfBlob);
      
      // Download the file
      const result = await new Promise((resolve) => {
        chrome.downloads.download({
          url: url,
          filename: `${filename}.pdf`,
          saveAs: false
        }, (downloadId) => {
          if (chrome.runtime.lastError) {
            resolve({ 
              status: 'error',
              message: chrome.runtime.lastError.message
            });
          } else {
            resolve({ 
              status: 'success',
              downloadId: downloadId,
              filename: `${filename}.pdf`
            });
          }
        });
      });
      
      // Update status
      chrome.runtime.sendMessage({
        action: 'pdfConversionProgress',
        progress: 100,
        processingId: filename,
        message: 'PDF downloaded successfully'
      });
      
      // Clean up
      URL.revokeObjectURL(url);
      container.innerHTML = '';
      
      return result;
    } catch (error) {
      console.error('PDF generation error:', error);
      
      // Update status
      chrome.runtime.sendMessage({
        action: 'pdfConversionError',
        processingId: filename,
        error: error.message
      });
      
      throw error;
    }
  }