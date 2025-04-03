const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function analyzeGoogleMapsHTML(searchTerm) {
  console.log(`Starting HTML analysis for "${searchTerm}"`);
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ viewport: null });
  const page = await context.newPage();
  
  const outputDir = path.join(__dirname, '../../analysis');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  try {
    // Navigate to Google Maps
    await page.goto('https://www.google.com/maps');
    console.log("Navigated to Google Maps");
    
    // Accept cookies if prompted
    try {
      const acceptButton = await page.$('button:has-text("Accept all")');
      if (acceptButton) {
        await acceptButton.click();
        await page.waitForTimeout(1000);
      }
    } catch (e) {
      console.log('No cookie consent needed or already accepted');
    }

    // Search for the term
    await page.fill('input[name="q"]', searchTerm);
    await page.press('input[name="q"]', 'Enter');
    
    // Wait for results to load
    await page.waitForSelector('div[role="feed"]', { timeout: 15000 })
      .catch(() => console.log('Feed selector not found, continuing anyway'));
    
    await page.waitForTimeout(3000);
    
    // Take a screenshot
    await page.screenshot({ path: path.join(outputDir, 'search-results.png') });
    console.log("Saved screenshot of search results");
    
    // Find all business listings and their classes
    const businessInfo = await page.evaluate(() => {
      const businesses = document.querySelectorAll('div[role="feed"] > div');
      return Array.from(businesses).map((business, index) => {
        return {
          index,
          classes: business.className,
          hasRoleArticle: business.hasAttribute('role') && business.getAttribute('role') === 'article',
          text: business.textContent.substring(0, 50) + '...',
          childElementCount: business.childElementCount
        };
      });
    });
    
    console.log(`Found ${businessInfo.length} potential business elements`);
    fs.writeFileSync(path.join(outputDir, 'business-elements.json'), 
                   JSON.stringify(businessInfo, null, 2));
    
    // Find the main business elements
    const businessElements = await page.$$('div.Nv2PK');
    console.log(`Found ${businessElements.length} business elements with class Nv2PK`);

    // Analyze the first business
    if (businessElements.length > 0) {
      // Click on the first business
      await businessElements[0].click();
      await page.waitForTimeout(3000);
      
      // Take a screenshot of the business details
      await page.screenshot({ path: path.join(outputDir, 'business-details.png') });
      
      // Save the HTML of the details panel
      const detailsPanelHTML = await page.evaluate(() => {
        return document.documentElement.outerHTML;
      });
      fs.writeFileSync(path.join(outputDir, 'business-details.html'), detailsPanelHTML);
      
      // Get key elements and their selectors
      const elementSelectors = await page.evaluate(() => {
        const getElementInfo = (element) => {
          if (!element) return null;
          return {
            tagName: element.tagName,
            className: element.className,
            id: element.id,
            text: element.textContent.substring(0, 100),
            attributes: Array.from(element.attributes || []).map(attr => ({ 
              name: attr.name, 
              value: attr.value 
            }))
          };
        };
        
        return {
          title: getElementInfo(document.querySelector('h1')),
          rating: getElementInfo(document.querySelector('[role="img"]')),
          address: getElementInfo(document.querySelector('button[data-item-id="address"]')),
          phone: getElementInfo(document.querySelector('button[data-item-id="phone"]')),
          website: getElementInfo(document.querySelector('a[data-item-id="website"]')),
          // Try to find common containers
          infoSections: Array.from(document.querySelectorAll('.fontBodyMedium')).map(getElementInfo)
        };
      });
      
      fs.writeFileSync(path.join(outputDir, 'element-selectors.json'), 
                     JSON.stringify(elementSelectors, null, 2));
      console.log(`Saved detailed element information`);
      
      // Test direct extraction of key fields
      const businessName = await page.$eval('h1', el => el.textContent.trim())
        .catch(() => 'Not found');
        
      const rating = await page.$eval('span[role="img"]', el => {
        const ariaLabel = el.getAttribute('aria-label');
        return ariaLabel ? ariaLabel : 'No aria-label';
      }).catch(() => 'Not found');
      
      console.log(`Business Name: ${businessName}`);
      console.log(`Rating: ${rating}`);
    }
    
    console.log(`Analysis complete. Check the '${outputDir}' directory for results.`);
    
  } catch (error) {
    console.error('Error in HTML analysis:', error);
  } finally {
    await browser.close();
  }
}

// Export the function to use from command line
if (require.main === module) {
  const searchTerm = process.argv[2] || "Digital Marketing Agency - New York - USA";
  analyzeGoogleMapsHTML(searchTerm)
    .then(() => console.log("Analysis complete"))
    .catch(console.error)
    .finally(() => process.exit(0));
}

module.exports = { analyzeGoogleMapsHTML };
