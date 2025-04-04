const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// PostgreSQL connection pool with explicit Render connection settings
const pool = new Pool({
  user: process.env.PGUSER || 'leads_db_rc6a_user',
  host: process.env.PGHOST || 'dpg-cvo56ap5pdvs739nroe0-a.oregon-postgres.render.com',
  database: process.env.PGDATABASE || 'leads_db_rc6a',
  password: process.env.PGPASSWORD || '4kzEQqPy5bLBpA1pNiQVGA7VT5KeOcgT',
  port: process.env.PGPORT || 5432,
  // Add connection timeout settings for more reliable remote connections
  connectionTimeoutMillis: 10000, // 10 seconds
  idle_in_transaction_session_timeout: 30000, // 30 seconds
  // Add SSL settings for cloud hosted PostgreSQL if needed
  ssl: {
    rejectUnauthorized: false // This may be needed for some cloud providers
  }
});

// Test database connection with improved error handling for remote connections
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection error:', err.message);
    console.error(`Failed to connect to PostgreSQL at ${process.env.PGHOST || 'dpg-cvo56ap5pdvs739nroe0-a'}:${process.env.PGPORT || 5432}`);
    console.error('Please check:');
    console.error('1. PostgreSQL is running on the remote host');
    console.error('2. Connection credentials are correct');
    console.error('3. Network connectivity between client and database server');
  } else {
    console.log(`Connected to PostgreSQL database at ${process.env.PGHOST || 'dpg-cvo56ap5pdvs739nroe0-a'}:${process.env.PGPORT || 5432}`);
    initializeTables();
  }
});

// Initialize database tables
async function initializeTables() {
  try {
    // First, check if the businesses table already exists
    const tableExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'businesses'
      );
    `);
    
    const businessesTableExists = tableExists.rows[0].exists;
    
    if (businessesTableExists) {
      // Check if domain column exists
      const columnExists = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'businesses' AND column_name = 'domain'
        );
      `);
      
      const domainColumnExists = columnExists.rows[0].exists;
      
      // If the column doesn't exist, add it
      if (!domainColumnExists) {
        console.log('Adding domain column to businesses table');
        await pool.query(`ALTER TABLE businesses ADD COLUMN domain TEXT;`);
        
        // Populate domain from website for existing records
        console.log('Populating domain values from website URLs');
        await pool.query(`
          UPDATE businesses 
          SET domain = substring(website from '.*://([^/]*)') 
          WHERE website IS NOT NULL AND website != '';
        `);
      }
    } else {
      // Create businesses table with domain column included
      await pool.query(`
        CREATE TABLE IF NOT EXISTS businesses (
          id SERIAL PRIMARY KEY,
          name TEXT,
          email TEXT,
          address TEXT,
          city TEXT,
          country TEXT,
          website TEXT,
          domain TEXT,
          rating REAL,
          phone TEXT,
          owner_name TEXT,
          search_term TEXT,
          search_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    }
    
    // Now check for unique constraint
    const constraintExists = await pool.query(`
      SELECT EXISTS (
        SELECT FROM pg_constraint 
        WHERE conname = 'unique_domain_search'
      );
    `);
    
    if (!constraintExists.rows[0].exists && businessesTableExists) {
      console.log('Adding unique constraint on domain and search_term');
      await pool.query(`
        ALTER TABLE businesses 
        ADD CONSTRAINT unique_domain_search 
        UNIQUE(domain, search_term)
      `).catch(err => {
        console.warn('Could not add unique constraint, continuing without it:', err.message);
      });
    }

    // Create scraping_tasks table if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS scraping_tasks (
        id TEXT PRIMARY KEY,
        search_term TEXT,
        status TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMP,
        businesses_found INTEGER DEFAULT 0,
        emails_found INTEGER DEFAULT 0
      )
    `);
    
    // Add domain index if it doesn't exist and the column exists
    await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_name = 'businesses' AND column_name = 'domain'
      )
    `).then(async result => {
      if (result.rows[0].exists) {
        const indexExists = await pool.query(`
          SELECT EXISTS (
            SELECT 1 FROM pg_indexes 
            WHERE tablename = 'businesses' AND indexname = 'idx_businesses_domain'
          )
        `);
        
        if (!indexExists.rows[0].exists) {
          console.log('Creating index on domain column');
          await pool.query(`CREATE INDEX idx_businesses_domain ON businesses(domain)`);
        }
      }
    });
    
    console.log('Database tables initialized successfully');
  } catch (error) {
    console.error('Error initializing tables:', error);
  }
}

// Helper functions for database operations
const db = {
  query: (text, params) => {
    console.log(`Executing SQL: ${text} with params:`, params);
    return pool.query(text, params)
      .then(result => {
        console.log(`Query returned ${result.rowCount} rows`);
        return result;
      })
      .catch(err => {
        console.error('Database query error:', err);
        throw err;
      });
  },
  
  // Get a single row
  getOne: async (text, params) => {
    try {
      const result = await pool.query(text, params);
      return result.rows[0];
    } catch (err) {
      console.error('Database getOne error:', err);
      throw err;
    }
  },
  
  // Get multiple rows
  getMany: async (text, params) => {
    try {
      const result = await pool.query(text, params);
      return result.rows;
    } catch (err) {
      console.error('Database getMany error:', err);
      throw err;
    }
  },
  
  // Insert and return the inserted row
  insert: async (text, params) => {
    try {
      const result = await pool.query(text, params);
      return result.rows[0];
    } catch (err) {
      console.error('Database insert error:', err);
      throw err;
    }
  }
};

module.exports = db;
