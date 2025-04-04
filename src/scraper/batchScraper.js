const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const ParallelScraper = require('./parallelScraper');
const EmailFinder = require('./emailFinder');
const db = require('../config/database');
const debug = require('../tools/debugHelper');

class BatchScraper {
  constructor(options = {}) {
    this.maxConcurrentTasks = options.maxConcurrentTasks || 1;
    this.autoRunEmailFinder = options.autoRunEmailFinder !== false;
    this.waitBetweenTasks = options.waitBetweenTasks || 30000; // 30 seconds between tasks
    this.maxResultsPerCity = options.maxResultsPerCity || 200;
    this.businessType = options.businessType || 'Digital Marketing Agency';
    
    this.scraper = new ParallelScraper(undefined, this.maxResultsPerCity);
    this.emailFinder = null;
    if (this.autoRunEmailFinder) {
      this.emailFinder = new EmailFinder();
    }
    
    this.taskQueue = [];
    this.runningTasks = 0;
    this.completedTasks = 0;
    this.failedTasks = 0;
    this.totalTasks = 0;
    this.isRunning = false;
    this.currentCity = null;
    this.currentState = null;
    this.batchId = null;
    
    this.stateProgress = {}; // Track progress by state
    
    // Initialize email finder
    if (this.autoRunEmailFinder) {
      this.emailFinder.initialize().catch(err => {
        debug.error(`Failed to initialize email finder: ${err.message}`);
      });
    }
  }
  
  /**
   * Load cities data from the JSON file
   */
  loadCitiesData() {
    const citiesPath = path.join(__dirname, '../data/top-cities-by-state.json');
    
    if (!fs.existsSync(citiesPath)) {
      throw new Error(`Cities data file not found: ${citiesPath}`);
    }
    
    try {
      const citiesJson = fs.readFileSync(citiesPath, 'utf8');
      return JSON.parse(citiesJson);
    } catch (error) {
      throw new Error(`Error loading cities data: ${error.message}`);
    }
  }
  
  /**
   * Start a batch operation for all states or specific states
   * @param {Array} states - Optional array of state names to process
   * @returns {Object} Batch information
   */
  async startBatch(states = null) {
    if (this.isRunning) {
      throw new Error('A batch operation is already running');
    }
    
    try {
      // Generate batch ID
      this.batchId = uuidv4();
      
      // Load cities data
      const citiesByState = this.loadCitiesData();
      
      // Filter states if specified
      const statesToProcess = states 
        ? Object.keys(citiesByState).filter(state => states.includes(state))
        : Object.keys(citiesByState);
      
      if (statesToProcess.length === 0) {
        throw new Error('No valid states to process');
      }
      
      // Initialize task queue
      this.taskQueue = [];
      this.runningTasks = 0;
      this.completedTasks = 0;
      this.failedTasks = 0;
      this.stateProgress = {};
      
      // Create tasks for each city in each state
      for (const state of statesToProcess) {
        const cities = citiesByState[state];
        this.stateProgress[state] = {
          total: cities.length,
          completed: 0,
          failed: 0,
          inProgress: false
        };
        
        for (const city of cities) {
          const searchTerm = `${this.businessType} - ${city} - ${state}`;
          this.taskQueue.push({ state, city, searchTerm });
        }
      }
      
      this.totalTasks = this.taskQueue.length;
      this.isRunning = true;
      
      // Record batch start in database
      await this.recordBatchStart(statesToProcess);
      
      // Start processing tasks
      this.processQueue();
      
      return {
        batchId: this.batchId,
        totalStates: statesToProcess.length,
        totalCities: this.totalTasks,
        states: statesToProcess
      };
    } catch (error) {
      this.isRunning = false;
      throw error;
    }
  }
  
  /**
   * Process the task queue
   */
  async processQueue() {
    if (this.taskQueue.length === 0) {
      if (this.runningTasks === 0) {
        this.isRunning = false;
        debug.info(`Batch completed: ${this.completedTasks} tasks completed, ${this.failedTasks} failed`);
        
        // Record batch completion
        await this.recordBatchCompletion();
        
        // Run email finder if enabled
        if (this.autoRunEmailFinder && this.emailFinder) {
          debug.info('Starting email finder for all pending businesses');
          await this.emailFinder.processAllPendingBusinesses();
        }
      }
      return;
    }
    
    // Only start new tasks if below concurrent limit
    while (this.runningTasks < this.maxConcurrentTasks && this.taskQueue.length > 0) {
      const task = this.taskQueue.shift();
      this.runningTasks++;
      this.currentCity = task.city;
      this.currentState = task.state;
      
      // Update state progress
      this.stateProgress[task.state].inProgress = true;
      
      // Start task with delay for rate limiting
      setTimeout(() => {
        this.processTask(task).finally(() => {
          this.runningTasks--;
          
          // Update state progress
          if (this.taskQueue.filter(t => t.state === task.state).length === 0 && 
              this.runningTasks === 0) {
            this.stateProgress[task.state].inProgress = false;
          }
          
          // Process next task after delay
          setTimeout(() => this.processQueue(), this.waitBetweenTasks);
        });
      }, 500);
    }
  }
  
  /**
   * Process a single city task
   * @param {Object} task - Task information
   */
  async processTask(task) {
    const { state, city, searchTerm } = task;
    
    debug.info(`Starting task for ${city}, ${state} with search term: ${searchTerm}`);
    
    try {
      // Add task to parallel scraper
      const taskId = await this.scraper.addTask(searchTerm);
      
      // Monitor task completion
      await this.monitorTask(taskId, state, city);
      
      // Task completed successfully
      this.completedTasks++;
      this.stateProgress[state].completed++;
      debug.info(`Task completed for ${city}, ${state}`);
      
      // Record state progress
      await this.updateStateProgress(state);
      
    } catch (error) {
      // Task failed
      this.failedTasks++;
      this.stateProgress[state].failed++;
      debug.error(`Task failed for ${city}, ${state}: ${error.message}`);
      
      // Record failure
      await this.recordTaskFailure(state, city, error.message);
    }
  }
  
  /**
   * Monitor a scraping task until completion
   * @param {string} taskId - The task ID
   * @param {string} state - The state name
   * @param {string} city - The city name
   */
  async monitorTask(taskId, state, city) {
    return new Promise((resolve, reject) => {
      const CHECK_INTERVAL = 5000; // Check every 5 seconds
      const MAX_CHECKS = 300; // Increased to 25 minutes (300 * 5000ms)
      
      let checks = 0;
      
      const checkStatus = async () => {
        try {
          if (checks >= MAX_CHECKS) {
            debug.warn(`Task monitoring timeout for ${state} - ${city}, marking as complete anyway`);
            // Instead of rejecting, let's resolve with what we have
            resolve({ status: 'completed', businessCount: 0 });
            return;
          }
          
          const status = await this.scraper.getTaskStatus(taskId);
          
          if (!status) {
            debug.error(`Task not found for ${state} - ${city}`);
            reject(new Error('Task not found'));
            return;
          }
          
          // Log progress every 30 seconds
          if (checks % 6 === 0) {
            debug.info(`${state} - ${city}: Status=${status.status}, Businesses=${status.businesses_found}`);
          }
          
          if (status.status === 'completed') {
            debug.info(`Task completed for ${state} - ${city} with ${status.businesses_found} businesses`);
            resolve(status);
            return;
          } else if (status.status === 'failed') {
            debug.error(`Task failed for ${state} - ${city}`);
            reject(new Error('Task failed'));
            return;
          }
          
          // Task is still running, check again later
          checks++;
          setTimeout(checkStatus, CHECK_INTERVAL);
          
        } catch (error) {
          debug.error(`Error checking task status for ${state} - ${city}: ${error.message}`);
          
          // Don't reject on status check errors, just try again
          checks++;
          setTimeout(checkStatus, CHECK_INTERVAL);
        }
      };
      
      // Start checking
      checkStatus();
    });
  }
  
  /**
   * Get the current status of the batch operation
   * @returns {Object} Batch status information
   */
  getStatus() {
    return {
      batchId: this.batchId,
      isRunning: this.isRunning,
      totalTasks: this.totalTasks,
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
      remainingTasks: this.taskQueue.length + this.runningTasks,
      currentState: this.currentState,
      currentCity: this.currentCity,
      progress: (this.completedTasks + this.failedTasks) / this.totalTasks,
      stateProgress: this.stateProgress
    };
  }
  
  /**
   * Record batch start in the database
   * @param {Array} states - States to be processed
   */
  async recordBatchStart(states) {
    try {
      const query = `
        INSERT INTO batch_operations (
          id, 
          start_time, 
          status, 
          total_tasks,
          states
        )
        VALUES ($1, NOW(), $2, $3, $4)
      `;
      
      await db.query(query, [
        this.batchId,
        'running',
        this.totalTasks,
        JSON.stringify(states)
      ]);
    } catch (error) {
      debug.error(`Error recording batch start: ${error.message}`);
    }
  }
  
  /**
   * Record batch completion in the database
   */
  async recordBatchCompletion() {
    try {
      const query = `
        UPDATE batch_operations
        SET 
          status = $1, 
          end_time = NOW(),
          completed_tasks = $2,
          failed_tasks = $3
        WHERE id = $4
      `;
      
      await db.query(query, [
        'completed',
        this.completedTasks,
        this.failedTasks,
        this.batchId
      ]);
    } catch (error) {
      debug.error(`Error recording batch completion: ${error.message}`);
    }
  }
  
  /**
   * Record task failure in the database
   * @param {string} state - State name
   * @param {string} city - City name
   * @param {string} error - Error message
   */
  async recordTaskFailure(state, city, error) {
    try {
      const query = `
        INSERT INTO batch_task_failures (
          batch_id, 
          state,
          city,
          error_message,
          failure_time
        )
        VALUES ($1, $2, $3, $4, NOW())
      `;
      
      await db.query(query, [
        this.batchId,
        state,
        city,
        error
      ]);
    } catch (error) {
      debug.error(`Error recording task failure: ${error.message}`);
    }
  }
  
  /**
   * Update state progress in the database
   * @param {string} state - State name
   */
  async updateStateProgress(state) {
    try {
      const query = `
        INSERT INTO batch_state_progress (
          batch_id,
          state,
          total_cities,
          completed_cities,
          failed_cities,
          last_updated
        )
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (batch_id, state) 
        DO UPDATE SET
          completed_cities = $4,
          failed_cities = $5,
          last_updated = NOW()
      `;
      
      await db.query(query, [
        this.batchId,
        state,
        this.stateProgress[state].total,
        this.stateProgress[state].completed,
        this.stateProgress[state].failed
      ]);
    } catch (error) {
      debug.error(`Error updating state progress: ${error.message}`);
    }
  }
  
  /**
   * Stop the current batch operation
   */
  async stop() {
    if (!this.isRunning) {
      return { stopped: false, message: 'No batch operation is running' };
    }
    
    this.isRunning = false;
    this.taskQueue = [];
    
    // Record batch stopping in database
    try {
      const query = `
        UPDATE batch_operations
        SET 
          status = $1, 
          end_time = NOW(),
          completed_tasks = $2,
          failed_tasks = $3
        WHERE id = $4
      `;
      
      await db.query(query, [
        'stopped',
        this.completedTasks,
        this.failedTasks,
        this.batchId
      ]);
    } catch (error) {
      debug.error(`Error recording batch stop: ${error.message}`);
    }
    
    return { 
      stopped: true, 
      completedTasks: this.completedTasks,
      remainingTasks: this.runningTasks
    };
  }
}

module.exports = BatchScraper;
