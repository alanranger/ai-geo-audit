/**
 * Shared loader for csv/06-site-urls.csv (first column = URL).
 * Used by schema-audit and content-extractability so crawl lists match the agreed site URL set.
 */

const CANONICAL_SITE_URLS_SOURCES = [
  'https://raw.githubusercontent.com/alanranger/alan-shared-resources/main/csv/06-site-urls.csv',
  'https://raw.githubusercontent.com/alanranger/alan-shared-resources/master/csv/06-site-urls.csv'
];

function normalizeUrlKey(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const parsed = new URL(url);
    const normalizedPath = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.origin}${normalizedPath}`.toLowerCase();
  } catch {
    return url.trim().replace(/\/+$/, '').toLowerCase();
  }
}

function buildGithubRawRefreshUrl(baseUrl, forceRefresh) {
  if (!forceRefresh) return baseUrl;
  try {
    const parsed = new URL(baseUrl);
    parsed.searchParams.set('_ts', String(Date.now()));
    return parsed.toString();
  } catch {
    const sep = String(baseUrl).includes('?') ? '&' : '?';
    return `${baseUrl}${sep}_ts=${Date.now()}`;
  }
}

function parseFirstColumnUrlsFrom06StyleCsv(csvText) {
  const lines = String(csvText || '').split(/\r?\n/);
  const out = [];
  const seen = new Set();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || !/^https?:\/\//i.test(line)) continue;
    const comma = line.indexOf(',');
    const url = (comma >= 0 ? line.slice(0, comma) : line).trim();
    if (!/^https?:\/\//i.test(url)) continue;
    try {
      new URL(url);
    } catch {
      continue;
    }
    const key = normalizeUrlKey(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}

/**
 * @param {{ forceRefresh?: boolean }} options
 * @returns {Promise<string[]>}
 */
export async function fetchCanonicalSiteUrlList(options = {}) {
  const forceRefresh = options.forceRefresh === true;
  for (const source of CANONICAL_SITE_URLS_SOURCES) {
    try {
      const reqUrl = buildGithubRawRefreshUrl(source, forceRefresh);
      const res = await fetch(reqUrl, { cache: forceRefresh ? 'no-store' : 'default' });
      if (!res.ok) continue;
      const urls = parseFirstColumnUrlsFrom06StyleCsv(await res.text());
      if (urls.length > 0) return urls;
    } catch {
      // try next source
    }
  }
  return [];
}
