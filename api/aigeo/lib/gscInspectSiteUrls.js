/**
 * Search Console URL Inspection accepts either:
 * - URL-prefix property: https://www.example.com/
 * - Domain property: sc-domain:example.com
 * Dashboard localStorage may not match GSC; try alternates on PERMISSION_DENIED.
 * Inspection URLs may be apex while property is www (or reverse) — try inspection-apex + sc-domain first.
 */

export function normalizeSiteUrlForInspect(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.toLowerCase().startsWith('sc-domain:')) {
    const host = s.slice('sc-domain:'.length).trim().toLowerCase().replace(/^www\./, '');
    return host ? `sc-domain:${host}` : '';
  }
  let u = s;
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  u = u.replace(/\/+$/, '');
  return `${u}/`;
}

function hostWithoutWww(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h.startsWith('www.') ? h.slice(4) : h;
}

function uniqueOrdered(lists) {
  const seen = new Set();
  const out = [];
  for (let li = 0; li < lists.length; li += 1) {
    const list = lists[li];
    if (!Array.isArray(list)) continue;
    for (let i = 0; i < list.length; i += 1) {
      const s = String(list[i] || '').trim();
      if (s && !seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
  }
  return out;
}

function candidatesFromInspectionUrl(inspectionUrl) {
  const insp = String(inspectionUrl || '').trim();
  if (!insp || typeof URL === 'undefined' || !URL.canParse(insp)) return [];
  try {
    const u = new URL(insp);
    const apex = hostWithoutWww(u.hostname.toLowerCase());
    if (!apex) return [];
    return [`sc-domain:${apex}`, `https://www.${apex}/`, `https://${apex}/`];
  } catch {
    return [];
  }
}

function candidatesFromPropertyUrl(propertyUrl) {
  const prop = String(propertyUrl || '').trim();
  const out = [];
  if (prop.toLowerCase().startsWith('sc-domain:')) {
    const apex = prop.slice('sc-domain:'.length).trim().toLowerCase().replace(/^www\./, '');
    if (apex) {
      out.push(`sc-domain:${apex}`, `https://www.${apex}/`, `https://${apex}/`);
    }
  } else if (/^https?:\/\//i.test(prop)) {
    const norm = normalizeSiteUrlForInspect(prop);
    out.push(norm);
    try {
      const u = new URL(norm);
      const host = u.hostname.toLowerCase();
      const apex = hostWithoutWww(host);
      if (host.startsWith('www.')) {
        out.push(`https://${apex}/`);
      } else {
        out.push(`https://www.${host}/`);
      }
      out.push(`sc-domain:${apex}`);
    } catch {
      /* ignore */
    }
  } else if (prop) {
    const rawHost = prop.replace(/^https?:\/\//i, '').split('/')[0].trim().toLowerCase();
    const apex = hostWithoutWww(rawHost);
    if (apex) {
      out.push(`sc-domain:${apex}`, `https://www.${apex}/`, `https://${apex}/`);
    }
  }
  return out;
}

/**
 * Ordered unique siteUrl values to try for index:inspect.
 * Inspection-URL-derived candidates first (fixes www vs apex mismatch with URL-prefix properties).
 */
export function buildGscSiteUrlCandidates(propertyUrl, inspectionUrl) {
  const prop = String(propertyUrl || '').trim();
  const merged = uniqueOrdered([
    candidatesFromInspectionUrl(inspectionUrl),
    candidatesFromPropertyUrl(propertyUrl),
  ]);
  if (merged.length) return merged;
  return [normalizeSiteUrlForInspect(prop)].filter(Boolean);
}

export function isGscInspectPermissionDenied(row) {
  const e = row?.error;
  if (!e || typeof e !== 'object') return false;
  if (Number(e.code) === 403) return true;
  if (String(e.status || '').toUpperCase() === 'PERMISSION_DENIED') return true;
  const msg = String(e.message || '').toLowerCase();
  if (msg.includes('permission_denied')) return true;
  if (msg.includes('do not own this site')) return true;
  if (msg.includes('not part of this property')) return true;
  return false;
}

/**
 * Try candidates until one does not return a property permission error.
 * Returns { siteUrl, row } where row is the last inspect response for the probe URL.
 */
export async function resolveGscSiteUrlForInspect(accessToken, inspectOne, propertyUrl, probeInspectionUrl, sleepMs) {
  const delay = typeof sleepMs === 'number' ? sleepMs : 100;
  const candidates = buildGscSiteUrlCandidates(propertyUrl, probeInspectionUrl);
  let lastRow = null;
  for (let i = 0; i < candidates.length; i += 1) {
    const siteUrl = candidates[i];
    const row = await inspectOne(accessToken, siteUrl, probeInspectionUrl);
    lastRow = row;
    if (!isGscInspectPermissionDenied(row)) {
      return { siteUrl, row, tried: candidates.slice(0, i + 1) };
    }
    if (i < candidates.length - 1) await new Promise((r) => setTimeout(r, delay));
  }
  const fallback = candidates[0] || normalizeSiteUrlForInspect(propertyUrl);
  return { siteUrl: fallback, row: lastRow, tried: candidates };
}
