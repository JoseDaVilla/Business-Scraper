#!/usr/bin/env node
const path = require('path');
const { spawn } = require('child_process');

// Parse command line arguments
const args = process.argv.slice(2);

// Set default options
const options = {
  states: null,
  wait: 60,
  maxResults: 200,
  businessType: 'Digital Marketing Agency',
  noEmailFinder: false,
  scrollTimeout: 3000,
  foreground: false  // New option for foreground execution
};

// Parse arguments
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  
  if (arg === '--states' && i + 1 < args.length) {
    options.states = args[++i];
  } else if (arg === '--wait' && i + 1 < args.length) {
    options.wait = parseInt(args[++i], 10);
  } else if (arg === '--max-results' && i + 1 < args.length) {
    options.maxResults = parseInt(args[++i], 10);
  } else if (arg === '--type' && i + 1 < args.length) {
    options.businessType = args[++i];
  } else if (arg === '--no-email-finder') {
    options.noEmailFinder = true;
  } else if (arg === '--scroll-timeout' && i + 1 < args.length) {
    options.scrollTimeout = parseInt(args[++i], 10);
  } else if (arg === '--foreground') {
    options.foreground = true;
  } else if (arg === '--help') {
    console.log(`
Business Scraper Batch Launcher

Usage: node launch-batch.js [options]

Options:
  --states STATE1,STATE2,...  Specific states to scrape (default: all states)
  --wait SECONDS             Wait time between tasks in seconds (default: 60)
  --max-results NUMBER       Maximum results per city (default: 200)
  --type "BUSINESS TYPE"     Type of business to search for (default: "Digital Marketing Agency")
  --no-email-finder          Disable automatic email finder after scraping
  --scroll-timeout MS        Set scroll wait timeout in ms (default: 3000)
  --foreground               Run in foreground mode (can interrupt with Ctrl+C)
  --help                     Show this help message
  
Examples:
  node launch-batch.js
  node launch-batch.js --states "California,New York,Texas" --wait 30 --max-results 100
  node launch-batch.js --type "Web Design Agency"
  node launch-batch.js --scroll-timeout 5000
  node launch-batch.js --foreground  # Run in foreground mode (can stop with Ctrl+C)
    `);
    process.exit(0);
  }
}

// Build command line arguments for the batch runner
const runnerArgs = [path.join(__dirname, 'cli/batch-runner.js')];

if (options.states) {
  runnerArgs.push('--states', options.states);
}

runnerArgs.push('--wait', options.wait.toString());
runnerArgs.push('--max-results', options.maxResults.toString());
runnerArgs.push('--type', options.businessType);

if (options.noEmailFinder) {
  runnerArgs.push('--no-email-finder');
}

runnerArgs.push('--scroll-timeout', options.scrollTimeout.toString());

console.log('Starting batch runner with the following options:');
console.log(options);

// Start the batch runner
if (options.foreground) {
  // Run in foreground mode
  console.log('\nRunning in foreground mode. Press Ctrl+C to stop the process.\n');
  const batchProcess = spawn('node', runnerArgs, {
    stdio: 'inherit' // This redirects child process I/O to parent
  });
  
  batchProcess.on('exit', (code) => {
    console.log(`Batch process exited with code ${code}`);
  });
  
  // Handle Ctrl+C in parent process
  process.on('SIGINT', () => {
    console.log('\nStopping batch process...');
    batchProcess.kill('SIGINT'); // Forward the signal to child
  });
} else {
  // Run in background mode (detached)
  const batchProcess = spawn('node', runnerArgs, {
    detached: true,
    stdio: 'ignore'
  });

  batchProcess.unref();

  console.log(`
Batch process started in the background with process ID: ${batchProcess.pid}
You can check the logs in the 'logs' directory.

To stop the process:
1. Run: node src/stop-batch.js
2. Or kill it manually using the process ID: ${batchProcess.pid}
   - Windows: taskkill /PID ${batchProcess.pid} /F
   - Linux/Mac: kill -15 ${batchProcess.pid}
  `);
}
