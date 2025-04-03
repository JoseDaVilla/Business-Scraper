const { chromium } = require('playwright');
const debug = require('../tools/debugHelper');

class BusinessDetailScraper {
  constructor() {
    this.browser = null;
    this.context = null;
    this.page = null;
    this.maxRetries = 2;
    this.emailCache = new Map(); // Cache for email addresses by domain
  }

  async initialize() {
    // Run in headless mode with proper settings
    this.browser = await chromium.launch({ 
      headless: true,
      args: [
        '--disable-dev-shm-usage',
        '--disable-setuid-sandbox',
        '--no-sandbox',
        '--disable-gpu'
      ]
    });
    
    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/96.0.4664.110 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      locale: 'en-US', // Set locale to English
      timezoneId: 'America/New_York',
      geolocation: { longitude: -73.97, latitude: 40.77 } // New York coordinates
    });
    
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(30000);
    debug.info("Detail scraper browser initialized in headless mode with English locale");
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async extractBusinessDetails(businessUrl, searchTerm) {
    try {
      // Ensure URL is properly formed with English language parameter and proper encoding
      let fullUrl = businessUrl;
      if (!businessUrl.startsWith('http')) {
        fullUrl = `https://www.google.com${businessUrl}`;
      }
      
      // Force English language and remove problematic URL parameters
      fullUrl = fullUrl.replace(/\?authuser=\d+&hl=[^&]+/, '?');
      fullUrl = fullUrl.replace(/&authuser=\d+&hl=[^&]+/, '&');
      
      // Ensure hl=en is added to the URL
      if (!fullUrl.includes('hl=en')) {
        fullUrl += (fullUrl.includes('?') ? '&' : '?') + 'hl=en';
      }
      
      debug.info(`Navigating to business: ${fullUrl}`);
      
      // Use safer navigation approach with retries
      let navError = null;
      let retries = 0;
      const maxRetries = 3;
      
      while (retries < maxRetries) {
        try {
          // Use faster navigation without waiting for domcontentloaded
          await this.page.goto(fullUrl, { timeout: 30000 });
          navError = null;
          break;
        } catch (error) {
          navError = error;
          retries++;
          debug.warn(`Navigation failed (attempt ${retries}/${maxRetries}): ${error.message}`);
          
          if (retries < maxRetries) {
            // Wait before retrying
            await new Promise(r => setTimeout(r, 2000 * retries));
          }
        }
      }
      
      if (navError && retries >= maxRetries) {
        // If all navigation attempts failed, try to extract details from the URL
        debug.warn(`All navigation attempts failed, extracting minimal details from URL`);
        return {
          name: this.extractNameFromUrl(businessUrl),
          email: '',
          address: '',
          city: '',
          country: '',
          website: '',
          rating: null,
          phone: '',
          owner_name: '',
          search_term: searchTerm
        };
      }
      
      // Wait for business information panel to load
      await this.page.waitForSelector('div[role="region"], div.m6QErb, button[data-item-id]', { timeout: 10000 })
        .catch(() => debug.warn('Business info panel not found'));
      
      // Take screenshot for debugging
      await this.page.screenshot({ path: `debug-business-${Date.now()}.png` });
      
      // Extract all business details
      const name = await this.extractName();
      debug.info(`Extracting details for: ${name}`);
      
      // Extract other details in parallel for better performance
      const [address, phone, website, rating] = await Promise.all([
        this.extractAddressFromPanel(),
        this.extractPhoneFromPanel(), 
        this.extractWebsiteFromPanel(),
        this.extractRating()
      ]);
      
      debug.info(`Address: ${address}, Phone: ${phone}, Website: ${website}, Rating: ${rating}`);
      
      // Get domain from website
      let domain = '';
      if (website && website.startsWith('http')) {
        domain = this.extractDomain(website) || '';
      }
      
      // No need to wait for email extraction now - we'll do it in a separate process
      // Parse city and country
      const { city, country } = this.parseCityCountry(address, searchTerm);
      
      return {
        name,
        email: '', // Start with empty email, will be filled by EmailFinder
        address,
        city,
        country,
        website,
        domain, // Add domain for duplicate detection
        rating,
        phone,
        owner_name: '',
        search_term: searchTerm
      };
    } catch (error) {
      debug.error(`Error extracting business details: ${error.message}`);
      return {
        name: this.extractNameFromUrl(businessUrl),
        email: '',
        address: '',
        city: '',
        country: '',
        website: '',
        rating: null,
        phone: '',
        owner_name: '',
        search_term: searchTerm
      };
    }
  }
  
  // Extract name from URL as fallback
  extractNameFromUrl(url) {
    try {
      const match = url.match(/place\/([^\/]+)/);
      if (match && match[1]) {
        return decodeURIComponent(match[1].split('/')[0])
          .replace(/\+/g, ' ')
          .replace(/-/g, ' ');
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  async extractName() {
    // Try multiple selectors for the business name
    return await this.page.$eval('h1.DUwDvf, h1.qBF1Pd', el => el.textContent.trim())
      .catch(() => {
        return this.page.$eval('h1', el => el.textContent.trim())
          .catch(() => {
            debug.warn('Could not find any h1 element for business name');
            return '';
          });
      });
  }

  async extractAddressFromPanel() {
    try {
      // Using the exact structure from checkThisHtml.html
      return await this.page.evaluate(() => {
        // Look for the specific button with data-item-id="address"
        const addressBtn = document.querySelector('button[data-item-id="address"]');
        if (addressBtn) {
          // Get text from the proper div inside the button (based on HTML structure)
          const addressText = addressBtn.querySelector('div.Io6YTe');
          if (addressText) {
            return addressText.textContent.trim();
          }
          return addressBtn.textContent.trim();
        }
        
        // Alternative approach if the specific structure isn't found
        const addressElements = Array.from(document.querySelectorAll('div.Io6YTe'));
        for (const el of addressElements) {
          const parent = el.closest('button, a');
          if (parent && parent.getAttribute('aria-label') && 
              parent.getAttribute('aria-label').includes('Address')) {
            return el.textContent.trim();
          }
        }
        
        // Try general approach for any address-like content
        const elements = Array.from(document.querySelectorAll('div.W4Efsd, div.Io6YTe'));
        for (const el of elements) {
          const text = el.textContent;
          if (text.includes(', ') && !text.includes('⋅') && !text.match(/^\d+\.\d+/)) {
            return text.trim();
          }
        }
        
        return '';
      });
    } catch (error) {
      debug.warn('Could not extract address');
      return '';
    }
  }

  async extractPhoneFromPanel() {
    try {
      // Updated extraction logic using the correct class path shown in the reference HTML
      return await this.page.evaluate(() => {
        // First try - use the exact structure from the reference HTML 
        const phoneElements = Array.from(document.querySelectorAll('div.Io6YTe.fontBodyMedium.kR99db'));
        for (const el of phoneElements) {
          // Look for phone pattern in the element text
          const text = el.textContent.trim();
          if (text.match(/^\+?\d[-\d\s()]{7,}$/)) {
            return text;
          }
        }
        
        // Second try - look for phone button with data-item-id attribute
        const phoneBtn = document.querySelector('button[data-item-id^="phone:tel:"]');
        if (phoneBtn) {
          const phoneText = phoneBtn.querySelector('div.Io6YTe');
          if (phoneText) {
            return phoneText.textContent.trim();
          }
          return phoneBtn.textContent.trim();
        }
        
        // Third try - general phone number pattern matching across various elements
        const phoneRegex = /(?:\+\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
        const allElements = document.querySelectorAll('div.Io6YTe, div.rogA2c div, div.fontBodyMedium');
        
        for (const el of allElements) {
          const match = el.textContent.match(phoneRegex);
          if (match) {
            return match[0];
          }
        }
        
        return '';
      });
    } catch (error) {
      debug.warn('Could not extract phone');
      return '';
    }
  }

  async extractWebsiteFromPanel() {
    try {
      // Using structure from checkThisHtml.html
      return await this.page.evaluate(() => {
        // Look for specific website links
        const websiteLinks = [
          document.querySelector('a[data-item-id="authority"]'),
          document.querySelector('a[data-item-id="website"]'),
          document.querySelector('a[data-value="Website"]'),
          document.querySelector('a[aria-label*="website" i]')
        ].filter(Boolean);
        
        for (const link of websiteLinks) {
          const href = link.getAttribute('href');
          if (href && !href.startsWith('/aclk?')) {
            return href;
          }
        }
        
        // Check for links in Io6YTe elements that might contain website URLs
        const websiteElements = Array.from(document.querySelectorAll('div.Io6YTe'));
        for (const el of websiteElements) {
          const text = el.textContent.trim();
          if (text && text.match(/\.(com|org|net|io|co)/i) && el.closest('a')) {
            const href = el.closest('a').getAttribute('href');
            if (href && !href.startsWith('/aclk?')) {
              return href;
            }
          }
        }
        
        // Last resort: look for any external links
        const links = Array.from(document.querySelectorAll('a[href^="http"]'));
        for (const link of links) {
          const href = link.getAttribute('href');
          if (href && !href.startsWith('/aclk?') && 
              !href.includes('google.com') &&
              !href.includes('support.google.com') && 
              !href.includes('maps.google.com')) {
            return href;
          }
        }
        
        return '';
      });
    } catch (error) {
      debug.warn('Could not extract website');
      return '';
    }
  }

  async extractRating() {
    try {
      return await this.page.evaluate(() => {
        // Look for rating in role="img" element
        const ratingElement = document.querySelector('span[role="img"]');
        if (ratingElement) {
          const ariaLabel = ratingElement.getAttribute('aria-label');
          if (ariaLabel) {
            // Extract rating pattern like "4.5 stars" or "4,5 stars" (international format)
            const match = ariaLabel.match(/(\d+[.,]\d+)/);
            if (match) {
              return parseFloat(match[1].replace(',', '.'));
            }
          }
          
          // Try to get rating from the element's text
          const text = ratingElement.textContent.trim();
          const numMatch = text.match(/(\d+[.,]\d+)/);
          if (numMatch) {
            return parseFloat(numMatch[1].replace(',', '.'));
          }
        }
        
        // Check any element containing rating-like number
        const elements = document.querySelectorAll('span.MW4etd, div.fontBodyMedium');
        for (const el of elements) {
          const text = el.textContent.trim();
          const match = text.match(/^(\d+[.,]\d+)$/);
          if (match) {
            return parseFloat(match[1].replace(',', '.'));
          }
        }
        
        return null;
      });
    } catch (error) {
      debug.warn('Could not extract rating');
      return null;
    }
  }

  async extractEmailFromWebsite(url) {
    // Check cache first
    const domain = this.extractDomain(url);
    if (domain && this.emailCache.has(domain)) {
      return this.emailCache.get(domain);
    }
    
    try {
      debug.info(`Extracting email from website: ${url}`);
      const page = await this.context.newPage();
      
      // Set timeout and optimization options
      const response = await page.goto(url, { 
        timeout: 20000,
        waitUntil: 'domcontentloaded'
      }).catch(e => {
        debug.warn(`Failed to load website ${url}: ${e.message}`);
        return null;
      });
      
      if (!response) {
        await page.close();
        return '';
      }
      
      // Only proceed if the page loaded correctly
      if (response.ok()) {
        // Quick email extraction from HTML content
        const content = await response.text();
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/g;
        const emails = content.match(emailRegex);
        
        if (emails && emails.length > 0) {
          // Filter out common false positives
          const filteredEmails = emails.filter(email => 
            !email.includes('example.com') && 
            !email.includes('@gmail.com') && 
            !email.endsWith('.jpg') && 
            !email.endsWith('.png') &&
            !email.includes('youremail')
          );
          
          if (filteredEmails.length > 0) {
            // Cache the email for this domain
            if (domain) {
              this.emailCache.set(domain, filteredEmails[0]);
            }
            await page.close();
            return filteredEmails[0];
          }
        }
        
        // Try to find contact/about us pages if no email found
        try {
          const contactLinks = await page.$$('a[href*="contact"], a[href*="about"], a:text("Contact"), a:text("About")');
          
          if (contactLinks.length > 0) {
            // Try up to 2 contact pages
            for (let i = 0; i < Math.min(2, contactLinks.length); i++) {
              // Get the link before clicking it
              const href = await contactLinks[i].getAttribute('href');
              if (href) {
                // If it's a relative URL, make it absolute
                const contactUrl = href.startsWith('http') ? href : new URL(href, url).href;
                
                try {
                  await page.goto(contactUrl, { timeout: 15000, waitUntil: 'domcontentloaded' });
                  const contactContent = await page.content();
                  const contactEmails = contactContent.match(emailRegex);
                  
                  if (contactEmails && contactEmails.length > 0) {
                    const filteredContactEmails = contactEmails.filter(email => 
                      !email.includes('example.com') && 
                      !email.endsWith('.jpg') && 
                      !email.endsWith('.png') &&
                      !email.includes('youremail')
                    );
                    
                    if (filteredContactEmails.length > 0) {
                      if (domain) {
                        this.emailCache.set(domain, filteredContactEmails[0]);
                      }
                      await page.close();
                      return filteredContactEmails[0];
                    }
                  }
                } catch (err) {
                  debug.warn(`Failed loading contact page: ${err.message}`);
                }
              }
            }
          }
        } catch (err) {
          debug.warn(`Error finding contact links: ${err.message}`);
        }
      }
      
      await page.close();
      return '';
    } catch (error) {
      debug.error(`Error extracting email: ${error.message}`);
      return '';
    }
  }
  
  // Extract domain name from URL
  extractDomain(url) {
    try {
      if (!url) return '';
      return new URL(url).hostname || '';
    } catch {
      return '';
    }
  }

  parseCityCountry(address, searchTerm) {
    let city = '';
    let country = '';
    
    if (address) {
      const addressParts = address.split(',');
      if (addressParts.length > 1) {
        city = addressParts[addressParts.length - 2]?.trim() || '';
        country = addressParts[addressParts.length - 1]?.trim() || '';
      }
    }
    
    // If city/country weren't in the address, try to extract from search term
    if (!city || !country) {
      const searchParts = searchTerm.split('-');
      if (searchParts.length > 1) {
        const locationParts = searchParts[1].trim().split(' ');
        if (locationParts.length > 1) {
          city = locationParts[0];
          country = locationParts[1];
        }
      }
    }
    
    return { city, country };
  }
}

module.exports = BusinessDetailScraper;
