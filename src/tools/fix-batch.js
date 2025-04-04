/**
 * This script performs a test run of the Google Maps scraper
 * and provides detailed debugging information to diagnose issues
 */
const GoogleMapsScraper = require('../scraper/googleMapsScraper');
const fs = require('fs');
const path = require('path');
const debug = require('./debugHelper');

const debugDir = path.join(__dirname, '../../debug');
if (!fs.existsSync(debugDir)) {
  fs.mkdirSync(debugDir, { recursive: true });
}

async function testScraper() {
  debug.info('Starting test scrape to diagnose batch issues');

  // Create a timestamp for this test run
  const timestamp = new Date().toISOString().replace(/:/g, '-');
  
  // Create test search term
  const searchTerm = 'Digital Marketing Agency - New York - New York';
  debug.info(`Using test search term: ${searchTerm}`);
  
  // Initialize scraper with visual debugging
  const scraper = new GoogleMapsScraper(10); // Limit to 10 results for test
  
  try {
    await scraper.initialize();
    debug.info('Browser initialized');
    
    // Run the search
    const businesses = await scraper.getBusinessList(searchTerm);
    
    // Save results to debug file
    const resultsFile = path.join(debugDir, `test-results-${timestamp}.json`);
    fs.writeFileSync(resultsFile, JSON.stringify({
      searchTerm,
      timestamp,
      businessesFound: businesses.length,
      businesses
    }, null, 2));
    
    debug.info(`Test completed. Found ${businesses.length} businesses`);
    debug.info(`Results saved to ${resultsFile}`);
    
    if (businesses.length === 0) {
      debug.error('No businesses found! Possible issues:');
      debug.error('1. Google may be blocking automated requests - try with headless: false');
      debug.error('2. Search term may be invalid or return no results');
      debug.error('3. Page structure may have changed - check the screenshots');
    } else {
      debug.info('Test successful. Scraper is working correctly.');
    }
  } catch (error) {
    debug.error(`Test failed with error: ${error.message}`);
    debug.error(error.stack);
  } finally {
    // Cleanup
    if (scraper.browser) {
      await scraper.browser.close();
    }
  }
}

// Run the test
testScraper().catch(console.error).finally(() => process.exit(0));
