/**
 * Google redirect links in DataForSEO SERP items (seen from 1 Nov 2026): many results come back with
 * url "https://google.com/goto?url=<opaque token>" and domain "google.com". The real site is then only in
 * `breadcrumb` ("https://www.alanranger.com › …") or `website_name`. Resolve every such item BEFORE any
 * "ours" / competitor decision, so ownership and competitor counts use the real site.
 * Order: decodable target → breadcrumb host (+ path) → website_name (platforms; our site name last).
 */

const GOOGLE_HOST = /^(www\.)?google\.[a-z.]+$/i;
const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;
const BREADCRUMB_SEP = /\s+›\s+/;
const PLATFORMS = [
  [/^facebook\b/i, 'facebook.com'], [/^youtube\b/i, 'youtube.com'], [/^reddit\b/i, 'reddit.com'], [/^instagram\b/i, 'instagram.com'],
  [/^linkedin\b/i, 'linkedin.com'], [/^tiktok\b/i, 'tiktok.com'], [/^(x|twitter)\b/i, 'x.com'], [/^yelp\b/i, 'yelp.com'],
  [/^tripadvisor\b/i, 'tripadvisor.com'], [/^pinterest\b/i, 'pinterest.com']
];
/** Our site names (website_name) by target root — the last-resort match. */
export const SITE_NAMES = { 'alanranger.com': [/^alan ranger( photography)?$/i] };

const hostOf = (u) => { try { return new URL(u).hostname; } catch { return ''; } };

export function isGoogleRedirect(item) {
  if (!item || typeof item !== 'object') return false;
  if (GOOGLE_HOST.test(String(item.domain || ''))) return true;
  const host = hostOf(item.url);
  return GOOGLE_HOST.test(host) && /^\/(goto|url)\b/.test(new URL(item.url).pathname);
}

/** The target of /goto?url= or /url?q= when it is a real http(s) URL (not Google's opaque token). */
export function decodeRedirectTarget(url) {
  try {
    const u = new URL(url);
    const t = u.searchParams.get('url') || u.searchParams.get('q') || '';
    return /^https?:\/\//i.test(t) && hostOf(t) && !GOOGLE_HOST.test(hostOf(t)) ? t : null;
  } catch {
    return null;
  }
}

/** "https://www.alanranger.com › beginners-photography-lessons" → { host, url }, or null if not a host. */
export function breadcrumbTarget(breadcrumb) {
  const parts = String(breadcrumb || '').split(BREADCRUMB_SEP).map((p) => p.trim()).filter(Boolean);
  const first = (parts[0] || '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!HOST_RE.test(first)) return null;
  const path = [];
  for (const seg of parts.slice(1)) {
    if (/\.\.\.$|…$|\s/.test(seg)) break;
    path.push(seg);
  }
  return { host: first.toLowerCase(), url: `https://${first.toLowerCase()}${path.length ? `/${path.join('/')}` : '/'}` };
}

function nameTarget(websiteName, targetRoot) {
  const name = String(websiteName || '').split(/\s*·\s*/)[0].trim();
  const platform = PLATFORMS.find(([re]) => re.test(name));
  if (platform) return { host: platform[1], url: null };
  const ours = (SITE_NAMES[targetRoot] || []).some((re) => re.test(name));
  return ours ? { host: targetRoot, url: `https://www.${targetRoot}/` } : null;
}

/** One item: unchanged unless it is a Google redirect; then domain/url are the real site's. */
export function resolveRedirectItem(item, targetRoot) {
  if (!isGoogleRedirect(item)) return item;
  const decoded = decodeRedirectTarget(item.url);
  if (decoded) return { ...item, url: decoded, domain: hostOf(decoded), redirect_resolved: 'decoded', redirect_url: item.url };
  const bc = breadcrumbTarget(item.breadcrumb);
  if (bc) return { ...item, url: bc.url, domain: bc.host, redirect_resolved: 'breadcrumb', redirect_url: item.url };
  const named = nameTarget(item.website_name, targetRoot);
  if (named) return { ...item, url: named.url || item.url, domain: named.host, redirect_resolved: 'website_name', redirect_url: item.url };
  return { ...item, redirect_resolved: 'unresolved' };
}

/** Every item and nested object with a url/domain (local pack, AIO references, …), depth-limited. */
export function resolveSerpRedirects(value, targetRoot, depth = 0) {
  if (depth > 5 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => resolveSerpRedirects(v, targetRoot, depth + 1));
  if (typeof value !== 'object') return value;
  const own = ('url' in value || 'domain' in value) ? resolveRedirectItem(value, targetRoot) : value;
  const out = { ...own };
  for (const [k, v] of Object.entries(own)) if (v && typeof v === 'object') out[k] = resolveSerpRedirects(v, targetRoot, depth + 1);
  return out;
}

/** Share of owner slots in a run's serp_surface_stack still on google.com (the >10% guard). */
export function googleOwnerShare(rows) {
  let total = 0;
  let google = 0;
  for (const r of rows || []) {
    for (const e of Array.isArray(r?.serp_surface_stack) ? r.serp_surface_stack : []) {
      for (const o of Array.isArray(e?.owners) ? e.owners : []) {
        total += 1;
        if (GOOGLE_HOST.test(String(o?.domain || ''))) google += 1;
      }
    }
  }
  return { total, google, share: total ? google / total : 0 };
}
