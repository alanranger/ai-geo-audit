/**
 * Search Console URL Inspection accepts either:
 * - URL-prefix property: https://www.example.com/
 * - Domain property: sc-domain:example.com
 * Dashboard localStorage may not match GSC; try alternates on PERMISSION_DENIED.
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

/**
 * Ordered unique siteUrl values to try for index:inspect.
 */
export function buildGscSiteUrlCandidates(propertyUrl, inspectionUrl) {
  const out = [];
  const add = (v) => {
    const s = String(v || '').trim();
    if (s && !out.includes(s)) out.push(s);
  };

  const prop = String(propertyUrl || '').trim();
  const insp = String(inspectionUrl || '').trim();

  if (prop.toLowerCase().startsWith('sc-domain:')) {
    const apex = prop.slice('sc-domain:'.length).trim().toLowerCase().replace(/^www\./, '');
    if (apex) {
      add(`sc-domain:${apex}`);
      add(`https://www.${apex}/`);
      add(`https://${apex}/`);
    }
  } else if (/^https?:\/\//i.test(prop)) {
    const norm = normalizeSiteUrlForInspect(prop);
    add(norm);
    try {
      const u = new URL(norm);
      const host = u.hostname.toLowerCase();
      const apex = hostWithoutWww(host);
      if (host.startsWith('www.')) {
        add(`https://${apex}/`);
      } else {
        add(`https://www.${host}/`);
      }
      add(`sc-domain:${apex}`);
    } catch {
      /* ignore */
    }
  } else if (prop) {
    const rawHost = prop.replace(/^https?:\/\//i, '').split('/')[0].trim().toLowerCase();
    const apex = hostWithoutWww(rawHost);
    if (apex) {
      add(`sc-domain:${apex}`);
      add(`https://www.${apex}/`);
      add(`https://${apex}/`);
    }
  }

  if (insp && typeof URL !== 'undefined' && URL.canParse(insp)) {
    try {
      const u = new URL(insp);
      const host = u.hostname.toLowerCase();
      const apex = hostWithoutWww(host);
      add(`sc-domain:${apex}`);
      add(`https://www.${apex}/`);
      add(`https://${apex}/`);
    } catch {
      /* ignore */
    }
  }

  return out.length ? out : [normalizeSiteUrlForInspect(prop)].filter(Boolean);
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
