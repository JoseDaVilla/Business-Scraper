const express = require('express');
const path = require('path');
const cors = require('cors');
const ParallelScraper = require('./scraper/parallelScraper');
const ExcelExporter = require('./export/excelExporter');
const EmailFinder = require('./scraper/emailFinder');
const db = require('./config/database');
const BatchScraper = require('./scraper/batchScraper');

// Initialize express app
const app = express();
const DEFAULT_PORT = process.env.PORT || 3000;

// Initialize services
const MAX_RESULTS_PER_SEARCH = 200;
const scraper = new ParallelScraper(undefined, MAX_RESULTS_PER_SEARCH);
const exporter = new ExcelExporter();
const emailFinder = new EmailFinder();
const batchScraper = new BatchScraper();

// Initialize email finder
let emailFinderRunning = false;
setTimeout(async () => {
  try {
    await emailFinder.initialize();
    console.log('Email finder service initialized');
  } catch (error) {
    console.error('Failed to initialize email finder:', error);
  }
}, 5000); // Delay startup to ensure database is ready

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/exports', express.static(path.join(__dirname, '../exports')));

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// API endpoints
app.post('/api/scrape', async (req, res) => {
  try {
    const { searchTerm } = req.body;
    
    if (!searchTerm) {
      return res.status(400).json({ error: 'Search term is required' });
    }
    
    const taskId = await scraper.addTask(searchTerm);
    res.json({ 
      taskId, 
      status: 'pending',
      maxResults: MAX_RESULTS_PER_SEARCH
    });

    // After starting a scraping task, set up a watcher to start email finder when complete
    const taskCheckInterval = setInterval(async () => {
      const taskStatus = await scraper.getTaskStatus(taskId);
      if (taskStatus.status === 'completed') {
        clearInterval(taskCheckInterval);
        
        // Wait a short while before starting email finder to ensure all data is saved
        setTimeout(async () => {
          if (!emailFinderRunning) {
            emailFinderRunning = true;
            await emailFinder.processAllPendingBusinesses();
            emailFinderRunning = false;
          }
        }, 5000);
      } else if (taskStatus.status === 'failed') {
        clearInterval(taskCheckInterval);
      }
    }, 10000);
  } catch (error) {
    console.error('Error starting scrape task:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/task/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const taskStatus = await scraper.getTaskStatus(taskId);
    
    if (!taskStatus) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    res.json(taskStatus);
  } catch (error) {
    console.error('Error getting task status:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/tasks', async (req, res) => {
  try {
    const tasks = await scraper.getAllTasks();
    res.json(tasks);
  } catch (error) {
    console.error('Error getting all tasks:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/businesses', async (req, res) => {
  try {
    const { searchTerm } = req.query;
    
    let query, params;
    
    if (searchTerm) {
      query = 'SELECT * FROM businesses WHERE search_term = $1';
      params = [searchTerm];
    } else {
      query = 'SELECT * FROM businesses';
      params = [];
    }
    
    // Using db.getMany instead of db.all (which was SQLite specific)
    const rows = await db.getMany(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Error getting businesses:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/export/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const exportResult = await exporter.exportTaskResults(taskId);
    
    res.json({
      downloadUrl: `/exports/${exportResult.filename}`,
      count: exportResult.count
    });
  } catch (error) {
    console.error('Error exporting to Excel:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add a new endpoint to start email finder job
app.post('/api/find-emails', async (req, res) => {
  try {
    if (emailFinderRunning) {
      return res.status(409).json({ message: 'Email finder is already running' });
    }

    emailFinderRunning = true;
    const count = await emailFinder.processAllPendingBusinesses();
    
    res.json({ 
      message: `Started email finding for ${count} businesses`,
      count 
    });
    
    // Reset flag when done
    emailFinder.processBatch([]).finally(() => {
      emailFinderRunning = false;
    });
  } catch (error) {
    emailFinderRunning = false;
    console.error('Error starting email finder:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add endpoint to get email finder status
app.get('/api/find-emails/status', (req, res) => {
  res.json({
    running: emailFinderRunning,
    queue: emailFinder.queue?.length || 0,
    activeTasks: emailFinder.runningTasks || 0
  });
});

// Add batch scraper endpoints
app.post('/api/batch/start', async (req, res) => {
  try {
    const { states } = req.body;
    
    if (batchScraper.isRunning) {
      return res.status(409).json({ 
        error: 'A batch operation is already running' 
      });
    }
    
    const result = await batchScraper.startBatch(states);
    res.json(result);
  } catch (error) {
    console.error('Error starting batch operation:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/batch/status', (req, res) => {
  try {
    const status = batchScraper.getStatus();
    res.json(status);
  } catch (error) {
    console.error('Error getting batch status:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/batch/stop', async (req, res) => {
  try {
    const result = await batchScraper.stop();
    res.json(result);
  } catch (error) {
    console.error('Error stopping batch operation:', error);
    res.status(500).json({ error: error.message });
  }
});

// Add new export endpoints
app.get('/api/export-all', async (req, res) => {
  try {
    const exportResult = await exporter.exportAllBusinesses();
    
    res.json({
      downloadUrl: `/exports/${exportResult.filename}`,
      count: exportResult.count
    });
  } catch (error) {
    console.error('Error exporting all businesses:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/export-state/:state', async (req, res) => {
  try {
    const { state } = req.params;
    const exportResult = await exporter.exportBusinessesByState(state);
    
    res.json({
      downloadUrl: `/exports/${exportResult.filename}`,
      count: exportResult.count
    });
  } catch (error) {
    console.error('Error exporting state businesses:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    // Get statistics about the database
    const businessCount = await db.getOne('SELECT COUNT(*) as count FROM businesses');
    const emailCount = await db.getOne('SELECT COUNT(*) as count FROM businesses WHERE email IS NOT NULL AND email != \'\'');
    const websiteCount = await db.getOne('SELECT COUNT(*) as count FROM businesses WHERE website IS NOT NULL AND website != \'\'');
    const searchTerms = await db.getMany('SELECT DISTINCT search_term FROM businesses');
    const states = await db.getMany(`
      SELECT DISTINCT substring(search_term from '.+- (.+)$') as state 
      FROM businesses 
      WHERE search_term LIKE '%-%'
    `);
    
    res.json({
      totalBusinesses: parseInt(businessCount.count),
      totalEmails: parseInt(emailCount.count),
      totalWebsites: parseInt(websiteCount.count),
      totalSearchTerms: searchTerms.length,
      states: states.map(row => row.state).filter(Boolean)
    });
  } catch (error) {
    console.error('Error getting statistics:', error);
    res.status(500).json({ error: error.message });
  }
});

// Improved server start function with port fallback
function startServer(port) {
  const server = app.listen(port)
    .on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${port} is already in use, trying port ${port + 1}...`);
        startServer(port + 1);
      } else {
        console.error('Server error:', err);
      }
    })
    .on('listening', () => {
      const actualPort = server.address().port;
      console.log(`Server running on http://localhost:${actualPort}`);
    });
}

// Get port from command line arguments if provided
const args = process.argv.slice(2);
const portArg = args.find(arg => arg.startsWith('--port='));
const port = portArg ? parseInt(portArg.split('=')[1]) : DEFAULT_PORT;

// Start the server with the chosen port
startServer(port);
