// Diagnostic script to understand URL matching issue
// Run this to check what URLs are actually stored vs what we're searching for

const targetUrl = 'www.alanranger.com/photography-courses-coventry';
const targetUrlVariations = [
  'www.alanranger.com/photography-courses-coventry',
  'https://www.alanranger.com/photography-courses-coventry',
  'http://www.alanranger.com/photography-courses-coventry',
  'alanranger.com/photography-courses-coventry',
  'https://alanranger.com/photography-courses-coventry',
  '/photography-courses-coventry',
  'photography-courses-coventry'
];

console.log('=== URL Matching Diagnostic ===');
console.log('Target URL:', targetUrl);
console.log('URL Variations to check:', targetUrlVariations);
console.log('\nThis script should be run in the browser console when the page is loaded.');
console.log('It will check the actual combinedRows data to see what URLs are stored.');

// Function to normalize URL for comparison
function normalizeUrlForComparison(url) {
  if (!url) return '';
  let normalized = String(url).trim().toLowerCase();
  // Remove protocol
  normalized = normalized.replace(/^https?:\/\//, '');
  // Remove www.
  normalized = normalized.replace(/^www\./, '');
  // Remove trailing slash (except root)
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1);
  }
  // Remove query parameters and hash
  normalized = normalized.split('?')[0].split('#')[0];
  return normalized;
}

// Function to check if URLs match (various strategies)
function checkUrlMatch(taskUrl, rowUrl) {
  const taskNorm = normalizeUrlForComparison(taskUrl);
  const rowNorm = normalizeUrlForComparison(rowUrl);
  
  const exactMatch = taskNorm === rowNorm;
  const pathMatch = taskNorm.includes('/') && rowNorm.includes('/') && 
                    taskNorm.split('/').slice(1).join('/') === rowNorm.split('/').slice(1).join('/');
  const domainMatch = taskNorm.split('/')[0] === rowNorm.split('/')[0];
  const pathContains = taskNorm.includes('/') && rowNorm.includes('/') &&
                       (rowNorm.includes(taskNorm.split('/').slice(1).join('/')) || 
                        taskNorm.includes(rowNorm.split('/').slice(1).join('/')));
  
  return {
    exactMatch,
    pathMatch,
    domainMatch,
    pathContains,
    taskNorm,
    rowNorm
  };
}

// Diagnostic function to run in browser console
window.diagnoseUrlMatching = function() {
  console.log('=== URL Matching Diagnostic ===');
  
  // Get combinedRows from various sources
  let combinedRows = [];
  
  if (typeof window.getRankingAiCombinedRows === 'function') {
    combinedRows = window.getRankingAiCombinedRows();
    console.log('✓ Got combinedRows from window.getRankingAiCombinedRows():', combinedRows.length, 'rows');
  } else if (typeof window.rankingAiData !== 'undefined' && Array.isArray(window.rankingAiData)) {
    combinedRows = window.rankingAiData;
    console.log('✓ Got combinedRows from window.rankingAiData:', combinedRows.length, 'rows');
  } else {
    try {
      const local = localStorage.getItem('rankingAiData');
      if (local) {
        const parsed = JSON.parse(local);
        if (parsed && Array.isArray(parsed.combinedRows)) {
          combinedRows = parsed.combinedRows;
          console.log('✓ Got combinedRows from localStorage:', combinedRows.length, 'rows');
        }
      }
    } catch (e) {
      console.error('✗ Error reading localStorage:', e);
    }
  }
  
  if (combinedRows.length === 0) {
    console.error('✗ No combinedRows found!');
    return;
  }
  
  console.log('\n=== Checking for photography-courses-coventry ===');
  
  // Check each variation
  targetUrlVariations.forEach(targetUrlVar => {
    console.log(`\n--- Checking: ${targetUrlVar} ---`);
    
    // Find rows that might match
    const potentialMatches = combinedRows.filter(row => {
      const rowUrl = row.best_url || row.targetUrl || row.ranking_url || '';
      const match = checkUrlMatch(targetUrlVar, rowUrl);
      return match.exactMatch || match.pathMatch || match.pathContains;
    });
    
    if (potentialMatches.length > 0) {
      console.log(`✓ Found ${potentialMatches.length} potential matches:`);
      potentialMatches.forEach((row, idx) => {
        const rowUrl = row.best_url || row.targetUrl || row.ranking_url || '';
        const match = checkUrlMatch(targetUrlVar, rowUrl);
        console.log(`  ${idx + 1}. Keyword: "${row.keyword}"`);
        console.log(`     Row URL: ${rowUrl}`);
        console.log(`     Task URL: ${targetUrlVar}`);
        console.log(`     Normalized Row: ${match.rowNorm}`);
        console.log(`     Normalized Task: ${match.taskNorm}`);
        console.log(`     Exact Match: ${match.exactMatch}`);
        console.log(`     Path Match: ${match.pathMatch}`);
        console.log(`     Path Contains: ${match.pathContains}`);
        console.log(`     AI Overview: ${row.has_ai_overview || row.ai_overview_present_any || false}`);
        console.log(`     AI Citations: ${row.ai_alan_citations_count || 0}`);
      });
    } else {
      console.log(`✗ No matches found for: ${targetUrlVar}`);
    }
  });
  
  // Show sample URLs from combinedRows
  console.log('\n=== Sample URLs from combinedRows (first 10) ===');
  combinedRows.slice(0, 10).forEach((row, idx) => {
    const rowUrl = row.best_url || row.targetUrl || row.ranking_url || '';
    console.log(`${idx + 1}. Keyword: "${row.keyword}"`);
    console.log(`   URL: ${rowUrl}`);
    console.log(`   Normalized: ${normalizeUrlForComparison(rowUrl)}`);
  });
  
  // Check specifically for "photography" keywords
  console.log('\n=== Rows with "photography" in keyword ===');
  const photographyRows = combinedRows.filter(row => 
    (row.keyword || '').toLowerCase().includes('photography')
  );
  console.log(`Found ${photographyRows.length} rows with "photography" in keyword`);
  photographyRows.forEach((row, idx) => {
    const rowUrl = row.best_url || row.targetUrl || row.ranking_url || '';
    console.log(`${idx + 1}. Keyword: "${row.keyword}"`);
    console.log(`   URL: ${rowUrl}`);
    console.log(`   Normalized: ${normalizeUrlForComparison(rowUrl)}`);
    console.log(`   Contains "photography-courses-coventry": ${normalizeUrlForComparison(rowUrl).includes('photography-courses-coventry')}`);
  });
};

console.log('\n=== Instructions ===');
console.log('1. Open the browser console on the audit dashboard page');
console.log('2. Run: diagnoseUrlMatching()');
console.log('3. This will show what URLs are actually stored and why they might not match');
