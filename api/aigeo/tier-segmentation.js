const DEFAULT_SEGMENTATION_SOURCES = [
  'https://raw.githubusercontent.com/alanranger/alan-shared-resources/main/csv/page%20segmentation%20by%20tier.csv',
  'https://raw.githubusercontent.com/alanranger/alan-shared-resources/master/csv/page%20segmentation%20by%20tier.csv'
];

const KNOWN_TIERS = new Set(['all', 'landing', 'product', 'event', 'blog', 'academy', 'unmapped']);
const DEFAULT_SITE_ORIGIN = 'https://www.alanranger.com';
const DEFAULT_TIER_CACHE_TTL_MS = 60 * 1000;
const DEFAULT_ROBOTS_CACHE_TTL_MS = 5 * 60 * 1000;
const INDEXABILITY_EXCLUSION_REASON_RE = /\b(noindex|robots|disallow)\b/i;

let tierEntriesCache = {
  entries: null,
  fetchedAt: 0
};
const tierEntriesSnapshotCache = new Map();
const runtimeIndexabilityExclusionKeys = new Set();
const robotsDisallowCache = new Map();

function resolveTierCacheTtlMs(value) {
  if (!Number.isFinite(Number(value))) return DEFAULT_TIER_CACHE_TTL_MS;
  return Math.max(0, Math.floor(Number(value)));
}

function buildSegmentationSourceUrl(sourceUrl, forceRefresh, now) {
  if (!forceRefresh) return sourceUrl;
  try {
    const parsed = new URL(sourceUrl);
    parsed.searchParams.set('_ts', String(now));
    return parsed.toString();
  } catch {
    const separator = String(sourceUrl).includes('?') ? '&' : '?';
    return `${sourceUrl}${separator}_ts=${now}`;
  }
}

async function fetchTierSegmentationCsvText(sources, forceRefresh, now) {
  for (const sourceUrl of sources) {
    try {
      const requestUrl = buildSegmentationSourceUrl(sourceUrl, forceRefresh, now);
      const response = await fetch(requestUrl, { cache: forceRefresh ? 'no-store' : 'default' });
      if (!response.ok) continue;
      const text = await response.text();
      if (text?.trim()) return text;
    } catch {
      // Try next source.
    }
  }
  return '';
}

function saveTierEntriesToCache(entries, now, snapshotKey = '') {
  tierEntriesCache = { entries, fetchedAt: now };
  if (snapshotKey) tierEntriesSnapshotCache.set(snapshotKey, entries);
  return entries;
}

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function directiveAppliesToTrackedAgent(agentNames = []) {
  const normalized = (Array.isArray(agentNames) ? agentNames : [])
    .map((agent) => String(agent || '').trim().toLowerCase())
    .filter(Boolean);
  if (!normalized.length) return false;
  if (normalized.includes('*')) return true;
  return normalized.some((agent) => agent === 'googlebot' || agent === 'gptbot' || agent === 'chatgpt-user');
}

function parseRobotsDirectiveLine(line) {
  const cleaned = String(line || '').replace(/#.*/, '').trim();
  if (!cleaned || !cleaned.includes(':')) return null;
  const separatorIdx = cleaned.indexOf(':');
  const key = cleaned.slice(0, separatorIdx).trim().toLowerCase();
  const value = cleaned.slice(separatorIdx + 1).trim();
  if (!key) return null;
  return { key, value };
}

function updateCurrentAgents(currentAgents, value, lastKey) {
  const nextAgent = String(value || '').trim().toLowerCase();
  if (!nextAgent) return currentAgents;
  if (lastKey === 'user-agent') return [...currentAgents, nextAgent];
  return [nextAgent];
}

function toDisallowRuleRegex(value) {
  if (!value) return null;
  const endAnchored = value.endsWith('$');
  const rawPattern = endAnchored ? value.slice(0, -1) : value;
  const regexSource = `^${escapeRegex(rawPattern).replace(/\\\*/g, '.*')}${endAnchored ? '$' : ''}`;
  try {
    return new RegExp(regexSource);
  } catch {
    return null;
  }
}

function parseRobotsDisallowRules(robotsText) {
  const lines = String(robotsText || '').split(/\r?\n/);
  const rules = [];
  let currentAgents = [];
  let lastKey = '';
  for (const line of lines) {
    const directive = parseRobotsDirectiveLine(line);
    if (!directive) continue;
    const { key, value } = directive;
    if (key === 'user-agent') {
      currentAgents = updateCurrentAgents(currentAgents, value, lastKey);
      lastKey = key;
      continue;
    }
    lastKey = key;
    if (key !== 'disallow') continue;
    if (!directiveAppliesToTrackedAgent(currentAgents)) continue;
    const rule = toDisallowRuleRegex(value);
    if (rule) rules.push(rule);
  }
  return rules;
}

async function fetchRobotsDisallowRulesForOrigin(origin, options = {}, now = Date.now()) {
  const cacheTtlMs = resolveTierCacheTtlMs(options.robotsCacheTtlMs ?? DEFAULT_ROBOTS_CACHE_TTL_MS);
  const forceRefresh = options.forceRefresh === true;
  const cached = robotsDisallowCache.get(origin);
  if (
    !forceRefresh
    && cached
    && (cacheTtlMs <= 0 || (now - Number(cached.fetchedAt || 0)) <= cacheTtlMs)
  ) {
    return cached.rules;
  }
  try {
    const robotsUrl = `${origin}/robots.txt`;
    const response = await fetch(robotsUrl, { cache: forceRefresh ? 'no-store' : 'default' });
    const text = response.ok ? await response.text() : '';
    const rules = parseRobotsDisallowRules(text);
    robotsDisallowCache.set(origin, { rules, fetchedAt: now });
    return rules;
  } catch {
    robotsDisallowCache.set(origin, { rules: [], fetchedAt: now });
    return [];
  }
}

async function filterEntriesByRobotsDisallow(entries = [], options = {}, now = Date.now()) {
  const safeEntries = Array.isArray(entries) ? entries : [];
  if (!safeEntries.length) return [];

  const rulesByOrigin = new Map();
  for (const entry of safeEntries) {
    const urlValue = String(entry?.url || '');
    try {
      const parsed = new URL(urlValue);
      if (!rulesByOrigin.has(parsed.origin)) {
        const rules = await fetchRobotsDisallowRulesForOrigin(parsed.origin, options, now);
        rulesByOrigin.set(parsed.origin, rules);
      }
    } catch {
      // Ignore malformed URLs.
    }
  }

  return safeEntries.filter((entry) => {
    try {
      const parsed = new URL(String(entry?.url || ''));
      const pathWithQuery = `${parsed.pathname || '/'}${parsed.search || ''}`;
      const rules = rulesByOrigin.get(parsed.origin) || [];
      return !rules.some((rule) => rule.test(pathWithQuery));
    } catch {
      return false;
    }
  });
}

function shouldExcludeByIndexabilitySignal(row = {}) {
  if (row?.pass === true || row?.indexable === true) return false;
  return INDEXABILITY_EXCLUSION_REASON_RE.test(String(row?.reason || ''));
}

function filterEntriesByRuntimeExclusions(entries = []) {
  if (!runtimeIndexabilityExclusionKeys.size) return Array.isArray(entries) ? entries : [];
  const safeEntries = Array.isArray(entries) ? entries : [];
  return safeEntries.filter((entry) => {
    const key = toTierUrlKey(entry?.url || '');
    return !key || !runtimeIndexabilityExclusionKeys.has(key);
  });
}

export function syncTierIndexabilityExclusions(rows = []) {
  const safeRows = Array.isArray(rows) ? rows : [];
  safeRows.forEach((row) => {
    const key = toTierUrlKey(row?.url || '');
    if (!key) return;
    if (shouldExcludeByIndexabilitySignal(row)) runtimeIndexabilityExclusionKeys.add(key);
    else if (row?.pass === true || row?.indexable === true) runtimeIndexabilityExclusionKeys.delete(key);
  });
  return runtimeIndexabilityExclusionKeys.size;
}

export function normalizeTierInput(value, fallback = 'all') {
  const normalized = String(value || '').trim().toLowerCase();
  if (KNOWN_TIERS.has(normalized)) return normalized;
  return KNOWN_TIERS.has(fallback) ? fallback : 'all';
}

export function classifyTierFromUrlHeuristic(url) {
  try {
    const pathname = String(new URL(String(url || '')).pathname || '/').toLowerCase();
    if (pathname === '/' || pathname === '/home') return 'landing';
    if (pathname.includes('/s/')) return 'academy';
    if (
      pathname.includes('/beginners-photography-lessons')
      || pathname.includes('/photographic-workshops-near-me')
      || pathname.includes('/photography-workshops-near-me')
      || pathname.includes('/workshops')
      || pathname.includes('/event')
      || pathname.includes('/webinar')
    ) {
      return 'event';
    }
    if (pathname.includes('/academy') || pathname.includes('/free-online-photography-course')) return 'academy';
    if (pathname.includes('/blog') || pathname.includes('/article') || pathname.includes('/guides')) return 'blog';
    if (
      pathname.includes('/photography-services-near-me')
      || pathname === '/photography-services'
      || pathname.startsWith('/photography-services/')
      || pathname.includes('/photo-workshops-uk')
      || pathname.includes('/product')
      || pathname.includes('/courses')
      || pathname.includes('/mentoring')
      || pathname.includes('/subscription')
    ) {
      return 'product';
    }
    if (pathname.split('/').filter(Boolean).length <= 1) return 'landing';
    return 'unmapped';
  } catch {
    return 'unmapped';
  }
}

function parseCsvLine(line) {
  const columns = [];
  let current = '';
  let inQuotes = false;
  const text = String(line || '');
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      columns.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  columns.push(current.trim());
  return columns;
}

function tierKeyFromHeader(header) {
  const normalized = String(header || '').toLowerCase();
  if (normalized.includes('tier a') || normalized.includes('landing')) return 'landing';
  if (normalized.includes('tier b') || normalized.includes('product')) return 'product';
  if (normalized.includes('tier c') || normalized.includes('event')) return 'event';
  if (normalized.includes('tier d') || normalized.includes('blog')) return 'blog';
  if (normalized.includes('tier e') || normalized.includes('academy')) return 'academy';
  if (normalized.includes('tier f') || normalized.includes('unmapped')) return 'unmapped';
  return null;
}

function normalizeSegmentationSourceUrl(rawValue) {
  const raw = String(rawValue || '').trim();
  if (!raw) return '';
  if (raw === '/') return `${DEFAULT_SITE_ORIGIN}/`;
  if (!/^https?:\/\//i.test(raw)) return '';
  try {
    const parsed = new URL(raw);
    const pathname = String(parsed.pathname || '/').replace(/\/{2,}/g, '/');
    const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/';
    return `${parsed.origin}${normalizedPath}`;
  } catch {
    return '';
  }
}

export function toTierUrlKey(url) {
  try {
    const parsed = new URL(String(url || ''));
    const pathname = String(parsed.pathname || '/').replace(/\/{2,}/g, '/');
    const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/';
    return normalizedPath.toLowerCase();
  } catch {
    return '';
  }
}

function setLookupWithAliases(lookup, key, tier) {
  if (!(lookup instanceof Map) || !key || !tier) return;
  lookup.set(key, tier);
  if (/\/home$/i.test(key)) {
    lookup.set(key.replace(/\/home$/i, '/'), tier);
  } else if (/\/$/i.test(key)) {
    lookup.set(key.replace(/\/$/i, '/home'), tier);
  }
}

export async function fetchTierSegmentationEntries(options = {}) {
  const cacheTtlMs = resolveTierCacheTtlMs(options.cacheTtlMs);
  const forceRefresh = options.forceRefresh === true;
  const snapshotKey = String(options.snapshotKey || '').trim();
  const now = Date.now();

  if (!forceRefresh && snapshotKey && tierEntriesSnapshotCache.has(snapshotKey)) {
    return tierEntriesSnapshotCache.get(snapshotKey) || [];
  }

  if (
    !forceRefresh
    && Array.isArray(tierEntriesCache.entries)
    && (cacheTtlMs <= 0 || (now - Number(tierEntriesCache.fetchedAt || 0)) <= cacheTtlMs)
  ) {
    if (snapshotKey) tierEntriesSnapshotCache.set(snapshotKey, tierEntriesCache.entries);
    return tierEntriesCache.entries;
  }

  const sources = Array.isArray(options.sources) && options.sources.length > 0
    ? options.sources
    : DEFAULT_SEGMENTATION_SOURCES;

  const csvText = await fetchTierSegmentationCsvText(sources, forceRefresh, now);

  if (!csvText) {
    return saveTierEntriesToCache([], now, snapshotKey);
  }

  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return saveTierEntriesToCache([], now, snapshotKey);
  }

  const headers = parseCsvLine(lines[0]);
  const columnDefs = headers
    .map((header, idx) => ({ idx, tier: tierKeyFromHeader(header) }))
    .filter((item) => item.tier);
  const byPath = new Map();

  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    columnDefs.forEach(({ idx, tier }) => {
      const normalizedUrl = normalizeSegmentationSourceUrl(cols[idx]);
      if (!normalizedUrl) return;
      const key = toTierUrlKey(normalizedUrl);
      if (!key || byPath.has(key)) return;
      byPath.set(key, { url: normalizedUrl, tier });
    });
  }

  const robotsFilteredEntries = await filterEntriesByRobotsDisallow(Array.from(byPath.values()), options, now);
  const entries = filterEntriesByRuntimeExclusions(robotsFilteredEntries);
  return saveTierEntriesToCache(entries, now, snapshotKey);
}

export function buildTierLookupFromEntries(entries = []) {
  const lookup = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const key = toTierUrlKey(entry?.url || '');
    const tier = normalizeTierInput(entry?.tier, 'unmapped');
    if (!key || tier === 'all') return;
    if (!lookup.has(key)) setLookupWithAliases(lookup, key, tier);
  });
  return lookup;
}

/**
 * Make a parseable absolute URL for tier rules when DFS rows may omit scheme or use path-only targets.
 * @param {string} raw url_to (or any target string)
 * @param {string|null|undefined} domainHost e.g. alanranger.com from dfs_domain_backlink_rows.domain_host
 */
export function resolveBacklinkTargetUrlForTier(raw, domainHost) {
  const s = String(raw || '').trim();
  if (!s) return `${DEFAULT_SITE_ORIGIN}/`;
  const dom = String(domainHost || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .replace(/^www\./, '')
    .replace(/:\d+$/, '');
  const baseRaw = dom ? `https://www.${dom.replace(/^www\./, '')}` : DEFAULT_SITE_ORIGIN;
  const base = baseRaw.endsWith('/') ? baseRaw : `${baseRaw}/`;
  try {
    return new URL(s, base).href;
  } catch {
    return `${DEFAULT_SITE_ORIGIN}/`;
  }
}

/**
 * @param {string} url
 * @param {Map|null} lookup from buildTierLookupFromEntries
 * @param {string|null} [domainHost] when set, resolve relative/malformed targets before lookup/heuristic (backlinks)
 * @param {boolean} [suppressUnmapped] backlinks only: never return unmapped (final fallback blog)
 */
export function getTierForUrlFromLookup(url, lookup = null, domainHost = null, suppressUnmapped = false) {
  const hasHost = domainHost != null && String(domainHost).trim() !== '';
  const resolved = hasHost ? resolveBacklinkTargetUrlForTier(url, domainHost) : String(url || '').trim();
  const key = toTierUrlKey(resolved);
  let fromLookup = null;
  if (key && lookup instanceof Map && lookup.has(key)) {
    fromLookup = normalizeTierInput(lookup.get(key), 'unmapped');
  }
  const fromHeuristic = classifyTierFromUrlHeuristic(resolved);
  let tier;
  if (fromLookup && fromLookup !== 'unmapped') tier = fromLookup;
  else tier = fromHeuristic;
  if (suppressUnmapped && tier === 'unmapped') tier = 'blog';
  return tier;
}

export function countTierEntries(entries = []) {
  const counts = {
    all: 0,
    landing: 0,
    product: 0,
    event: 0,
    blog: 0,
    academy: 0,
    unmapped: 0
  };
  const safeEntries = Array.isArray(entries) ? entries : [];
  counts.all = safeEntries.length;
  safeEntries.forEach((entry) => {
    const tier = normalizeTierInput(entry?.tier, 'unmapped');
    if (Object.hasOwn(counts, tier)) counts[tier] += 1;
    else counts.unmapped += 1;
  });
  return counts;
}

export function filterTierEntriesByTier(entries = [], tier = 'all') {
  const normalizedTier = normalizeTierInput(tier, 'all');
  const safeEntries = Array.isArray(entries) ? entries : [];
  if (normalizedTier === 'all') return safeEntries;
  return safeEntries.filter((entry) => normalizeTierInput(entry?.tier, 'unmapped') === normalizedTier);
}

export function urlsFromTierEntries(entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => String(entry?.url || '').trim())
    .filter((url) => /^https?:\/\//i.test(url));
}
