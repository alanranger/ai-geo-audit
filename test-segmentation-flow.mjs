/**
 * Mock test for full segmentation flow
 * 
 * Simulates: GSC API response → classification → segmented score calculation
 * 
 * Run with: node test-segmentation-flow.mjs
 */

import { classifyPageSegment, PageSegment } from './api/aigeo/pageSegment.js';

// Mock GSC queryPages data (simulating real API response)
const mockQueryPages = [
  // Education pages
  { query: 'photography tips', page: 'https://www.alanranger.com/blog-on-photography/tips', clicks: 50, impressions: 1000, ctr: 5.0, position: 3 },
  { query: 'exposure calculator', page: 'https://www.alanranger.com/outdoor-photography-exposure-calculator', clicks: 30, impressions: 500, ctr: 6.0, position: 2 },
  { query: 'free photography course', page: 'https://www.alanranger.com/free-online-photography-course', clicks: 20, impressions: 400, ctr: 5.0, position: 4 },
  
  // Money pages
  { query: 'photography workshops', page: 'https://www.alanranger.com/photography-workshops', clicks: 100, impressions: 2000, ctr: 5.0, position: 1 },
  { query: 'photography courses', page: 'https://www.alanranger.com/photography-courses-coventry', clicks: 80, impressions: 1500, ctr: 5.33, position: 2 },
  { query: 'gift vouchers', page: 'https://www.alanranger.com/photography-gift-vouchers', clicks: 40, impressions: 800, ctr: 5.0, position: 3 },
  { query: 'fine art prints', page: 'https://www.alanranger.com/fine-art-prints', clicks: 25, impressions: 500, ctr: 5.0, position: 4 },
  { query: 'batsford arboretum', page: 'https://www.alanranger.com/batsford-arboretum-photography', clicks: 15, impressions: 300, ctr: 5.0, position: 5 },
  
  // Support pages
  { query: 'about alan ranger', page: 'https://www.alanranger.com/about-alan-ranger', clicks: 10, impressions: 200, ctr: 5.0, position: 8 },
  { query: 'contact', page: 'https://www.alanranger.com/contact-us', clicks: 5, impressions: 100, ctr: 5.0, position: 10 },
  
  // System pages
  { query: 'terms', page: 'https://www.alanranger.com/terms', clicks: 2, impressions: 50, ctr: 4.0, position: 15 },
];

// Mock the score calculation functions (simplified versions)
function normalisePct(value, max) {
  const pct = Math.max(0, Math.min(1, value / max));
  return pct * 100;
}

function computeBehaviourScoreRaw(queries) {
  if (!queries || queries.length === 0) return 50;
  
  const ranking = queries.filter(q => q.position > 0 && q.position <= 20 && q.impressions > 0);
  if (ranking.length === 0) return 50;
  
  const totalClicks = ranking.reduce((s, q) => s + q.clicks, 0);
  const totalImpr = ranking.reduce((s, q) => s + q.impressions, 0);
  const ctrAll = totalImpr > 0 ? totalClicks / totalImpr : 0;
  
  const top10 = ranking.filter(q => q.position <= 10);
  const top10Clicks = top10.reduce((s, q) => s + q.clicks, 0);
  const top10Impr = top10.reduce((s, q) => s + q.impressions, 0);
  const ctrTop10 = top10Impr > 0 ? top10Clicks / top10Impr : ctrAll;
  
  const ctrScoreAll = normalisePct(ctrAll, 0.05);
  const ctrScoreTop10 = normalisePct(ctrTop10, 0.10);
  
  return 0.5 * ctrScoreAll + 0.5 * ctrScoreTop10;
}

function computeBehaviourScoreWithSegment(queryPages) {
  if (!queryPages || queryPages.length === 0) {
    return { all: 50, nonBlog: 50, money: 50 };
  }
  
  const withSegment = queryPages.map(row => {
    const segment = classifyPageSegment(row.page || row.url || '/');
    return { ...row, __segment: segment };
  });
  
  const toQueryFormat = (rows) => rows.map(r => ({
    clicks: r.clicks || 0,
    impressions: r.impressions || 0,
    ctr: (r.ctr || 0) / 100,
    position: r.position || 0
  }));
  
  const all = computeBehaviourScoreRaw(toQueryFormat(withSegment));
  const nonBlog = computeBehaviourScoreRaw(
    toQueryFormat(withSegment.filter(r => r.__segment !== PageSegment.EDUCATION))
  );
  const money = computeBehaviourScoreRaw(
    toQueryFormat(withSegment.filter(r => r.__segment === PageSegment.MONEY))
  );
  
  return { all, nonBlog, money };
}

// Run the test
console.log('Testing full segmentation flow...\n');
console.log(`Input: ${mockQueryPages.length} query+page combinations\n`);

// Classify each row
console.log('Classification results:');
const classified = mockQueryPages.map(row => {
  const segment = classifyPageSegment(row.page);
  return { ...row, segment };
});

// Show classification breakdown
const segmentCounts = {};
classified.forEach(row => {
  segmentCounts[row.segment] = (segmentCounts[row.segment] || 0) + 1;
});

console.log('\nSegment distribution:');
Object.entries(segmentCounts).forEach(([segment, count]) => {
  console.log(`  ${segment}: ${count} rows`);
});

// Calculate segmented scores
console.log('\nCalculating segmented Behaviour scores...');
const scores = computeBehaviourScoreWithSegment(mockQueryPages);

console.log('\nResults:');
console.log(`  All pages: ${scores.all.toFixed(1)}`);
console.log(`  Non-blog (exclude education): ${scores.nonBlog.toFixed(1)}`);
console.log(`  Money pages only: ${scores.money.toFixed(1)}`);

// Verify expected behavior
console.log('\nVerification:');
const allCount = classified.length;
const nonBlogCount = classified.filter(r => r.segment !== PageSegment.EDUCATION).length;
const moneyCount = classified.filter(r => r.segment === PageSegment.MONEY).length;

console.log(`  Total rows: ${allCount}`);
console.log(`  Non-blog rows: ${nonBlogCount} (${((nonBlogCount/allCount)*100).toFixed(1)}%)`);
console.log(`  Money rows: ${moneyCount} (${((moneyCount/allCount)*100).toFixed(1)}%)`);

// Expected: money score should be different from all (since we're filtering)
if (scores.money !== scores.all) {
  console.log('  ✓ Money score differs from all (segmentation working)');
} else {
  console.log('  ⚠ Money score same as all (may indicate filtering issue)');
}

if (scores.nonBlog !== scores.all) {
  console.log('  ✓ Non-blog score differs from all (segmentation working)');
} else {
  console.log('  ⚠ Non-blog score same as all (may indicate no education pages)');
}

console.log('\n✅ Full flow test complete!');
console.log('\nNext: Check UI debug logs when running actual audit to see:');
console.log('  - QueryPages data received from API');
console.log('  - Classification results');
console.log('  - Segmented score calculations');

