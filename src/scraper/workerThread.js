const { workerData, parentPort } = require('worker_threads');
const GoogleMapsScraper = require('./googleMapsScraper');

async function runScraper() {
  const { taskId, searchTerm, maxResults } = workerData;
  const scraper = new GoogleMapsScraper(maxResults);

  try {
    await scraper.initialize();
    const businesses = await scraper.searchBusinesses(searchTerm, taskId);
    
    parentPort.postMessage({
      type: 'result',
      data: businesses
    });
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      error: error.message
    });
  } finally {
    await scraper.close();
  }
}

runScraper();
