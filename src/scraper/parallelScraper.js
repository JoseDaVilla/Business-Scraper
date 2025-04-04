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
      console.log(`Getting business list for search term: ${searchTerm}`);
      const businessList = await mainScraper.getBusinessList(searchTerm);
      console.log(`Found ${businessList.length} businesses to scrape details`);
      
      // Save the businesses URLs to a debug file for inspection
      const fs = require('fs');
      const path = require('path');
      const debugDir = path.join(__dirname, '../../debug');
      if (!fs.existsSync(debugDir)) {
        fs.mkdirSync(debugDir, { recursive: true });
      }
      fs.writeFileSync(
        path.join(debugDir, `business-urls-${taskId}.json`), 
        JSON.stringify(businessList, null, 2)
      );
      
      // Close main scraper browser to free resources
      await mainScraper.close();
      
      // If no businesses found, try with a slightly modified search term
      if (businessList.length === 0) {
        console.log(`No businesses found for "${searchTerm}", trying alternatives...`);
        
        // Try with just the city name if it contains multiple parts
        const cityMatch = searchTerm.match(/- ([^-]+) -/);
        if (cityMatch && cityMatch[1].includes(' ')) {
          const cityParts = cityMatch[1].trim().split(' ');
          const simplifiedCity = cityParts[0]; // Just first part of the city name
          const stateMatch = searchTerm.match(/- ([^-]+)$/);
          const state = stateMatch ? stateMatch[1].trim() : '';
          
          const alternateSearchTerm = `${searchTerm.split('-')[0].trim()} - ${simplifiedCity} - ${state}`;
          console.log(`Trying alternate search term: "${alternateSearchTerm}"`);
          
          // Initialize a new scraper with the simplified search term
          const alternateScraper = new GoogleMapsScraper(this.maxResultsPerSearch);
          await alternateScraper.initialize();
          
          const alternateList = await alternateScraper.getBusinessList(alternateSearchTerm);
          console.log(`Found ${alternateList.length} businesses using alternate search term`);
          
          // Save the alternate results for inspection
          fs.writeFileSync(
            path.join(debugDir, `alternate-urls-${taskId}.json`), 
            JSON.stringify(alternateList, null, 2)
          );
          
          await alternateScraper.close();
          
          // If the alternate search found results, use those instead
          if (alternateList.length > 0) {
            console.log(`Using ${alternateList.length} businesses from alternate search`);
            businessList.push(...alternateList);
          }
        }
      }
      
      // If still no businesses found, exit early with a more detailed error
      if (businessList.length === 0) {
        console.error(`No businesses found for search term: ${searchTerm}`);
        // Take a screenshot of what's on the page for debugging
        await mainScraper.page?.screenshot({ 
          path: path.join(debugDir, `no-results-${taskId}.png`),
          fullPage: true 
        }).catch(e => console.error("Failed to take screenshot:", e));
        
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
      console.error(error.stack);
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
      
      // Filter out empty results and businesses without domains/websites
      const validResults = batchResults.filter(b => {
        if (!b || !b.name) return false;
        
        // Skip businesses without websites or domains
        if ((!b.website || b.website === '') && (!b.domain || b.domain === '')) {
          console.log(`Skipping business "${b.name}" - no website or domain found`);
          return false;
        }
        
        return true;
      });
      
      for (const business of validResults) {
        const id = await this.saveBusinessToDB(business);
        if (id) {
          results.push(business);
        }
      }
      
      // Report progress
      if (onProgress) {
        onProgress(validResults.length);
      }
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
      // Don't save businesses without websites or domains
      if ((!businessData.website || businessData.website === '') && 
          (!businessData.domain || businessData.domain === '')) {
        console.log(`Not saving "${businessData.name}" - no website or domain`);
        return false;
      }
      
      // Generate a domain from the website if available
      if (businessData.website && !businessData.domain) {
        try {
          businessData.domain = new URL(businessData.website).hostname;
        } catch (e) {
          // If URL parsing fails, use website as domain
          businessData.domain = businessData.website;
        }
      }
      
      // Format data for insertion
      const formattedData = {
        name: businessData.name || 'Unnamed Business',
        email: businessData.email || null,
        address: businessData.address || null,
        city: businessData.city || null,
        country: businessData.country || null,
        website: businessData.website || null,
        domain: businessData.domain || null, // No more placeholder domains
        rating: businessData.rating || null,
        phone: businessData.phone || null,
        owner_name: businessData.owner_name || null,
        search_term: businessData.search_term || null
      };
      
      // Log the business being saved
      console.log(`Saving business: "${formattedData.name}" with domain: ${formattedData.domain}`);
      
      // Use simplified INSERT without ON CONFLICT handling to ensure data is always inserted
      const query = `
        INSERT INTO businesses (name, email, address, city, country, website, domain, rating, phone, owner_name, search_term)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id
      `;
      
      const result = await db.query(query, [
        formattedData.name,
        formattedData.email,
        formattedData.address,
        formattedData.city,
        formattedData.country,
        formattedData.website,
        formattedData.domain,
        formattedData.rating,
        formattedData.phone,
        formattedData.owner_name,
        formattedData.search_term
      ]);
      
      // Extract the returned ID from the result
      const id = result.rows && result.rows[0] ? result.rows[0].id : null;
      console.log(`Successfully saved business "${formattedData.name}" with ID: ${id || 'unknown'}`);
      return id;
    } catch (error) {
      console.error('Error saving business to database:', error.message);
      console.error('Business data that failed:', JSON.stringify(businessData, null, 2));
      
      // Try alternative insertion without domain constraint
      try {
        // Skip businesses without domains even in the backup method
        if ((!businessData.website || businessData.website === '') && 
            (!businessData.domain || businessData.domain === '')) {
          return false;
        }
        
        // Use a simpler query without returning id and without complex conditions
        const backupQuery = `
          INSERT INTO businesses (name, email, address, city, country, website, domain, rating, phone, owner_name, search_term)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `;
        
        await db.query(backupQuery, [
          businessData.name || 'Unnamed Business',
          businessData.email || null, 
          businessData.address || null,
          businessData.city || null,
          businessData.country || null,
          businessData.website || null,
          businessData.domain || null, // No more placeholder values
          businessData.rating || null,
          businessData.phone || null,
          businessData.owner_name || null,
          businessData.search_term || null
        ]);
        
        console.log(`Saved business "${businessData.name}" using backup method`);
        return true;
      } catch (backupError) {
        console.error('Backup insertion also failed:', backupError.message);
        return false;
      }
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

  updateTaskStatus(taskId, status, businessesFound) {
    // Don't update businesses_found if it's not provided (might be undefined)
    let query;
    let params;
    
    if (businessesFound !== undefined) {
      query = `
        UPDATE scraping_tasks
        SET status = $1, businesses_found = $3, completed_at = $4
        WHERE id = $2
      `;
      params = [status, taskId, businessesFound, status === 'running' ? null : new Date()];
    } else {
      query = `
        UPDATE scraping_tasks
        SET status = $1, completed_at = $3
        WHERE id = $2
      `;
      params = [status, taskId, status === 'running' ? null : new Date()];
    }
    
    return db.query(query, params)
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
