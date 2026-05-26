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

// Rhetorical question opening within ~80 chars (allows for slightly
// longer aspirational hooks like "Ready to capture the world through
// your lens?" which is 45 chars).
const RHETORICAL_OPENERS = /^[^.?!]{0,80}\?/;
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

// Strip HTML to plain text. 2026-05-26: aligned with extractBodyText
// in live-page-validator.js — strips <head>, <nav>, <header>, <footer>
// in addition to <script>/<style>, so the resulting body text starts at
// the first content paragraph rather than the document <title> + nav
// links. Without that the fluffy-opener detector was hunting for the
// rhetorical question past the 80-char window when called via
// scanLiabilities(html) without a bodyText override.
function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<head[\s\S]*?<\/head>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ')
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
 *   { isFluffy: bool, signals: string[], score: 0..1, sample: string,
 *     audit_status: 'ok' | 'incomplete', audit_reason?: string }
 *
 * 2026-05-26 fail-loud policy: if there's no body text the function
 * returns `audit_status: 'incomplete'` AND logs a warning. It never
 * silently returns a neutral pass — that previously hid genuine
 * fluffy-opener content from the recommendation engine.
 */
export function detectFluffyOpener(bodyText) {
  const sample = firstNWords(bodyText, 90);
  if (!sample) {
    // eslint-disable-next-line no-console
    console.warn('[page-liability] detectFluffyOpener: no body text supplied — audit incomplete, cannot judge opener.');
    return {
      isFluffy: false, signals: ['no_body_text'], score: 0, sample: '',
      audit_status: 'incomplete', audit_reason: 'no_body_text'
    };
  }
  const signals = [];
  const rhetorical = RHETORICAL_OPENERS.test(sample);
  if (rhetorical) signals.push('rhetorical_question_open');
  const aspirational = countMatches(sample, ASPIRATIONAL_WORDS);
  if (aspirational >= 2) signals.push(`aspirational_words_${aspirational}`);
  if (aspirational >= 5) signals.push('aspirational_high');
  const adjectives = countMatches(sample, ADJECTIVES_SAMPLE);
  const words = Math.max(1, sample.split(/\s+/).filter(Boolean).length);
  const density = adjectives / words;
  if (density >= ADJECTIVE_DENSITY_THRESHOLD) signals.push(`adjective_density_${density.toFixed(2)}`);
  const hasFacts = CONCRETE_FACT_TOKENS.test(sample);
  if (!hasFacts) signals.push('no_concrete_facts');
  // 2026-05-26 calibration: ONE concrete fact ("beginner") shouldn't
  // fully veto a fluffy verdict when the opener is drowning in
  // marketing copy. Verdicts (any is sufficient):
  //   - rhetorical question + ≥3 aspirational words (strong fluffy)
  //   - ≥3 fluffy signals (works for the Coventry-style opener with
  //     "Ready... discover... unleash... unlock..." + concrete tokens)
  //   - ≥2 signals AND no concrete facts (the old gate, still useful
  //     for pages with shorter taglines and no facts)
  const strongFluffy = rhetorical && aspirational >= 3;
  const isFluffy = strongFluffy
    || signals.length >= 3
    || (signals.length >= 2 && !hasFacts);
  const score = Math.min(1, signals.length / 4);
  return { isFluffy, signals, score, sample, audit_status: 'ok' };
}

/**
 * Convenience wrapper that takes raw HTML and runs detectFluffyOpener
 * on the stripped body snippet.
 */
export function detectFluffyOpenerFromHtml(html) {
  return detectFluffyOpener(stripHtml(html));
}

// Numeric claim regex. Notes:
//   - `\b` only used at the START of the digit run. `%` is a non-word
//     char and the trailing `\b` was missing the common "30% of UK" case
//     (no word boundary between `%` and a following space).
//   - Up to ~120 non-terminator chars then a sentence-ending `.`/`?`/`!`.
const NUMERIC_CLAIM_RE = /(\b\d{1,3}\s?(?:%|per\s?cent|percent)[^.?!]{5,120}[.?!])/gi;
const CITATION_NEAR = /(\bsource\b|\baccording to\b|\bcited\b|\[\d+\]|\(\s*source\s*:|\bons\b|\bgov\.uk\b|\.edu\b|\.ac\.uk\b)/i;

/**
 * Find numeric statistical claims ("30% of UK adults…") that have no
 * citation tag within ~150 characters. Each entry includes a `count`
 * field summing repetitions of the same claim across the page.
 *
 * 2026-05-26: empty input is logged + returned as a sentinel
 * `[{ _audit_status: 'incomplete', _audit_reason: 'no_html' }]` so the
 * recommendation engine can surface "scan incomplete" rather than
 * silently emitting zero remediation tasks.
 */
export function detectUnsourcedStats(html) {
  const text = stripHtml(html);
  if (!text) {
    // eslint-disable-next-line no-console
    console.warn('[page-liability] detectUnsourcedStats: no HTML supplied — audit incomplete.');
    return [{ _audit_status: 'incomplete', _audit_reason: 'no_html' }];
  }
  const seen = new Map();
  let m;
  NUMERIC_CLAIM_RE.lastIndex = 0;
  while ((m = NUMERIC_CLAIM_RE.exec(text)) !== null) {
    const claim = (m[1] || '').trim();
    if (!claim) continue;
    const idx = m.index;
    const window = text.slice(Math.max(0, idx - 80), Math.min(text.length, idx + claim.length + 80));
    if (CITATION_NEAR.test(window)) continue;
    // Dedup key = first ~30 chars after normalising whitespace. Two
    // sentences that begin with the same statistical stem
    // ("30% of UK adults own a camera...") collide regardless of what
    // they trail off into, which is the "duplicate claim" the user
    // flagged on /photography-courses-coventry. 30 chars is short
    // enough to absorb minor lead-in differences ("Around" vs "For
    // context") and long enough to avoid colliding unrelated stats.
    const normalised = claim.toLowerCase().replace(/\s+/g, ' ');
    const stem = normalised.slice(0, 30);
    if (!seen.has(stem)) seen.set(stem, { snippet: claim, count: 0 });
    seen.get(stem).count += 1;
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
  if (!html) {
    // eslint-disable-next-line no-console
    console.warn('[page-liability] detectWeakOutboundCitations: no HTML supplied — audit incomplete.');
    return [{ _audit_status: 'incomplete', _audit_reason: 'no_html' }];
  }
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
  if (stats.length && stats[0] && stats[0]._audit_status === 'incomplete') return stats;
  return stats.filter(s => s.count >= 2);
}

function _stripIncomplete(list) {
  if (!Array.isArray(list)) return [];
  return list.filter(item => !(item && item._audit_status === 'incomplete'));
}

/**
 * Aggregate scanner. Caller passes raw HTML once and gets back every
 * liability type the engine knows how to emit a REMEDIATE task for.
 *
 * 2026-05-26: surfaces `audit_status` ('ok' | 'incomplete' | 'partial')
 * and `audit_reasons[]` so the recommendation engine can either inject
 * a "scan incomplete" warning card OR fall back to metadata-only logic
 * rather than silently claiming "no liabilities found".
 */
export function scanLiabilities(html, bodyTextOverride) {
  const bodyText = bodyTextOverride || stripHtml(html);
  const fluffy = detectFluffyOpener(bodyText);
  const statsRaw = detectUnsourcedStats(html);
  const weakRaw = detectWeakOutboundCitations(html);
  const dupRaw = detectDuplicateClaims(html);
  const stats = _stripIncomplete(statsRaw);
  const weakCitations = _stripIncomplete(weakRaw);
  const duplicates = _stripIncomplete(dupRaw);
  const auditReasons = new Set();
  if (fluffy.audit_status === 'incomplete') auditReasons.add(fluffy.audit_reason || 'no_body_text');
  if (statsRaw[0] && statsRaw[0]._audit_status === 'incomplete') auditReasons.add(statsRaw[0]._audit_reason || 'no_html');
  if (weakRaw[0] && weakRaw[0]._audit_status === 'incomplete') auditReasons.add(weakRaw[0]._audit_reason || 'no_html');
  const allIncomplete = auditReasons.size >= 2;
  const auditStatus = auditReasons.size === 0 ? 'ok' : (allIncomplete ? 'incomplete' : 'partial');
  return {
    fluffy,
    unsourced_stats: stats,
    weak_citations: weakCitations,
    duplicate_claims: duplicates,
    has_any_liability: fluffy.isFluffy
      || stats.length > 0
      || weakCitations.length > 0
      || duplicates.length > 0,
    audit_status: auditStatus,
    audit_reasons: Array.from(auditReasons)
  };
}
