/**
 * Test script to run backfill endpoint with small batch (3 domains)
 */

import handler from './api/domain-strength/backfill.js';
import { readFileSync } from 'fs';

// Read test data
const testData = JSON.parse(readFileSync('./test-backfill-small.json', 'utf-8'));

// Create mock request/response
const req = {
  method: 'POST',
  headers: {
    'x-admin-token': process.env.ADMIN_TOKEN || 'test-admin-token-for-local'
  },
  body: testData
};

let responseData = null;
let statusCode = 200;

const res = {
  setHeader: () => {},
  status: (code) => {
    statusCode = code;
    return res;
  },
  json: (data) => {
    responseData = data;
    console.log('\n=== BACKFILL TEST RESULTS (REAL RUN) ===');
    console.log(JSON.stringify(data, null, 2));
    return res;
  },
  end: () => res
};

// Run the test
console.log('Running REAL backfill test (will create snapshots)...');
console.log(`Mode: ${testData.mode}`);
console.log(`Domains: ${testData.domains.length}`);
console.log(`Dry run: ${testData.dryRun}`);
console.log(`Max new domains: ${testData.maxNewDomains}\n`);

try {
  await handler(req, res);
  console.log(`\n✅ Test completed with status: ${statusCode}`);
  if (responseData) {
    console.log(`\nSummary:`);
    console.log(`- Considered: ${responseData.considered}`);
    console.log(`- Processed: ${responseData.processed}`);
    console.log(`- Skipped (existing): ${responseData.skipped_existing}`);
    console.log(`- Invalid: ${responseData.invalid}`);
    if (responseData.errors && responseData.errors.length > 0) {
      console.log(`\n⚠️  Errors: ${responseData.errors.length}`);
      responseData.errors.forEach((e, i) => {
        console.log(`  ${i + 1}. ${JSON.stringify(e)}`);
      });
    }
  }
} catch (error) {
  console.error('\n❌ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
}

