import fs from 'node:fs/promises';

export const MENTIONS_PLATFORM_DOMAINS = {
  reddit: 'reddit.com',
  linkedin: 'linkedin.com',
  youtube: 'youtube.com'
};

const DEFAULT_KEYWORDS_FILE = 'G:/Dropbox/alan ranger photography/Website Code/alan-shared-resources/csv/Keywords.csv';
const DEFAULT_KEYWORDS_URLS = [
  'https://raw.githubusercontent.com/alanranger/alan-shared-resources/main/csv/Keywords.csv',
  'https://raw.githubusercontent.com/alanranger/alan-shared-resources/master/csv/Keywords.csv'
];
const DEFAULT_BRAND_TERMS = ['alan ranger photography', 'alanranger.com'];
const DEFAULT_WEAK_BRAND_TERMS = ['alan ranger'];
const DEFAULT_BRAND_CONTEXT_TERMS = ['photograph', 'workshop', 'tuition', 'coventry', 'alanranger.com'];
const DEFAULT_KEYWORD_LIMIT = 30;
const DEFAULT_PER_QUERY_LIMIT = 3;
const DEFAULT_CONCURRENCY = 4;

const normalizeKeyword = (value) => String(value || '').trim().toLowerCase();
const uniq = (values) => [...new Set(values)];
const normalizeHost = (value) => String(value || '').trim().toLowerCase();

const decodeXml = (value) => {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
};

const stripTags = (value) => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const extractTag = (itemXml, tagName) => {
  const match = itemXml.match(new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'i'));
  return match ? decodeXml(stripTags(match[1])) : '';
};

const parseCsvKeywords = (csvText) => {
  const rows = String(csvText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!rows.length) return [];
  const startIdx = normalizeKeyword(rows[0]) === 'keywords' ? 1 : 0;
  const parsed = [];
  for (let i = startIdx; i < rows.length; i += 1) {
    const raw = rows[i].replace(/^"+|"+$/g, '').trim();
    if (!raw) continue;
    parsed.push(raw);
  }
  return uniq(parsed.map(normalizeKeyword).filter(Boolean));
};

const readKeywordFile = async (path) => {
  try {
    const text = await fs.readFile(path, 'utf8');
    return parseCsvKeywords(text);
  } catch (err) {
    console.warn('[mentions] keyword file read failed:', err.message);
    return [];
  }
};

const readKeywordUrl = async (url) => {
  try {
    const response = await fetch(url);
    if (!response.ok) return [];
    const text = await response.text();
    return parseCsvKeywords(text);
  } catch (err) {
    console.warn('[mentions] keyword URL fetch failed:', err.message);
    return [];
  }
};

export const loadMentionKeywords = async () => {
  const filePath = process.env.MENTIONS_KEYWORDS_FILE || DEFAULT_KEYWORDS_FILE;
  const fileKeywords = await readKeywordFile(filePath);
  if (fileKeywords.length) {
    return { keywords: fileKeywords, source: `file:${filePath}` };
  }

  const configuredUrls = String(process.env.MENTIONS_KEYWORDS_URLS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const candidateUrls = configuredUrls.length ? configuredUrls : DEFAULT_KEYWORDS_URLS;
  for (const url of candidateUrls) {
    const fetchedKeywords = await readKeywordUrl(url);
    if (fetchedKeywords.length) {
      return { keywords: fetchedKeywords, source: `url:${url}` };
    }
  }

  return { keywords: [], source: 'none' };
};

const parseBingRssItems = (xml) => {
  const itemMatches = String(xml || '').match(/<item>([\s\S]*?)<\/item>/gi) || [];
  return itemMatches.map((itemXml) => ({
    title: extractTag(itemXml, 'title'),
    link: extractTag(itemXml, 'link'),
    snippet: extractTag(itemXml, 'description'),
    publishedAt: extractTag(itemXml, 'pubDate')
  }));
};

const parseDuckDuckGoItems = (html) => {
  const matches = String(html || '').match(/uddg=([^&"]+)/g) || [];
  const links = uniq(matches.map((part) => {
    const encoded = String(part || '').replace(/^uddg=/, '');
    try {
      return decodeURIComponent(encoded);
    } catch (err) {
      return '';
    }
  }).filter(Boolean));
  return links.map((link) => ({
    title: '',
    link,
    snippet: '',
    publishedAt: ''
  }));
};

const extractHostname = (url) => {
  const raw = String(url || '').trim();
  if (!raw || !URL.canParse(raw)) return '';
  return normalizeHost(new URL(raw).hostname);
};

const hostMatchesDomain = (host, domain) => {
  const normalizedHost = normalizeHost(host);
  const normalizedDomain = normalizeHost(domain);
  if (!normalizedHost || !normalizedDomain) return false;
  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
};

const derivePlatformFromHost = (host) => {
  const normalizedHost = normalizeHost(host);
  if (!normalizedHost) return null;
  if (hostMatchesDomain(normalizedHost, 'reddit.com')) return 'reddit';
  if (hostMatchesDomain(normalizedHost, 'linkedin.com')) return 'linkedin';
  if (normalizedHost === 'youtu.be' || hostMatchesDomain(normalizedHost, 'youtube.com')) return 'youtube';
  return null;
};

const buildDiscoveryTerms = (brandTerms, propertyUrl = '') => {
  const host = extractHostname(propertyUrl).replace(/^www\./, '');
  const terms = uniq([
    ...((brandTerms || []).map(normalizeKeyword).filter(Boolean)),
    host,
    'alan ranger photography',
    '"alan ranger" photography',
    'alan ranger coventry photography'
  ]);
  return terms.filter((term) => term.length >= 3);
};

const buildPlatformSearchPairs = (terms, perQueryLimit) => {
  const pairs = [];
  for (const term of terms) {
    pairs.push({
      platform: 'youtube',
      domain: MENTIONS_PLATFORM_DOMAINS.youtube,
      query: `site:youtube.com "${term}"`,
      matchedKeyword: term,
      perQueryLimit
    });
    pairs.push({
      platform: 'linkedin',
      domain: MENTIONS_PLATFORM_DOMAINS.linkedin,
      query: `site:linkedin.com/in "${term}"`,
      matchedKeyword: term,
      perQueryLimit
    });
    pairs.push({
      platform: 'reddit',
      domain: MENTIONS_PLATFORM_DOMAINS.reddit,
      query: `site:reddit.com "${term}"`,
      matchedKeyword: term,
      perQueryLimit
    });
  }
  return pairs;
};

const buildMentionSeed = ({ row, host, platform, scoreMeta }) => ({
  platform,
  source_domain: host || row.sourceDomain || null,
  source_url: row.sourceUrl,
  title: row.title || null,
  snippet: row.snippet || null,
  published_at: row.publishedAt,
  mention_score: scoreMeta.mentionScore,
  alert_level: scoreMeta.alertLevel,
  is_brand_mention: scoreMeta.isBrandMention,
  matched_keywords: [row.matchedKeyword].filter(Boolean)
});

const mergeMentionRows = (existing, incoming, scoreMeta) => {
  const keywordsMerged = uniq([...(existing.matched_keywords || []), incoming.matchedKeyword].filter(Boolean));
  const useIncoming = scoreMeta.mentionScore > Number(existing.mention_score || 0);
  return {
    ...existing,
    title: useIncoming ? (incoming.title || existing.title || null) : existing.title,
    snippet: useIncoming ? (incoming.snippet || existing.snippet || null) : existing.snippet,
    published_at: existing.published_at || incoming.publishedAt || null,
    mention_score: Math.max(Number(existing.mention_score || 0), scoreMeta.mentionScore),
    alert_level: useIncoming ? scoreMeta.alertLevel : existing.alert_level,
    is_brand_mention: existing.is_brand_mention || scoreMeta.isBrandMention,
    matched_keywords: keywordsMerged
  };
};

const normalizeUrlForKey = (url) => {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return `${parsed.origin}${parsed.pathname}`.replace(/\/+$/, '').toLowerCase();
  } catch (err) {
    console.warn('[mentions] URL normalization fallback:', err.message);
    return String(url || '').trim().toLowerCase();
  }
};

const asIsoOrNull = (value) => {
  const ts = Date.parse(String(value || ''));
  if (!Number.isFinite(ts) || ts <= 0) return null;
  return new Date(ts).toISOString();
};

const runWithConcurrency = async (items, concurrency, handler) => {
  const safeConcurrency = Math.max(1, Math.min(10, Number(concurrency || 1)));
  const results = [];
  let idx = 0;
  const workers = Array.from({ length: safeConcurrency }, async () => {
    while (idx < items.length) {
      const current = idx;
      idx += 1;
      const out = await handler(items[current], current);
      if (Array.isArray(out) && out.length) results.push(...out);
    }
  });
  await Promise.all(workers);
  return results;
};

const applyBrandTermScore = (
  terms,
  title,
  snippet,
  url = '',
  weakTerms = DEFAULT_WEAK_BRAND_TERMS,
  contextTerms = DEFAULT_BRAND_CONTEXT_TERMS
) => {
  let score = 0;
  let hasBrand = false;
  let hasStrongBrand = false;
  const haystackUrl = normalizeKeyword(url);

  const hasContextSignal = contextTerms.some((contextTerm) => {
    const normalized = normalizeKeyword(contextTerm);
    if (!normalized) return false;
    return title.includes(normalized) || snippet.includes(normalized) || haystackUrl.includes(normalized);
  });

  for (const termRaw of weakTerms) {
    const term = normalizeKeyword(termRaw);
    if (!term) continue;
    if (title.includes(term) || snippet.includes(term) || haystackUrl.includes(term)) {
      score += 5;
      hasBrand = true;
      if (hasContextSignal) {
        score += 20;
        hasStrongBrand = true;
      }
    }
  }

  for (const termRaw of terms) {
    const term = normalizeKeyword(termRaw);
    if (!term) continue;
    if (title.includes(term)) {
      score += 40;
      hasBrand = true;
      hasStrongBrand = true;
    }
    if (snippet.includes(term)) {
      score += 25;
      hasBrand = true;
      hasStrongBrand = true;
    }
    if (haystackUrl.includes(term)) {
      score += 40;
      hasBrand = true;
      hasStrongBrand = true;
    }
  }
  return { score, hasBrand, hasStrongBrand };
};

const applyKeywordScore = (keyword, title, snippet) => {
  const normalized = normalizeKeyword(keyword);
  if (!normalized) return 0;
  let score = 0;
  if (title.includes(normalized)) score += 20;
  if (snippet.includes(normalized)) score += 10;
  return score;
};

const applyRecencyScore = (publishedAt) => {
  const publishedTs = Date.parse(String(publishedAt || ''));
  if (!Number.isFinite(publishedTs)) return 0;
  const ageDays = (Date.now() - publishedTs) / (1000 * 60 * 60 * 24);
  if (ageDays <= 30) return 10;
  if (ageDays <= 90) return 5;
  return 0;
};

const resolveAlertLevel = (score) => {
  if (score >= 90) return 'critical';
  if (score >= 70) return 'alert';
  if (score >= 45) return 'watch';
  return 'low';
};

const computeMentionScore = ({ title, snippet, sourceUrl, keyword, brandTerms, publishedAt }) => {
  const haystackTitle = normalizeKeyword(title);
  const haystackSnippet = normalizeKeyword(snippet);
  const brandMeta = applyBrandTermScore(brandTerms, haystackTitle, haystackSnippet, sourceUrl);
  const keywordScore = applyKeywordScore(keyword, haystackTitle, haystackSnippet);
  const recencyScore = applyRecencyScore(publishedAt);
  const cappedScore = Math.max(0, Math.min(100, brandMeta.score + keywordScore + recencyScore));

  return {
    mentionScore: cappedScore,
    alertLevel: resolveAlertLevel(cappedScore),
    isBrandMention: brandMeta.hasBrand,
    isStrongBrandMention: brandMeta.hasStrongBrand
  };
};

const fetchMentionsForPair = async ({ platform, domain, query, matchedKeyword, perQueryLimit }) => {
  const bingUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&setlang=en-gb`;
  const bingResponse = await fetch(bingUrl, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; AI-GEO-Audit/mentions-baseline)' }
  });
  if (!bingResponse.ok) {
    throw new Error(`Bing RSS failed (${platform}:${matchedKeyword}) HTTP ${bingResponse.status}`);
  }
  const xml = await bingResponse.text();
  const bingItems = parseBingRssItems(xml);

  const ddgUrl = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  let ddgItems = [];
  try {
    const ddgResponse = await fetch(ddgUrl, {
      headers: { 'user-agent': 'Mozilla/5.0 (compatible; AI-GEO-Audit/mentions-baseline)' }
    });
    if (ddgResponse.ok) {
      const html = await ddgResponse.text();
      ddgItems = parseDuckDuckGoItems(html);
    }
  } catch (err) {
    console.warn('[mentions] duckduckgo fetch failed:', err.message);
  }

  const items = uniq([...bingItems, ...ddgItems].map((item) => JSON.stringify(item)))
    .map((value) => JSON.parse(value))
    .filter((item) => hostMatchesDomain(extractHostname(item.link), domain))
    .slice(0, perQueryLimit);
  return items.map((item) => ({
    platform,
    sourceDomain: extractHostname(item.link) || domain,
    sourceUrl: item.link,
    title: item.title,
    snippet: item.snippet,
    publishedAt: asIsoOrNull(item.publishedAt),
    matchedKeyword
  }));
};

export const collectMentionCandidates = async ({
  keywords,
  keywordLimit = DEFAULT_KEYWORD_LIMIT,
  perQueryLimit = DEFAULT_PER_QUERY_LIMIT,
  concurrency = DEFAULT_CONCURRENCY,
  brandTerms = DEFAULT_BRAND_TERMS,
  propertyUrl = ''
}) => {
  const normalizedKeywords = uniq((keywords || []).map(normalizeKeyword).filter(Boolean));
  const fallbackTerms = normalizedKeywords.slice(0, Math.max(1, Number(keywordLimit || DEFAULT_KEYWORD_LIMIT)));
  const discoveryTerms = buildDiscoveryTerms(brandTerms, propertyUrl);
  const keywordsUsed = discoveryTerms.length ? discoveryTerms : fallbackTerms;
  const pairs = buildPlatformSearchPairs(keywordsUsed, perQueryLimit);

  const rawMentions = await runWithConcurrency(pairs, concurrency, async (pair) => {
    try {
      return await fetchMentionsForPair(pair);
    } catch (err) {
      console.warn('[mentions] pair fetch failed:', err.message);
      return [];
    }
  });

  const deduped = new Map();
  for (const row of rawMentions) {
    if (!row?.sourceUrl) continue;
    const host = extractHostname(row.sourceUrl);
    const derivedPlatform = derivePlatformFromHost(host);
    if (!derivedPlatform) continue;
    const key = `${derivedPlatform}|${normalizeUrlForKey(row.sourceUrl)}`;
    const existing = deduped.get(key);
    const scoreMeta = computeMentionScore({
      title: row.title,
      snippet: row.snippet,
      sourceUrl: row.sourceUrl,
      keyword: row.matchedKeyword,
      brandTerms,
      publishedAt: row.publishedAt
    });
    if (!scoreMeta.isStrongBrandMention) continue;
    if (!existing) {
      deduped.set(key, buildMentionSeed({ row, host, platform: derivedPlatform, scoreMeta }));
      continue;
    }

    deduped.set(key, mergeMentionRows(existing, row, scoreMeta));
  }

  const mentions = [...deduped.values()];
  const platformBreakdown = mentions.reduce((acc, row) => {
    const key = row.platform || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  return {
    keywordsUsed,
    mentions,
    platformBreakdown
  };
};
