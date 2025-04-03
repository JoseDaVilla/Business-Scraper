const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '../../logs');

// Ensure logs directory exists
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Log levels
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
};

// Set current log level (adjust as needed)
const CURRENT_LOG_LEVEL = LOG_LEVELS.INFO;

function logToFile(message, type = 'info') {
  const timestamp = new Date().toISOString();
  const logFile = path.join(logsDir, `scraper-${new Date().toISOString().slice(0, 10)}.log`);
  const logMessage = `[${timestamp}] [${type.toUpperCase()}] ${typeof message === 'object' ? JSON.stringify(message) : message}\n`;
  
  // Log to file
  try {
    fs.appendFileSync(logFile, logMessage);
  } catch (err) {
    console.error(`Failed to write to log file: ${err.message}`);
  }
  
  // Only log to console if level is high enough
  const messageLevel = LOG_LEVELS[type.toUpperCase()] || 0;
  if (messageLevel >= CURRENT_LOG_LEVEL) {
    if (type.toUpperCase() === 'ERROR') {
      console.error(`[${type.toUpperCase()}] ${message}`);
    } else {
      console.log(`[${type.toUpperCase()}] ${message}`);
    }
  }
}

module.exports = {
  debug: message => logToFile(message, 'debug'),
  info: message => logToFile(message, 'info'),
  warn: message => logToFile(message, 'warn'),
  error: message => logToFile(message, 'error'),
  setLogLevel: (level) => {
    if (LOG_LEVELS[level.toUpperCase()] !== undefined) {
      CURRENT_LOG_LEVEL = LOG_LEVELS[level.toUpperCase()];
    }
  }
};
