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
    const maxScrollAttempts = 200; // Keep high number of attempts
    const maxConsecutiveFailedAttempts = 15; // Keep current limit
    let consecutiveFailedAttempts = 0;
    
    debug.info(`Gathering business URLs (max: ${this.maxResults})...`);
    
    try {
      // Initial wait for page to stabilize
      await this.randomDelay(2000, 4000);
      
      // Generate a unique ID for this extraction run for the debug screenshots
      const runId = new Date().toISOString().replace(/[:.]/g, '-');
      
      // Keep scrolling and collecting results until we reach limits
      while (scrollAttempts < maxScrollAttempts && 
             businessUrls.length < this.maxResults &&
             consecutiveFailedAttempts < maxConsecutiveFailedAttempts) {
        
        // Take occasional screenshots to track scrolling progress
        if (scrollAttempts % 20 === 0) {
          const scrollScreenshot = path.join(this.debugDir, `scroll-attempt-${runId}-${scrollAttempts}.png`);
          await this.page.screenshot({ path: scrollScreenshot, fullPage: true });
        }
        
        // Use a more direct and comprehensive approach to find business elements and URLs
        const extractedUrls = await this.page.evaluate(() => {
          // First approach: Find all link elements that point to Maps place pages
          const allLinks = Array.from(document.querySelectorAll('a[href*="/maps/place/"]'));
          
          // Make sure we're getting unique elements (not duplicated in the DOM)
          const uniqueLinks = [...new Set(allLinks)];
          
          // Get full URLs from valid links
          return uniqueLinks
            .map(link => {
              const href = link.href;
              // Only include actual place links, not directions or other types
              if (href && href.includes('/maps/place/') && !href.includes('/dir/')) {
                return href;
              }
              return null;
            })
            .filter(Boolean);
        });
        
        // For debugging, get count of ALL business elements in different ways
        const elementCounts = await this.page.evaluate(() => {
          return {
            mapsPlaceLinks: document.querySelectorAll('a[href*="/maps/place/"]').length,
            nv2pkDivs: document.querySelectorAll('div.Nv2PK').length,
            feedItems: document.querySelectorAll('div[role="feed"] > div').length,
            allDivsWithData: document.querySelectorAll('div[data-result-index]').length
          };
        });
        
        debug.info(`Found ${JSON.stringify(elementCounts)} elements, extracted ${extractedUrls.length} URLs`);
        
        // Process new findings
        if (extractedUrls.length > previousResultsCount) {
          // Reset consecutive failures when we find new results
          consecutiveFailedAttempts = 0;
          
          // Update the count for next comparison
          previousResultsCount = extractedUrls.length;
          
          // Add new business URLs to our collection, avoiding duplicates
          const existingUrls = new Set(businessUrls);
          
          for (const url of extractedUrls) {
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
        
        // Try a more aggressive scrolling approach when no new results for a while
        if (consecutiveFailedAttempts > 5) {
          await this.performAggressiveScrolling();
        } else {
          await this.performEnhancedScrolling();
        }
        
        // Wait between scrolls - variable timeout
        const scrollWaitTime = Math.floor(1500 + (Math.random() * 1000));
        await this.page.waitForTimeout(scrollWaitTime);
      }
      
      debug.info(`Finished gathering URLs. Found ${businessUrls.length} businesses`);
      
      // Take a final screenshot if we didn't get enough results
      if (businessUrls.length < this.maxResults) {
        const finalScreenshot = path.join(this.debugDir, `final-scroll-${runId}.png`);
        await this.page.screenshot({ path: finalScreenshot, fullPage: true });
        debug.info(`Final screenshot saved to ${finalScreenshot}`);
        
        // Save the HTML to analyze why we're not getting more results
        const html = await this.page.content();
        fs.writeFileSync(path.join(this.debugDir, `final-html-${runId}.html`), html);
      }
      
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
  
  // Add a more aggressive scrolling technique when standard scrolling stops yielding results
  async performAggressiveScrolling() {
    try {
      debug.info("Performing aggressive scrolling");
      
      await this.page.evaluate(async () => {
        const feed = document.querySelector('div[role="feed"], .VkpGBb, .section-scrollbox');
        if (!feed) return;
        
        // Try multiple approaches to trigger more content loading
        
        // 1. Scroll to bottom with force
        feed.scrollTop = feed.scrollHeight + 1000;
        
        // 2. Look for any "Show more results" buttons and click them
        const showMoreButtons = Array.from(document.querySelectorAll('button')).filter(
          button => button.innerText.toLowerCase().includes('more') ||
                   button.innerText.toLowerCase().includes('show') ||
                   button.getAttribute('aria-label')?.toLowerCase().includes('more')
        );
        
        if (showMoreButtons.length > 0) {
          showMoreButtons[0].click();
          await new Promise(r => setTimeout(r, 500));
        }
        
        // 3. Try to trigger lazy loading by rapid scrolling
        const scrollHeight = feed.scrollHeight;
        const scrollPositions = [
          scrollHeight * 0.8,
          scrollHeight * 0.9,
          scrollHeight,
          scrollHeight * 0.5, // Jump back to middle
          scrollHeight * 0.95,
          scrollHeight // Back to bottom
        ];
        
        for (const pos of scrollPositions) {
          feed.scrollTop = pos;
          await new Promise(r => setTimeout(r, 250));
        }
      });
      
      // Wait a bit longer after aggressive scrolling
      await this.page.waitForTimeout(2000);
      
    } catch (error) {
      debug.error('Error during aggressive scrolling:', error);
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
