const { chromium } = require('playwright');
const db = require('../config/database');
const debug = require('../tools/debugHelper');

class EmailFinder {
  constructor(options = {}) {
    this.browser = null;
    this.context = null;
    this.maxRetries = options.maxRetries || 2;
    this.maxConcurrent = options.maxConcurrent || 5;
    this.emailCache = new Map();
    this.runningTasks = 0;
    this.queue = [];
    this.visitedUrls = new Set();
    this.isRunning = false;
  }

  async initialize() {
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
      viewport: { width: 1366, height: 768 }
    });
    
    debug.info("Email finder initialized");
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }

  /**
   * Start processing a batch of businesses to find emails
   * @param {Array} businesses - Array of business objects with website URLs
   */
  async processBatch(businesses) {
    if (!this.browser) {
      await this.initialize();
    }
    
    this.isRunning = true;
    const pendingBusinesses = businesses.filter(b => 
      b.website && 
      b.website.startsWith('http') && 
      !b.email
    );
    
    debug.info(`Starting email finder for ${pendingBusinesses.length} businesses`);
    
    // Add all businesses to queue
    for (const business of pendingBusinesses) {
      this.queue.push(business);
    }
    
    // Start processing the queue
    this.processQueue();
    
    return true;
  }
  
  async processQueue() {
    if (this.queue.length === 0) {
      if (this.runningTasks === 0) {
        this.isRunning = false;
        debug.info("Email finder completed all tasks");
      }
      return;
    }
    
    // Only start new tasks if below concurrent limit
    while (this.runningTasks < this.maxConcurrent && this.queue.length > 0) {
      const business = this.queue.shift();
      this.runningTasks++;
      
      this.findEmailForBusiness(business).finally(() => {
        this.runningTasks--;
        // Continue processing the queue
        this.processQueue();
      });
    }
  }
  
  async findEmailForBusiness(business) {
    try {
      const { id, website, name } = business;
      const domain = this.extractDomain(website);
      
      // Check cache first
      if (domain && this.emailCache.has(domain)) {
        const cachedEmail = this.emailCache.get(domain);
        if (cachedEmail) {
          await this.updateBusinessEmail(id, cachedEmail);
          debug.info(`Used cached email for ${name}: ${cachedEmail}`);
          return cachedEmail;
        }
      }
      
      debug.info(`Finding email for ${name} (${website})`);
      const email = await this.extractEmailWithMultipleStrategies(website);
      
      if (email && domain) {
        // Cache the result
        this.emailCache.set(domain, email);
        
        // Update database
        await this.updateBusinessEmail(id, email);
        debug.info(`Found email for ${name}: ${email}`);
      } else {
        debug.info(`No email found for ${name}`);
      }
      
      return email;
    } catch (error) {
      debug.error(`Error finding email for business ${business.name}: ${error.message}`);
      return null;
    }
  }
  
  async extractEmailWithMultipleStrategies(baseUrl) {
    const page = await this.context.newPage();
    
    try {
      // First strategy: Check homepage
      let email = await this.scrapeEmailFromPage(page, baseUrl);
      if (email) return email;
      
      // Generate potential contact page URLs
      const contactPaths = [
        '/contact', '/contact-us', '/contact_us', '/contactus', 
        '/contacto', '/about', '/about-us', '/about_us', 
        '/aboutus', '/get-in-touch', '/reach-us', '/support',
        '/connect', '/email-us', '/email', '/info'
      ];
      
      // Second strategy: Try various contact page patterns
      for (const path of contactPaths) {
        try {
          const contactUrl = new URL(path, baseUrl).href;
          
          // Skip if already visited
          if (this.visitedUrls.has(contactUrl)) continue;
          this.visitedUrls.add(contactUrl);
          
          email = await this.scrapeEmailFromPage(page, contactUrl);
          if (email) return email;
        } catch (error) {
          debug.debug(`Error checking contact path ${path}: ${error.message}`);
        }
      }
      
      // Third strategy: Look for contact links on the homepage
      try {
        await page.goto(baseUrl, { timeout: 15000, waitUntil: 'domcontentloaded' });
        
        const contactLinks = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('a'))
            .filter(a => {
              const text = a.textContent.toLowerCase();
              const href = a.getAttribute('href') || '';
              return text.includes('contact') || 
                    text.includes('about') || 
                    href.includes('contact') || 
                    href.includes('about');
            })
            .map(a => a.href);
        });
        
        // Visit each contact link
        for (const link of contactLinks) {
          if (!link) continue;
          
          // Skip if already visited
          if (this.visitedUrls.has(link)) continue;
          this.visitedUrls.add(link);
          
          email = await this.scrapeEmailFromPage(page, link);
          if (email) return email;
        }
      } catch (error) {
        debug.debug(`Error finding contact links: ${error.message}`);
      }
      
      // Fourth strategy: Check if there's a staff/team page
      const teamPaths = ['/team', '/staff', '/our-team', '/our-staff', '/people', '/management'];
      for (const path of teamPaths) {
        try {
          const teamUrl = new URL(path, baseUrl).href;
          
          // Skip if already visited
          if (this.visitedUrls.has(teamUrl)) continue;
          this.visitedUrls.add(teamUrl);
          
          email = await this.scrapeEmailFromPage(page, teamUrl);
          if (email) return email;
        } catch (error) {
          debug.debug(`Error checking team path ${path}: ${error.message}`);
        }
      }
      
      return null;
    } finally {
      await page.close();
    }
  }
  
  async scrapeEmailFromPage(page, url) {
    try {
      const response = await page.goto(url, { 
        timeout: 10000,
        waitUntil: 'domcontentloaded'
      }).catch(e => {
        debug.debug(`Failed to load ${url}: ${e.message}`);
        return null;
      });
      
      if (!response || !response.ok()) return null;
      
      // First try: Get emails from the rendered page content
      const emails = await page.evaluate(() => {
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/gi;
        const body = document.body.innerText;
        return body.match(emailRegex) || [];
      });
      
      // Second try: Check for obfuscated emails
      if (!emails.length) {
        // Look for data attributes that might contain emails
        const obfuscatedEmails = await page.evaluate(() => {
          const results = [];
          
          // Check for mailto links
          document.querySelectorAll('a[href^="mailto:"]').forEach(el => {
            const mailtoHref = el.getAttribute('href');
            if (mailtoHref && mailtoHref.startsWith('mailto:')) {
              const email = mailtoHref.substring(7).split('?')[0];
              if (email && email.includes('@') && email.includes('.')) {
                results.push(email);
              }
            }
          });
          
          // Check for elements with data attributes
          document.querySelectorAll('[data-email], [data-mail]').forEach(el => {
            const dataEmail = el.getAttribute('data-email') || el.getAttribute('data-mail');
            if (dataEmail && dataEmail.includes('@') && dataEmail.includes('.')) {
              results.push(dataEmail);
            }
          });
          
          return results;
        });
        
        if (obfuscatedEmails.length) {
          emails.push(...obfuscatedEmails);
        }
      }
      
      // Third try: Check in HTML source
      if (!emails.length) {
        const content = await page.content();
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}/gi;
        const sourceEmails = content.match(emailRegex) || [];
        emails.push(...sourceEmails);
      }
      
      // Filter and validate emails
      const validEmails = this.filterEmails(emails);
      return validEmails.length > 0 ? validEmails[0] : null;
      
    } catch (error) {
      debug.debug(`Error scraping email from ${url}: ${error.message}`);
      return null;
    }
  }
  
  filterEmails(emails) {
    // Filter out common invalid emails and duplicates
    const uniqueEmails = [...new Set(emails)];
    
    return uniqueEmails.filter(email => {
      // Validate email format
      if (!email || !email.includes('@') || !email.includes('.')) return false;
      
      // Filter out common false positives
      return !email.includes('example.com') && 
             !email.includes('youremail') &&
             !email.includes('sample') &&
             !email.includes('domain.com') &&
             !email.endsWith('.jpg') &&
             !email.endsWith('.png') &&
             !email.endsWith('.gif');
    });
  }
  
  extractDomain(url) {
    try {
      return new URL(url).hostname;
    } catch {
      return null;
    }
  }
  
  async updateBusinessEmail(businessId, email) {
    try {
      const query = `
        UPDATE businesses 
        SET email = $1 
        WHERE id = $2
      `;
      
      await db.query(query, [email, businessId]);
      return true;
    } catch (error) {
      debug.error(`Error updating business email: ${error.message}`);
      return false;
    }
  }
  
  async processAllPendingBusinesses() {
    try {
      // Get all businesses with websites but no emails
      const query = `
        SELECT id, name, website 
        FROM businesses 
        WHERE website IS NOT NULL 
        AND website != '' 
        AND (email IS NULL OR email = '')
      `;
      
      const businesses = await db.getMany(query, []);
      debug.info(`Found ${businesses.length} businesses without emails`);
      
      if (businesses.length > 0) {
        await this.processBatch(businesses);
      }
      
      return businesses.length;
    } catch (error) {
      debug.error(`Error processing pending businesses: ${error.message}`);
      return 0;
    }
  }
}

module.exports = EmailFinder;
