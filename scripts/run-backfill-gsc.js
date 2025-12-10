/**
 * Run GSC Backfill via API Endpoint
 * 
 * This script calls the /api/backfill-gsc-data endpoint which uses
 * Vercel environment variables (including Google OAuth credentials).
 * 
 * Usage: node scripts/run-backfill-gsc.js
 */

const API_URL = process.env.VERCEL_URL 
  ? `https://${process.env.VERCEL_URL}`
  : 'https://ai-geo-audit.vercel.app'; // Update with your actual Vercel URL

const propertyUrl = 'https://www.alanranger.com';

async function runBackfill() {
  console.log('🚀 Starting GSC data backfill via API...\n');
  console.log(`📡 Calling: ${API_URL}/api/backfill-gsc-data\n`);
  
  try {
    const response = await fetch(`${API_URL}/api/backfill-gsc-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        propertyUrl,
        limit: 100, // Process up to 100 dates at a time
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ API Error:', errorText);
      return;
    }
    
    const result = await response.json();
    
    console.log('📊 Results:');
    console.log(`   Status: ${result.status}`);
    console.log(`   Message: ${result.message}`);
    console.log(`   Fetched: ${result.fetched || 0}`);
    console.log(`   Saved: ${result.saved || 0}`);
    console.log(`   Errors: ${result.errors || 0}`);
    
    if (result.errorDetails && result.errorDetails.length > 0) {
      console.log('\n⚠️  Errors:');
      result.errorDetails.forEach(({ date, error }) => {
        console.log(`   ${date}: ${error}`);
      });
    }
    
    if (result.saved > 0) {
      console.log('\n✅ GSC data fetched! Next step: Re-run the backfill migration to calculate scores.');
    }
    
  } catch (error) {
    console.error('❌ Fatal error:', error.message);
    console.error('\n💡 Make sure:');
    console.error('   1. The API is deployed to Vercel');
    console.error('   2. Google OAuth credentials are set in Vercel environment variables');
    console.error('   3. Update API_URL in this script if your Vercel URL is different');
  }
}

runBackfill();

