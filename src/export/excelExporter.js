const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const db = require('../config/database');

class ExcelExporter {
  constructor() {
    this.exportDirectory = path.resolve(__dirname, '../../exports');
    
    // Create exports directory if it doesn't exist
    if (!fs.existsSync(this.exportDirectory)) {
      fs.mkdirSync(this.exportDirectory, { recursive: true });
    }
  }

  async exportTaskResults(taskId) {
    try {
      // Get task information
      const task = await db.getOne('SELECT * FROM scraping_tasks WHERE id = $1', [taskId]);
      
      if (!task) {
        throw new Error('Task not found');
      }

      // Get businesses for this task
      const businesses = await this.getBusinessesForTask(task.search_term);
      
      if (businesses.length === 0) {
        throw new Error('No businesses found for this task');
      }

      const filename = `${task.search_term.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`;
      const filepath = path.join(this.exportDirectory, filename);
      
      await this.createExcelFile(businesses, filepath, task.search_term);
      
      return {
        filename,
        filepath,
        count: businesses.length
      };
    } catch (error) {
      console.error('Error exporting task results:', error);
      throw error;
    }
  }

  async exportAllBusinesses() {
    try {
      // Get all businesses
      const businesses = await db.getMany('SELECT * FROM businesses ORDER BY search_term, name', []);
      
      if (businesses.length === 0) {
        throw new Error('No businesses found in the database');
      }
      
      // Create a more descriptive filename with date and time
      const dateTime = new Date().toISOString().replace(/:/g, '-').split('.')[0];
      const filename = `All_Businesses_${dateTime}.xlsx`;
      const filepath = path.join(this.exportDirectory, filename);
      
      await this.createExcelFile(businesses, filepath, "All Businesses");
      
      return {
        filename,
        filepath,
        count: businesses.length
      };
    } catch (error) {
      console.error('Error exporting all businesses:', error);
      throw error;
    }
  }

  async exportBusinessesByState(state) {
    try {
      // Get businesses for the specified state
      const businesses = await db.getMany(
        `SELECT * FROM businesses 
         WHERE search_term LIKE $1 
         ORDER BY city, name`, 
        [`%- ${state}`]
      );
      
      if (businesses.length === 0) {
        throw new Error(`No businesses found for state: ${state}`);
      }
      
      const filename = `${state}_Businesses_${new Date().toISOString().split('T')[0]}.xlsx`;
      const filepath = path.join(this.exportDirectory, filename);
      
      await this.createExcelFile(businesses, filepath, `Businesses in ${state}`);
      
      return {
        filename,
        filepath,
        count: businesses.length
      };
    } catch (error) {
      console.error(`Error exporting businesses for state ${state}:`, error);
      throw error;
    }
  }

  async getBusinessesForTask(searchTerm) {
    try {
      return await db.getMany('SELECT * FROM businesses WHERE search_term = $1 ORDER BY name', [searchTerm]);
    } catch (error) {
      console.error('Error getting businesses for task:', error);
      throw error;
    }
  }

  async createExcelFile(businesses, filepath, title) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Business Scraper Bot';
    workbook.lastModifiedBy = 'Business Scraper Bot';
    workbook.created = new Date();
    workbook.modified = new Date();
    
    // Add title to workbook properties
    workbook.properties.title = title;
    
    const worksheet = workbook.addWorksheet('Businesses', {
      properties: { tabColor: { argb: '4167B8' } },
      views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }] // Freeze the header row
    });
    
    // Define columns with improved formatting
    worksheet.columns = [
      { header: 'Name', key: 'name', width: 30, style: { alignment: { wrapText: true } } },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Website', key: 'website', width: 30 },
      { header: 'Phone', key: 'phone', width: 20 },
      { header: 'Address', key: 'address', width: 40, style: { alignment: { wrapText: true } } },
      { header: 'City', key: 'city', width: 20 },
      { header: 'Country', key: 'country', width: 15 },
      { header: 'Rating', key: 'rating', width: 10 },
      { header: 'Search Term', key: 'search_term', width: 30 },
      { header: 'Scraped', key: 'search_date', width: 20 }
    ];
    
    // Style the header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: '4167B8' } // Dark blue header
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    headerRow.height = 22;
    
    // Add rows with proper data type handling
    businesses.forEach(business => {
      // Format date in a readable way if available
      let formattedDate = business.search_date;
      if (business.search_date instanceof Date) {
        formattedDate = business.search_date.toLocaleString();
      } else if (typeof business.search_date === 'string' && business.search_date) {
        formattedDate = new Date(business.search_date).toLocaleString();
      }
      
      // Add the row
      const row = worksheet.addRow({
        name: business.name || 'N/A',
        email: business.email || '',
        website: business.website || '',
        phone: business.phone || '',
        address: business.address || '',
        city: business.city || '',
        country: business.country || '',
        rating: business.rating || '',
        search_term: business.search_term || '',
        search_date: formattedDate || ''
      });
      
      // Make website and email clickable
      if (business.website) {
        const websiteCell = row.getCell('website');
        websiteCell.value = { 
          text: business.website,
          hyperlink: business.website.startsWith('http') ? business.website : `http://${business.website}`,
          tooltip: 'Click to visit website'
        };
        websiteCell.font = { color: { argb: '0563C1' }, underline: true };
      }
      
      if (business.email) {
        const emailCell = row.getCell('email');
        emailCell.value = { 
          text: business.email,
          hyperlink: `mailto:${business.email}`,
          tooltip: 'Click to send email'
        };
        emailCell.font = { color: { argb: '0563C1' }, underline: true };
      }
      
      // Set number format for rating
      if (business.rating) {
        const ratingCell = row.getCell('rating');
        ratingCell.numFmt = '0.0';
      }
      
      // Alternate row colors for better readability
      if (row.number % 2 === 0) {
        row.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'F5F5F5' } // Light gray for even rows
        };
      }
    });
    
    // Add autofilter to the entire data range
    worksheet.autoFilter = {
      from: 'A1',
      to: `J${businesses.length + 1}`
    };
    
    // Add title above the table
    const titleRow = worksheet.insertRow(1, [`${title} - Total: ${businesses.length}`]);
    titleRow.font = { bold: true, size: 14 };
    titleRow.height = 24;
    worksheet.mergeCells(`A1:J1`);
    titleRow.alignment = { horizontal: 'center' };
    
    // Add borders to all cells
    for (let i = 1; i <= businesses.length + 2; i++) {
      const row = worksheet.getRow(i);
      row.eachCell({ includeEmpty: true }, cell => {
        cell.border = {
          top: {style:'thin'},
          left: {style:'thin'},
          bottom: {style:'thin'},
          right: {style:'thin'}
        };
      });
    }
    
    // Save the workbook
    await workbook.xlsx.writeFile(filepath);
    return filepath;
  }
}

module.exports = ExcelExporter;
