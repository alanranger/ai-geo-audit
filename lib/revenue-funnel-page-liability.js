/**
 * Page-liability scanner — detects on-page issues that ADD-style
 * recommendations would silently paper over.
 *
 * Pure functions. Inputs are plain HTML strings + an optional
 * bodyText snippet (first ~150 words of stripped body). No DB, no HTTP.
 *
 * Detects (2026-05-26):
 *   - fluffy opener  : rhetorical question or aspirational-marketing
 *     intro with no concrete facts in the first ~90 words
 *   - unsourced stats: numeric claims ("30% of UK adults…") with no
 *     citation tag, link, or "(Source: …)" parenthetical nearby
 *   - weak outbound  : outbound links to low-authority / non-recognised
 *     domains being treated as citations
 *   - duplicate claim: the same numeric claim repeated 2+ times in the
 *     page body (sign of copy-paste padding)
 *
 * Emits REMEDIATE tasks via the recommendation engine.
 */

const RHETORICAL_OPENERS = /^[^.?!]{0,40}\?/;
const ASPIRATIONAL_WORDS = /\b(ready|capture|discover|unlock|journey|passion|dream|transform|elevate|unleash|inspire|imagine|world through|your lens)\b/gi;
const CONCRETE_FACT_TOKENS = /(\u00a3|\$|\beur\b|\bgbp\b|\b\d{1,4}\s?(weeks?|months?|years?|hours?|sessions?|levels?|students?|people)\b|\b(coventry|warwickshire|midlands|leamington|kenilworth|rugby)\b|\b(beginner|intermediate|advanced|all levels)\b|\b(one[\s-]to[\s-]one|1[\s-]to[\s-]1|1[\s-]2[\s-]1|group|in[\s-]person|online)\b)/i;

const ADJECTIVE_DENSITY_THRESHOLD = 0.10;
const ADJECTIVES_SAMPLE = /\b(beautiful|stunning|amazing|incredible|wonderful|magical|breathtaking|extraordinary|exceptional|outstanding|perfect|ultimate|essential|complete|comprehensive|expert|professional|trusted|leading|premier|award[\s-]winning)\b/gi;

// Known low-authority / non-recognised citation domains. Anything not in
// the recognised allowlist is treated as weak when used as a citation
// target. List is intentionally short — extend as more get flagged.
const WEAK_CITATION_DOMAINS = [
  'allbachelordegrees.com',
  'wikihow.com',
  'ehow.com',
  'answers.com'
];
const RECOGNISED_AUTHORITIES = [
  'rps.org', 'royalphotographicsociety',
  'bhphotovideo.com', 'bandhphotovideo',
  'dpreview.com',
  'cipa.jp',
  'gov.uk', '.gov',
  'bbc.co.uk', 'bbc.com',
  'theguardian.com', 'nytimes.com',
  '.edu', '.ac.uk',
  'nature.com', 'sciencedaily.com',
  'photographylife.com', 'fstoppers.com'
];

function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstNWords(text, n) {
  if (!text) return '';
  const words = String(text).split(/\s+/).filter(Boolean);
  return words.slice(0, n).join(' ');
}

function countMatches(text, regex) {
  if (!text) return 0;
  const matches = String(text).match(regex);
  return matches ? matches.length : 0;
}

/**
 * Score the page's opener for "fluffiness". Returns:
 *   { isFluffy: bool, signals: string[], score: 0..1, sample: string }
 */
export function detectFluffyOpener(bodyText) {
  const sample = firstNWords(bodyText, 90);
  if (!sample) return { isFluffy: false, signals: ['no_body_text'], score: 0, sample: '' };
  const signals = [];
  if (RHETORICAL_OPENERS.test(sample)) signals.push('rhetorical_question_open');
  const aspirational = countMatches(sample, ASPIRATIONAL_WORDS);
  if (aspirational >= 2) signals.push(`aspirational_words_${aspirational}`);
  const adjectives = countMatches(sample, ADJECTIVES_SAMPLE);
  const words = Math.max(1, sample.split(/\s+/).filter(Boolean).length);
  const density = adjectives / words;
  if (density >= ADJECTIVE_DENSITY_THRESHOLD) signals.push(`adjective_density_${density.toFixed(2)}`);
  const hasFacts = CONCRETE_FACT_TOKENS.test(sample);
  if (!hasFacts) signals.push('no_concrete_facts');
  const isFluffy = signals.length >= 2 && !hasFacts;
  const score = Math.min(1, signals.length / 4);
  return { isFluffy, signals, score, sample };
}

/**
 * Convenience wrapper that takes raw HTML and runs detectFluffyOpener
 * on the stripped body snippet.
 */
export function detectFluffyOpenerFromHtml(html) {
  return detectFluffyOpener(stripHtml(html));
}

const NUMERIC_CLAIM_RE = /(\b\d{1,3}\s?(?:%|per\s?cent|percent)\b[^.?!]{5,120}[.?!])/gi;
const CITATION_NEAR = /(\bsource\b|\baccording to\b|\bcited\b|\[\d+\]|\(\s*source\s*:|\bons\b|\bgov\.uk\b|\.edu\b|\.ac\.uk\b)/i;

/**
 * Find numeric statistical claims ("30% of UK adults…") that have no
 * citation tag within ~150 characters. Each entry includes a `count`
 * field summing repetitions of the same claim across the page.
 */
export function detectUnsourcedStats(html) {
  const text = stripHtml(html);
  if (!text) return [];
  const seen = new Map();
  let m;
  NUMERIC_CLAIM_RE.lastIndex = 0;
  while ((m = NUMERIC_CLAIM_RE.exec(text)) !== null) {
    const claim = (m[1] || '').trim();
    if (!claim) continue;
    const idx = m.index;
    const window = text.slice(Math.max(0, idx - 80), Math.min(text.length, idx + claim.length + 80));
    if (CITATION_NEAR.test(window)) continue;
    const key = claim.toLowerCase().replace(/\s+/g, ' ');
    if (!seen.has(key)) seen.set(key, { snippet: claim, count: 0 });
    seen.get(key).count += 1;
  }
  return Array.from(seen.values());
}

const HREF_RE = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

function hostnameFromUrl(raw) {
  if (!raw) return '';
  try {
    return new URL(raw, 'https://www.alanranger.com').hostname.toLowerCase();
  } catch {
    return String(raw).toLowerCase();
  }
}

function isWeakDomain(host) {
  const h = host || '';
  return WEAK_CITATION_DOMAINS.some(d => h.includes(d));
}

function isRecognisedDomain(host) {
  const h = host || '';
  return RECOGNISED_AUTHORITIES.some(d => h.includes(d));
}

/**
 * Find outbound <a> tags pointing to low-authority domains. The matcher
 * only flags WEAK_CITATION_DOMAINS hits today; later we can extend this
 * to flag ANY outbound that isn't in RECOGNISED_AUTHORITIES if the link
 * sits inside a "(source: …)" / "according to …" context.
 */
export function detectWeakOutboundCitations(html) {
  if (!html) return [];
  const out = [];
  const seen = new Set();
  let m;
  HREF_RE.lastIndex = 0;
  while ((m = HREF_RE.exec(html)) !== null) {
    const href = (m[1] || '').trim();
    const host = hostnameFromUrl(href);
    if (!host || host.endsWith('alanranger.com')) continue;
    if (!isWeakDomain(host)) continue;
    const anchor = stripHtml(m[2] || '').slice(0, 80);
    const key = `${host}|${anchor}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ domain: host, anchor, href, recognised: isRecognisedDomain(host) });
  }
  return out;
}

/**
 * Same numeric claim ("30% of UK adults") repeated 2+ times across the
 * page body. Indicates copy-paste padding or unintentional duplication.
 */
export function detectDuplicateClaims(html) {
  const stats = detectUnsourcedStats(html);
  return stats.filter(s => s.count >= 2);
}

/**
 * Aggregate scanner. Caller passes raw HTML once and gets back every
 * liability type the engine knows how to emit a REMEDIATE task for.
 */
export function scanLiabilities(html, bodyTextOverride) {
  const bodyText = bodyTextOverride || stripHtml(html);
  const fluffy = detectFluffyOpener(bodyText);
  const stats = detectUnsourcedStats(html);
  const weakCitations = detectWeakOutboundCitations(html);
  const duplicates = detectDuplicateClaims(html);
  return {
    fluffy,
    unsourced_stats: stats,
    weak_citations: weakCitations,
    duplicate_claims: duplicates,
    has_any_liability: fluffy.isFluffy
      || stats.length > 0
      || weakCitations.length > 0
      || duplicates.length > 0
  };
}
