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
      
      await this.createExcelFile(businesses, filepath);
      
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

  async getBusinessesForTask(searchTerm) {
    try {
      return await db.getMany('SELECT * FROM businesses WHERE search_term = $1', [searchTerm]);
    } catch (error) {
      console.error('Error getting businesses for task:', error);
      throw error;
    }
  }

  async createExcelFile(businesses, filepath) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Businesses');
    
    // Add headers with styling
    worksheet.columns = [
      { header: 'Name', key: 'name', width: 30 },
      { header: 'Email', key: 'email', width: 30 },
      { header: 'Address', key: 'address', width: 40 },
      { header: 'City', key: 'city', width: 20 },
      { header: 'Country', key: 'country', width: 20 },
      { header: 'Website', key: 'website', width: 30 },
      { header: 'Rating', key: 'rating', width: 10 },
      { header: 'Phone', key: 'phone', width: 20 },
      { header: 'Owner Name', key: 'owner_name', width: 25 }
    ];
    
    // Style the headers
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD3D3D3' }
    };
    
    // Add rows
    businesses.forEach(business => {
      worksheet.addRow({
        name: business.name,
        email: business.email,
        address: business.address,
        city: business.city,
        country: business.country,
        website: business.website,
        rating: business.rating,
        phone: business.phone,
        owner_name: business.owner_name
      });
    });
    
    // Auto filter
    worksheet.autoFilter = {
      from: 'A1',
      to: 'I1'
    };
    
    // Save the workbook
    await workbook.xlsx.writeFile(filepath);
    return filepath;
  }
}

module.exports = ExcelExporter;
