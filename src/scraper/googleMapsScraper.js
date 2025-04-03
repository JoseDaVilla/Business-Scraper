const { chromium } = require('playwright');
const db = require('../config/database');

class GoogleMapsScraper {
  constructor(maxResults = 200) {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.maxResults = maxResults; // Maximum number of results to scrape
  }

  async initialize() {
    // Run browser in headless mode for better performance
    this.browser = await chromium.launch({ 
      headless: true,
      args: [
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process'
      ]
    });
    
    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      hasTouch: false,
      javaScriptEnabled: true,
      bypassCSP: true,
      locale: 'en-US', // Set locale to English US
      timezoneId: 'America/New_York',
      geolocation: { longitude: -73.97, latitude: 40.77 }, // New York coordinates
      permissions: ['geolocation']
    });
    
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(45000); // Increased timeout for reliability
    
    console.log("Browser initialized successfully in headless mode with English locale");
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  // New method to just get the list of business URLs
  async getBusinessList(searchTerm) {
    try {
      console.log(`Searching for: ${searchTerm}`);
      
      // Navigate to Google Maps with reliable wait options and English language explicitly set
      await this.page.goto('https://www.google.com/maps?hl=en', { 
        waitUntil: 'domcontentloaded',
        timeout: 60000 
      });
      console.log("Navigated to Google Maps");
      
      // Make sure the page is fully loaded
      await this.page.waitForLoadState('load');
      
      // Accept cookies if prompted
      try {
        const acceptButton = await this.page.$('button:has-text("Accept all")');
        if (acceptButton) {
          await acceptButton.click();
          await this.page.waitForTimeout(1000);
        }
      } catch (e) {
        console.log('No cookie consent needed or already accepted');
      }

      // Focus on search box first
      await this.page.click('input[name="q"]');
      await this.page.waitForTimeout(500);

      // Clear any existing text and search for the term
      console.log(`Entering search term: ${searchTerm}`);
      await this.page.fill('input[name="q"]', '');
      await this.page.fill('input[name="q"]', searchTerm);
      
      // Press Enter and wait for navigation
      await Promise.all([
        this.page.keyboard.press('Enter'),
        this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30000 })
          .catch(() => console.log('Navigation timeout, continuing anyway'))
      ]);
      
      // Wait for search results feed to appear
      console.log("Waiting for search results to load...");
      await this.page.waitForSelector('div[role="feed"], div[jsaction*="mouseover:pane.wfvdle"]', { timeout: 30000 })
        .catch(() => console.log('Feed selector not found, continuing anyway'));
      
      // Take a screenshot for debugging in headless mode
      await this.page.screenshot({ path: 'debug-search-results.png' });
      console.log("Saved debug screenshot");
      
      // Wait for results to appear
      await this.page.waitForTimeout(3000);
      
      // Get business URLs through improved scrolling
      return await this.gatherBusinessUrls();
    } catch (error) {
      console.error('Error getting business list:', error);
      // Save screenshot on error for debugging
      await this.page.screenshot({ path: 'error-search-results.png' });
      console.error('Error screenshot saved to error-search-results.png');
      return [];
    }
  }

  async gatherBusinessUrls() {
    const businessUrls = [];
    let previousResultsCount = 0;
    let scrollAttempts = 0;
    const maxScrollAttempts = 50; // Increased for more thorough scrolling
    
    console.log(`Gathering business URLs (max: ${this.maxResults})...`);
    
    try {
      // Keep scrolling and collecting results until we stop finding new ones or hit the limit
      while (scrollAttempts < maxScrollAttempts && businessUrls.length < this.maxResults) {
        // Find all business elements
        const businessElements = await this.page.$$('div.Nv2PK');
        console.log(`Found ${businessElements.length} business elements, gathered ${businessUrls.length} URLs so far`);
        
        if (businessElements.length > previousResultsCount) {
          previousResultsCount = businessElements.length;
          scrollAttempts = 0; // Reset scroll attempts when we find new results
          
          // Extract URLs for the new elements
          for (let i = businessUrls.length; i < businessElements.length && businessUrls.length < this.maxResults; i++) {
            try {
              // Extract the URL without clicking (more efficient)
              const href = await businessElements[i].$eval('a.hfpxzc', el => el.getAttribute('href'));
              if (href) {
                // Clean the URL to remove problematic parameters
                const cleanedHref = href.replace(/authuser=\d+&hl=[^&]+/, 'hl=en');
                businessUrls.push(cleanedHref);
                
                if (businessUrls.length % 10 === 0) {
                  console.log(`Gathered ${businessUrls.length} business URLs`);
                }
              }
            } catch (error) {
              console.error(`Error extracting URL for business ${i+1}:`, error);
            }
          }
          
          // If we've reached the limit, break out of the loop
          if (businessUrls.length >= this.maxResults) {
            console.log(`Reached maximum of ${this.maxResults} businesses, stopping URL gathering`);
            break;
          }
        } else {
          scrollAttempts++;
          console.log(`No new results found, scroll attempt ${scrollAttempts}/${maxScrollAttempts}`);
        }
        
        // More aggressive scrolling by simulating multiple small scrolls
        await this.performImprovedScroll();
        
        // Wait less time between scrolls for better performance
        await this.page.waitForTimeout(1000);
      }
      
      console.log(`Finished gathering URLs. Found ${businessUrls.length} businesses`);
      return businessUrls.slice(0, this.maxResults);
    } catch (error) {
      console.error('Error gathering business URLs:', error);
      return businessUrls.slice(0, this.maxResults);
    }
  }
  
  async performImprovedScroll() {
    // Scroll in smaller increments multiple times
    await this.page.evaluate(() => {
      const feed = document.querySelector('div[role="feed"]');
      if (feed) {
        const height = feed.clientHeight;
        // Perform three smaller scrolls instead of one big scroll
        feed.scrollTop += height / 3;
        setTimeout(() => { feed.scrollTop += height / 3; }, 100);
        setTimeout(() => { feed.scrollTop += height / 3; }, 200);
      }
    });
  }

  // ...rest of existing methods are kept but will not be used in parallel mode...
}

module.exports = GoogleMapsScraper;
