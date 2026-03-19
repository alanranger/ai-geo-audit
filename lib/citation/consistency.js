export const DEFAULT_CORE_DIRECTORY_DOMAINS = [
  'trustpilot.com',
  'yell.com',
  'yelp.com',
  'bark.com',
  'tripadvisor.com',
  'facebook.com',
  'linkedin.com'
];

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_PER_DOMAIN_LIMIT = 2;
const DEFAULT_TIMEOUT_MS = 12000;

const normalizeText = (value) => String(value || '').toLowerCase().trim();
const normalizePhoneDigits = (value) => String(value || '').replace(/\D+/g, '');
const unique = (values) => [...new Set(values)];

const withTimeout = async (url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const stripHtml = (html) => {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
};

const decodeXml = (value) => {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
};

const extractTag = (itemXml, tagName) => {
  const match = itemXml.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match ? decodeXml(stripHtml(match[1])) : '';
};

const parseBingRss = (xml) => {
  const items = String(xml || '').match(/<item>([\s\S]*?)<\/item>/gi) || [];
  return items.map((itemXml) => ({
    title: extractTag(itemXml, 'title'),
    link: extractTag(itemXml, 'link'),
    snippet: extractTag(itemXml, 'description')
  }));
};

const toPathlessUrl = (value) => {
  try {
    const parsed = new URL(String(value || '').trim());
    parsed.hash = '';
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch (err) {
    return String(value || '').trim().toLowerCase();
  }
};

const isUrlOnDomain = (url, domain) => {
  try {
    const host = new URL(String(url || '')).hostname.toLowerCase();
    const normalizedDomain = String(domain || '').toLowerCase().trim();
    return host === normalizedDomain || host.endsWith(`.${normalizedDomain}`);
  } catch (err) {
    return false;
  }
};

const runParallel = async (items, concurrency, worker) => {
  const output = [];
  const safeConcurrency = Math.max(1, Math.min(10, Number(concurrency || 1)));
  let index = 0;
  const workers = Array.from({ length: safeConcurrency }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      const result = await worker(items[current], current);
      if (Array.isArray(result) && result.length) output.push(...result);
    }
  });
  await Promise.all(workers);
  return output;
};

const parseDomainList = (raw) => {
  const configured = String(raw || '')
    .split(',')
    .map((value) => normalizeText(value))
    .filter(Boolean);
  return configured.length ? unique(configured) : DEFAULT_CORE_DIRECTORY_DOMAINS;
};

const parseSeedMapFromJson = (raw) => {
  try {
    const parsed = JSON.parse(String(raw || '').trim());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const output = {};
    for (const [domainRaw, value] of Object.entries(parsed)) {
      const domain = normalizeText(domainRaw);
      if (!domain) continue;
      const urls = Array.isArray(value) ? value : [value];
      const normalizedUrls = urls
        .map((item) => String(item || '').trim())
        .filter(Boolean);
      if (normalizedUrls.length) output[domain] = normalizedUrls;
    }
    return output;
  } catch (err) {
    return {};
  }
};

const parseSeedMapFromLines = (raw) => {
  const output = {};
  const lines = String(raw || '')
    .split(/[\r\n;]+/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const separatorIdx = line.indexOf('=');
    if (separatorIdx <= 0) continue;
    const domain = normalizeText(line.slice(0, separatorIdx));
    const url = String(line.slice(separatorIdx + 1) || '').trim();
    if (!domain || !url) continue;
    output[domain] = output[domain] || [];
    output[domain].push(url);
  }

  return output;
};

const parseDirectorySeedMap = (raw) => {
  const jsonMap = parseSeedMapFromJson(raw);
  if (Object.keys(jsonMap).length) return jsonMap;
  return parseSeedMapFromLines(raw);
};

const resolveSeedCandidates = (seedMap, domain) => {
  const urls = Array.isArray(seedMap?.[domain]) ? seedMap[domain] : [];
  const validUrls = unique(urls)
    .filter((url) => isUrlOnDomain(url, domain));
  return validUrls.map((url) => ({
    domain,
    sourceUrl: url,
    sourceTitle: 'Manual seeded listing URL',
    sourceSnippet: 'manual_seed'
  }));
};

const createNoCandidateRow = (domain) => ({
  directory_domain: domain,
  source_url: `https://${domain}/`,
  title: null,
  snippet: null,
  status: 'watch',
  consistency_score: 0,
  matched_signals: [],
  missing_signals: [],
  alert_level: 'alert',
  fetch_error: 'No indexed listing candidate found for this directory domain'
});

const buildAvailableSignals = (canonicalNap = {}) => {
  const name = normalizeText(canonicalNap.name || '');
  const phoneDigits = normalizePhoneDigits(canonicalNap.phone || '');
  const phoneTail = phoneDigits.length >= 9 ? phoneDigits.slice(-9) : phoneDigits;
  const locality = normalizeText(canonicalNap.locality || '');
  const postcode = normalizeText(canonicalNap.postcode || '').replace(/\s+/g, '');
  return {
    name,
    phoneTail,
    locality,
    postcode
  };
};

const computeEntrySignals = (text, canonicalSignals) => {
  const textNorm = normalizeText(text);
  const textDigits = normalizePhoneDigits(textNorm);
  const postcodeNorm = (canonicalSignals.postcode || '').replace(/\s+/g, '');
  const matched = [];
  const missing = [];
  const compactText = textNorm.replace(/\s+/g, '');

  const recordSignal = (label, expected, comparator) => {
    if (!expected) return;
    if (comparator(expected)) matched.push(label);
    else missing.push(label);
  };

  recordSignal('name', canonicalSignals.name, (value) => textNorm.includes(value));
  recordSignal('phone', canonicalSignals.phoneTail, (value) => textDigits.includes(value));
  recordSignal('locality', canonicalSignals.locality, (value) => textNorm.includes(value));
  recordSignal('postcode', postcodeNorm, (value) => compactText.includes(value));

  const available = matched.length + missing.length;
  const score = available > 0 ? Math.round((matched.length / available) * 100) : 0;
  return { matched, missing, score, available };
};

const resolveEntryStatus = (score, available, fetchError) => {
  if (fetchError) return { status: 'fail', alertLevel: 'critical' };
  if (available === 0) return { status: 'watch', alertLevel: 'watch' };
  if (score >= 75) return { status: 'pass', alertLevel: 'low' };
  if (score >= 50) return { status: 'watch', alertLevel: 'alert' };
  return { status: 'fail', alertLevel: 'critical' };
};

const fetchDomainCandidates = async ({ domain, brandName, perDomainLimit }) => {
  const query = `site:${domain} "${brandName}"`;
  const rssUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&setlang=en-gb`;
  const response = await withTimeout(rssUrl, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; AI-GEO-Audit/citation-consistency)' }
  });
  if (!response.ok) return [];
  const xml = await response.text();
  return parseBingRss(xml)
    .filter((item) => isUrlOnDomain(item.link, domain))
    .slice(0, perDomainLimit)
    .map((item) => ({ domain, sourceUrl: item.link, sourceTitle: item.title, sourceSnippet: item.snippet }));
};

const fetchPageText = async (url) => {
  try {
    const response = await withTimeout(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; AI-GEO-Audit/citation-consistency)' }
    });
    if (!response.ok) return { text: '', fetchError: `HTTP ${response.status}` };
    const html = await response.text();
    return { text: stripHtml(html), fetchError: null };
  } catch (error) {
    console.warn('[citation] page fetch failed:', error.message);
    return { text: '', fetchError: error.message };
  }
};

export const collectCitationConsistencyRows = async ({
  canonicalNap,
  domainsRaw,
  directorySeedMapRaw = '',
  perDomainLimit = DEFAULT_PER_DOMAIN_LIMIT,
  concurrency = DEFAULT_CONCURRENCY
}) => {
  const domains = parseDomainList(domainsRaw);
  const seedMap = parseDirectorySeedMap(directorySeedMapRaw);
  const canonicalSignals = buildAvailableSignals(canonicalNap);
  const brandName = canonicalSignals.name || normalizeText(canonicalNap?.name || 'alan ranger photography');

  const candidates = await runParallel(domains, concurrency, async (domain) => {
    const seeded = resolveSeedCandidates(seedMap, domain);
    if (seeded.length) return seeded;
    const domainCandidates = await fetchDomainCandidates({ domain, brandName, perDomainLimit });
    if (domainCandidates.length) return domainCandidates;
    return [{ domain, sourceUrl: `https://${domain}/`, sourceTitle: '', sourceSnippet: '', isNoCandidate: true }];
  });

  const dedupedCandidates = unique(
    candidates.map((row) => JSON.stringify({ ...row, sourceUrl: toPathlessUrl(row.sourceUrl) }))
  ).map((value) => JSON.parse(value));

  const rows = await runParallel(dedupedCandidates, concurrency, async (candidate) => {
    if (candidate.isNoCandidate) {
      return [createNoCandidateRow(candidate.domain)];
    }
    const page = await fetchPageText(candidate.sourceUrl);
    const signals = computeEntrySignals(page.text || `${candidate.sourceTitle} ${candidate.sourceSnippet}`, canonicalSignals);
    const statusMeta = resolveEntryStatus(signals.score, signals.available, page.fetchError);
    return [{
      directory_domain: candidate.domain,
      source_url: candidate.sourceUrl,
      title: candidate.sourceTitle || null,
      snippet: candidate.sourceSnippet || null,
      status: statusMeta.status,
      consistency_score: signals.score,
      matched_signals: signals.matched,
      missing_signals: signals.missing,
      alert_level: statusMeta.alertLevel,
      fetch_error: page.fetchError || null
    }];
  });

  const driftRows = rows.filter((row) => row.status !== 'pass');
  const alertsCount = rows.filter((row) => ['alert', 'critical'].includes(String(row.alert_level || '').toLowerCase())).length;
  const averageScore = rows.length
    ? Math.round(rows.reduce((sum, row) => sum + Number(row.consistency_score || 0), 0) / rows.length)
    : 0;

  return {
    rows,
    domainsChecked: domains.length,
    entriesChecked: rows.length,
    driftCount: driftRows.length,
    alertsCount,
    averageScore
  };
};
