// Live page validator
// -------------------------------------------------------------------
// Fetches a public URL at request time and extracts the FACTS that
// downstream recommenders (Top Actions picker, lever scenario engine,
// per-page diagnostic cards) need to validate suggested changes against.
//
// Why this exists
//   The audit table `audit_results.schema_pages_detail` is captured on
//   a crawl schedule and goes stale within hours of any on-page change.
//   It also has a known meta-description capture bug (prefers longest
//   JSON-LD description over the real <meta> tag). Using it as the
//   authoritative source for "what's on this page right now?" produced
//   factually wrong Top-3 Actions cards (see Docs/CHANGELOG.md v5).
//   This module is the live source of truth.
//
// Scope
//   - Real <title> text (first <title> in document <head>)
//   - Real <meta name="description"> content (NOT JSON-LD description)
//   - All JSON-LD @type values inside <script type="application/ld+json">
//     blocks (flat list, deduped; no nesting walk beyond @graph items —
//     that's enough for "does the page have FAQPage / Course / Service?")
//   - Approximate H1 text (first <h1>) for head-term-in-H1 diagnostics
//
// What this does NOT do
//   - Headless / JS-rendered crawling. Squarespace renders the static
//     schema and meta tags server-side, so plain `fetch` is enough for
//     alanranger.com. If we hit a JS-only SPA we fall back to the audit
//     cache with a [stale audit] marker so the caller can flag it.
//   - Schema correctness scoring. That stays in schema-audit.js.
//   - Page-content-quality NLP (word count, readability). Out of scope.
//
// Caching
//   In-memory Map keyed by URL with a default 5-minute TTL. Multiple
//   Top-Actions candidates that resolve to the same URL inside one
//   request only fetch once. Cache survives between requests on the
//   same warm Node instance — short enough that a fresh on-page change
//   becomes visible within 5 min, long enough that repeated dashboard
//   loads don't hammer the live site.

const FETCH_TIMEOUT_MS = 4500;
const CACHE_TTL_MS = 5 * 60 * 1000;
const USER_AGENT = 'AlanRangerAudit/1.0 (+https://ai-geo-audit.vercel.app)';

const _cache = new Map();

function nowMs() { return Date.now(); }

function cacheGet(url) {
  const hit = _cache.get(url);
  if (!hit) return null;
  if (nowMs() - hit.t > CACHE_TTL_MS) {
    _cache.delete(url);
    return null;
  }
  return hit.v;
}
function cacheSet(url, v) {
  _cache.set(url, { v, t: nowMs() });
}

// -------------------------------------------------------------------
// HTML extraction helpers (regex-based, defensively scoped)
// -------------------------------------------------------------------

// Pull the first <title>...</title> from <head>. Tolerates attributes
// on the title tag and whitespace, but does NOT match nested HTML
// (which would be invalid anyway).
function extractTitle(html) {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  return decodeEntities(m[1].replace(/\s+/g, ' ').trim()) || null;
}

// Pull the FIRST <meta name="description" content="..."> on the page.
// We deliberately ignore JSON-LD `description` fields here — that was
// the upstream bug that gave the wrong meta length on the academy hub.
function extractMetaDescription(html) {
  // Try the common attribute orders. Squarespace emits name="description"
  // ahead of content; some pages reverse them.
  const a = /<meta[^>]+name\s*=\s*["']description["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*>/i.exec(html);
  if (a && a[1]) return decodeEntities(a[1].trim()) || null;
  const b = /<meta[^>]+content\s*=\s*["']([^"']*)["'][^>]*name\s*=\s*["']description["'][^>]*>/i.exec(html);
  if (b && b[1]) return decodeEntities(b[1].trim()) || null;
  return null;
}

// First <h1> text, stripped of inner tags. Used for "is the head term
// in the H1?" diagnostic — Squarespace landing pages sometimes have
// the head term in <h2> not <h1>, which IS a real CTR issue.
function extractH1(html) {
  const m = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (!m) return null;
  const stripped = m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return decodeEntities(stripped) || null;
}

// First ~250 words of visible body text. Powers downstream liability
// scanners (fluffy-opener detection, unsourced-stats) without forcing
// them to re-fetch the page.
//
// 2026-05-26: Squarespace renders the main menu as a <nav> followed
// by a long chain of <div> menu containers that the previous regex
// did NOT strip. The result on /photography-courses-coventry was
// `bodyText` reading "Cart 0 Sign In My Account Back photography courses
// coventry Which Photography Courses..." — i.e. the entire site menu.
// The fluffy-opener detector then judged fluffiness on nav text rather
// than the actual page intro.
//
// Fix: prefer the FIRST <main>...</main> region when present (the
// Squarespace article wrapper) and extract bodyText from that. Fall
// back to whole-document stripping only when <main> isn't on the page.
function extractBodyText(html, wordLimit = 250) {
  if (!html) return null;
  const str = String(html);
  // Try <main>...</main>; fall back to <article> or the post-<head>
  // document. Squarespace pages always emit exactly one <main>.
  const mainScope = extractFirstScopedRegion(str, ['main', 'article'])
    || str.replace(/<head[\s\S]*?<\/head>/i, ' ');
  const cleaned = mainScope
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ');
  const decoded = decodeEntities(cleaned).replace(/\s+/g, ' ').trim();
  if (!decoded) return null;
  const words = decoded.split(/\s+/);
  return words.slice(0, wordLimit).join(' ');
}

// Pull out the FIRST matching scoped region (e.g. <main>…</main>) using
// a simple open-tag scan + matching close-tag search. Returns null when
// no scope is found (caller falls back to whole-document handling).
function extractFirstScopedRegion(html, tagNames) {
  for (const tag of tagNames) {
    const open = new RegExp('<' + tag + '\\b[^>]*>', 'i');
    const close = new RegExp('</' + tag + '\\s*>', 'i');
    const o = open.exec(html);
    if (!o) continue;
    const startIdx = o.index + o[0].length;
    const tail = html.slice(startIdx);
    const c = close.exec(tail);
    if (!c) continue;
    return tail.slice(0, c.index);
  }
  return null;
}

// Capped HTML sample around the first <main>/<article> open tag, up
// to 200KB. Used by liability scanners that need raw HTML (link
// detection, unsourced-stat windows).
//
// 2026-05-26: cap raised 60KB -> 200KB after the
// /photography-courses-coventry case. That page's <main> opens at
// position 123KB in the raw HTML and contains BOTH a duplicate "30%"
// stat (at offset 12KB inside <main>) AND an allbachelordegrees.com
// citation (at offset 136KB inside <main>). At the old 60KB cap the
// link detector never saw the allbachelor link and emitted zero
// REMEDIATE tasks. Squarespace HTML routinely sails past 60KB inside
// the article scope; 200KB covers every page tested.
function extractBodyHtmlSnippet(html, capBytes = 200000) {
  if (!html) return null;
  const str = String(html);
  const startMatch = /<(main|article|body)\b/i.exec(str);
  const startIdx = startMatch ? startMatch.index : 0;
  return str.slice(startIdx, startIdx + capBytes);
}

// Find every <script type="application/ld+json"> block, parse each one,
// and return the flat union of @type values found anywhere inside
// (top-level or @graph children). Deduped, sorted for stable display.
function extractJsonLdTypes(html) {
  const out = new Set();
  const blockRe = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let block;
  while ((block = blockRe.exec(html)) !== null) {
    const body = (block[1] || '').trim();
    if (!body) continue;
    try {
      const parsed = JSON.parse(body);
      collectTypes(parsed, out);
    } catch {
      // Some blocks contain JS template literals or comments; fall back
      // to a regex pass that just looks for "@type": "X" strings inside
      // the unparseable block. Catches the common cases.
      const typeRe = /"@type"\s*:\s*"([^"]+)"/g;
      let tm;
      while ((tm = typeRe.exec(body)) !== null) out.add(tm[1]);
    }
  }
  return Array.from(out).sort();
}

// Recursively pluck @type values from a parsed JSON-LD object/array,
// including descent into @graph. Capped at 8 levels of recursion to
// keep complexity bounded.
function collectTypes(node, out, depth = 0) {
  if (!node || depth > 8) return;
  if (Array.isArray(node)) {
    for (const item of node) collectTypes(item, out, depth + 1);
    return;
  }
  if (typeof node !== 'object') return;
  const t = node['@type'];
  if (typeof t === 'string') out.add(t);
  else if (Array.isArray(t)) t.forEach(x => { if (typeof x === 'string') out.add(x); });
  if (Array.isArray(node['@graph'])) {
    for (const g of node['@graph']) collectTypes(g, out, depth + 1);
  }
}

// Minimal HTML-entity decode for the strings we extract. Full DOM
// decoding would need a dependency; the cases we hit in practice are
// numeric refs and a handful of named ones.
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '\u2014', ndash: '\u2013', hellip: '\u2026',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
  copy: '\u00a9', reg: '\u00ae', trade: '\u2122', pound: '\u00a3',
  euro: '\u20ac', deg: '\u00b0'
};
function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : m);
}

// -------------------------------------------------------------------
// Fetch with timeout
// -------------------------------------------------------------------
async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9'
      }
    });
    if (!res.ok) {
      return { ok: false, status: res.status, html: null, error: `http_${res.status}` };
    }
    const html = await res.text();
    return { ok: true, status: res.status, html, error: null };
  } catch (err) {
    const isAbort = err && (err.name === 'AbortError' || /aborted/i.test(String(err.message || '')));
    return { ok: false, status: null, html: null, error: isAbort ? 'timeout' : (err && err.message) || 'fetch_error' };
  } finally {
    clearTimeout(timer);
  }
}

// -------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------
/**
 * Validate one URL. Returns an object with the fields downstream
 * recommenders need, plus a `source` discriminator so the caller can
 * tell live vs. cached vs. fallback at render time.
 *
 * Shape:
 *   {
 *     url,                       // canonical URL fetched
 *     source: 'live' | 'cache' | 'fallback',
 *     fetchedAt: ISO string | null,
 *     title: string | null,
 *     metaDescription: string | null,
 *     h1: string | null,
 *     schemaTypes: string[],
 *     ok: boolean,
 *     error: string | null
 *   }
 */
export async function validateUrlLive(url) {
  if (!url) return makeEmpty(url, 'fallback', 'missing_url');
  const cached = cacheGet(url);
  if (cached) return { ...cached, source: 'cache' };
  const fetched = await fetchHtml(url);
  if (!fetched.ok) {
    // Caller decides whether to fall back to audit data. We return a
    // recognisable empty record so callers can branch on it cleanly.
    return makeEmpty(url, 'fallback', fetched.error);
  }
  const out = {
    url,
    source: 'live',
    fetchedAt: new Date().toISOString(),
    title: extractTitle(fetched.html),
    metaDescription: extractMetaDescription(fetched.html),
    h1: extractH1(fetched.html),
    schemaTypes: extractJsonLdTypes(fetched.html),
    bodyText: extractBodyText(fetched.html),
    bodyHtmlSnippet: extractBodyHtmlSnippet(fetched.html),
    ok: true,
    error: null
  };
  cacheSet(url, out);
  return out;
}

/**
 * Validate up to N URLs in parallel. Used by the Top-Actions picker
 * so a single dashboard render fans out one fetch per pick rather
 * than serial 4-second blocks.
 */
export async function validateUrlsLive(urls) {
  const unique = Array.from(new Set((urls || []).filter(Boolean)));
  if (!unique.length) return new Map();
  const results = await Promise.all(unique.map(u => validateUrlLive(u)));
  const map = new Map();
  for (const r of results) map.set(r.url, r);
  return map;
}

function makeEmpty(url, source, error) {
  return {
    url: url || null,
    source,
    fetchedAt: null,
    title: null,
    metaDescription: null,
    h1: null,
    schemaTypes: [],
    bodyText: null,
    bodyHtmlSnippet: null,
    ok: false,
    error: error || null
  };
}
