/**
 * Test Script for queryTotals Save/Retrieve
 * 
 * This script tests the queryTotals flow:
 * 1. Fetches queryTotals for 5 test keywords using the same endpoint as the UI
 * 2. Saves them to Supabase using the same endpoint as the UI
 * 3. Queries Supabase to verify the data was saved correctly
 * 
 * Usage: node test-querytotals.js
 */

const BASE_URL = process.env.VERCEL_URL 
  ? `https://${process.env.VERCEL_URL}` 
  : process.env.LOCAL_URL || 'http://localhost:3000';

// Test configuration
const TEST_KEYWORDS = [
  'photography workshops',
  'camera training',
  'photo editing',
  'photography courses',
  'camera lessons'
];

const TEST_PROPERTY_URL = process.env.TEST_PROPERTY_URL || 'https://alanranger.com';
const TEST_DAYS = 28;

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, message) {
  log(`\n[Step ${step}] ${message}`, 'cyan');
}

function logSuccess(message) {
  log(`✓ ${message}`, 'green');
}

function logError(message) {
  log(`✗ ${message}`, 'red');
}

function logWarning(message) {
  log(`⚠ ${message}`, 'yellow');
}

async function fetchQueryTotals(keywords, propertyUrl, days) {
  logStep(1, `Fetching queryTotals for ${keywords.length} keywords...`);
  log(`   Keywords: ${keywords.join(', ')}`, 'blue');
  log(`   Property: ${propertyUrl}`, 'blue');
  log(`   Days: ${days}`, 'blue');
  
  const keywordsParam = encodeURIComponent(JSON.stringify(keywords));
  const propertyParam = encodeURIComponent(propertyUrl);
  const url = `${BASE_URL}/api/aigeo/gsc-entity-metrics?property=${propertyParam}&keywords=${keywordsParam}&days=${days}`;
  
  log(`   URL: ${url}`, 'blue');
  
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
    
    if (data.status !== 'ok') {
      throw new Error(`API returned error: ${data.message || 'Unknown error'}`);
    }
    
    if (!data.data || !Array.isArray(data.data.queryTotals)) {
      throw new Error('API did not return queryTotals array');
    }
    
    const queryTotals = data.data.queryTotals;
    logSuccess(`Fetched ${queryTotals.length} queryTotals from GSC API`);
    
    // Log sample data
    if (queryTotals.length > 0) {
      log(`   Sample: ${JSON.stringify(queryTotals[0], null, 2)}`, 'blue');
    }
    
    return queryTotals;
  } catch (error) {
    logError(`Failed to fetch queryTotals: ${error.message}`);
    throw error;
  }
}

async function saveToSupabase(propertyUrl, auditDate, queryTotals) {
  logStep(2, `Saving queryTotals to Supabase...`);
  log(`   Property: ${propertyUrl}`, 'blue');
  log(`   Audit Date: ${auditDate}`, 'blue');
  log(`   QueryTotals Count: ${queryTotals.length}`, 'blue');
  
  const url = `${BASE_URL}/api/supabase/save-audit`;
  const payload = {
    propertyUrl: propertyUrl,
    auditDate: auditDate,
    searchData: {
      queryTotals: queryTotals
    }
  };
  
  log(`   Payload keys: ${Object.keys(payload).join(', ')}`, 'blue');
  log(`   searchData.queryTotals type: ${Array.isArray(payload.searchData.queryTotals) ? 'array' : typeof payload.searchData.queryTotals}`, 'blue');
  log(`   searchData.queryTotals length: ${payload.searchData.queryTotals.length}`, 'blue');
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const result = await response.json();
    
    if (result.status !== 'ok') {
      throw new Error(`Save failed: ${result.message || 'Unknown error'}`);
    }
    
    logSuccess(`Saved queryTotals to Supabase successfully`);
    
    // Log the saved data from response if available
    if (result.data && Array.isArray(result.data) && result.data.length > 0) {
      const savedRecord = result.data[0];
      if (savedRecord.query_totals) {
        const savedQt = savedRecord.query_totals;
        log(`   Saved query_totals type: ${Array.isArray(savedQt) ? 'array' : typeof savedQt}`, 'blue');
        log(`   Saved query_totals length: ${Array.isArray(savedQt) ? savedQt.length : 'N/A'}`, 'blue');
      } else {
        logWarning(`   Response does not include query_totals field`);
      }
    }
    
    return result;
  } catch (error) {
    logError(`Failed to save to Supabase: ${error.message}`);
    throw error;
  }
}

async function verifyInSupabase(propertyUrl, auditDate) {
  logStep(3, `Verifying queryTotals in Supabase...`);
  log(`   Property: ${propertyUrl}`, 'blue');
  log(`   Audit Date: ${auditDate}`, 'blue');
  
  const url = `${BASE_URL}/api/supabase/get-latest-audit?propertyUrl=${encodeURIComponent(propertyUrl)}`;
  
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    const result = await response.json();
    
    if (result.status !== 'ok' || !result.data) {
      throw new Error(`Failed to retrieve audit: ${result.message || 'Unknown error'}`);
    }
    
    const auditData = result.data;
    
    // Check if searchData exists
    if (!auditData.searchData) {
      logError('searchData is missing from retrieved audit');
      return false;
    }
    
    logSuccess('Retrieved audit data from Supabase');
    log(`   searchData keys: ${Object.keys(auditData.searchData).join(', ')}`, 'blue');
    
    // Check queryTotals
    const queryTotals = auditData.searchData.queryTotals;
    
    if (!queryTotals) {
      logError('queryTotals is missing from searchData');
      return false;
    }
    
    if (!Array.isArray(queryTotals)) {
      logError(`queryTotals is not an array (type: ${typeof queryTotals})`);
      if (typeof queryTotals === 'object' && queryTotals !== null) {
        log(`   queryTotals keys: ${Object.keys(queryTotals).join(', ')}`, 'yellow');
        log(`   queryTotals value: ${JSON.stringify(queryTotals).substring(0, 200)}`, 'yellow');
      }
      return false;
    }
    
    if (queryTotals.length === 0) {
      logWarning('queryTotals is an empty array');
      return false;
    }
    
    logSuccess(`Verified queryTotals in Supabase: ${queryTotals.length} items`);
    
    // Log sample
    if (queryTotals.length > 0) {
      log(`   Sample queryTotal: ${JSON.stringify(queryTotals[0], null, 2)}`, 'blue');
    }
    
    // Verify structure
    const sample = queryTotals[0];
    const requiredFields = ['query', 'clicks', 'impressions', 'ctr', 'position'];
    const missingFields = requiredFields.filter(field => !(field in sample));
    
    if (missingFields.length > 0) {
      logWarning(`Missing fields in queryTotal: ${missingFields.join(', ')}`);
    } else {
      logSuccess('All required fields present in queryTotals');
    }
    
    return true;
  } catch (error) {
    logError(`Failed to verify in Supabase: ${error.message}`);
    throw error;
  }
}

function createMockQueryTotals(keywords) {
  // Create mock queryTotals data for testing
  return keywords.map((keyword, index) => ({
    query: keyword,
    clicks: Math.floor(Math.random() * 100) + 1,
    impressions: Math.floor(Math.random() * 1000) + 100,
    ctr: (Math.random() * 5).toFixed(2),
    position: (Math.random() * 20 + 1).toFixed(1)
  }));
}

async function runTest() {
  log('\n' + '='.repeat(60), 'cyan');
  log('queryTotals Save/Retrieve Test', 'cyan');
  log('='.repeat(60), 'cyan');
  
  try {
    // Get audit date (use today's date)
    const auditDate = new Date().toISOString().split('T')[0];
    
    // Step 1: Try to fetch queryTotals, fallback to mock data if it fails
    let queryTotals;
    try {
      queryTotals = await fetchQueryTotals(TEST_KEYWORDS, TEST_PROPERTY_URL, TEST_DAYS);
      if (queryTotals.length === 0) {
        logWarning('No queryTotals returned from API - using mock data for testing');
        queryTotals = createMockQueryTotals(TEST_KEYWORDS);
      }
    } catch (fetchError) {
      logWarning(`Failed to fetch from GSC API: ${fetchError.message}`);
      log('Using mock data to test save/retrieve flow...', 'yellow');
      queryTotals = createMockQueryTotals(TEST_KEYWORDS);
    }
    
    log(`   Using ${queryTotals.length} queryTotals for testing`, 'blue');
    
    // Step 2: Save to Supabase
    await saveToSupabase(TEST_PROPERTY_URL, auditDate, queryTotals);
    
    // Step 3: Verify in Supabase
    const verified = await verifyInSupabase(TEST_PROPERTY_URL, auditDate);
    
    // Summary
    log('\n' + '='.repeat(60), 'cyan');
    if (verified) {
      logSuccess('TEST PASSED: queryTotals saved and retrieved correctly!');
    } else {
      logError('TEST FAILED: queryTotals not found or invalid in Supabase');
    }
    log('='.repeat(60), 'cyan');
    
    process.exit(verified ? 0 : 1);
  } catch (error) {
    log('\n' + '='.repeat(60), 'red');
    logError(`TEST FAILED: ${error.message}`);
    log('='.repeat(60), 'red');
    console.error(error);
    process.exit(1);
  }
}

// Run the test
runTest();

