// Quick script to check optimisation tasks in Supabase
// Run with: node check-optimisation-tasks.js

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTasks() {
  console.log('Querying optimisation tasks from Supabase...\n');
  
  // Query the view to get all tasks
  const { data, error } = await supabase
    .from('vw_optimisation_task_status')
    .select('keyword_text, status, cycle_active, last_activity_at, target_url_clean, task_type, created_at')
    .order('keyword_text');

  if (error) {
    console.error('Error querying Supabase:', error);
    return;
  }

  if (!data || data.length === 0) {
    console.log('No optimisation tasks found in database.');
    return;
  }

  console.log(`Found ${data.length} optimisation task(s):\n`);
  console.log('Keyword'.padEnd(35), 'Status'.padEnd(15), 'Cycle'.padEnd(8), 'Last Activity'.padEnd(20), 'URL');
  console.log('-'.repeat(120));

  data.forEach(task => {
    const keyword = (task.keyword_text || '').substring(0, 34);
    const status = (task.status || '').substring(0, 14);
    const cycle = `Cycle ${task.cycle_active || 1}`;
    const lastActivity = task.last_activity_at 
      ? new Date(task.last_activity_at).toLocaleDateString('en-GB')
      : 'N/A';
    const url = (task.target_url_clean || '').substring(0, 50);
    
    console.log(
      keyword.padEnd(35),
      status.padEnd(15),
      cycle.padEnd(8),
      lastActivity.padEnd(20),
      url
    );
  });

  console.log('\n--- Summary by Status ---');
  const statusCounts = {};
  data.forEach(task => {
    const status = task.status || 'unknown';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  });
  
  Object.entries(statusCounts)
    .sort((a, b) => b[1] - a[1])
    .forEach(([status, count]) => {
      console.log(`${status}: ${count}`);
    });
}

checkTasks().catch(console.error);


