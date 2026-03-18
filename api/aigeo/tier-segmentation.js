const DEFAULT_SEGMENTATION_SOURCES = [
  'https://raw.githubusercontent.com/alanranger/alan-shared-resources/main/csv/page%20segmentation%20by%20tier.csv',
  'https://raw.githubusercontent.com/alanranger/alan-shared-resources/master/csv/page%20segmentation%20by%20tier.csv'
];

const KNOWN_TIERS = new Set(['all', 'landing', 'product', 'event', 'blog', 'academy', 'unmapped']);
const DEFAULT_SITE_ORIGIN = 'https://www.alanranger.com';

let tierEntriesCache = null;

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
      pathname.includes('/photographic-workshops-near-me')
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
      pathname.includes('/photography-services-near-me/')
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
    const pathname = String(parsed.pathname || '/').replaceAll(/\/{2,}/g, '/');
    const normalizedPath = pathname.length > 1 ? pathname.replaceAll(/\/+$/, '') : '/';
    return `${parsed.origin}${normalizedPath}`;
  } catch {
    return '';
  }
}

export function toTierUrlKey(url) {
  try {
    const parsed = new URL(String(url || ''));
    const pathname = String(parsed.pathname || '/').replaceAll(/\/{2,}/g, '/');
    const normalizedPath = pathname.length > 1 ? pathname.replaceAll(/\/+$/, '') : '/';
    return normalizedPath.toLowerCase();
  } catch {
    return '';
  }
}

function setLookupWithAliases(lookup, key, tier) {
  if (!(lookup instanceof Map) || !key || !tier) return;
  lookup.set(key, tier);
  if (/\/home$/i.test(key)) {
    lookup.set(key.replaceAll(/\/home$/i, '/'), tier);
  } else if (/\/$/i.test(key)) {
    lookup.set(key.replaceAll(/\/$/i, '/home'), tier);
  }
}

export async function fetchTierSegmentationEntries(options = {}) {
  const forceRefresh = options.forceRefresh === true;
  if (!forceRefresh && Array.isArray(tierEntriesCache) && tierEntriesCache.length > 0) {
    return tierEntriesCache;
  }

  const sources = Array.isArray(options.sources) && options.sources.length > 0
    ? options.sources
    : DEFAULT_SEGMENTATION_SOURCES;

  let csvText = '';
  for (const sourceUrl of sources) {
    try {
      const response = await fetch(sourceUrl);
      if (!response.ok) continue;
      const text = await response.text();
      if (!text?.trim()) continue;
      csvText = text;
      break;
    } catch {
      // Try next source.
    }
  }

  if (!csvText) {
    tierEntriesCache = [];
    return tierEntriesCache;
  }

  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    tierEntriesCache = [];
    return tierEntriesCache;
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

  tierEntriesCache = Array.from(byPath.values());
  return tierEntriesCache;
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

export function getTierForUrlFromLookup(url, lookup = null) {
  const key = toTierUrlKey(url);
  if (key && lookup instanceof Map && lookup.has(key)) {
    return normalizeTierInput(lookup.get(key), 'unmapped');
  }
  return classifyTierFromUrlHeuristic(url);
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
