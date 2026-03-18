import { getGSCAccessToken, getGscDateRange, normalizePropertyUrl } from './utils.js';
import {
  fetchTierSegmentationEntries,
  urlsFromTierEntries,
  buildTierLookupFromEntries,
  getTierForUrlFromLookup,
  syncTierIndexabilityExclusions
} from './tier-segmentation.js';

/**
 * Technical Foundation Audit API
 *
 * Checks crawl/indexability prerequisites for AI visibility:
 * - robots.txt accessibility + blocking signals
 * - sitemap.xml accessibility
 * - key-page indexability (HTTP + noindex signals)
 */

const AI_BOT_NAMES = [
  'GPTBot',
  'ChatGPT-User',
  'Google-Extended',
  'CCBot',
  'PerplexityBot',
  'ClaudeBot',
  'Claude-Web'
];

const DEFAULT_INDEXABILITY_BATCH_SIZE = 100;
const DEFAULT_INDEXABILITY_REQUEST_DELAY_MS = 120;
const DEFAULT_INDEXABILITY_BATCH_DELAY_MS = 1000;
const DEFAULT_INDEXABILITY_RETRIES = 2;
const DEFAULT_INDEXABILITY_RETRY_BASE_DELAY_MS = 1500;
const DEFAULT_INDEXABILITY_TIMEOUT_MS = 10000;
const DEFAULT_RATE_LIMIT_RETRY_COOLDOWN_MS = 15000;
const DEFAULT_RATE_LIMIT_RETRY_REQUEST_DELAY_MS = 1500;
const MAX_INDEXABILITY_BATCH_SIZE = 500;
const MAX_INDEXABILITY_RETRIES = 5;
const MAX_INDEXABILITY_DELAY_MS = 15000;

function normalizeBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(withProto);
    return `${url.protocol}//${url.hostname}`;
  } catch {
    return null;
  }
}

function buildDefaultUrls(baseUrl) {
  return ['/', '/about', '/contact', '/services', '/workshops'].map((path) => `${baseUrl}${path}`);
}

function filterUrlsToPropertyHost(urls = [], propertyUrl = '') {
  const safeUrls = Array.isArray(urls) ? urls : [];
  if (!safeUrls.length) return [];
  let propertyHost = '';
  try {
    propertyHost = new URL(String(propertyUrl || '')).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    propertyHost = '';
  }
  if (!propertyHost) return safeUrls;
  return safeUrls.filter((url) => {
    try {
      const host = new URL(String(url || '')).hostname.replace(/^www\./i, '').toLowerCase();
      return host === propertyHost;
    } catch {
      return false;
    }
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function extractLocEntries(xmlText) {
  const out = [];
  const re = /<loc>(.*?)<\/loc>/gi;
  let match = re.exec(String(xmlText || ''));
  while (match) {
    const value = String(match[1] || '').trim();
    if (value) out.push(value);
    match = re.exec(String(xmlText || ''));
  }
  return out;
}

function normalizeAbsoluteHttpUrl(value) {
  try {
    const u = new URL(String(value || '').trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.protocol}//${u.hostname}${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

function parsePositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function parseNonNegativeInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function clampInt(value, fallback, min, max) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function sleep(ms) {
  const waitMs = Math.max(0, Number(ms) || 0);
  if (!waitMs) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, waitMs));
}

function parseRetryAfterMs(retryAfterHeader) {
  const raw = String(retryAfterHeader || '').trim();
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_INDEXABILITY_DELAY_MS, Math.floor(seconds * 1000));
  }

  const dateMs = Date.parse(raw);
  if (Number.isFinite(dateMs)) {
    const delta = dateMs - Date.now();
    if (delta <= 0) return 0;
    return Math.min(MAX_INDEXABILITY_DELAY_MS, Math.floor(delta));
  }

  return null;
}

function normalizeComparableUrl(value) {
  try {
    const parsed = new URL(String(value || '').trim());
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return `${parsed.protocol}//${parsed.hostname}${pathname}`;
  } catch {
    return null;
  }
}

function computeBackoffDelayMs(attempt, retryBaseDelayMs, retryAfterMs = null) {
  if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return Math.min(MAX_INDEXABILITY_DELAY_MS, Math.floor(retryAfterMs));
  }
  return Math.min(MAX_INDEXABILITY_DELAY_MS, retryBaseDelayMs * (2 ** attempt));
}

async function buildIndexabilityRowFromResponse(pageUrl, response) {
  const statusCode = response.status;
  const html = response.ok ? await response.text() : '';
  const xRobotsNoindex = readXRobotsNoindex(response.headers);
  const metaNoindex = readMetaRobotsNoindex(html);
  const indexable = response.ok && !xRobotsNoindex && !metaNoindex;
  const reasons = [];
  if (!response.ok) reasons.push(statusCode === 429 ? 'HTTP 429 (rate limited)' : `HTTP ${statusCode}`);
  if (xRobotsNoindex) reasons.push('X-Robots-Tag noindex');
  if (metaNoindex) reasons.push('Meta robots noindex');
  return {
    url: pageUrl,
    statusCode,
    indexable,
    pass: indexable,
    rateLimited: statusCode === 429,
    reason: reasons.join(', ') || 'Indexable'
  };
}

function buildFetchFailedIndexabilityRow(pageUrl, error) {
  return {
    url: pageUrl,
    statusCode: null,
    indexable: false,
    pass: false,
    rateLimited: false,
    reason: `Fetch failed: ${error.message}`
  };
}

async function attemptSingleIndexabilityFetch(pageUrl, options) {
  const {
    attempt,
    retries,
    timeoutMs,
    retryBaseDelayMs
  } = options;
  try {
    const response = await fetchWithTimeout(pageUrl, { headers: { 'User-Agent': 'AI-GEO-Audit/1.0' } }, timeoutMs);
    if (response.status === 429 && attempt < retries) {
      const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
      return {
        kind: 'retry',
        delayMs: computeBackoffDelayMs(attempt, retryBaseDelayMs, retryAfterMs)
      };
    }
    return { kind: 'result', row: await buildIndexabilityRowFromResponse(pageUrl, response) };
  } catch (error) {
    if (attempt < retries) {
      return {
        kind: 'retry',
        delayMs: computeBackoffDelayMs(attempt, retryBaseDelayMs)
      };
    }
    return { kind: 'result', row: buildFetchFailedIndexabilityRow(pageUrl, error) };
  }
}

async function fetchGoogleIndexSignals(baseUrl, pagesToCheck) {
  const fallback = {
    available: false,
    source: 'gsc-searchanalytics',
    startDate: null,
    endDate: null,
    indexedSet: new Set(),
    error: null
  };

  try {
    const accessToken = await getGSCAccessToken();
    const siteUrl = normalizePropertyUrl(baseUrl);
    const { startDate, endDate } = getGscDateRange({ daysBack: 90, endOffsetDays: 2 });
    const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        startDate,
        endDate,
        dimensions: ['page'],
        rowLimit: Math.max(25000, pagesToCheck.length + 500)
      })
    });

    if (!response.ok) {
      const text = await response.text();
      return {
        ...fallback,
        startDate,
        endDate,
        error: `gsc_api_error:${response.status}:${text.slice(0, 180)}`
      };
    }

    const payload = await response.json();
    const indexedSet = new Set();
    for (const row of payload?.rows || []) {
      const rawPage = row?.keys?.[0];
      const comparable = normalizeComparableUrl(rawPage);
      if (!comparable) continue;
      const impressions = Number(row?.impressions || 0);
      const clicks = Number(row?.clicks || 0);
      if (impressions > 0 || clicks > 0) indexedSet.add(comparable);
    }

    return {
      available: true,
      source: 'gsc-searchanalytics-90d',
      startDate,
      endDate,
      indexedSet,
      error: null
    };
  } catch (error) {
    return {
      ...fallback,
      error: error.message || 'unknown_gsc_error'
    };
  }
}

async function rerunRateLimitedRows(results, options = {}) {
  const cooldownMs = clampInt(options.cooldownMs, DEFAULT_RATE_LIMIT_RETRY_COOLDOWN_MS, 0, MAX_INDEXABILITY_DELAY_MS);
  const retryRequestDelayMs = clampInt(options.retryRequestDelayMs, DEFAULT_RATE_LIMIT_RETRY_REQUEST_DELAY_MS, 0, MAX_INDEXABILITY_DELAY_MS);
  const retries = clampInt(options.retries, DEFAULT_INDEXABILITY_RETRIES + 1, 0, MAX_INDEXABILITY_RETRIES);
  const timeoutMs = clampInt(options.timeoutMs, DEFAULT_INDEXABILITY_TIMEOUT_MS, 3000, 30000);
  const retryBaseDelayMs = clampInt(options.retryBaseDelayMs, Math.max(DEFAULT_INDEXABILITY_RETRY_BASE_DELAY_MS, 3000), 250, MAX_INDEXABILITY_DELAY_MS);
  const targetIndexes = [];

  results.forEach((row, idx) => {
    if (row?.rateLimited) targetIndexes.push(idx);
  });
  if (!targetIndexes.length) {
    return { retried: 0, resolved: 0, stillRateLimited: 0 };
  }

  if (cooldownMs > 0) await sleep(cooldownMs);
  let resolved = 0;
  for (let i = 0; i < targetIndexes.length; i += 1) {
    const idx = targetIndexes[i];
    const prev = results[idx];
    const updated = await checkSinglePageIndexability(prev.url, { retries, timeoutMs, retryBaseDelayMs });
    results[idx] = updated;
    if (!updated.rateLimited) resolved += 1;
    const isLast = i === targetIndexes.length - 1;
    if (!isLast && retryRequestDelayMs > 0) await sleep(retryRequestDelayMs);
  }

  return {
    retried: targetIndexes.length,
    resolved,
    stillRateLimited: targetIndexes.length - resolved
  };
}

function applyGoogleIndexSignals(results, googleSignals) {
  const indexedSet = googleSignals?.indexedSet || new Set();
  let googleIndexedCount = 0;
  let googleNotIndexedCount = 0;
  let googleUnknownCount = 0;
  let requestIndexingCandidates = 0;

  const rows = results.map((row) => {
    if (!googleSignals?.available) {
      googleUnknownCount += 1;
      return {
        ...row,
        googleIndexed: null,
        googleIndexReason: 'GSC index data unavailable'
      };
    }
    const comparable = normalizeComparableUrl(row.url);
    const isIndexed = !!(comparable && indexedSet.has(comparable));
    if (isIndexed) googleIndexedCount += 1;
    else googleNotIndexedCount += 1;
    if (!isIndexed && row.pass && !row.rateLimited) requestIndexingCandidates += 1;
    return {
      ...row,
      googleIndexed: isIndexed,
      googleIndexReason: isIndexed ? 'Seen in GSC (last 90d)' : 'Not seen in GSC (last 90d)'
    };
  });

  return {
    rows,
    counts: {
      googleIndexedCount,
      googleNotIndexedCount,
      googleUnknownCount,
      requestIndexingCandidates
    }
  };
}

function extractDirectivesForAgent(robotsText, agentName) {
  const lines = String(robotsText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('#'));

  const entries = [];
  let currentAgents = [];
  for (const line of lines) {
    const parts = line.split(':');
    if (parts.length < 2) continue;
    const key = parts[0].trim().toLowerCase();
    const value = parts.slice(1).join(':').trim();
    if (key === 'user-agent') {
      currentAgents = [value.toLowerCase()];
      continue;
    }
    if (key !== 'disallow' && key !== 'allow') continue;
    if (!currentAgents.length) continue;
    entries.push({ agents: currentAgents, key, value });
  }

  const target = agentName.toLowerCase();
  return entries.filter((entry) => entry.agents.includes(target) || entry.agents.includes('*'));
}

function isAgentBlockedByRootDisallow(robotsText, agentName) {
  const directives = extractDirectivesForAgent(robotsText, agentName);
  if (!directives.length) return false;
  const hasRootDisallow = directives.some((d) => d.key === 'disallow' && d.value === '/');
  if (!hasRootDisallow) return false;
  const hasRootAllow = directives.some((d) => d.key === 'allow' && d.value === '/');
  return !hasRootAllow;
}

function readMetaRobotsNoindex(html) {
  const metaRegex = /<meta[^>]+name=["']robots["'][^>]*content=["']([^"']+)["'][^>]*>/i;
  const match = metaRegex.exec(String(html || ''));
  if (!match) return false;
  return match[1].toLowerCase().includes('noindex');
}

function readXRobotsNoindex(headers) {
  const raw = headers.get('x-robots-tag');
  if (!raw) return false;
  return raw.toLowerCase().includes('noindex');
}

async function checkRobots(robotsUrl) {
  const robots = {
    url: robotsUrl,
    exists: false,
    pass: false,
    statusCode: null,
    blockedAiBots: [],
    notes: []
  };
  try {
    const response = await fetchWithTimeout(robotsUrl, { headers: { 'User-Agent': 'AI-GEO-Audit/1.0' } }, 10000);
    robots.statusCode = response.status;
    robots.exists = response.ok;
    if (!response.ok) {
      robots.notes.push(`robots.txt returned HTTP ${response.status}.`);
      return robots;
    }
    const text = await response.text();
    robots.blockedAiBots = AI_BOT_NAMES.filter((name) => isAgentBlockedByRootDisallow(text, name));
    robots.pass = robots.blockedAiBots.length === 0;
    if (robots.pass) robots.notes.push('No root disallow detected for monitored AI bots.');
    else robots.notes.push(`Blocked bots: ${robots.blockedAiBots.join(', ')}`);
    return robots;
  } catch (error) {
    robots.notes.push(`robots.txt check failed: ${error.message}`);
    return robots;
  }
}

async function readChildSitemapUrls(childSitemapUrl) {
  try {
    const response = await fetchWithTimeout(childSitemapUrl, { headers: { 'User-Agent': 'AI-GEO-Audit/1.0' } }, 10000);
    if (!response.ok) return [];
    const text = await response.text();
    const hasUrlSet = /<urlset[\s>]/i.test(text);
    if (!hasUrlSet) return [];
    const urls = extractLocEntries(text).map(normalizeAbsoluteHttpUrl).filter(Boolean);
    return urls;
  } catch {
    return [];
  }
}

function collectUniqueHttpUrls(urls = [], seedSeen = null) {
  const seen = seedSeen instanceof Set ? seedSeen : new Set();
  const unique = [];
  for (const raw of urls || []) {
    const normalized = normalizeAbsoluteHttpUrl(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  return { unique, seen };
}

function buildIndexabilitySampleUrls(baseUrl, uniqueUrls = []) {
  const baseHost = new URL(baseUrl).hostname.toLowerCase();
  const home = `${new URL(baseUrl).protocol}//${baseHost}/`;
  const preferred = [];
  const hasHome = uniqueUrls.some((u) => {
    try { return new URL(u).hostname.toLowerCase() === baseHost && new URL(u).pathname === '/'; } catch { return false; }
  });
  if (hasHome) preferred.push(home);

  const containsAny = (value, words) => words.some((w) => value.includes(w));
  const buckets = [
    ['about'],
    ['workshop', 'course', 'lesson', 'services', 'service'],
    ['blog', 'article', 'academy']
  ];
  for (const bucket of buckets) {
    const hit = uniqueUrls.find((u) => containsAny(u.toLowerCase(), bucket) && !preferred.includes(u));
    if (hit) preferred.push(hit);
  }
  for (const url of uniqueUrls) {
    if (preferred.length >= 5) break;
    if (!preferred.includes(url)) preferred.push(url);
  }
  return preferred.slice(0, 5);
}

function pickIndexabilityUrls(baseUrl, canonicalUrls = [], sitemapPageUrls = [], mode = 'sample', limit = null) {
  const canonicalCollected = collectUniqueHttpUrls(canonicalUrls);
  const unique = [...canonicalCollected.unique];
  if (!unique.length) {
    unique.push(...collectUniqueHttpUrls(sitemapPageUrls, canonicalCollected.seen).unique);
  }
  if (!unique.length) return { urls: buildDefaultUrls(baseUrl), source: 'fallback-defaults', mode: 'sample' };

  const effectiveLimit = limit || unique.length;
  const source = canonicalUrls.length ? 'tier-segmentation-csv' : 'sitemap-derived';
  if (mode === 'full') {
    return {
      urls: unique.slice(0, effectiveLimit),
      source,
      mode: 'full'
    };
  }
  return { urls: buildIndexabilitySampleUrls(baseUrl, unique), source, mode: 'sample' };
}

async function checkSitemap(sitemapUrl, pageUrlLimit = 5000) {
  const sitemap = {
    url: sitemapUrl,
    exists: false,
    pass: false,
    statusCode: null,
    discoveredSitemaps: [],
    pageUrls: [],
    notes: []
  };
  try {
    const response = await fetchWithTimeout(sitemapUrl, { headers: { 'User-Agent': 'AI-GEO-Audit/1.0' } }, 10000);
    sitemap.statusCode = response.status;
    sitemap.exists = response.ok;
    if (!response.ok) {
      sitemap.notes.push(`sitemap.xml returned HTTP ${response.status}.`);
      return sitemap;
    }
    const text = await response.text();
    const hasUrlSet = /<urlset[\s>]/i.test(text);
    const hasSitemapIndex = /<sitemapindex[\s>]/i.test(text);
    const locEntries = extractLocEntries(text);
    sitemap.discoveredSitemaps = locEntries.slice(0, 10);
    if (hasUrlSet) {
      sitemap.pageUrls = locEntries.map(normalizeAbsoluteHttpUrl).filter(Boolean).slice(0, pageUrlLimit);
    } else if (hasSitemapIndex) {
      const childSitemaps = locEntries.slice(0, 100);
      const pageUrlSet = new Set();
      for (const child of childSitemaps) {
        const childUrls = await readChildSitemapUrls(child);
        for (const u of childUrls) pageUrlSet.add(u);
        if (pageUrlSet.size >= pageUrlLimit) break;
      }
      sitemap.pageUrls = Array.from(pageUrlSet).slice(0, pageUrlLimit);
    }
    sitemap.pass = hasUrlSet || hasSitemapIndex;
    if (!sitemap.pass) sitemap.notes.push('sitemap.xml did not contain <urlset> or <sitemapindex>.');
    return sitemap;
  } catch (error) {
    sitemap.notes.push(`sitemap.xml check failed: ${error.message}`);
    return sitemap;
  }
}

async function checkSinglePageIndexability(pageUrl, options = {}) {
  const retries = clampInt(options.retries, DEFAULT_INDEXABILITY_RETRIES, 0, MAX_INDEXABILITY_RETRIES);
  const timeoutMs = clampInt(options.timeoutMs, DEFAULT_INDEXABILITY_TIMEOUT_MS, 3000, 30000);
  const retryBaseDelayMs = clampInt(options.retryBaseDelayMs, DEFAULT_INDEXABILITY_RETRY_BASE_DELAY_MS, 250, MAX_INDEXABILITY_DELAY_MS);

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const attemptResult = await attemptSingleIndexabilityFetch(pageUrl, {
      attempt,
      retries,
      timeoutMs,
      retryBaseDelayMs
    });
    if (attemptResult.kind === 'retry') {
      await sleep(attemptResult.delayMs);
      continue;
    }
    return attemptResult.row;
  }

  return {
    url: pageUrl,
    statusCode: 429,
    indexable: false,
    pass: false,
    rateLimited: true,
    reason: 'HTTP 429 (rate limited)'
  };
}

async function checkIndexability(pagesToCheck, source = 'unknown', mode = 'sample', options = {}) {
  const batchSize = clampInt(options.batchSize, DEFAULT_INDEXABILITY_BATCH_SIZE, 1, MAX_INDEXABILITY_BATCH_SIZE);
  const requestDelayMs = clampInt(options.requestDelayMs, DEFAULT_INDEXABILITY_REQUEST_DELAY_MS, 0, MAX_INDEXABILITY_DELAY_MS);
  const batchDelayMs = clampInt(options.batchDelayMs, DEFAULT_INDEXABILITY_BATCH_DELAY_MS, 0, MAX_INDEXABILITY_DELAY_MS);
  const retries = clampInt(options.retries, DEFAULT_INDEXABILITY_RETRIES, 0, MAX_INDEXABILITY_RETRIES);
  const timeoutMs = clampInt(options.timeoutMs, DEFAULT_INDEXABILITY_TIMEOUT_MS, 3000, 30000);
  const retryBaseDelayMs = clampInt(options.retryBaseDelayMs, DEFAULT_INDEXABILITY_RETRY_BASE_DELAY_MS, 250, MAX_INDEXABILITY_DELAY_MS);

  const results = [];
  let adaptiveRequestDelayMs = requestDelayMs;
  let consecutiveRateLimited = 0;
  for (let i = 0; i < pagesToCheck.length; i += 1) {
    const pageUrl = pagesToCheck[i];
    const row = await checkSinglePageIndexability(pageUrl, { retries, timeoutMs, retryBaseDelayMs });
    results.push(row);

    const isLast = i === pagesToCheck.length - 1;
    if (row.rateLimited) {
      consecutiveRateLimited += 1;
      adaptiveRequestDelayMs = Math.min(MAX_INDEXABILITY_DELAY_MS, Math.max(2000, adaptiveRequestDelayMs * 2 || 2000));
      if (consecutiveRateLimited >= 3 && !isLast) {
        await sleep(10000);
      }
    } else {
      consecutiveRateLimited = 0;
      if (adaptiveRequestDelayMs > requestDelayMs) {
        adaptiveRequestDelayMs = Math.max(requestDelayMs, adaptiveRequestDelayMs - 100);
      }
    }

    if (!isLast && adaptiveRequestDelayMs > 0) {
      await sleep(adaptiveRequestDelayMs);
    }
    const checked = i + 1;
    if (!isLast && checked % batchSize === 0 && batchDelayMs > 0) {
      await sleep(batchDelayMs);
    }
  }

  let rateLimitedCount = results.filter((r) => r.rateLimited).length;
  let rateLimitRetry = { retried: 0, resolved: 0, stillRateLimited: rateLimitedCount };

  if (mode === 'full' && rateLimitedCount > 0) {
    rateLimitRetry = await rerunRateLimitedRows(results, {
      retries,
      timeoutMs,
      retryBaseDelayMs,
      cooldownMs: DEFAULT_RATE_LIMIT_RETRY_COOLDOWN_MS,
      retryRequestDelayMs: DEFAULT_RATE_LIMIT_RETRY_REQUEST_DELAY_MS
    });
    rateLimitedCount = results.filter((r) => r.rateLimited).length;
  }

  let googleIndex = {
    available: false,
    source: 'gsc-searchanalytics',
    startDate: null,
    endDate: null,
    error: 'google_index_check_disabled',
    googleIndexedCount: 0,
    googleNotIndexedCount: 0,
    googleUnknownCount: results.length,
    requestIndexingCandidates: 0
  };

  if (options.includeGoogleIndex) {
    const googleSignals = await fetchGoogleIndexSignals(options.baseUrl, pagesToCheck);
    const enriched = applyGoogleIndexSignals(results, googleSignals);
    results.splice(0, results.length, ...enriched.rows);
    googleIndex = {
      available: googleSignals.available,
      source: googleSignals.source,
      startDate: googleSignals.startDate,
      endDate: googleSignals.endDate,
      error: googleSignals.error || null,
      ...enriched.counts
    };
  }

  const finalPassCount = results.filter((r) => r.pass).length;
  const finalFailCount = results.length - finalPassCount;
  return {
    source,
    mode,
    pagesChecked: results.length,
    passCount: finalPassCount,
    failCount: finalFailCount,
    rateLimitedCount,
    pass: finalFailCount === 0,
    pacing: {
      batchSize,
      requestDelayMs,
      adaptiveRequestDelayMs,
      batchDelayMs,
      retries,
      timeoutMs,
      retryBaseDelayMs
    },
    rateLimitRetry,
    googleIndex,
    results
  };
}

function buildOverallResult(robots, sitemap, indexability) {
  const blockers = [];
  if (!robots.pass) blockers.push('robots.txt blocks one or more monitored AI crawlers or is inaccessible.');
  if (!sitemap.pass) blockers.push('sitemap.xml is missing, inaccessible, or malformed.');
  if (!indexability.pass) blockers.push(`${indexability.failCount} key page(s) are not indexable.`);
  return {
    pass: blockers.length === 0,
    blockers
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      status: 'error',
      source: 'technical-foundation',
      message: 'Method not allowed. Use GET.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    const baseUrl = normalizeBaseUrl(req.query.property);
    const modeRaw = String(req.query.mode || 'sample').trim().toLowerCase();
    const mode = modeRaw === 'full' ? 'full' : 'sample';
    const limit = parsePositiveInt(req.query.limit);
    const refreshTierSource = String(req.query.refreshTierSource || '').trim() === '1'
      || String(req.query.refreshTierSource || '').trim().toLowerCase() === 'true';
    const tierSnapshotKey = String(req.query.tierSnapshotKey || '').trim();
    const tierCacheTtlMs = parsePositiveInt(req.query.tierCacheTtlMs);
    const includeGoogleIndex = String(req.query.includeGoogleIndex ?? '1').trim() !== '0';
    if (!baseUrl) {
      return res.status(400).json({
        status: 'error',
        source: 'technical-foundation',
        message: 'Missing or invalid required parameter: property',
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    const robotsUrl = `${baseUrl}/robots.txt`;
    const sitemapUrl = `${baseUrl}/sitemap.xml`;
    const pageUrlLimit = limit || (mode === 'full' ? 5000 : 500);
    const batchSizeDefault = mode === 'full' ? DEFAULT_INDEXABILITY_BATCH_SIZE : 25;
    const requestDelayDefault = mode === 'full' ? DEFAULT_INDEXABILITY_REQUEST_DELAY_MS : 40;
    const batchDelayDefault = mode === 'full' ? DEFAULT_INDEXABILITY_BATCH_DELAY_MS : 0;
    const batchSize = clampInt(parsePositiveInt(req.query.batchSize), batchSizeDefault, 1, MAX_INDEXABILITY_BATCH_SIZE);
    const requestDelayMs = clampInt(parseNonNegativeInt(req.query.requestDelayMs), requestDelayDefault, 0, MAX_INDEXABILITY_DELAY_MS);
    const batchDelayMs = clampInt(parseNonNegativeInt(req.query.batchDelayMs), batchDelayDefault, 0, MAX_INDEXABILITY_DELAY_MS);
    const retries = clampInt(parseNonNegativeInt(req.query.retries), DEFAULT_INDEXABILITY_RETRIES, 0, MAX_INDEXABILITY_RETRIES);
    const retryBaseDelayMs = clampInt(parsePositiveInt(req.query.retryBaseDelayMs), DEFAULT_INDEXABILITY_RETRY_BASE_DELAY_MS, 250, MAX_INDEXABILITY_DELAY_MS);
    const timeoutMs = clampInt(parsePositiveInt(req.query.timeoutMs), DEFAULT_INDEXABILITY_TIMEOUT_MS, 3000, 30000);

    const [robots, sitemap] = await Promise.all([
      checkRobots(robotsUrl),
      checkSitemap(sitemapUrl, pageUrlLimit)
    ]);
    const tierEntries = await fetchTierSegmentationEntries({
      forceRefresh: refreshTierSource,
      snapshotKey: tierSnapshotKey,
      cacheTtlMs: tierCacheTtlMs
    });
    const tierLookup = buildTierLookupFromEntries(tierEntries);
    const canonicalUrls = filterUrlsToPropertyHost(urlsFromTierEntries(tierEntries), baseUrl);
    const selection = pickIndexabilityUrls(baseUrl, canonicalUrls, sitemap.pageUrls, mode, limit);
    const indexabilityRaw = await checkIndexability(selection.urls, selection.source, selection.mode, {
      baseUrl,
      includeGoogleIndex,
      batchSize,
      requestDelayMs,
      batchDelayMs,
      retries,
      timeoutMs,
      retryBaseDelayMs
    });
    const indexability = {
      ...indexabilityRaw,
      results: (Array.isArray(indexabilityRaw.results) ? indexabilityRaw.results : []).map((row) => ({
        ...row,
        pageTier: getTierForUrlFromLookup(row?.url || '', tierLookup)
      }))
    };
    syncTierIndexabilityExclusions(indexability.results);
    const overall = buildOverallResult(robots, sitemap, indexability);

    return res.status(200).json({
      status: 'ok',
      source: 'technical-foundation',
      params: {
        property: baseUrl,
        mode,
        limit,
        batchSize,
        requestDelayMs,
        batchDelayMs,
        retries,
        timeoutMs,
        retryBaseDelayMs,
        includeGoogleIndex
      },
      data: {
        overall,
        robots,
        sitemap,
        indexability
      },
      meta: { generatedAt: new Date().toISOString() }
    });
  } catch (error) {
    console.error('[technical-foundation] Error:', error);
    return res.status(500).json({
      status: 'error',
      source: 'technical-foundation',
      message: error.message || 'Unknown error',
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}

