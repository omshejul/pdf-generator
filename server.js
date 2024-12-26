const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// List of allowed origins
const allowedOrigins = [
  'http://localhost:3000',
  '*', // Allow all origins for Postman
];

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET'], // Only allow GET requests
  optionsSuccessStatus: 200
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Create temporary directory if it doesn't exist
const tempDir = path.join(__dirname, 'temp');
fs.mkdir(tempDir, { recursive: true }).catch(console.error);

// Function to generate temporary file path
const getTempFilePath = () => {
  const randomName = crypto.randomBytes(16).toString('hex');
  return path.join(tempDir, `${randomName}.pdf`);
};

// Function to delete file after delay
const deleteFileAfterDelay = async (filePath, delay = 5000) => {
  setTimeout(async () => {
    try {
      await fs.unlink(filePath);
      console.log(`[CLEANUP] Deleted temporary file: ${filePath}`);
    } catch (error) {
      console.error(`[ERROR] Failed to delete temporary file: ${filePath}`, error);
    }
  }, delay);
};

const config = {
  viewport: {
    width: 1200,
    height: 1800,
    deviceScaleFactor: 0.8
  },
  pdf: {
    scale: 1,
    margin: {
      top: '20px',
      right: '20px',
      bottom: '20px',
      left: '20px'
    }
  }
};
app.get('/generate-pdf', async (req, res) => {
  let browser;
  let tempFilePath;
  try {
    const url = req.query.url;
    if (!url) {
      throw new Error('URL parameter is required');
    }

    console.log(`[1] Starting PDF generation for URL: ${url}`);
    
    // Generate temporary file path
    tempFilePath = getTempFilePath();
    console.log(`[1.1] Will use temporary file: ${tempFilePath}`);

    // Launch browser with specific configurations
    console.log('[2] Launching browser...');
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--font-render-hinting=none'
      ]
    });
    console.log('[3] Browser launched successfully');
    
    console.log('[4] Creating new page...');
    const page = await browser.newPage();
    console.log('[5] New page created');

    // Set viewport for better rendering
    console.log('[6] Setting viewport...');
    await page.setViewport(config.viewport);
    console.log('[7] Viewport set');

    // Navigate to the webpage with the provided URL
    console.log(`[8] Navigating to URL: ${url}`);
    
    const response = await page.goto(url, {
      waitUntil: ['networkidle0', 'load', 'domcontentloaded'],
      timeout: 60000
    });
    console.log(`[9] Page loaded with status: ${response.status()}`);

    // Check if page loaded successfully
    if (!response.ok()) {
      console.error(`[ERROR] Failed to load page: ${response.status()}`);
      throw new Error(`Failed to load page: ${response.status()}`);
    }

    // Wait for content to be fully loaded
    console.log('[10] Waiting for dynamic content...');
    try {
      await page.waitForSelector('body', { timeout: 10000 });
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (error) {
      console.log('[WARNING] Timeout waiting for content, proceeding anyway...');
    }
    console.log('[11] Wait complete');

    // Generate PDF and save to temporary file
    console.log('[12] Generating PDF...');
    await page.pdf({
      path: tempFilePath,
      format: 'A4',
      printBackground: true,
      ...config.pdf,
      preferCSSPageSize: true,
      timeout: 60000
    });
    console.log('[13] PDF generated and saved to temporary file');

    // Verify file exists and has content
    const stats = await fs.stat(tempFilePath);
    console.log(`[13.1] PDF file size: ${stats.size} bytes`);
    if (stats.size === 0) {
      throw new Error('Generated PDF file is empty');
    }

    // Read the file
    console.log('[14] Reading PDF file...');
    const pdfBuffer = await fs.readFile(tempFilePath);

    // Set response headers
    console.log('[15] Setting response headers...');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=generated.pdf`);
    res.setHeader('Content-Length', pdfBuffer.length);
    
    // Send the PDF
    console.log('[16] Sending PDF response...');
    res.send(pdfBuffer);
    console.log('[17] PDF sent successfully');

    // Schedule file deletion
    deleteFileAfterDelay(tempFilePath);

  } catch (error) {
    console.error('[ERROR] Error in PDF generation:', error);
    console.error('[ERROR] Stack trace:', error.stack);
    res.status(500).json({ 
      error: 'Failed to generate PDF',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
    
    // Try to delete the temporary file if it exists
    if (tempFilePath) {
      deleteFileAfterDelay(tempFilePath, 0);
    }
  } finally {
    // Ensure browser is closed even if there's an error
    if (browser) {
      console.log('[CLEANUP] Closing browser...');
      try {
        await browser.close();
        console.log('[CLEANUP] Browser closed');
      } catch (error) {
        console.error('[CLEANUP ERROR] Failed to close browser:', error);
      }
    }
  }
});

// Add a route for the homepage
app.get('/', (req, res) => {
  res.send('Server is running!');
});

// Error handling for uncaught exceptions
process.on('unhandledRejection', (error) => {
  console.error('[UNHANDLED REJECTION]', error);
});

app.listen(port, () => {
  console.log(`[SERVER] Server running on port ${port}`);
});