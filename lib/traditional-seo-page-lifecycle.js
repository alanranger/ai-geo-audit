/**
 * Detect Traditional SEO page lifecycle: live | redirected | gone | hidden.
 * Used by extractability API + mirrored in audit-dashboard helpers.
 */

export function normalizeUrlPathKey(url) {
  try {
    const u = new URL(String(url || '').trim());
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    const path = (u.pathname || '/').replace(/\/+$/, '') || '/';
    return `${host}${path.toLowerCase()}`;
  } catch {
    return String(url || '').trim().toLowerCase().replace(/\/+$/, '');
  }
}

export function isWorkshopListingPath(pathname) {
  const p = String(pathname || '').replace(/\/+$/, '') || '/';
  return p === '/photographic-workshops-near-me' || p === '/photo-workshops-uk';
}

export function resolveAbsoluteUrl(base, location) {
  try {
    return new URL(String(location || ''), String(base || '')).toString();
  } catch {
    return String(location || '').trim();
  }
}

/** Same registrable host ignoring www (apex ↔ www is not a content redirect). */
export function isSameSiteHost(a, b) {
  try {
    const ha = new URL(String(a || '')).hostname.replace(/^www\./i, '').toLowerCase();
    const hb = new URL(String(b || '')).hostname.replace(/^www\./i, '').toLowerCase();
    return Boolean(ha && hb && ha === hb);
  } catch {
    return false;
  }
}

/** Host-only / trailing-slash redirect to the same page — still score content rules. */
export function isHostNormalizationRedirect(pageUrl, finalUrl) {
  const final = String(finalUrl || '').trim();
  if (!final || !pageUrl) return false;
  return isSameSiteHost(pageUrl, final)
    && normalizeUrlPathKey(final) === normalizeUrlPathKey(pageUrl);
}

/** Redirected / gone / hidden pages are not scored for content rules. */
export function isInactiveLifecycle(life) {
  const s = String(life || '').toLowerCase();
  return s === 'redirected' || s === 'gone' || s === 'hidden';
}

/**
 * @param {{ pageLifecycle?: string, redirected?: boolean, httpStatusFirst?: number, statusCode?: number, finalUrl?: string, seoCanonicalHref?: string, requestOk?: boolean, hasNoindex?: boolean }} signal
 * @param {string} pageUrl
 */
export function classifyPageLifecycle(signal, pageUrl) {
  if (!signal) return 'unknown';
  const explicit = String(signal.pageLifecycle || '').toLowerCase();
  const finalUrl = String(signal.finalUrl || '').trim();
  // www ↔ apex (same path) must not blanket-na the whole Trad SEO scorecard.
  if (explicit === 'redirected' && isHostNormalizationRedirect(pageUrl, finalUrl)) {
    return 'live';
  }
  if (explicit === 'redirected' || explicit === 'gone' || explicit === 'hidden' || explicit === 'live') {
    return explicit;
  }

  if (signal.hasNoindex === true) return 'hidden';

  const first = Number(signal.httpStatusFirst != null ? signal.httpStatusFirst : signal.statusCode);
  if (first === 404 || first === 410) return 'gone';
  if (signal.redirected === true || (Number.isFinite(first) && first >= 300 && first < 400)) {
    if (isHostNormalizationRedirect(pageUrl, finalUrl)) return 'live';
    return 'redirected';
  }

  if (finalUrl && normalizeUrlPathKey(finalUrl) !== normalizeUrlPathKey(pageUrl)) {
    try {
      if (isWorkshopListingPath(new URL(finalUrl).pathname)) return 'redirected';
    } catch { /* ignore */ }
  }

  const canon = String(signal.seoCanonicalHref || '').trim();
  if (canon) {
    try {
      const pagePath = new URL(pageUrl).pathname.replace(/\/+$/, '') || '/';
      const canonPath = new URL(canon, pageUrl).pathname.replace(/\/+$/, '') || '/';
      if (pagePath !== canonPath && isWorkshopListingPath(canonPath)) return 'redirected';
    } catch { /* ignore */ }
  }

  if (signal.requestOk === false && (first === 404 || first === 410)) return 'gone';
  return 'live';
}
