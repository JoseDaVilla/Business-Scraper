const { chromium } = require('playwright');
const db = require('../config/database');
const path = require('path');
const fs = require('fs');
const debug = require('../tools/debugHelper');

class GoogleMapsScraper {
  constructor(maxResults = 200) {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.maxResults = maxResults; // Maximum number of results to scrape
    
    // Create debug directory if it doesn't exist
    this.debugDir = path.join(__dirname, '../../debug');
    if (!fs.existsSync(this.debugDir)) {
      fs.mkdirSync(this.debugDir, { recursive: true });
    }
  }

  async initialize() {
    // Run browser with more robust settings
    this.browser = await chromium.launch({ 
      headless: true,
      args: [
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--no-sandbox',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-blink-features=AutomationControlled', // Try to hide automation
        '--window-size=1920,1080'
      ]
    });
    
    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      hasTouch: false,
      javaScriptEnabled: true,
      bypassCSP: true,
      locale: 'en-US', // Set locale to English US
      timezoneId: 'America/New_York',
      geolocation: { longitude: -73.97, latitude: 40.77 }, // New York coordinates
      permissions: ['geolocation'],
      // Additional settings to avoid detection
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      colorScheme: 'light'
    });
    
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(60000); // Increased timeout for reliability
    
    // Add custom scripts to bypass detection
    await this.page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
      
      // Overwrite the plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      
      // Overwrite the languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
    });
    
    debug.info("Browser initialized successfully with enhanced anti-detection");
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  // New method to get the list of business URLs
  async getBusinessList(searchTerm) {
    try {
      debug.info(`Searching for: ${searchTerm}`);
      
      // Navigate to Google Maps with reliable wait options and English language explicitly set
      await this.page.goto('https://www.google.com/maps?hl=en', { 
        waitUntil: 'domcontentloaded',
        timeout: 60000 
      });
      debug.info("Navigated to Google Maps");
      
      // Make sure the page is fully loaded
      await this.page.waitForLoadState('load');
      
      // Take an initial screenshot
      const screenshotPath = path.join(this.debugDir, 'initial-page.png');
      await this.page.screenshot({ path: screenshotPath, fullPage: true });
      debug.info(`Saved initial page screenshot to ${screenshotPath}`);
      
      // Accept cookies if prompted (try multiple selectors)
      await this.acceptCookiesIfNeeded();
      
      // Add a small random delay to appear more human-like
      await this.randomDelay(1000, 3000);
      
      // Focus on search box first - try multiple selector strategies
      await this.tryMultipleSelectors([
        'input[name="q"]',
        'input#searchboxinput',
        'input[aria-label*="Search"]',
        'input.searchboxinput'
      ], 'click');
      
      await this.randomDelay(500, 1500);

      // Clear any existing text and search for the term with slower, human-like typing
      debug.info(`Entering search term: ${searchTerm}`);
      
      await this.clearAndTypeText('input[name="q"]', searchTerm);
      
      // Press Enter and wait for navigation
      await Promise.all([
        this.page.keyboard.press('Enter'),
        this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 })
          .catch(() => debug.warn('Navigation timeout, continuing anyway'))
      ]);
      
      // Wait for search results feed to appear
      debug.info("Waiting for search results to load...");
      
      // Try multiple selectors for the feed
      const feedSelectors = [
        'div[role="feed"]', 
        'div[jsaction*="mouseover:pane.wfvdle"]',
        '.section-scrollbox',
        '.section-result-content',
        '.VkpGBb' // New selector observed in current Google Maps
      ];
      
      let feedFound = false;
      for (const selector of feedSelectors) {
        try {
          await this.page.waitForSelector(selector, { timeout: 20000 });
          debug.info(`Feed found using selector: ${selector}`);
          feedFound = true;
          break;
        } catch (e) {
          debug.warn(`Selector ${selector} not found`);
        }
      }
      
      if (!feedFound) {
        debug.warn("No feed selector matched. Taking screenshot and continuing anyway");
      }
      
      // Take a screenshot after search results load
      const searchScreenshotPath = path.join(this.debugDir, 'search-results.png');
      await this.page.screenshot({ path: searchScreenshotPath, fullPage: true });
      debug.info(`Saved search results screenshot to ${searchScreenshotPath}`);
      
      // Wait for results to stabilize
      await this.randomDelay(3000, 5000);
      
      // Save page HTML for debugging
      const html = await this.page.content();
      fs.writeFileSync(path.join(this.debugDir, 'search-results.html'), html);
      debug.info("Saved search results HTML for inspection");
      
      // Get business URLs through improved scrolling
      const urls = await this.gatherBusinessUrls();
      
      // Take a final screenshot after gathering URLs
      const finalScreenshotPath = path.join(this.debugDir, 'after-gathering-urls.png');
      await this.page.screenshot({ path: finalScreenshotPath, fullPage: true });
      
      // Log the number of URLs found
      debug.info(`Found ${urls.length} business URLs`);
      return urls;
    } catch (error) {
      debug.error('Error getting business list:', error);
      // Save screenshot on error for debugging
      await this.page.screenshot({ path: path.join(this.debugDir, 'error-search-results.png') });
      debug.error('Error screenshot saved');
      return [];
    }
  }

  async gatherBusinessUrls() {
    const businessUrls = [];
    let previousResultsCount = 0;
    let scrollAttempts = 0;
    const maxScrollAttempts = 200; // Increased for more thorough scrolling
    const maxConsecutiveFailedAttempts = 15; // Increased for more resilience
    let consecutiveFailedAttempts = 0;
    
    debug.info(`Gathering business URLs (max: ${this.maxResults})...`);
    
    try {
      // Initial wait for page to stabilize
      await this.randomDelay(2000, 4000);
      
      // Keep scrolling and collecting results until we reach limits
      while (scrollAttempts < maxScrollAttempts && 
             businessUrls.length < this.maxResults &&
             consecutiveFailedAttempts < maxConsecutiveFailedAttempts) {
        
        // Take occasional screenshots to track scrolling progress
        if (scrollAttempts % 20 === 0) {
          const scrollScreenshot = path.join(this.debugDir, `scroll-attempt-${scrollAttempts}.png`);
          await this.page.screenshot({ path: scrollScreenshot, fullPage: true });
        }
        
        // Try multiple selectors for business elements
        const businessElements = await this.page.evaluate(() => {
          // Combined selectors approach - try every possible business element selector
          const selectors = [
            'div.Nv2PK', 
            '.xvfwg', 
            '[data-result-index]',
            'div.bfdHYd',
            'a.hfpxzc',
            'div.MjjYud',
            'div.Nv2PK, a.hfpxzc', // Combined selector
            'div[jsaction*="mouseover:pane"] a',
            'div[jsaction*="pane.placeResult"] a',
            'a[href*="maps/place"]',
            'div[role="feed"] > div' // Generic feed item
          ];
          
          // Try each selector and return all matches
          let allElements = [];
          for (const selector of selectors) {
            const elements = Array.from(document.querySelectorAll(selector));
            if (elements.length > 0) {
              allElements = allElements.concat(elements);
            }
          }
          
          // Get unique elements (may have duplicates from different selectors)
          const uniqueElements = [...new Set(allElements)];
          
          // Extract URLs from elements
          return uniqueElements
            .filter(element => {
              // Filter elements that look like business listings
              return element.tagName === 'A' || element.querySelector('a[href*="maps/place"]');
            })
            .map(element => {
              // Get the href attribute from the element or its child
              const link = element.tagName === 'A' ? element : element.querySelector('a[href*="maps/place"]');
              return link ? link.href : null;
            })
            .filter(url => url && url.includes('/maps/place/'));
        });
        
        // Log the progress
        debug.info(`Found ${businessElements.length} business elements, gathered ${businessUrls.length} URLs so far (attempt ${scrollAttempts})`);
        
        // Process new findings
        if (businessElements.length > previousResultsCount) {
          // Reset consecutive failures when we find new results
          consecutiveFailedAttempts = 0;
          
          // Update the count for next comparison
          previousResultsCount = businessElements.length;
          
          // Add new business URLs to our collection, avoiding duplicates
          const existingUrls = new Set(businessUrls);
          
          for (const url of businessElements) {
            if (!existingUrls.has(url) && businessUrls.length < this.maxResults) {
              businessUrls.push(url);
              existingUrls.add(url);
            }
          }
          
          debug.info(`Total unique URLs collected: ${businessUrls.length}`);
          
          // Stop if we've reached the limit
          if (businessUrls.length >= this.maxResults) {
            debug.info(`Reached maximum URLs limit (${this.maxResults}), stopping gathering`);
            break;
          }
        } else {
          // No new results found
          consecutiveFailedAttempts++;
          debug.info(`No new results found. Consecutive failed attempts: ${consecutiveFailedAttempts}/${maxConsecutiveFailedAttempts}`);
        }
        
        // Increment scroll attempt counter
        scrollAttempts++;
        
        // Perform a scroll action with randomized behavior
        await this.performEnhancedScrolling();
        
        // Wait between scrolls - variable timeout
        const scrollWaitTime = Math.floor(2000 + (Math.random() * 3000));
        await this.page.waitForTimeout(scrollWaitTime);
      }
      
      debug.info(`Finished gathering URLs. Found ${businessUrls.length} businesses`);
      
      // Return unique URLs
      return [...new Set(businessUrls)].slice(0, this.maxResults);
    } catch (error) {
      debug.error('Error gathering business URLs:', error);
      return [...new Set(businessUrls)].slice(0, this.maxResults);
    }
  }

  // Enhanced scrolling technique with randomization
  async performEnhancedScrolling() {
    try {
      // Use different scrolling techniques randomly
      const scrollTechnique = Math.floor(Math.random() * 4);
      
      switch (scrollTechnique) {
        case 0: // Standard scroll
          await this.page.evaluate(() => {
            const feedElement = document.querySelector('div[role="feed"], .VkpGBb, .section-scrollbox');
            if (feedElement) {
              feedElement.scrollTop += 800 + Math.floor(Math.random() * 400);
            } else {
              window.scrollBy(0, 800 + Math.floor(Math.random() * 400));
            }
          });
          break;
          
        case 1: // Smooth scroll
          await this.page.evaluate(() => {
            return new Promise(resolve => {
              const feedElement = document.querySelector('div[role="feed"], .VkpGBb, .section-scrollbox');
              const targetScroll = (feedElement?.scrollTop || window.scrollY) + 800;
              
              const smoothScroll = () => {
                if (feedElement) {
                  feedElement.scrollTop += 50;
                  if (feedElement.scrollTop < targetScroll) {
                    setTimeout(smoothScroll, 30);
                  } else {
                    resolve();
                  }
                } else {
                  window.scrollBy(0, 50);
                  if (window.scrollY < targetScroll) {
                    setTimeout(smoothScroll, 30);
                  } else {
                    resolve();
                  }
                }
              };
              
              smoothScroll();
            });
          });
          break;
          
        case 2: // Mouse wheel simulation
          await this.page.evaluate(() => {
            const feedElement = document.querySelector('div[role="feed"], .VkpGBb, .section-scrollbox');
            
            if (feedElement) {
              for (let i = 0; i < 20; i++) {
                setTimeout(() => {
                  feedElement.dispatchEvent(new WheelEvent('wheel', {
                    deltaY: 120,
                    bubbles: true
                  }));
                }, i * 100);
              }
            } else {
              for (let i = 0; i < 20; i++) {
                setTimeout(() => {
                  window.scrollBy({
                    top: 100,
                    behavior: 'smooth'
                  });
                }, i * 100);
              }
            }
          });
          
          // Wait for wheel events to complete
          await this.page.waitForTimeout(2500);
          break;
          
        case 3: // Click "Show more" button if it exists
          try {
            const showMoreButton = await this.page.$('button:has-text("Show more")');
            if (showMoreButton) {
              await showMoreButton.click();
              await this.page.waitForTimeout(1000);
            } else {
              // Fallback to standard scroll
              await this.page.evaluate(() => {
                const feedElement = document.querySelector('div[role="feed"], .VkpGBb, .section-scrollbox');
                if (feedElement) {
                  feedElement.scrollTop += 800;
                } else {
                  window.scrollBy(0, 800);
                }
              });
            }
          } catch (e) {
            // Fallback to standard scroll
            await this.page.evaluate(() => {
              window.scrollBy(0, 800);
            });
          }
          break;
      }
    } catch (error) {
      debug.error('Error during enhanced scrolling:', error);
      // Fallback to basic scrolling
      await this.page.evaluate(() => window.scrollBy(0, 500));
    }
  }
  
  // Helper: Try multiple selectors until one works
  async tryMultipleSelectors(selectors, action, timeout = 5000) {
    for (const selector of selectors) {
      try {
        const element = await this.page.waitForSelector(selector, { timeout });
        if (element) {
          if (action === 'click') await element.click();
          return element;
        }
      } catch (e) {
        debug.warn(`Selector ${selector} not found or action failed`);
      }
    }
    throw new Error(`None of the selectors matched: ${selectors.join(', ')}`);
  }
  
  // Helper: Clear and type text with human-like behavior
  async clearAndTypeText(selector, text) {
    try {
      // Click the field first
      await this.page.click(selector);
      
      // Clear the field
      await this.page.fill(selector, '');
      
      // Type with random delays between characters
      for (const char of text) {
        await this.page.type(selector, char, { delay: Math.floor(50 + Math.random() * 100) });
        
        // Add occasional longer pauses
        if (Math.random() < 0.1) {
          await this.page.waitForTimeout(200 + Math.random() * 300);
        }
      }
    } catch (error) {
      debug.error(`Error typing text: ${error.message}`);
      // Fallback to simple fill
      await this.page.fill(selector, text);
    }
  }
  
  // Helper: Random delay to appear more human-like
  async randomDelay(min, max) {
    const delay = Math.floor(min + Math.random() * (max - min));
    await this.page.waitForTimeout(delay);
  }
  
  // Helper: Accept cookies if prompted
  async acceptCookiesIfNeeded() {
    try {
      // Try multiple selectors for cookie consent
      const cookieSelectors = [
        'button:has-text("Accept all")',
        'button:has-text("I agree")',
        'button:has-text("Accept")',
        'button[aria-label="Accept all"]',
        'form button:nth-child(1)'
      ];
      
      for (const selector of cookieSelectors) {
        const cookieButton = await this.page.$(selector);
        if (cookieButton) {
          debug.info(`Found cookie consent button: ${selector}`);
          await cookieButton.click();
          await this.page.waitForTimeout(1000);
          return true;
        }
      }
      
      debug.info('No cookie consent needed or already accepted');
      return false;
    } catch (e) {
      debug.warn('Error handling cookie consent:', e);
      return false;
    }
  }
}

module.exports = GoogleMapsScraper;
