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

function pickIndexabilityUrls(baseUrl, sitemapPageUrls) {
  const unique = [];
  const seen = new Set();
  for (const raw of sitemapPageUrls || []) {
    const normalized = normalizeAbsoluteHttpUrl(raw);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
  }
  if (!unique.length) return { urls: buildDefaultUrls(baseUrl), source: 'fallback-defaults' };

  const baseHost = new URL(baseUrl).hostname.toLowerCase();
  const home = `${new URL(baseUrl).protocol}//${baseHost}/`;
  const preferred = [];
  const hasHome = unique.some((u) => {
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
    const hit = unique.find((u) => containsAny(u.toLowerCase(), bucket) && !preferred.includes(u));
    if (hit) preferred.push(hit);
  }
  for (const url of unique) {
    if (preferred.length >= 5) break;
    if (!preferred.includes(url)) preferred.push(url);
  }
  return { urls: preferred.slice(0, 5), source: 'sitemap-derived' };
}

async function checkSitemap(sitemapUrl) {
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
      sitemap.pageUrls = locEntries.map(normalizeAbsoluteHttpUrl).filter(Boolean).slice(0, 200);
    } else if (hasSitemapIndex) {
      const childSitemaps = locEntries.slice(0, 8);
      const pageUrlSet = new Set();
      for (const child of childSitemaps) {
        const childUrls = await readChildSitemapUrls(child);
        for (const u of childUrls) pageUrlSet.add(u);
        if (pageUrlSet.size >= 200) break;
      }
      sitemap.pageUrls = Array.from(pageUrlSet).slice(0, 200);
    }
    sitemap.pass = hasUrlSet || hasSitemapIndex;
    if (!sitemap.pass) sitemap.notes.push('sitemap.xml did not contain <urlset> or <sitemapindex>.');
    return sitemap;
  } catch (error) {
    sitemap.notes.push(`sitemap.xml check failed: ${error.message}`);
    return sitemap;
  }
}

async function checkSinglePageIndexability(pageUrl) {
  try {
    const response = await fetchWithTimeout(pageUrl, { headers: { 'User-Agent': 'AI-GEO-Audit/1.0' } }, 10000);
    const statusCode = response.status;
    const html = response.ok ? await response.text() : '';
    const xRobotsNoindex = readXRobotsNoindex(response.headers);
    const metaNoindex = readMetaRobotsNoindex(html);
    const indexable = response.ok && !xRobotsNoindex && !metaNoindex;
    const reasons = [];
    if (!response.ok) reasons.push(`HTTP ${statusCode}`);
    if (xRobotsNoindex) reasons.push('X-Robots-Tag noindex');
    if (metaNoindex) reasons.push('Meta robots noindex');
    return {
      url: pageUrl,
      statusCode,
      indexable,
      pass: indexable,
      reason: reasons.join(', ') || 'Indexable'
    };
  } catch (error) {
    return {
      url: pageUrl,
      statusCode: null,
      indexable: false,
      pass: false,
      reason: `Fetch failed: ${error.message}`
    };
  }
}

async function checkIndexability(pagesToCheck, source = 'unknown') {
  const results = [];
  for (const pageUrl of pagesToCheck) {
    const row = await checkSinglePageIndexability(pageUrl);
    results.push(row);
  }
  const passCount = results.filter((r) => r.pass).length;
  const failCount = results.length - passCount;
  return {
    source,
    pagesChecked: results.length,
    passCount,
    failCount,
    pass: failCount === 0,
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
    const [robots, sitemap] = await Promise.all([
      checkRobots(robotsUrl),
      checkSitemap(sitemapUrl)
    ]);
    const selection = pickIndexabilityUrls(baseUrl, sitemap.pageUrls);
    const indexability = await checkIndexability(selection.urls, selection.source);
    const overall = buildOverallResult(robots, sitemap, indexability);

    return res.status(200).json({
      status: 'ok',
      source: 'technical-foundation',
      params: { property: baseUrl },
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

