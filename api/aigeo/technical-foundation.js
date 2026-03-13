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
  return ['/', '/about', '/blog', '/lessons', '/workshops'].map((path) => `${baseUrl}${path}`);
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

async function checkSitemap(sitemapUrl) {
  const sitemap = {
    url: sitemapUrl,
    exists: false,
    pass: false,
    statusCode: null,
    discoveredSitemaps: [],
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
    const locMatches = [...text.matchAll(/<loc>(.*?)<\/loc>/gi)];
    sitemap.discoveredSitemaps = locMatches.map((m) => m[1]).slice(0, 10);
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

async function checkIndexability(pagesToCheck) {
  const results = [];
  for (const pageUrl of pagesToCheck) {
    const row = await checkSinglePageIndexability(pageUrl);
    results.push(row);
  }
  const passCount = results.filter((r) => r.pass).length;
  const failCount = results.length - passCount;
  return {
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
    const pagesToCheck = buildDefaultUrls(baseUrl);

    const [robots, sitemap, indexability] = await Promise.all([
      checkRobots(robotsUrl),
      checkSitemap(sitemapUrl),
      checkIndexability(pagesToCheck)
    ]);
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

