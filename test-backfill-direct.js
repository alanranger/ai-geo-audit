/**
 * Direct test script for domain strength backfill
 * Run with: node test-backfill-direct.js
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import the handler
const backfillModule = await import('./api/domain-strength/backfill.js');
const handler = backfillModule.default;

// Read test data
const testData = JSON.parse(readFileSync(join(__dirname, 'test-backfill.json'), 'utf-8'));

// Mock request/response objects
const mockReq = {
  method: 'POST',
  headers: {
    'x-admin-token': process.env.ADMIN_TOKEN || 'test-token-for-local-testing'
  },
  body: testData
};

const mockRes = {
  statusCode: 200,
  headers: {},
  setHeader: function(name, value) {
    this.headers[name] = value;
  },
  status: function(code) {
    this.statusCode = code;
    return this;
  },
  json: function(data) {
    console.log('\n=== BACKFILL TEST RESULTS ===');
    console.log(JSON.stringify(data, null, 2));
    return this;
  },
  end: function() {
    return this;
  }
};

// Run the test
console.log('Testing domain strength backfill...');
console.log(`Mode: ${testData.mode}`);
console.log(`Domains: ${testData.domains.length}`);
console.log(`Dry run: ${testData.dryRun}`);
console.log(`Max new domains: ${testData.maxNewDomains}\n`);

try {
  await handler(mockReq, mockRes);
  console.log(`\nStatus: ${mockRes.statusCode}`);
} catch (error) {
  console.error('\nError:', error.message);
  console.error(error.stack);
}

