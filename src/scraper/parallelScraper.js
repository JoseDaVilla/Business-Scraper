const { v4: uuidv4 } = require('uuid');
const GoogleMapsScraper = require('./googleMapsScraper');
const BusinessDetailScraper = require('./businessDetailScraper');
const db = require('../config/database');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const path = require('path');
const os = require('os');

class ParallelScraper {
  constructor(maxWorkers = Math.max(os.cpus().length - 1, 1), maxResultsPerSearch = 200) {
    this.maxWorkers = maxWorkers;
    this.activeWorkers = 0;
    this.queue = [];
    this.maxResultsPerSearch = maxResultsPerSearch;
    // Increase number of parallel browsers for better performance
    this.parallelBrowsers = Math.min(8, os.cpus().length); // Up to 8 parallel browsers
  }

  async addTask(searchTerm) {
    try {
      const taskId = uuidv4();
      
      // Insert task into database
      const query = `
        INSERT INTO scraping_tasks (id, search_term, status)
        VALUES ($1, $2, $3)
      `;
      
      await db.query(query, [taskId, searchTerm, 'pending']);
      
      // Add task to queue
      return new Promise((resolve, reject) => {
        const task = { taskId, searchTerm, resolve, reject };
        this.queue.push(task);
        this.processQueue();
        resolve(taskId);
      });
    } catch (error) {
      console.error('Error creating task:', error);
      throw error;
    }
  }

  processQueue() {
    if (this.queue.length === 0 || this.activeWorkers >= this.maxWorkers) {
      return;
    }

    const task = this.queue.shift();
    this.startWorker(task);
  }

  async startParallelScraping(taskId, searchTerm) {
    try {
      console.log(`Starting parallel scraping for task ${taskId}`);
      
      // Update task status to running first thing
      await this.updateTaskStatus(taskId, 'running', 0);
      
      // First, get the list of all businesses without details
      const mainScraper = new GoogleMapsScraper(this.maxResultsPerSearch);
      await mainScraper.initialize();
      
      // Get just the list of business elements (URLs, not full details)
      const businessList = await mainScraper.getBusinessList(searchTerm);
      console.log(`Found ${businessList.length} businesses to scrape details`);
      
      // Close main scraper browser to free resources
      await mainScraper.close();
      
      // If no businesses found, exit early
      if (businessList.length === 0) {
        await this.updateTaskStatus(taskId, 'completed', 0);
        return [];
      }
      
      // Throttle the number of parallel browsers based on available system resources
      const totalMemoryMB = os.totalmem() / (1024 * 1024);
      const freeMemoryMB = os.freemem() / (1024 * 1024);
      const memoryPerBrowser = 300; // Estimated MB per browser instance
      
      // Calculate optimal number of browsers
      let optimalBrowserCount = Math.floor(Math.min(
        this.parallelBrowsers,
        freeMemoryMB / memoryPerBrowser,
        Math.ceil(businessList.length / 10) // At least 10 businesses per browser
      ));
      
      // Ensure at least 1 browser
      if (optimalBrowserCount < 1) optimalBrowserCount = 1;
      
      console.log(`System memory: ${Math.round(totalMemoryMB)}MB total, ${Math.round(freeMemoryMB)}MB free`);
      console.log(`Creating ${optimalBrowserCount} parallel browsers for detail scraping`);
      
      // Create detail scrapers with the optimal count
      const detailScrapers = [];
      for (let i = 0; i < optimalBrowserCount; i++) {
        const scraper = new BusinessDetailScraper();
        await scraper.initialize();
        detailScrapers.push(scraper);
      }
      
      // Distribute businesses optimally among scrapers
      const businessChunks = this.chunkArray(
        businessList.slice(0, this.maxResultsPerSearch), 
        detailScrapers.length
      );
      
      console.log(`Distributed businesses into ${businessChunks.length} chunks`);
      
      // Process in parallel with progress tracking
      let processedCount = 0;
      const progressInterval = setInterval(() => {
        this.updateTaskStatus(taskId, 'running', processedCount);
      }, 5000);
      
      const scrapingPromises = businessChunks.map((chunk, index) => 
        this.scrapeBusinessChunk(detailScrapers[index], chunk, searchTerm, (count) => {
          processedCount += count;
        })
      );
      
      // Wait for all scraping to complete
      const results = await Promise.all(scrapingPromises);
      clearInterval(progressInterval);
      
      // Close all browser instances
      await Promise.all(detailScrapers.map(scraper => scraper.close()));
      
      // Combine and flatten the results
      const businesses = results.flat();
      
      // Update final task status
      await this.updateTaskStatus(taskId, 'completed', businesses.length);
      
      console.log(`Completed parallel scraping. Found ${businesses.length} businesses.`);
      return businesses;
    } catch (error) {
      console.error(`Error in parallel scraping: ${error.message}`);
      await this.updateTaskStatus(taskId, 'failed');
      throw error;
    }
  }
  
  async scrapeBusinessChunk(scraper, businessUrls, searchTerm, onProgress) {
    const results = [];
    const batchSize = 5; // Process in smaller batches
    
    // Process URLs in batches for better error isolation
    for (let i = 0; i < businessUrls.length; i += batchSize) {
      const batch = businessUrls.slice(i, i + batchSize);
      const batchPromises = batch.map(url => this.processSingleBusiness(scraper, url, searchTerm));
      
      // Wait for the batch to complete
      const batchResults = await Promise.all(batchPromises);
      
      // Filter out empty results and save to database
      const validResults = batchResults.filter(b => b && b.name);
      for (const business of validResults) {
        await this.saveBusinessToDB(business);
        results.push(business);
      }
      
      // Report progress
      if (onProgress) onProgress(validResults.length);
    }
    
    return results;
  }
  
  // New method to process a single business with better error handling
  async processSingleBusiness(scraper, businessUrl, searchTerm) {
    try {
      // Add retry logic for more reliability
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount <= maxRetries) {
        try {
          // Check if URL contains problematic parameters that could cause navigation failure
          if (businessUrl.includes('authuser=') && businessUrl.includes('hl=es')) {
            // Fix URL to use English and remove problematic params
            businessUrl = businessUrl.replace(/authuser=\d+&hl=[^&]+/, 'hl=en');
          }
          
          // Extract business details
          const businessData = await scraper.extractBusinessDetails(businessUrl, searchTerm);
          
          if (businessData && businessData.name) {
            console.log(`Scraped: ${businessData.name} (Address: ${businessData.address?.substring(0, 30) || 'N/A'}, Phone: ${businessData.phone || 'N/A'})`);
            return businessData;
          }
          
          retryCount++;
          if (retryCount <= maxRetries) {
            console.log(`Retry ${retryCount}/${maxRetries} for ${businessUrl}`);
            // Wait longer between retries
            await new Promise(r => setTimeout(r, 3000 * retryCount));
          }
        } catch (error) {
          console.error(`Error processing business (attempt ${retryCount}): ${error.message}`);
          
          // For navigation errors, we'll modify the URL and try different approaches
          if (error.message.includes('ERR_ABORTED')) {
            // Try alternate approach - extract directly from URL if possible
            const nameFromUrl = businessUrl.match(/place\/([^\/]+)/);
            if (nameFromUrl && nameFromUrl[1]) {
              const businessName = decodeURIComponent(nameFromUrl[1])
                .replace(/\+/g, ' ')
                .replace(/-/g, ' ');
                
              console.log(`Using fallback extraction for: ${businessName}`);
              
              return {
                name: businessName,
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
          
          retryCount++;
          if (retryCount <= maxRetries) {
            // Wait before retrying
            await new Promise(r => setTimeout(r, 3000 * retryCount));
          }
        }
      }
      
      console.warn(`Failed to process business after ${maxRetries} retries: ${businessUrl}`);
      return null;
    } catch (error) {
      console.error(`Error in processSingleBusiness: ${error.message}`);
      return null;
    }
  }
  
  async saveBusinessToDB(businessData) {
    try {
      // Check if we have a domain to use for duplicate prevention
      if (businessData.website && !businessData.domain) {
        try {
          businessData.domain = new URL(businessData.website).hostname;
        } catch {
          // If URL parsing fails, leave domain empty
          businessData.domain = '';
        }
      }
      
      // Use ON CONFLICT DO NOTHING to avoid duplicates based on domain + search term
      const query = `
        INSERT INTO businesses (name, email, address, city, country, website, domain, rating, phone, owner_name, search_term)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (domain, search_term) DO NOTHING
        RETURNING id
      `;
      
      const result = await db.insert(query, [
        businessData.name,
        businessData.email || null, // Use null instead of empty string
        businessData.address,
        businessData.city,
        businessData.country,
        businessData.website,
        businessData.domain || '', // New domain field
        businessData.rating,
        businessData.phone,
        businessData.owner_name,
        businessData.search_term
      ]);
      
      return result?.id;
    } catch (error) {
      console.error('Error saving to database:', error);
    }
  }
  
  // Helper function to chunk an array into n pieces
  chunkArray(array, chunks) {
    const result = [];
    const chunkSize = Math.ceil(array.length / chunks);
    
    for (let i = 0; i < chunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, array.length);
      if (start < array.length) {
        result.push(array.slice(start, end));
      }
    }
    
    return result;
  }

  startWorker(task) {
    const { taskId, searchTerm, resolve, reject } = task;
    this.activeWorkers++;
    
    // Update task status to 'running'
    const updateQuery = `UPDATE scraping_tasks SET status = $1 WHERE id = $2`;
    db.query(updateQuery, ['running', taskId]);

    // Start parallel scraping directly instead of using worker threads
    this.startParallelScraping(taskId, searchTerm)
      .then(businesses => {
        resolve({ taskId, businesses });
      })
      .catch(error => {
        reject(error.message);
      })
      .finally(() => {
        this.activeWorkers--;
        this.processQueue();
      });
  }

  updateTaskStatus(taskId, status) {
    const query = `
      UPDATE scraping_tasks
      SET status = $1, completed_at = NOW()
      WHERE id = $2
    `;
    
    db.query(query, [status, taskId])
      .catch(err => console.error('Error updating task status:', err));
  }

  async getTaskStatus(taskId) {
    try {
      const query = `
        SELECT * FROM scraping_tasks
        WHERE id = $1
      `;
      
      return await db.getOne(query, [taskId]);
    } catch (error) {
      console.error('Error getting task status:', error);
      throw error;
    }
  }

  async getAllTasks() {
    try {
      const query = `
        SELECT * FROM scraping_tasks
        ORDER BY created_at DESC
      `;
      
      return await db.getMany(query, []);
    } catch (error) {
      console.error('Error getting all tasks:', error);
      throw error;
    }
  }
}

module.exports = ParallelScraper;
