/**
 * Run backfill for portfolio segments (all_tracked fix)
 * Can run directly (imports handler) or via API endpoint
 * 
 * Usage:
 *   node scripts/run-backfill-portfolio-segments.js
 *   USE_API=true API_URL=https://your-vercel-url.vercel.app node scripts/run-backfill-portfolio-segments.js
 */

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

// Check for required environment variables
const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const USE_API = process.env.USE_API === 'true';
const API_URL = process.env.API_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
const ENDPOINT = `${API_URL}/api/supabase/backfill-portfolio-segments`;

console.log(`🔄 Running portfolio segments backfill...`);
console.log(`⏰ This will process all runs (including last 3 months)`);
console.log('');

// If running directly and env vars are missing, suggest using API
if (!USE_API && (!supabaseUrl || !supabaseKey)) {
  console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
  console.error('');
  console.error('💡 Options:');
  console.error('   1. Set environment variables in .env.local or .env file:');
  console.error('      SUPABASE_URL=your_supabase_url');
  console.error('      SUPABASE_SERVICE_ROLE_KEY=your_service_role_key');
  console.error('');
  console.error('   2. Or use the API endpoint (if deployed):');
  console.error(`      USE_API=true API_URL=${API_URL} node scripts/run-backfill-portfolio-segments.js`);
  console.error('');
  process.exit(1);
}

async function runBackfillViaAPI() {
  console.log(`📍 Calling API endpoint: ${ENDPOINT}`);
  
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  return await response.json();
}

async function runBackfillDirect() {
  console.log(`📍 Running directly (importing handler)`);
  
  // Import the handler function directly
  const handlerModule = await import('../api/supabase/backfill-portfolio-segments.js');
  
  // Create mock request/response objects
  const req = {
    method: 'POST',
    body: JSON.stringify({}),
  };
  
  let responseData = null;
  let responseStatus = 200;
  
  const res = {
    setHeader: () => {},
    status: (code) => {
      responseStatus = code;
      return res;
    },
    send: (data) => {
      responseData = JSON.parse(data);
    },
    end: () => {},
  };
  
  await handlerModule.default(req, res);
  
  if (responseStatus !== 200) {
    throw new Error(`Backfill failed with status ${responseStatus}: ${JSON.stringify(responseData)}`);
  }
  
  return responseData;
}

async function runBackfill() {
  try {
    const result = USE_API ? await runBackfillViaAPI() : await runBackfillDirect();
    
    console.log('✅ Backfill completed successfully!');
    console.log('');
    console.log('Results:');
    console.log(`  - Total rows inserted: ${result.totalInserted || 0}`);
    console.log(`  - Runs processed: ${result.runsProcessed || 0}`);
    
    if (result.results && Array.isArray(result.results)) {
      console.log('');
      console.log('Per-run results:');
      result.results.forEach((r, i) => {
        const status = r.success ? '✅' : '❌';
        console.log(`  ${status} Run ${r.runId || i + 1}: ${r.success ? `${r.segments || 0} segments` : r.error || 'Failed'}`);
      });
    }
    
    console.log('');
    console.log('✨ The "All tracked" segment should now have correct values for all months!');
    
  } catch (error) {
    console.error('❌ Error running backfill:', error.message);
    console.error(error.stack);
    
    if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
      console.error('');
      console.error('💡 Tip: Try running directly (without USE_API=true)');
      console.error('   node scripts/run-backfill-portfolio-segments.js');
    }
    
    process.exit(1);
  }
}

runBackfill();
