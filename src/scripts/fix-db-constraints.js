#!/usr/bin/env node
const { Pool } = require('pg');
require('dotenv').config();

async function fixDatabaseConstraints() {
  console.log('Fixing database constraints for Business Scraper Bot...');
  
  // Get connection info from environment variables
  const host = process.env.PGHOST || 'dpg-cvo56ap5pdvs739nroe0-a.oregon-postgres.render.com';
  const port = process.env.PGPORT || 5432;
  const user = process.env.PGUSER || 'leads_db_rc6a_user';
  const password = process.env.PGPASSWORD || '4kzEQqPy5bLBpA1pNiQVGA7VT5KeOcgT';
  const database = process.env.PGDATABASE || 'leads_db_rc6a';
  
  console.log(`Connecting to PostgreSQL at ${host}:${port}`);
  
  const pool = new Pool({
    host,
    port,
    user,
    password,
    database,
    connectionTimeoutMillis: 10000,
    ssl: {
      rejectUnauthorized: false
    }
  });
  
  try {
    // Test connection first
    const testResult = await pool.query('SELECT NOW() as current_time');
    console.log(`Connected to database '${database}' successfully.`);
    
    // Remove any existing unique constraint
    try {
      await pool.query(`
        ALTER TABLE businesses 
        DROP CONSTRAINT IF EXISTS unique_domain_search
      `);
      console.log('✓ Removed existing domain constraint');
    } catch (error) {
      console.error('Error removing constraint:', error.message);
    }
    
    // Remove any existing unique index
    try {
      await pool.query(`
        DROP INDEX IF EXISTS idx_unique_domain_search
      `);
      console.log('✓ Removed existing domain unique index (if any)');
    } catch (error) {
      console.error('Error removing index:', error.message);
    }
    
    // Add unique index instead of constraint with WHERE clause
    try {
      await pool.query(`
        CREATE UNIQUE INDEX idx_unique_domain_search
        ON businesses (domain, search_term)
        WHERE domain IS NOT NULL AND domain != '' AND domain NOT LIKE 'no-domain-%' AND domain NOT LIKE 'backup-domain-%'
      `);
      console.log('✓ Added unique index on domain and search_term');
    } catch (error) {
      console.error('Error adding unique index:', error.message);
    }
    
    // Check for duplicate businesses to ensure future inserts work properly
    const duplicates = await pool.query(`
      SELECT 
        domain, 
        search_term, 
        COUNT(*) as count,
        array_agg(id) as ids
      FROM businesses 
      WHERE domain IS NOT NULL AND domain != ''
      GROUP BY domain, search_term
      HAVING COUNT(*) > 1
      LIMIT 10
    `);
    
    if (duplicates.rows.length > 0) {
      console.log('\nWarning: Found duplicate businesses that might cause issues:');
      duplicates.rows.forEach(row => {
        console.log(`Domain: ${row.domain}, Search Term: ${row.search_term}, Count: ${row.count}`);
      });
      
      console.log('\nYou may want to clean up these duplicates using SQL commands.');
    } else {
      console.log('\n✓ No duplicate businesses found with the same domain and search term');
    }
    
    // Check for businesses without domains
    const noDomains = await pool.query(`
      SELECT COUNT(*) as count FROM businesses 
      WHERE domain IS NULL OR domain = ''
    `);
    
    console.log(`\nBusinesses without domains: ${noDomains.rows[0].count}`);
    
    // Add an index to improve query performance
    try {
      await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_businesses_name_search 
        ON businesses(name, search_term)
      `);
      console.log('✓ Created index on name and search_term');
    } catch (error) {
      console.error('Error creating index:', error.message);
    }
    
    console.log('\nDatabase constraints fixed successfully!');
    
    // Close the connection
    await pool.end();
    
  } catch (error) {
    console.error('Error during constraint fix:', error);
    process.exit(1);
  }
}

// Run the script
fixDatabaseConstraints().then(() => {
  console.log('Script completed.');
  process.exit(0);
}).catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
