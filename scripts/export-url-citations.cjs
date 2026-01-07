const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

function normalizeUrl(url) {
  if (!url) return '';
  let normalized = String(url).toLowerCase().trim();
  normalized = normalized.replace(/^https?:\/\//, '');
  normalized = normalized.replace(/^www\./, '');
  normalized = normalized.split('?')[0].split('#')[0];

  let pathPart = normalized;
  const domainMatch = normalized.match(/^[^\/]+(\/.*)?$/);
  if (domainMatch && normalized.includes('/')) {
    pathPart = normalized.split('/').slice(1).join('/');
  } else if (normalized.startsWith('/')) {
    pathPart = normalized.substring(1);
  }

  pathPart = pathPart.replace(/^\/+/, '').replace(/\/+$/, '');
  return pathPart;
}

async function fetchCitations(propertyUrl, targetUrl) {
  const targetUrlNormalized = normalizeUrl(targetUrl);
  const { data: audits, error: auditError } = await supabase
    .from('audit_results')
    .select('audit_date')
    .eq('property_url', propertyUrl)
    .order('audit_date', { ascending: false });

  if (auditError) {
    throw new Error(`Failed to load audits: ${auditError.message}`);
  }

  const rows = [];

  for (const audit of audits) {
    const auditDate = audit.audit_date;
    const { data: keywords, error: keywordError } = await supabase
      .from('keyword_rankings')
      .select('keyword, ai_alan_citations')
      .eq('audit_date', auditDate)
      .eq('property_url', propertyUrl);

    if (keywordError) {
      console.warn(`Skipping ${auditDate} because keyword query failed: ${keywordError.message}`);
      continue;
    }

    const citingKeywords = [];

    if (Array.isArray(keywords)) {
      for (const keywordRow of keywords) {
        const citationsArray = keywordRow.ai_alan_citations || [];
        if (!Array.isArray(citationsArray) || citationsArray.length === 0) {
          continue;
        }

        const cited = citationsArray.some(citation => {
          const citedUrl = typeof citation === 'string'
            ? citation
            : (
                citation && typeof citation === 'object'
                  ? (
                      citation.url ||
                      citation.URL ||
                      citation.link ||
                      citation.href ||
                      citation.page ||
                      citation.pageUrl ||
                      citation.target ||
                      citation.targetUrl ||
                      citation.best_url ||
                      citation.bestUrl ||
                      ''
                    )
                  : ''
              );

          if (!citedUrl) return false;
          const citedNormalized = normalizeUrl(citedUrl);
          return (
            citedNormalized === targetUrlNormalized ||
            (targetUrlNormalized && citedNormalized.includes(targetUrlNormalized))
          );
        });

        if (cited) {
          citingKeywords.push(keywordRow.keyword);
        }
      }
    }

    rows.push({
      auditDate,
      citationCount: citingKeywords.length,
      keywords: citingKeywords
    });
  }

  return rows;
}

async function main() {
  const propertyUrl = process.argv[2] || 'https://www.alanranger.com';
  const targetUrl = process.argv[3] || 'https://www.alanranger.com/photography-courses-coventry';

  const rows = await fetchCitations(propertyUrl, targetUrl);

  const generatedDir = path.resolve('generated');
  if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
  }

  const tablePath = path.join(generatedDir, 'photography-courses-coventry-citations.md');
  const jsonPath = path.join(generatedDir, 'photography-courses-coventry-citations.json');

  const tableLines = ['| Audit Date | AI Citations | Keywords |', '| --- | --- | --- |'];

  for (const row of rows) {
    const keywordsCell = row.keywords.length ? row.keywords.join(', ') : '(none)';
    tableLines.push(`| ${row.auditDate} | ${row.citationCount} | ${keywordsCell} |`);
  }

  const tableContent = tableLines.join('\n');
  const jsonContent = JSON.stringify(rows, null, 2);

  fs.writeFileSync(tablePath, tableContent, 'utf8');
  fs.writeFileSync(jsonPath, jsonContent, 'utf8');

  console.log(`Table written to ${tablePath}`);
  console.log(`Raw data written to ${jsonPath}`);
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
