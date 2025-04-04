#!/usr/bin/env node
const { Pool } = require('pg');
require('dotenv').config();

async function checkDatabaseConnection() {
  console.log('Checking connection to Render PostgreSQL database...');
  
  const config = {
    user: process.env.PGUSER || 'leads_db_rc6a_user',
    host: process.env.PGHOST || 'dpg-cvo56ap5pdvs739nroe0-a.onrender.com',
    database: process.env.PGDATABASE || 'leads_db_rc6a',
    password: process.env.PGPASSWORD || '4kzEQqPy5bLBpA1pNiQVGA7VT5KeOcgT',
    port: process.env.PGPORT || 5432,
    connectionTimeoutMillis: 10000,
    ssl: {
      rejectUnauthorized: false
    }
  };
  
  console.log('Connection config:', {
    host: config.host,
    port: config.port,
    user: config.user,
    database: config.database,
    ssl: config.ssl ? 'enabled' : 'disabled'
  });
  
  const pool = new Pool(config);
  
  try {
    console.log('Attempting to connect...');
    const res = await pool.query('SELECT NOW() as current_time');
    
    console.log('✓ Connection successful!');
    console.log(`Current server time: ${res.rows[0].current_time}`);
    
    // Check tables
    console.log('\nChecking for required tables...');
    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    console.log('Found tables:');
    if (tables.rows.length === 0) {
      console.log('No tables found. Database is empty.');
    } else {
      tables.rows.forEach(row => console.log(`- ${row.table_name}`));
    }
    
    await pool.end();
  } catch (err) {
    console.error('✗ Connection failed:', err.message);
    
    if (err.message.includes('no pg_hba.conf entry')) {
      console.log('\nPossible solution:');
      console.log('- Check if IP whitelist is required for Render');
    } else if (err.message.includes('password authentication failed')) {
      console.log('\nPossible solution:');
      console.log('- Double-check username and password');
    } else if (err.message.includes('connect ETIMEDOUT')) {
      console.log('\nPossible solution:');
      console.log('- Check network connectivity');
      console.log('- Verify hostname is correct');
      console.log('- Make sure no firewall is blocking the connection');
    } else if (err.message.includes('self signed certificate')) {
      console.log('\nPossible solution:');
      console.log('- Try setting SSL to { rejectUnauthorized: false }');
    }
    
    process.exit(1);
  }
}

checkDatabaseConnection().catch(console.error);
