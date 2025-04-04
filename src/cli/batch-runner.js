#!/usr/bin/env node

const BatchScraper = require('../scraper/batchScraper');
const EmailFinder = require('../scraper/emailFinder');
const db = require('../config/database');
const debug = require('../tools/debugHelper');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  states: null,
  waitBetweenTasks: 60000, // 1 minute between tasks by default
  maxResultsPerCity: 200,
  businessType: 'Digital Marketing Agency',
  autoRunEmailFinder: true,
  scrollTimeout: 3000       // New option to control scroll timing
};

// Parse arguments
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--states') {
    options.states = args[++i].split(',');
  } else if (args[i] === '--wait') {
    options.waitBetweenTasks = parseInt(args[++i], 10) * 1000;
  } else if (args[i] === '--max-results') {
    options.maxResultsPerCity = parseInt(args[++i], 10);
  } else if (args[i] === '--type') {
    options.businessType = args[++i];
  } else if (args[i] === '--no-email-finder') {
    options.autoRunEmailFinder = false;
  } else if (args[i] === '--scroll-timeout') {
    options.scrollTimeout = parseInt(args[++i], 10);
  } else if (args[i] === '--help') {
    showHelp();
    process.exit(0);
  }
}

function showHelp() {
  console.log(`
Business Scraper Batch Runner

Usage: node batch-runner.js [options]

Options:
  --states STATE1,STATE2,...  Specific states to scrape (default: all states)
  --wait SECONDS             Wait time between tasks in seconds (default: 60)
  --max-results NUMBER       Maximum results per city (default: 200)
  --type "BUSINESS TYPE"     Type of business to search for (default: "Digital Marketing Agency")
  --no-email-finder          Disable automatic email finder after scraping
  --scroll-timeout MS        Set scroll wait timeout in ms (default: 3000)
  --help                     Show this help message
  
Examples:
  node batch-runner.js
  node batch-runner.js --states "California,New York,Texas" --wait 30 --max-results 100
  node batch-runner.js --type "Web Design Agency"
  node batch-runner.js --scroll-timeout 5000
  `);
}

// Create log directory if it doesn't exist
const logDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// Create log file for this run
const timestamp = new Date().toISOString().replace(/:/g, '-');
const logFile = path.join(logDir, `batch-run-${timestamp}.log`);
const logStream = fs.createWriteStream(logFile, { flags: 'a' });

// Log to console and file
function log(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  
  console.log(logMessage);
  logStream.write(logMessage + '\n');
}

// Error logging
function logError(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ERROR: ${message}`;
  
  console.error(logMessage);
  logStream.write(logMessage + '\n');
}

// Add batch_operations table if it doesn't exist
async function setupDatabase() {
  try {
    // Create batch_operations table
    await db.query(`
      CREATE TABLE IF NOT EXISTS batch_operations (
        id TEXT PRIMARY KEY,
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        status TEXT,
        total_tasks INTEGER,
        completed_tasks INTEGER DEFAULT 0,
        failed_tasks INTEGER DEFAULT 0,
        states JSON
      )
    `);
    
    // Create batch_task_failures table
    await db.query(`
      CREATE TABLE IF NOT EXISTS batch_task_failures (
        id SERIAL PRIMARY KEY,
        batch_id TEXT REFERENCES batch_operations(id),
        state TEXT,
        city TEXT,
        error_message TEXT,
        failure_time TIMESTAMP
      )
    `);
    
    // Create batch_state_progress table
    await db.query(`
      CREATE TABLE IF NOT EXISTS batch_state_progress (
        batch_id TEXT REFERENCES batch_operations(id),
        state TEXT,
        total_cities INTEGER,
        completed_cities INTEGER DEFAULT 0,
        failed_cities INTEGER DEFAULT 0,
        last_updated TIMESTAMP,
        PRIMARY KEY (batch_id, state)
      )
    `);
    
    log('Database tables initialized');
  } catch (error) {
    logError(`Database setup error: ${error.message}`);
    process.exit(1);
  }
}

// Interactive progress display
function startProgressDisplay(batchScraper) {
  // Only in interactive terminals
  if (!process.stdout.isTTY) return;
  
  const interval = setInterval(() => {
    const status = batchScraper.getStatus();
    
    if (!status.isRunning) {
      clearInterval(interval);
      return;
    }
    
    process.stdout.write('\x1Bc'); // Clear screen
    
    console.log('='.repeat(80));
    console.log(`Batch Scraper Status - ${new Date().toLocaleString()}`);
    console.log('='.repeat(80));
    console.log(`Batch ID: ${status.batchId}`);
    console.log(`Progress: ${Math.round(status.progress * 100)}% (${status.completedTasks}/${status.totalTasks} tasks)`);
    console.log(`Current: ${status.currentState ? status.currentState + ' - ' + status.currentCity : 'N/A'}`);
    console.log(`Completed: ${status.completedTasks}, Failed: ${status.failedTasks}, Remaining: ${status.remainingTasks}`);
    console.log('-'.repeat(80));
    
    console.log('State Progress:');
    Object.entries(status.stateProgress).forEach(([state, progress]) => {
      const stateStatus = progress.inProgress ? '⚡' : progress.completed === progress.total ? '✅' : '⏳';
      console.log(`${stateStatus} ${state.padEnd(15)} ${progress.completed}/${progress.total} cities completed`);
    });
    
    console.log('-'.repeat(80));
    console.log('Press Ctrl+C to stop the batch scraper');
    console.log('='.repeat(80));
    
  }, 2000);
  
  // Handle Ctrl+C
  readline.createInterface({
    input: process.stdin,
    output: process.stdout
  }).on('SIGINT', async () => {
    process.stdout.write('\x1Bc'); // Clear screen
    log('Stopping batch operation...');
    
    try {
      const result = await batchScraper.stop();
      log(`Batch operation stopped: ${result.completedTasks} tasks completed`);
    } catch (error) {
      logError(`Error stopping batch: ${error.message}`);
    }
    
    process.exit(0);
  });
}

// Main runner function
async function run() {
  log('Starting batch scraper');
  log(`Options: ${JSON.stringify(options, null, 2)}`);
  
  try {
    process.env.SCROLL_TIMEOUT = options.scrollTimeout.toString();
    
    // Set up database tables
    await setupDatabase();
    
    // Create batch scraper
    const batchScraper = new BatchScraper({
      maxConcurrentTasks: 1,
      waitBetweenTasks: options.waitBetweenTasks,
      maxResultsPerCity: options.maxResultsPerCity,
      businessType: options.businessType,
      autoRunEmailFinder: options.autoRunEmailFinder
    });
    
    // Start progress display
    startProgressDisplay(batchScraper);
    
    // Start batch operation
    const result = await batchScraper.startBatch(options.states);
    log(`Batch operation started: ${result.batchId}`);
    log(`IMPORTANT: Processing ${result.totalCities} cities across ${result.totalStates} states`);
    log(`Targeting ${options.maxResultsPerCity} businesses per city, please be patient`);
    
    // Wait for batch to complete by checking every 5 seconds
    while (batchScraper.isRunning) {
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    log('Batch operation completed');
    
    // Final status
    const finalStatus = batchScraper.getStatus();
    log(`Final status: ${finalStatus.completedTasks} completed, ${finalStatus.failedTasks} failed`);
    
    if (options.autoRunEmailFinder) {
      log('Email finder already automatically processed after batch completion');
    }
    
    log(`Log file: ${logFile}`);
    
    process.exit(0);
  } catch (error) {
    logError(`Error in batch operation: ${error.message}`);
    process.exit(1);
  }
}

// Start the runner
run();
