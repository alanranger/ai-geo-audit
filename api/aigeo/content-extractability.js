import { safeJsonParse } from './utils.js';

const CSV_SOURCES = [
  'https://raw.githubusercontent.com/alanranger/alan-shared-resources/main/csv/06-site-urls.csv',
  'https://raw.githubusercontent.com/alanranger/alan-shared-resources/master/csv/06-site-urls.csv'
];
const TIER_VALUES = new Set(['all', 'landing', 'product', 'event', 'blog', 'academy', 'unmapped']);

function parsePositiveInt(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeTierInput(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return TIER_VALUES.has(normalized) ? normalized : 'all';
}

function classifyTierFromUrl(url) {
  try {
    const pathname = String(new URL(String(url || '')).pathname || '/').toLowerCase();
    if (pathname === '/' || pathname === '/home') return 'landing';
    if (pathname.includes('/s/')) return 'academy';
    if (
      pathname.includes('/photographic-workshops-near-me')
      || pathname.includes('/photography-workshops-near-me')
      || pathname.includes('/event')
      || pathname.includes('/webinar')
    ) {
      return 'event';
    }
    if (pathname.includes('/academy') || pathname.includes('/free-online-photography-course')) return 'academy';
    if (pathname.includes('/blog') || pathname.includes('/article') || pathname.includes('/guides')) return 'blog';
    if (pathname.includes('/photography-services-near-me/')
      || pathname.includes('/photo-workshops-uk')
      || pathname.includes('/product')
      || pathname.includes('/courses')
      || pathname.includes('/mentoring')
      || pathname.includes('/subscription')) return 'product';
    if (pathname.split('/').filter(Boolean).length <= 1) return 'landing';
    return 'unmapped';
  } catch {
    return 'unmapped';
  }
}

function filterUrlsByTier(urls, tier) {
  if (!Array.isArray(urls) || !urls.length) return [];
  if (tier === 'all') return urls;
  return urls.filter((url) => classifyTierFromUrl(url) === tier);
}

function countUrlsByTier(urls = []) {
  const counts = {
    all: 0,
    landing: 0,
    product: 0,
    event: 0,
    blog: 0,
    academy: 0,
    unmapped: 0
  };
  if (!Array.isArray(urls) || !urls.length) return counts;
  counts.all = urls.length;
  urls.forEach((url) => {
    const tier = classifyTierFromUrl(url);
    if (Object.hasOwn(counts, tier)) counts[tier] += 1;
    else counts.unmapped += 1;
  });
  return counts;
}

function parseCsvLine(line) {
  const columns = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      columns.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  columns.push(current);
  return columns;
}

async function parseCsvUrls() {
  let csvText = '';
  for (const source of CSV_SOURCES) {
    try {
      const res = await fetch(source);
      if (!res.ok) continue;
      const body = await res.text();
      if (body?.trim()) {
        csvText = body;
        break;
      }
    } catch {
      // Try next source.
    }
  }
  if (!csvText) return [];
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map((h) => String(h || '').trim().toLowerCase());
  const urlCol = headers.indexOf('url');
  const urlIdx = Math.max(urlCol, 0);
  const urls = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const raw = String(cols[urlIdx] || '').trim().replaceAll(/^"|"$/g, '');
    if (/^https?:\/\//i.test(raw)) urls.push(raw);
  }
  return urls;
}

function selectUrlsForMode(urls, mode, limit) {
  const safeUrls = Array.isArray(urls) ? urls : [];
  if (!safeUrls.length) return [];
  const max = parsePositiveInt(limit);
  if (mode === 'sample') {
    const sampleSize = max || 25;
    return safeUrls.slice(0, Math.min(sampleSize, safeUrls.length));
  }
  return max ? safeUrls.slice(0, Math.min(max, safeUrls.length)) : safeUrls;
}

function stripHtmlToText(html = '') {
  return String(html || '')
    .replaceAll(/<script[\s\S]*?<\/script>/gi, ' ')
    .replaceAll(/<style[\s\S]*?<\/style>/gi, ' ')
    .replaceAll(/<[^>]+>/g, ' ')
    .replaceAll(/&nbsp;/gi, ' ')
    .replaceAll(/&amp;/gi, '&')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

function decodeBasicHtmlEntities(text = '') {
  return String(text || '')
    .replaceAll(/&nbsp;/gi, ' ')
    .replaceAll(/&amp;/gi, '&')
    .replaceAll(/&quot;/gi, '"')
    .replaceAll(/&#39;/gi, "'")
    .replaceAll(/&lt;/gi, '<')
    .replaceAll(/&gt;/gi, '>');
}

function findJsonLdBlocks(html = '') {
  const blocks = [];
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const matches = html.matchAll(regex);
  for (const match of matches) {
    const parsed = safeJsonParse(String(match[1] || '').trim());
    if (!parsed) continue;
    if (Array.isArray(parsed)) blocks.push(...parsed);
    else blocks.push(parsed);
  }
  return blocks;
}

function collectTypes(node, bucket = new Set()) {
  if (!node || typeof node !== 'object') return bucket;
  if (Array.isArray(node)) {
    node.forEach((item) => collectTypes(item, bucket));
    return bucket;
  }
  const atType = node['@type'];
  if (typeof atType === 'string') bucket.add(atType.toLowerCase());
  if (Array.isArray(atType)) {
    atType.forEach((typeName) => {
      if (typeof typeName === 'string') bucket.add(typeName.toLowerCase());
    });
  }
  Object.keys(node).forEach((key) => {
    if (key === '@type') return;
    collectTypes(node[key], bucket);
  });
  return bucket;
}

function evaluateExtractability(html, jsonLdBlocks = []) {
  const checks = {
    hasTldr: false,
    hasDirectAnswer: false,
    hasFaq: false,
    hasLastUpdated: false
  };

  const headingTldrRegex = /<h[1-4][^>]*>\s*(?:tl;?\s*dr|tldr|summary|quick answer)\s*<\/h[1-4]>/i;
  checks.hasTldr = headingTldrRegex.test(html) || /\btl;?\s*dr\b/i.test(html);

  const paragraphRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let paragraphCount = 0;
  while (paragraphCount < 8) {
    const pMatch = paragraphRegex.exec(html);
    if (!pMatch) break;
    paragraphCount += 1;
    const plain = decodeBasicHtmlEntities(
      String(pMatch[1] || '')
        .replaceAll(/<[^>]+>/g, ' ')
        .replaceAll(/\s+/g, ' ')
        .trim()
    );
    const words = plain.split(/\s+/).filter(Boolean).length;
    if (plain.length >= 90 && plain.length <= 420 && words >= 14) {
      checks.hasDirectAnswer = true;
      break;
    }
  }

  const faqTypes = new Set();
  jsonLdBlocks.forEach((block) => collectTypes(block, faqTypes));
  const hasFaqFromSchema = faqTypes.has('faqpage');
  const questionHeadings = (html.match(/<h[2-4][^>]*>[^<]*\?[^<]*<\/h[2-4]>/gi) || []).length;
  checks.hasFaq = hasFaqFromSchema || questionHeadings >= 2;

  const modifiedMetaRegex = /<(?:meta)\b[^>]*(?:property|name)=["'](?:article:modified_time|last-modified|dateModified|og:updated_time)["'][^>]*content=["']([^"']+)["'][^>]*>/i;
  const updatedLabelRegex = /\b(last\s*updated|updated)\b/i;
  const updatedIsoDateRegex = /\b\d{4}-\d{2}-\d{2}\b/i;
  const updatedMonthDayYearRegex = /\b[A-Z]{3,9}\s+\d{1,2},?\s+\d{4}\b/i;
  const updatedDayMonthYearRegex = /\b\d{1,2}\s+[A-Z]{3,9}\s+\d{4}\b/i;
  const hasUpdatedDate = updatedIsoDateRegex.test(html)
    || updatedMonthDayYearRegex.test(html)
    || updatedDayMonthYearRegex.test(html);
  checks.hasLastUpdated = modifiedMetaRegex.test(html) || (updatedLabelRegex.test(html) && hasUpdatedDate);

  const passCount = Object.values(checks).filter(Boolean).length;
  const score = Math.round((passCount / 4) * 100);
  const issues = [];
  if (!checks.hasTldr) issues.push('Missing clear TLDR/summary section');
  if (!checks.hasDirectAnswer) issues.push('No direct-answer paragraph detected near page intro');
  if (!checks.hasFaq) issues.push('FAQ content not detected (FAQPage schema or FAQ headings)');
  if (!checks.hasLastUpdated) issues.push('No visible/structured last-updated signal detected');

  return {
    ...checks,
    score,
    pass: passCount >= 3,
    issues
  };
}

async function checkUrl(url) {
  const pageTier = classifyTierFromUrl(url);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AI-GEO-Audit/1.0; +https://ai-geo-audit.vercel.app)' },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      return {
        url,
        pageTier,
        statusCode: response.status,
        pass: false,
        score: 0,
        hasTldr: false,
        hasDirectAnswer: false,
        hasFaq: false,
        hasLastUpdated: false,
        issues: [`HTTP ${response.status}: ${response.statusText}`]
      };
    }
    const html = await response.text();
    const jsonLdBlocks = findJsonLdBlocks(html);
    const result = evaluateExtractability(html, jsonLdBlocks);
    const plainText = stripHtmlToText(html);
    return {
      url,
      pageTier,
      statusCode: response.status,
      pass: result.pass,
      score: result.score,
      hasTldr: result.hasTldr,
      hasDirectAnswer: result.hasDirectAnswer,
      hasFaq: result.hasFaq,
      hasLastUpdated: result.hasLastUpdated,
      issues: result.issues || [],
      textLength: plainText.length
    };
  } catch (error) {
    return {
      url,
      pageTier,
      statusCode: null,
      pass: false,
      score: 0,
      hasTldr: false,
      hasDirectAnswer: false,
      hasFaq: false,
      hasLastUpdated: false,
      issues: [error?.message || 'Request failed']
    };
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({
      status: 'error',
      source: 'content-extractability',
      message: 'Method not allowed. Use GET or POST.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    const query = req.query || {};
    const mode = String(query.mode || 'sample').toLowerCase() === 'full' ? 'full' : 'sample';
    const limit = parsePositiveInt(query.limit);
    const tier = normalizeTierInput(query.tier);
    const urls = await parseCsvUrls();
    const sourceTierCounts = countUrlsByTier(urls);
    const tierScopedUrls = filterUrlsByTier(urls, tier);
    const selectedUrls = selectUrlsForMode(tierScopedUrls, mode, limit);
    if (!selectedUrls.length) {
      return res.status(400).json({
        status: 'error',
        source: 'content-extractability',
        message: 'No URLs found in source CSV.',
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    const results = await Promise.all(selectedUrls.map((url) => checkUrl(url)));
    const checkedPages = results.length;
    const passPages = results.filter((row) => row.pass).length;
    const passRate = checkedPages > 0 ? Math.round((passPages / checkedPages) * 100) : 0;
    const avgScore = checkedPages > 0
      ? Math.round(results.reduce((acc, row) => acc + Number(row.score || 0), 0) / checkedPages)
      : 0;
    const counts = {
      hasTldr: results.filter((row) => row.hasTldr).length,
      hasDirectAnswer: results.filter((row) => row.hasDirectAnswer).length,
      hasFaq: results.filter((row) => row.hasFaq).length,
      hasLastUpdated: results.filter((row) => row.hasLastUpdated).length
    };

    return res.status(200).json({
      status: 'ok',
      source: 'content-extractability',
      data: {
        mode,
        tier,
        pagesChecked: checkedPages,
        passPages,
        failPages: checkedPages - passPages,
        passRate,
        avgScore,
        counts,
        sourceTierCounts,
        rows: results
      },
      meta: {
        generatedAt: new Date().toISOString(),
        selection: {
          mode,
          tier,
          inputUrlCount: urls.length,
          candidateUrlCount: tierScopedUrls.length,
          selectedUrlCount: selectedUrls.length,
          limit: limit || null
        }
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      source: 'content-extractability',
      message: error?.message || 'Unknown error',
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}
