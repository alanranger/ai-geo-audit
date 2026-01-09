/**
 * Local harness to test AI citations/overview matching for a URL using the same logic
 * as computeAiMetricsForPageUrl, but runnable in isolation.
 *
 * Usage:
 *   node scripts/test-ai-citations.js --url "<targetUrl>" --rows "<path-to-combinedRows.json>"
 *
 * Expected rows JSON structure: array of objects with fields like:
 *   keyword, ai_alan_citations (array), has_ai_overview, best_url, etc.
 *
 * You can also pass a keywords file (same shape) with --keywords, but --rows is enough
 * to test the in-memory matching logic.
 */

const fs = require('fs');
const path = require('path');

const argv = process.argv.slice(2);
const getArg = (name) => {
  const idx = argv.indexOf(`--${name}`);
  if (idx === -1 || idx === argv.length - 1) return null;
  return argv[idx + 1];
};

const targetUrl = getArg('url');
const rowsFile = getArg('rows');
const keywordsFile = getArg('keywords'); // optional, same shape as rows

if (!targetUrl || !rowsFile) {
  console.error('Usage: node scripts/test-ai-citations.js --url "<targetUrl>" --rows "<path-to-combinedRows.json>"');
  process.exit(1);
}

const readJson = (p) => JSON.parse(fs.readFileSync(path.resolve(p), 'utf8'));

const rows = readJson(rowsFile);
const keywordRows = keywordsFile ? readJson(keywordsFile) : null;

// Normalize URL (path-only) to compare citations
const normalizeUrl = (url) => {
  if (!url) return '';
  let normalized = String(url).toLowerCase().trim();
  normalized = normalized.replace(/^https?:\/\//, '');
  normalized = normalized.replace(/^www\./, '');
  normalized = normalized.split('?')[0].split('#')[0];

  let pathPart = normalized;
  const domainMatch = normalized.match(/^[^/]+(\/.*)?$/);
  if (domainMatch && normalized.includes('/')) {
    pathPart = normalized.split('/').slice(1).join('/');
  } else if (normalized.startsWith('/')) {
    pathPart = normalized.substring(1);
  }
  pathPart = pathPart.replace(/^\/+/, '').replace(/\/+$/, '');
  return pathPart;
};

// Extract a citation URL from various possible fields
const extractCitationUrl = (cit) => {
  if (!cit) return null;
  if (typeof cit === 'string') return cit;
  if (typeof cit === 'object') {
    const candidates = [
      'url',
      'URL',
      'link',
      'href',
      'page',
      'pageUrl',
      'target',
      'targetUrl',
      'best_url',
      'bestUrl',
    ];
    for (const key of candidates) {
      if (cit[key]) return cit[key];
    }
  }
  return null;
};

// Core matching logic (mirrors computeAiMetricsForPageUrl but expanded URL extraction)
function computeAiMetricsForPageUrl(pageUrl, combinedRows) {
  const rows = Array.isArray(combinedRows) ? combinedRows : [];
  const canonTarget = normalizeUrl(pageUrl);
  if (!canonTarget || rows.length === 0) {
    return { ai_overview: null, ai_citations: null, citing: [] };
  }

  const citingKeywords = [];
  let hasOverview = false;

  rows.forEach((r) => {
    const citationsArray = r.ai_alan_citations || r.aiAlanCitations || r.citations || [];
    if (!Array.isArray(citationsArray) || citationsArray.length === 0) return;

    let urlIsCited = false;
    citationsArray.forEach((citation) => {
      const citedUrl = extractCitationUrl(citation);
      if (!citedUrl) return;
      const citedUrlNormalized = normalizeUrl(citedUrl);
      if (citedUrlNormalized === canonTarget || citedUrlNormalized.includes(canonTarget)) {
        urlIsCited = true;
      }
    });

    if (urlIsCited) {
      const rowHasOverview =
        r.has_ai_overview === true ||
        r.hasAiOverview === true ||
        r.ai_overview_present_any === true ||
        r.aiOverviewPresentAny === true;
      if (rowHasOverview) hasOverview = true;
      citingKeywords.push({
        keyword: r.keyword || 'unknown',
        has_ai_overview: rowHasOverview,
        best_url: r.best_url || r.bestUrl || r.targetUrl || r.ranking_url || '',
      });
    }
  });

  const uniqueKeywordsCount = citingKeywords.length;
  if (uniqueKeywordsCount === 0) {
    return { ai_overview: null, ai_citations: null, citing: [] };
  }
  return {
    ai_overview: hasOverview,
    ai_citations: uniqueKeywordsCount,
    citing: citingKeywords,
  };
}

// Run test
const result = computeAiMetricsForPageUrl(targetUrl, rows);
console.log('Target:', targetUrl);
console.log('Normalized target:', normalizeUrl(targetUrl));
console.log('Rows loaded:', rows.length);
if (keywordRows) console.log('Keyword rows loaded:', keywordRows.length);
console.log('Result:', result);

if (!result.citing || result.citing.length === 0) {
  console.log('No matches found. Suggestions:');
  console.log('- Inspect a citation object in your rows to see which field carries the URL (url/URL/link/href/page/pageUrl/target/targetUrl/best_url/bestUrl).');
  console.log('- Ensure the target slug appears in the citation URLs.');
}
