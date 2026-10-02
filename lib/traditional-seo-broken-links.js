/**
 * Traditional SEO — broken internal-link helpers (404/410).
 * Pure functions for API + tests; dashboard mirrors evaluatePageBrokenLinks.
 */

export function isBrokenHttpStatus(statusCode) {
  const n = Number(statusCode);
  return n === 404 || n === 410;
}

export function isOkHttpStatus(statusCode) {
  const n = Number(statusCode);
  return Number.isFinite(n) && n >= 200 && n < 400;
}

/** @returns {'broken'|'ok'|'unknown'} */
export function classifyLinkHttpStatus(statusCode, fetchError = null) {
  if (fetchError) return 'unknown';
  if (isBrokenHttpStatus(statusCode)) return 'broken';
  if (isOkHttpStatus(statusCode)) return 'ok';
  return 'unknown';
}

/**
 * @param {string[]} targets
 * @param {(url: string) => ({ kind?: string }|null|undefined)} resolveStatus
 * @returns {{ status: 'pass'|'warn'|'fail', brokenUrls: string[], unknownCount: number, note: string }}
 */
export function evaluatePageBrokenLinks(targets, resolveStatus) {
  const list = Array.isArray(targets) ? targets.map((t) => String(t || '').trim()).filter(Boolean) : null;
  if (!list) {
    return {
      status: 'warn',
      brokenUrls: [],
      unknownCount: 0,
      note: 'Internal link targets missing — run ② Score Traditional SEO to refresh extractability.'
    };
  }
  if (!list.length) {
    return {
      status: 'pass',
      brokenUrls: [],
      unknownCount: 0,
      note: 'No same-site outbound links on this page.'
    };
  }
  if (typeof resolveStatus !== 'function') {
    return {
      status: 'warn',
      brokenUrls: [],
      unknownCount: list.length,
      note: 'Broken-link status map not built yet — re-run ② or ①.'
    };
  }

  const brokenUrls = [];
  let unknownCount = 0;
  list.forEach((url) => {
    const hit = resolveStatus(url);
    const kind = String(hit?.kind || 'unknown').toLowerCase();
    if (kind === 'broken') brokenUrls.push(url);
    else if (kind !== 'ok') unknownCount += 1;
  });

  if (brokenUrls.length) {
    const sample = brokenUrls.slice(0, 5).join(' · ');
    const more = brokenUrls.length > 5 ? ` (+${brokenUrls.length - 5} more)` : '';
    return {
      status: 'fail',
      brokenUrls,
      unknownCount,
      note: `Broken same-site link(s) (404/410): ${brokenUrls.length}. ${sample}${more}`
    };
  }
  if (unknownCount) {
    return {
      status: 'warn',
      brokenUrls: [],
      unknownCount,
      note: `Could not confirm ${unknownCount} same-site link(s) (timeout/blocked/non-404 error).`
    };
  }
  return {
    status: 'pass',
    brokenUrls: [],
    unknownCount: 0,
    note: `All ${list.length} same-site outbound link(s) resolve (no 404/410).`
  };
}

const UA = 'Mozilla/5.0 (compatible; AI-GEO-Audit/1.0; +https://ai-geo-audit.vercel.app)';

/**
 * HEAD then GET fallback. Follows redirects; final status wins.
 * @returns {Promise<{ url: string, statusCode: number|null, kind: string, error: string|null }>}
 */
export async function probeUrlHttpStatus(url, fetchImpl = fetch, timeoutMs = 8000) {
  const target = String(url || '').trim();
  if (!/^https?:\/\//i.test(target)) {
    return { url: target, statusCode: null, kind: 'unknown', error: 'invalid_url' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 8000));
  const opts = {
    redirect: 'follow',
    signal: controller.signal,
    headers: { 'User-Agent': UA, Accept: '*/*' }
  };
  try {
    let res = await fetchImpl(target, { ...opts, method: 'HEAD' });
    const headCode = Number(res.status);
    if (headCode === 405 || headCode === 501 || headCode === 403) {
      res = await fetchImpl(target, { ...opts, method: 'GET' });
    }
    const statusCode = Number(res.status);
    return {
      url: target,
      statusCode: Number.isFinite(statusCode) ? statusCode : null,
      kind: classifyLinkHttpStatus(statusCode),
      error: null
    };
  } catch (err) {
    return {
      url: target,
      statusCode: null,
      kind: 'unknown',
      error: String(err?.message || err || 'fetch_failed').slice(0, 180)
    };
  } finally {
    clearTimeout(timer);
  }
}
