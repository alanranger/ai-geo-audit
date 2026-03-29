/** Match dashboard `traditionalSeoNormalizeEvalCachePropertyKey` / signal map keys (Node). */

export const normalizePropertyKey = (raw) => {
  const s = String(raw || '').trim();
  if (!s) return '';
  const low = s.toLowerCase();
  if (low.startsWith('sc-domain:')) return low.replace(/\s+/g, '');
  try {
    if (URL.canParse(s)) {
      const u = new URL(s);
      const host = u.hostname.toLowerCase().replace(/^www\./, '');
      const path = String(u.pathname || '/').replace(/\/+$/, '') || '/';
      return `${u.protocol.toLowerCase()}//${host}${path}`;
    }
  } catch (e) {
    /* ignore */
  }
  return low;
};

export const normalizeUrl = (rawUrl, propertyUrl = '') => {
  const raw = String(rawUrl || '').trim();
  if (!raw) return '';
  if (URL.canParse(raw)) return new URL(raw).toString();
  const prop = String(propertyUrl || '').trim();
  if (prop && URL.canParse(prop)) {
    try {
      const base = new URL(prop);
      return new URL(raw.startsWith('/') ? raw : `/${raw}`, `${base.protocol}//${base.host}`).toString();
    } catch (err) {
      return '';
    }
  }
  return '';
};

export const toComparableUrl = (rawUrl, propertyUrl = '') => {
  const normalized = normalizeUrl(rawUrl, propertyUrl);
  if (!normalized || !URL.canParse(normalized)) return '';
  try {
    const parsed = new URL(normalized);
    const cleanPath = String(parsed.pathname || '/').replace(/\/+$/, '') || '/';
    const host = String(parsed.hostname || '').toLowerCase().replace(/^www\./, '');
    return `${parsed.protocol}//${host}${cleanPath}`;
  } catch (err) {
    return '';
  }
};

export const signalMapKey = (rawUrl, propertyUrl = '') =>
  toComparableUrl(rawUrl, propertyUrl) || normalizeUrl(rawUrl, propertyUrl) || String(rawUrl || '').trim();
