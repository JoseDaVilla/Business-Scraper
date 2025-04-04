#!/usr/bin/env node
const { Pool } = require('pg');
require('dotenv').config();

async function setupDatabase() {
  console.log('Setting up the database for Business Scrapper Bot...');
  
  // Get connection info from environment variables with fallbacks
  const host = process.env.PGHOST || '10.10.0.76';
  const port = process.env.PGPORT || 5432;
  const user = process.env.PGUSER || 'postgres';
  const password = process.env.PGPASSWORD || 'newpassword';
  const database = process.env.PGDATABASE || 'business_scraper';
  
  console.log(`Connecting to PostgreSQL at ${host}:${port}`);
  
  // First connect to 'postgres' database to create our app database if it doesn't exist
  const pool = new Pool({
    host,
    port,
    user,
    password,
    database: 'postgres', // Connect to default database first
    connectionTimeoutMillis: 10000,
  });
  
  try {
    // Check if our database exists
    const dbCheckResult = await pool.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [database]
    );
    
    // Create database if it doesn't exist
    if (dbCheckResult.rowCount === 0) {
      console.log(`Database '${database}' does not exist. Creating it now...`);
      await pool.query(`CREATE DATABASE ${database}`);
      console.log(`Database '${database}' created successfully!`);
    } else {
      console.log(`Database '${database}' already exists.`);
    }
    
    // Close the initial connection
    await pool.end();
    
    // Connect to our new database to create tables
    const appPool = new Pool({
      host,
      port,
      user,
      password,
      database,
      connectionTimeoutMillis: 10000,
    });
    
    // Create tables
    console.log('Creating necessary tables...');
    
    // Businesses table
    await appPool.query(`
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
    
    // Add unique constraint if it doesn't exist
    try {
      await appPool.query(`
        ALTER TABLE businesses 
        ADD CONSTRAINT unique_domain_search 
        UNIQUE(domain, search_term)
      `);
      console.log('Added unique constraint on domain and search_term');
    } catch (error) {
      // Constraint might already exist
      console.log('Note: Unique constraint may already exist');
    }
    
    // Create index on domain column if it doesn't exist
    try {
      await appPool.query(`
        CREATE INDEX idx_businesses_domain ON businesses(domain)
      `);
      console.log('Created index on domain column');
    } catch (error) {
      // Index might already exist
      console.log('Note: Domain index may already exist');
    }
    
    // Create scraping_tasks table
    await appPool.query(`
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
    await appPool.query(`
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
    
    await appPool.query(`
      CREATE TABLE IF NOT EXISTS batch_task_failures (
        id SERIAL PRIMARY KEY,
        batch_id TEXT REFERENCES batch_operations(id),
        state TEXT,
        city TEXT,
        error_message TEXT,
        failure_time TIMESTAMP
      )
    `);
    
    await appPool.query(`
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
    await appPool.end();
    
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
