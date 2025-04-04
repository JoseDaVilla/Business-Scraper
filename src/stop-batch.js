#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const db = require('./config/database');

async function stopBatch() {
  console.log('Attempting to stop running batch processes...');

  try {
    // Method 1: Try to stop via the database
    const result = await db.query(
      `UPDATE batch_operations 
       SET status = 'stopped', end_time = NOW() 
       WHERE status = 'running' 
       RETURNING id`
    );
    
    if (result.rows && result.rows.length > 0) {
      console.log(`Marked ${result.rows.length} batch operations as stopped in database.`);
      console.log(`Batch IDs: ${result.rows.map(r => r.id).join(', ')}`);
    } else {
      console.log('No active batch operations found in database.');
    }

    // Method 2: Find and kill the process by name pattern
    if (process.platform === 'win32') {
      // Windows
      exec('tasklist /FI "IMAGENAME eq node.exe" /FO CSV', (error, stdout) => {
        if (error) {
          console.error('Error finding processes:', error);
          return;
        }
        
        // Parse the CSV output to find batch processes
        const lines = stdout.split('\n');
        const processes = [];
        
        for (let i = 1; i < lines.length; i++) {  // Skip header row
          const line = lines[i].trim();
          if (!line) continue;
          
          // Parse the CSV format
          const match = line.match(/"([^"]+)"/g);
          if (match && match.length >= 2) {
            const process = match[0].replace(/"/g, '');
            const pid = match[1].replace(/"/g, '');
            processes.push({ process, pid });
          }
        }
        
        if (processes.length > 0) {
          console.log('Found running Node.js processes:');
          processes.forEach(p => {
            console.log(`PID: ${p.pid} - Process: ${p.process}`);
          });
          
          console.log('\nTo stop a specific batch process, run:');
          console.log('taskkill /PID <PID> /F');
        } else {
          console.log('No running Node.js processes found.');
        }
      });
    } else {
      // Unix-based systems
      exec('ps aux | grep "[n]ode.*batch-runner"', (error, stdout) => {
        if (error && error.code !== 1) {
          console.error('Error finding processes:', error);
          return;
        }
        
        if (stdout) {
          const lines = stdout.split('\n').filter(Boolean);
          if (lines.length > 0) {
            console.log('Found running batch processes:');
            console.log(stdout);
            
            console.log('\nTo stop a specific batch process, run:');
            console.log('kill -15 <PID>');
          } else {
            console.log('No running batch processes found.');
          }
        } else {
          console.log('No running batch processes found.');
        }
      });
    }
    
    console.log('\nRemember that stopping the process abruptly may leave some browser instances running.');
    console.log('You may need to check your task manager to close any orphaned browser processes.');
  } catch (error) {
    console.error('Error stopping batch:', error);
  }
}

// Execute
stopBatch().catch(console.error).finally(() => {
  // Give time for the database connection to close
  setTimeout(() => process.exit(0), 1000);
});
