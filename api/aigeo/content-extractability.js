import { safeJsonParse } from './utils.js';
import { fetchCanonicalSiteUrlList } from './canonical-site-urls.js';
import {
  fetchTierSegmentationEntries,
  normalizeTierInput as normalizeSharedTierInput,
  getTierForUrlFromLookup,
  filterTierEntriesByTier,
  countTierEntries,
  buildTierLookupFromEntries
} from './tier-segmentation.js';

const TIER_SEGMENTATION_SOURCES = [
  'https://raw.githubusercontent.com/alanranger/alan-shared-resources/main/csv/page%20segmentation%20by%20tier.csv',
  'https://raw.githubusercontent.com/alanranger/alan-shared-resources/master/csv/page%20segmentation%20by%20tier.csv'
];
const DEFAULT_SITE_ORIGIN = 'https://www.alanranger.com';
const MEMBER_UTILITY_PATH_PATTERNS = [
  /^\/academy\/login(?:\/|$)/i,
  /^\/academy\/trial-expired(?:\/|$)/i,
  /^\/academy\/robo-ranger(?:\/|$)/i
];
const INDEX_HUB_PATH_PATTERNS = [
  /^\/photography-news-blog(?:\/|$)/i
];

function parsePositiveInt(value) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

function normalizeTierInput(value) {
  return normalizeSharedTierInput(value, 'all');
}

function normalizeUrlPath(url) {
  try {
    return new URL(String(url || '')).pathname.toLowerCase();
  } catch {
    return '';
  }
}

function getPreflightExclusionReason(url) {
  const path = normalizeUrlPath(url);
  if (!path) return '';
  if (MEMBER_UTILITY_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
    return 'Member/login utility page (excluded from actionable extractability scope)';
  }
  if (INDEX_HUB_PATH_PATTERNS.some((pattern) => pattern.test(path))) {
    return 'Index/hub page (excluded from money-page extractability scope)';
  }
  return '';
}

function extractNoindexSignals(response, html = '') {
  const xRobotsRaw = String(response?.headers?.get?.('x-robots-tag') || '').toLowerCase();
  const hasXRobotsNoindex = /\bnoindex\b/i.test(xRobotsRaw);
  const metaRobotsMatch = String(html || '').match(/<meta[^>]*name=["']robots["'][^>]*content=["']([^"']+)["'][^>]*>/i);
  const metaRobotsRaw = String(metaRobotsMatch?.[1] || '');
  const hasMetaRobotsNoindex = /\bnoindex\b/i.test(metaRobotsRaw);
  return {
    hasNoindex: hasXRobotsNoindex || hasMetaRobotsNoindex,
    xRobotsTag: xRobotsRaw,
    metaRobots: metaRobotsRaw
  };
}

function tierKeyFromHeader(header) {
  const h = String(header || '').toLowerCase();
  if (h.includes('tier a') || h.includes('landing')) return 'landing';
  if (h.includes('tier b') || h.includes('product')) return 'product';
  if (h.includes('tier c') || h.includes('event')) return 'event';
  if (h.includes('tier d') || h.includes('blog')) return 'blog';
  if (h.includes('tier e') || h.includes('academy')) return 'academy';
  if (h.includes('tier f') || h.includes('unmapped')) return 'unmapped';
  return null;
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

function normalizeSourceUrl(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';
  if (value === '/') {
    return `${DEFAULT_SITE_ORIGIN}/`;
  }
  if (!/^https?:\/\//i.test(value)) return '';
  try {
    const parsed = new URL(value);
    const pathname = String(parsed.pathname || '/').replaceAll(/\/{2,}/g, '/');
    const normalizedPath = pathname.length > 1 ? pathname.replace(/\/+$/, '') : '/';
    return `${parsed.origin}${normalizedPath}`;
  } catch {
    return '';
  }
}

function getTierForUrl(url, tierLookup = null) {
  return getTierForUrlFromLookup(url, tierLookup);
}

function filterUrlsByTier(entries, tier) {
  const filtered = filterTierEntriesByTier(entries, tier);
  return filtered.map((entry) => entry.url);
}

function countUrlsByTier(entries = []) {
  return countTierEntries(entries);
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

async function parseTierSegmentationEntries(options = {}) {
  return fetchTierSegmentationEntries(options);
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
    const raw = String(match[1] || '').trim();
    const parsed = safeJsonParse(raw) || safeJsonParse(decodeBasicHtmlEntities(raw));
    if (!parsed) continue;
    if (Array.isArray(parsed)) blocks.push(...parsed);
    else blocks.push(parsed);
  }
  return blocks;
}

function hasDeferredFaqLoaderSignal(html = '') {
  const source = String(html || '');
  // Support both literal FAQ JSON URLs and dynamic loader construction patterns.
  return (
    /\/[a-z0-9._\-/]*_faq\.json(?:["'?#&]|$)/i.test(source)
    || /_faq\.json["'`]/i.test(source)
    || /const\s+faqUrl\s*=.*_faq\.json/i.test(source)
    || /fetch\(\s*faqUrl\s*\)/i.test(source)
  );
}

function hasManifestFaqLoaderSignal(html = '', pageUrl = '') {
  const source = String(html || '');
  const currentUrl = String(pageUrl || '').toLowerCase();
  const isEventPage = /\/(?:beginners-photography-lessons|photographic-workshops-near-me)\//i.test(currentUrl);
  if (!isEventPage) return false;
  // Detect manifest-driven event loader variants that resolve FAQ file names at runtime.
  const hasManifestRef = /events-manifest\.json/i.test(source);
  const hasFaqRuntimePattern = /(faqFileName|faqUrl|shouldSkipExternalFaq|fetch\(\s*faqUrl\s*\))/i.test(source);
  return hasManifestRef && hasFaqRuntimePattern;
}

function hasDeferredTldrLoaderSignal(html = '') {
  const source = String(html || '');
  // Detect common deferred TLDR loader patterns used in global script injectors.
  return (
    /injectTldrBlock\s*\(/i.test(source)
    || /hasExistingTldrSignal\s*\(/i.test(source)
    || /id\s*=\s*["']ar-tldr-block["']/i.test(source)
    || /textContent\s*=\s*["']TLDR["']/i.test(source)
  );
}

function extractSnippetLoaderTargets(html = '', baseUrl = '') {
  const targets = [];
  const tagRegex = /<[^>]*data-m-plugin=["']load["'][^>]*>/gi;
  const tags = html.match(tagRegex) || [];
  tags.forEach((tag) => {
    const targetMatch = /data-target=["']([^"']+)["']/i.exec(tag);
    if (!targetMatch?.[1]) return;
    const rawTarget = String(targetMatch[1]).trim();
    if (!rawTarget) return;
    let absoluteTarget = rawTarget;
    try {
      absoluteTarget = new URL(rawTarget, baseUrl).toString();
    } catch {
      absoluteTarget = rawTarget;
    }
    if (!targets.includes(absoluteTarget)) targets.push(absoluteTarget);
  });
  return targets.slice(0, 6);
}

async function fetchHtmlText(url, timeoutMs = 10000) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AI-GEO-Audit/1.0; +https://ai-geo-audit.vercel.app)' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) return '';
  return response.text();
}

async function enrichHtmlWithSnippetLoaderContent(pageUrl, html = '') {
  const snippetTargets = extractSnippetLoaderTargets(html, pageUrl);
  if (!snippetTargets.length) return html;

  const parts = [String(html || '')];
  for (const targetUrl of snippetTargets) {
    try {
      const snippetHtml = await fetchHtmlText(targetUrl, 8000);
      if (snippetHtml?.trim()) parts.push(snippetHtml);
    } catch {
      // Ignore snippet fetch errors for resilience.
    }
  }
  return parts.join('\n');
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

function evaluateExtractability(html, jsonLdBlocks = [], pageUrl = '') {
  const checks = {
    hasTldr: false,
    hasDirectAnswer: false,
    hasFaq: false,
    hasLastUpdated: false
  };

  const headingTldrRegex = /<h[1-4][^>]*>\s*(?:tl;?\s*dr|tldr|summary|quick answer)\s*<\/h[1-4]>/i;
  const hasDeferredTldrLoader = hasDeferredTldrLoaderSignal(html);
  checks.hasTldr = headingTldrRegex.test(html) || /\btl;?\s*dr\b/i.test(html) || hasDeferredTldrLoader;

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
  const hasFaqHeading = /<h[1-4][^>]*>\s*(?:faqs?|frequently\s+asked\s+questions)\s*<\/h[1-4]>/i.test(html);
  const hasDeferredFaqLoader = hasDeferredFaqLoaderSignal(html);
  const hasManifestFaqLoader = hasManifestFaqLoaderSignal(html, pageUrl);
  checks.hasFaq = hasFaqFromSchema || questionHeadings >= 2 || hasFaqHeading || hasDeferredFaqLoader || hasManifestFaqLoader;

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

function plainTextFromHtmlFragment(fragment = '') {
  return decodeBasicHtmlEntities(
    String(fragment || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

function normalizeSeoSnippetText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Meta description: support name= before content= OR content= before name= (common on Squarespace). */
function extractMetaDescriptionFromHtml(html = '') {
  const source = String(html || '');
  let m = source.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/is);
  if (m?.[1]) return normalizeSeoSnippetText(decodeBasicHtmlEntities(m[1]));
  m = source.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/is);
  if (m?.[1]) return normalizeSeoSnippetText(decodeBasicHtmlEntities(m[1]));
  m = source.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/is);
  if (m?.[1]) return normalizeSeoSnippetText(decodeBasicHtmlEntities(m[1]));
  m = source.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:description["']/is);
  return m?.[1] ? normalizeSeoSnippetText(decodeBasicHtmlEntities(m[1])) : '';
}

/** Counts used by Traditional SEO dashboard (H1, images, outbound links). */
function analyzeTraditionalSeoHtmlSignals(html = '', pageUrl = '') {
  const out = {
    h1Count: 0,
    firstH1PlainLength: 0,
    longestH1PlainLength: 0,
    metaDescription: '',
    imgTotal: 0,
    imgMissingAlt: 0,
    extOutboundCount: 0,
    extMissingTargetBlank: 0
  };
  const source = String(html || '');
  out.metaDescription = extractMetaDescriptionFromHtml(source);
  const h1Matches = [...source.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  out.h1Count = h1Matches.length;
  let longest = 0;
  h1Matches.forEach((match) => {
    const len = plainTextFromHtmlFragment(match[1]).length;
    if (len > longest) longest = len;
  });
  out.longestH1PlainLength = longest;
  if (h1Matches[0]) out.firstH1PlainLength = plainTextFromHtmlFragment(h1Matches[0][1]).length;

  const imgMatches = [...source.matchAll(/<img\b[^>]*>/gi)];
  imgMatches.forEach((match) => {
    const tag = match[0];
    out.imgTotal += 1;
    const altMatch = /\balt\s*=\s*["']([^"']*)["']/i.exec(tag);
    const altVal = altMatch ? String(altMatch[1]).trim() : '';
    if (!altVal) out.imgMissingAlt += 1;
  });

  let pageHost = '';
  try {
    pageHost = new URL(String(pageUrl || '').trim()).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    pageHost = '';
  }
  const anchorMatches = [...source.matchAll(/<a\b([^>]*)>/gi)];
  anchorMatches.forEach((match) => {
    const inner = match[1] || '';
    const hrefMatch = /\bhref\s*=\s*["']([^"']+)["']/i.exec(inner);
    if (!hrefMatch) return;
    const rawHref = String(hrefMatch[1] || '').trim();
    if (!rawHref || rawHref.startsWith('#') || /^javascript:/i.test(rawHref)) return;
    let absUrl;
    try {
      absUrl = new URL(rawHref, pageUrl);
    } catch {
      return;
    }
    const host = absUrl.hostname.replace(/^www\./i, '').toLowerCase();
    if (!host || !pageHost || host === pageHost) return;
    out.extOutboundCount += 1;
    if (!/\btarget\s*=\s*["']?_blank["']?/i.test(inner)) out.extMissingTargetBlank += 1;
  });
  return out;
}

async function checkUrl(url, tierLookup = null) {
  const seoNone = {
    seoH1Count: 0,
    seoFirstH1Length: 0,
    seoLongestH1Length: 0,
    seoMetaDescription: '',
    seoImgTotal: 0,
    seoImgMissingAlt: 0,
    seoExtOutbound: 0,
    seoExtMissingTargetBlank: 0
  };
  const pageTier = getTierForUrl(url, tierLookup);
  const preflightExclusionReason = getPreflightExclusionReason(url);
  if (preflightExclusionReason) {
    return {
      url,
      pageTier,
      requestOk: true,
      statusCode: null,
      errorType: null,
      pass: true,
      score: 100,
      hasTldr: false,
      hasDirectAnswer: false,
      hasFaq: false,
      hasLastUpdated: false,
      issues: [],
      excludedFromAudit: true,
      exclusionReason: preflightExclusionReason,
      ...seoNone
    };
  }
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AI-GEO-Audit/1.0; +https://ai-geo-audit.vercel.app)' },
      signal: AbortSignal.timeout(10000)
    });
    if (!response.ok) {
      let errorType = 'HTTP Error';
      if (response.status === 429) {
        errorType = 'Rate Limited';
      } else if (response.status >= 500) {
        errorType = 'Server Error';
      }
      return {
        url,
        pageTier,
        requestOk: false,
        statusCode: response.status,
        errorType,
        pass: false,
        score: 0,
        hasTldr: false,
        hasDirectAnswer: false,
        hasFaq: false,
        hasLastUpdated: false,
        issues: [`HTTP ${response.status}: ${response.statusText}`],
        ...seoNone
      };
    }
    const html = await response.text();
    const noindexSignals = extractNoindexSignals(response, html);
    if (noindexSignals.hasNoindex) {
      return {
        url,
        pageTier,
        requestOk: true,
        statusCode: response.status,
        errorType: null,
        pass: true,
        score: 100,
        hasTldr: false,
        hasDirectAnswer: false,
        hasFaq: false,
        hasLastUpdated: false,
        issues: [],
        excludedFromAudit: true,
        exclusionReason: 'Meta/X-Robots noindex page (excluded from actionable extractability scope)',
        xRobotsTag: noindexSignals.xRobotsTag || '',
        metaRobots: noindexSignals.metaRobots || '',
        ...seoNone
      };
    }
    const htmlForChecks = await enrichHtmlWithSnippetLoaderContent(url, html);
    const jsonLdBlocks = findJsonLdBlocks(htmlForChecks);
    const result = evaluateExtractability(htmlForChecks, jsonLdBlocks, url);
    const plainText = stripHtmlToText(htmlForChecks);
    const seoMain = analyzeTraditionalSeoHtmlSignals(html, url);
    const seoMerged = analyzeTraditionalSeoHtmlSignals(htmlForChecks, url);
    const useMainH1 = seoMain.h1Count > 0;
    const seo = {
      h1Count: useMainH1 ? seoMain.h1Count : seoMerged.h1Count,
      firstH1PlainLength: useMainH1 ? seoMain.firstH1PlainLength : seoMerged.firstH1PlainLength,
      longestH1PlainLength: useMainH1 ? seoMain.longestH1PlainLength : seoMerged.longestH1PlainLength,
      metaDescription: seoMain.metaDescription || seoMerged.metaDescription || '',
      imgTotal: seoMerged.imgTotal,
      imgMissingAlt: seoMerged.imgMissingAlt,
      extOutboundCount: seoMerged.extOutboundCount,
      extMissingTargetBlank: seoMerged.extMissingTargetBlank
    };
    return {
      url,
      pageTier,
      requestOk: true,
      statusCode: response.status,
      errorType: null,
      pass: result.pass,
      score: result.score,
      hasTldr: result.hasTldr,
      hasDirectAnswer: result.hasDirectAnswer,
      hasFaq: result.hasFaq,
      hasLastUpdated: result.hasLastUpdated,
      issues: result.issues || [],
      textLength: plainText.length,
      excludedFromAudit: false,
      exclusionReason: '',
      seoH1Count: seo.h1Count,
      seoFirstH1Length: seo.firstH1PlainLength,
      seoLongestH1Length: seo.longestH1PlainLength,
      seoMetaDescription: seo.metaDescription || '',
      seoImgTotal: seo.imgTotal,
      seoImgMissingAlt: seo.imgMissingAlt,
      seoExtOutbound: seo.extOutboundCount,
      seoExtMissingTargetBlank: seo.extMissingTargetBlank
    };
  } catch (error) {
    return {
      url,
      pageTier,
      requestOk: false,
      statusCode: null,
      errorType: 'Request Error',
      pass: false,
      score: 0,
      hasTldr: false,
      hasDirectAnswer: false,
      hasFaq: false,
      hasLastUpdated: false,
      issues: [error?.message || 'Request failed'],
      excludedFromAudit: false,
      exclusionReason: '',
      ...seoNone
    };
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class Semaphore {
  constructor(max) {
    this.max = max;
    this.current = 0;
    this.queue = [];
  }

  async acquire() {
    return new Promise((resolve) => {
      if (this.current < this.max) {
        this.current += 1;
        resolve();
      } else {
        this.queue.push(resolve);
      }
    });
  }

  release() {
    this.current -= 1;
    if (this.queue.length > 0) {
      this.current += 1;
      const next = this.queue.shift();
      next();
    }
  }
}

async function checkUrlWithPacing(url, semaphore, delayAfterMs = 0, tierLookup = null) {
  await semaphore.acquire();
  try {
    const result = await checkUrl(url, tierLookup);
    if (delayAfterMs > 0) await delay(delayAfterMs);
    return result;
  } finally {
    semaphore.release();
  }
}

function filterUrlListByTier(urls, tier, tierLookup) {
  const normalizedTier = normalizeSharedTierInput(tier, 'all');
  const safe = Array.isArray(urls) ? urls : [];
  if (normalizedTier === 'all') return safe;
  return safe.filter((u) => (
    normalizeSharedTierInput(getTierForUrlFromLookup(u, tierLookup), 'unmapped') === normalizedTier
  ));
}

function countTierForUrlList(urls, tierLookup) {
  const counts = {
    all: 0,
    landing: 0,
    product: 0,
    event: 0,
    blog: 0,
    academy: 0,
    unmapped: 0
  };
  const safe = Array.isArray(urls) ? urls : [];
  counts.all = safe.length;
  safe.forEach((u) => {
    const t = normalizeSharedTierInput(getTierForUrlFromLookup(u, tierLookup), 'unmapped');
    if (Object.hasOwn(counts, t)) counts[t] += 1;
    else counts.unmapped += 1;
  });
  return counts;
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
    let body = {};
    if (req.method === 'POST') {
      try {
        if (typeof req.body === 'string') body = JSON.parse(req.body);
        else if (req.body && typeof req.body === 'object') body = req.body;
      } catch {
        body = {};
      }
    }
    const bodyUrls = Array.isArray(body.urls)
      ? body.urls.map((u) => String(u || '').trim()).filter((u) => /^https?:\/\//i.test(u))
      : [];
    const explicitUrls = bodyUrls.slice(0, 25);

    const query = req.query || {};
    const modeFromBody = String(body.mode || '').toLowerCase() === 'full' ? 'full' : '';
    const modeFromQuery = String(query.mode || 'sample').toLowerCase() === 'full' ? 'full' : 'sample';
    const mode = explicitUrls.length > 0 ? 'full' : (modeFromBody || modeFromQuery);
    const limit = parsePositiveInt(query.limit ?? body.limit);
    const tier = normalizeTierInput(query.tier ?? body.tier);
    const countsOnly = parseBoolean(query.countsOnly);
    const refreshTierSource = parseBoolean(query.refreshTierSource);
    const tierSnapshotKey = String(query.tierSnapshotKey || '').trim();
    const tierCacheTtlMs = parsePositiveInt(query.tierCacheTtlMs);
    const tierEntries = await parseTierSegmentationEntries({
      forceRefresh: refreshTierSource,
      snapshotKey: tierSnapshotKey,
      cacheTtlMs: tierCacheTtlMs
    });
    const tierLookup = buildTierLookupFromEntries(tierEntries);
    const canonicalUrls = await fetchCanonicalSiteUrlList({ forceRefresh: refreshTierSource });
    const urls = canonicalUrls.length > 0 ? canonicalUrls : tierEntries.map((entry) => entry.url);
    const usedCanonical06 = canonicalUrls.length > 0;
    const sourceTierCounts = usedCanonical06
      ? countTierForUrlList(urls, tierLookup)
      : countUrlsByTier(tierEntries);
    const tierScopedUrls = usedCanonical06
      ? filterUrlListByTier(urls, tier, tierLookup)
      : filterUrlsByTier(tierEntries, tier);
    let selectedUrls = selectUrlsForMode(tierScopedUrls, mode, limit);
    if (explicitUrls.length > 0) {
      selectedUrls = explicitUrls;
    }
    if (countsOnly) {
      return res.status(200).json({
        status: 'ok',
        source: 'content-extractability',
        data: {
          mode,
          tier,
          pagesChecked: 0,
          passPages: 0,
          failPages: 0,
          passRate: 0,
          avgScore: 0,
          counts: {
            hasTldr: 0,
            hasDirectAnswer: 0,
            hasFaq: 0,
            hasLastUpdated: 0
          },
          sourceTierCounts,
          rows: []
        },
        meta: {
          generatedAt: new Date().toISOString(),
          selection: {
            mode,
            tier,
            countsOnly: true,
            inputUrlCount: urls.length,
            candidateUrlCount: tierScopedUrls.length,
            selectedUrlCount: 0,
            limit: limit || null
          }
        }
      });
    }
    if (!selectedUrls.length) {
      return res.status(400).json({
        status: 'error',
        source: 'content-extractability',
        message: 'No URLs found in source CSV.',
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    const initialSemaphore = new Semaphore(2);
    const delayBetweenRequests = 300;
    let results = await Promise.all(selectedUrls.map((url) => checkUrlWithPacing(url, initialSemaphore, delayBetweenRequests, tierLookup)));

    const retryCandidates = results.filter((row) => row.requestOk === false);
    if (retryCandidates.length > 0) {
      const hasRateLimited = retryCandidates.some((row) => row.errorType === 'Rate Limited');
      await delay(hasRateLimited ? 8000 : 2500);
      const retrySemaphore = new Semaphore(1);
      const retryResults = await Promise.all(retryCandidates.map(async (row) => {
        if (row.errorType === 'Rate Limited') {
          await delay(1500);
        }
        return checkUrlWithPacing(row.url, retrySemaphore, 800, tierLookup);
      }));
      const retryMap = new Map(retryResults.map((row) => [row.url, row]));
      results = results.map((row) => retryMap.get(row.url) || row);
    }
    const excludedRows = results.filter((row) => row?.excludedFromAudit);
    const includedRows = results.filter((row) => !row?.excludedFromAudit);
    const checkedPages = includedRows.length;
    const passPages = includedRows.filter((row) => row.pass).length;
    const passRate = checkedPages > 0 ? Math.round((passPages / checkedPages) * 100) : 0;
    const avgScore = checkedPages > 0
      ? Math.round(includedRows.reduce((acc, row) => acc + Number(row.score || 0), 0) / checkedPages)
      : 0;
    const counts = {
      hasTldr: includedRows.filter((row) => row.hasTldr).length,
      hasDirectAnswer: includedRows.filter((row) => row.hasDirectAnswer).length,
      hasFaq: includedRows.filter((row) => row.hasFaq).length,
      hasLastUpdated: includedRows.filter((row) => row.hasLastUpdated).length
    };

    const rowsPayload = explicitUrls.length > 0 ? results : includedRows;

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
        excludedByPolicyCount: excludedRows.length,
        excludedByPolicy: excludedRows.map((row) => ({
          url: row.url,
          pageTier: row.pageTier,
          exclusionReason: row.exclusionReason || ''
        })),
        rows: rowsPayload
      },
      meta: {
        generatedAt: new Date().toISOString(),
        selection: {
          mode,
          tier,
          inputUrlCount: urls.length,
          candidateUrlCount: tierScopedUrls.length,
          selectedUrlCount: selectedUrls.length,
          excludedByPolicyCount: excludedRows.length,
          limit: limit || null,
          targetedUrls: explicitUrls.length > 0
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
