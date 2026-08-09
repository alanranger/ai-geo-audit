/**
 * Link-presence rules for cannibalisation page audits (presentation layer).
 * No integrity scoring / check logic changes.
 */
import { pathOnly } from '../audit/moneyPageRoles.js';

export function normalizePath(raw) {
  return pathOnly(raw);
}

export function normalizeKeyword(kw) {
  return String(kw || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Loose containment: normalized keyword tokens appear in order in anchor text. */
export function anchorContainsKeyword(anchorText, keyword) {
  const a = normalizeKeyword(anchorText);
  const k = normalizeKeyword(keyword);
  if (!a || !k) return false;
  if (a.includes(k)) return true;
  // allow minor punctuation drift: strip hyphens
  const a2 = a.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  const k2 = k.replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
  return a2.includes(k2);
}

/**
 * Match rule (authoritative):
 * A "good" fix link exists when:
 *  1) from-page HTML contains an <a href> whose resolved PATH equals the to-page path
 *     (ignore scheme, host, trailing slash, query/hash), AND
 *  2) the visible/full anchor text (including nested tags) contains the finding keyword
 *     case-insensitively after whitespace normalization.
 * A path match without keyword match = weak anchor. No path match = absent.
 */
export function scanPageForLink(html, toPath, keyword) {
  const want = normalizePath(toPath);
  if (!want || !html) {
    return { linkPresent: false, strongAnchor: false, sampleHref: '', sampleAnchor: '' };
  }
  const base = 'https://www.alanranger.com';
  // Global <a ...href=...> ... </a> (non-greedy, allow nested spans)
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  let anyPath = false;
  let strong = false;
  let sampleHref = '';
  let sampleAnchor = '';
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || '';
    const inner = m[2] || '';
    const hrefM = attrs.match(/\bhref\s*=\s*(["'])(.*?)\1/i) || attrs.match(/\bhref\s*=\s*([^\s>]+)/i);
    if (!hrefM) continue;
    let href = (hrefM[2] || hrefM[1] || '').trim();
    if (!href || href.startsWith('#') || href.toLowerCase().startsWith('mailto:') || href.toLowerCase().startsWith('javascript:')) {
      continue;
    }
    let resolvedPath = '';
    try {
      resolvedPath = normalizePath(new URL(href, base).href);
    } catch {
      resolvedPath = normalizePath(href);
    }
    if (resolvedPath !== want) continue;
    anyPath = true;
    const plain = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!sampleHref) {
      sampleHref = href;
      sampleAnchor = plain;
    }
    if (anchorContainsKeyword(plain, keyword)) {
      strong = true;
      sampleHref = href;
      sampleAnchor = plain;
      break;
    }
  }
  return {
    linkPresent: anyPath,
    strongAnchor: strong,
    sampleHref,
    sampleAnchor
  };
}

export function linkStatusFromScan(scan) {
  if (scan.strongAnchor) return 'present';
  if (scan.linkPresent) return 'weak';
  return 'absent';
}

export function statusKeyFromLink(linkStatus, isDecision) {
  if (isDecision) return { key: 'decision', label: 'Decision needed', sort: 0 };
  if (linkStatus === 'present') {
    return { key: 'awaiting', label: 'Link in place — awaiting recrawl', sort: 7 };
  }
  if (linkStatus === 'weak') {
    return { key: 'weak', label: 'Link present, weak anchor', sort: 3 };
  }
  if (linkStatus === 'absent') {
    return { key: 'fix', label: 'Fix needed', sort: 1 };
  }
  return { key: 'unchecked', label: 'Not page-checked', sort: 5 };
}

export function toAbsoluteUrl(pathOrUrl) {
  const raw = String(pathOrUrl || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const p = raw.startsWith('/') ? raw : `/${raw}`;
  return `https://www.alanranger.com${p}`;
}
