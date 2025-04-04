#!/usr/bin/env node
const { Pool } = require('pg');
require('dotenv').config();

async function setupDatabase() {
  console.log('Setting up the database for Business Scrapper Bot...');
  
  // Get connection info from environment variables with fallbacks to Render credentials
  const host = process.env.PGHOST || 'dpg-cvo56ap5pdvs739nroe0-a.onrender.com';
  const port = process.env.PGPORT || 5432;
  const user = process.env.PGUSER || 'leads_db_rc6a_user';
  const password = process.env.PGPASSWORD || '4kzEQqPy5bLBpA1pNiQVGA7VT5KeOcgT';
  const database = process.env.PGDATABASE || 'leads_db_rc6a';
  
  console.log(`Connecting to PostgreSQL at ${host}:${port}`);
  
  // For Render PostgreSQL, we connect directly to the database
  const pool = new Pool({
    host,
    port,
    user,
    password,
    database,
    connectionTimeoutMillis: 10000,
    ssl: {
      rejectUnauthorized: false // Typically needed for Render
    }
  });
  
  try {
    // Test connection first
    const testResult = await pool.query('SELECT NOW() as current_time');
    console.log(`Connected to database '${database}' successfully. Server time: ${testResult.rows[0].current_time}`);
    
    console.log('Creating necessary tables...');
    
    // Businesses table
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
    
    // Try to remove any existing constraint first to avoid conflicts
    try {
      await pool.query(`
        ALTER TABLE businesses 
        DROP CONSTRAINT IF EXISTS unique_domain_search
      `);
      console.log('Removed existing domain constraint (if any)');
      
      // Remove any existing index
      await pool.query(`
        DROP INDEX IF EXISTS idx_unique_domain_search
      `);
      
      // Now add a unique index instead of constraint
      await pool.query(`
        CREATE UNIQUE INDEX idx_unique_domain_search
        ON businesses (domain, search_term)
        WHERE domain IS NOT NULL AND domain != '' AND domain NOT LIKE 'no-domain-%' AND domain NOT LIKE 'backup-domain-%'
      `);
      console.log('Added unique index on domain and search_term');
    } catch (error) {
      console.log('Note: Issue with index management', error.message);
    }
    
    // Create index on domain column if it doesn't exist
    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_businesses_domain ON businesses(domain)
        WHERE domain IS NOT NULL AND domain != ''
      `);
      console.log('Created conditional index on domain column');
    } catch (error) {
      // Index might already exist
      console.log('Note: Domain index may already exist');
    }
    
    // Create scraping_tasks table
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
    
    // Create batch operation tables
    await pool.query(`
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
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS batch_task_failures (
        id SERIAL PRIMARY KEY,
        batch_id TEXT REFERENCES batch_operations(id),
        state TEXT,
        city TEXT,
        error_message TEXT,
        failure_time TIMESTAMP
      )
    `);
    
    await pool.query(`
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
    
    console.log('Database setup completed successfully!');
    
    // Close the connection
    await pool.end();
    
  } catch (error) {
    console.error('Error during database setup:', error);
    process.exit(1);
  }
}

// Run the setup function
setupDatabase().then(() => {
  console.log('Database initialization complete.');
  process.exit(0);
});
