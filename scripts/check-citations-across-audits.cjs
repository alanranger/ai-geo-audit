// Check AI citations for a URL across all audits
// Usage: node scripts/check-citations-across-audits.cjs

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Normalize URL for comparison
function normalizeUrl(url) {
  if (!url) return '';
  let normalized = String(url).toLowerCase().trim();
  normalized = normalized.replace(/^https?:\/\//, '');
  normalized = normalized.replace(/^www\./, '');
  normalized = normalized.split('?')[0].split('#')[0];
  
  let path = normalized;
  const domainMatch = normalized.match(/^[^\/]+(\/.*)?$/);
  if (domainMatch && normalized.includes('/')) {
    path = normalized.split('/').slice(1).join('/');
  } else if (normalized.startsWith('/')) {
    path = normalized.substring(1);
  }
  path = path.replace(/^\/+/, '').replace(/\/+$/, '');
  return path;
}

async function checkCitationsAcrossAudits(propertyUrl, targetUrl) {
  const targetUrlNormalized = normalizeUrl(targetUrl);
  console.log(`\nChecking citations for: ${targetUrl}`);
  console.log(`Normalized target: ${targetUrlNormalized}\n`);
  
  // Get all audits for this property
  const { data: audits, error: auditError } = await supabase
    .from('audit_results')
    .select('audit_date')
    .eq('property_url', propertyUrl)
    .order('audit_date', { ascending: false });
  
  if (auditError) {
    console.error('Error fetching audits:', auditError);
    return;
  }
  
  if (!audits || audits.length === 0) {
    console.log('No audits found for property:', propertyUrl);
    return;
  }
  
  console.log(`Found ${audits.length} audit(s)\n`);
  console.log('='.repeat(100));
  console.log('AUDIT DATE'.padEnd(12), '|', 'AI CITATIONS'.padEnd(15), '|', 'KEYWORDS');
  console.log('='.repeat(100));
  
  for (const audit of audits) {
    const auditDate = audit.audit_date;
    
    // Get all keywords for this audit
    const { data: keywords, error: keywordError } = await supabase
      .from('keyword_rankings')
      .select('keyword, has_ai_overview, ai_alan_citations')
      .eq('audit_date', auditDate)
      .eq('property_url', propertyUrl);
    
    if (keywordError) {
      console.log(auditDate.padEnd(12), '|', 'ERROR'.padEnd(15), '|', keywordError.message);
      continue;
    }
    
    // Find keywords that cite the target URL
    const citingKeywords = [];
    
    if (keywords && Array.isArray(keywords)) {
      keywords.forEach(row => {
        const citationsArray = row.ai_alan_citations || [];
        if (!Array.isArray(citationsArray) || citationsArray.length === 0) {
          return;
        }
        
        let urlIsCited = false;
        citationsArray.forEach(citation => {
          const citedUrl = typeof citation === 'string' 
            ? citation 
            : (citation && typeof citation === 'object' 
                ? (citation.url || citation.URL || citation.link || citation.href || citation.page || citation.pageUrl || citation.target || citation.targetUrl || citation.best_url || citation.bestUrl || '') 
                : null);
          
          if (!citedUrl) return;
          
          const citedUrlNormalized = normalizeUrl(citedUrl);
          if (citedUrlNormalized === targetUrlNormalized || citedUrlNormalized.includes(targetUrlNormalized)) {
            urlIsCited = true;
          }
        });
        
        if (urlIsCited) {
          citingKeywords.push(row.keyword);
        }
      });
    }
    
    const count = citingKeywords.length;
    const keywordsList = citingKeywords.length > 0 ? citingKeywords.join(', ') : '(none)';
    
    console.log(auditDate.padEnd(12), '|', String(count).padEnd(15), '|', keywordsList);
  }
  
  console.log('='.repeat(100));
  console.log('\n');
}

// Run
const propertyUrl = process.argv[2] || 'https://www.alanranger.com';
const targetUrl = process.argv[3] || 'https://www.alanranger.com/photography-courses-coventry';

checkCitationsAcrossAudits(propertyUrl, targetUrl).catch(console.error);
