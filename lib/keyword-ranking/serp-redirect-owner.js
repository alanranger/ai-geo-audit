/**
 * Google redirect links in DataForSEO SERP items (seen from 1 Nov 2026): many results come back with
 * url "https://google.com/goto?url=<opaque token>" and domain "google.com". The real site is then only in
 * `breadcrumb` ("https://www.alanranger.com › …"), `website_name` (organic) or `source` (AI-overview
 * references, 9 Nov 2026: 104 of 219). Resolve every such item BEFORE any "ours" / competitor decision,
 * so ownership and competitor counts use the real site. Never match on the google.com domain itself.
 * Order: decodable target → breadcrumb host (+ path) → our place id → site name (platforms, our name,
 * then a host seen with that site name elsewhere on the same SERP).
 */

import { getBusinessCid } from './business-location.js';

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

const siteNameKey = (name) => String(name || '').split(/\s*·\s*/)[0].trim().toLowerCase();

/** Site name the item carries: organic `website_name`, AI-overview reference `source`, local-pack `title`. */
function siteNameOf(item) {
  if (item.website_name) return item.website_name;
  if (item.source) return item.source;
  return item.type === 'local_pack' ? item.title : '';
}

function nameTarget(siteName, targetRoot, names) {
  const name = siteNameKey(siteName);
  if (!name) return null;
  const platform = PLATFORMS.find(([re]) => re.test(name));
  if (platform) return { host: platform[1], url: null };
  if ((SITE_NAMES[targetRoot] || []).some((re) => re.test(name))) return { host: targetRoot, url: `https://www.${targetRoot}/` };
  const seen = names?.get(name);
  return seen ? { host: seen, url: null } : null;
}

const isOurPlace = (item) => item.cid != null && String(item.cid) !== '' && String(item.cid) === getBusinessCid();

/** One item: unchanged unless it is a Google redirect; then domain/url are the real site's. */
export function resolveRedirectItem(item, targetRoot, names = null) {
  if (!isGoogleRedirect(item)) return item;
  const decoded = decodeRedirectTarget(item.url);
  if (decoded) return { ...item, url: decoded, domain: hostOf(decoded), redirect_resolved: 'decoded', redirect_url: item.url };
  const bc = breadcrumbTarget(item.breadcrumb);
  if (bc) return { ...item, url: bc.url, domain: bc.host, redirect_resolved: 'breadcrumb', redirect_url: item.url };
  if (isOurPlace(item)) return { ...item, url: `https://www.${targetRoot}/`, domain: targetRoot, redirect_resolved: 'our_cid', redirect_url: item.url };
  const named = nameTarget(siteNameOf(item), targetRoot, names);
  if (named) return { ...item, url: named.url || item.url, domain: named.host, redirect_resolved: 'website_name', redirect_url: item.url };
  return { ...item, redirect_resolved: 'unresolved' };
}

/** Every item and nested object with a url/domain (local pack, AIO references, …), depth-limited. */
export function resolveSerpRedirects(value, targetRoot, depth = 0, names = null) {
  if (depth > 5 || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => resolveSerpRedirects(v, targetRoot, depth + 1, names));
  if (typeof value !== 'object') return value;
  const own = ('url' in value || 'domain' in value) ? resolveRedirectItem(value, targetRoot, names) : value;
  const out = { ...own };
  for (const [k, v] of Object.entries(own)) if (v && typeof v === 'object') out[k] = resolveSerpRedirects(v, targetRoot, depth + 1, names);
  return out;
}

/** Site name → host from this SERP's own items that show both (organic breadcrumb + website_name). */
export function siteNameHosts(items) {
  const names = new Map();
  for (const it of Array.isArray(items) ? items : []) {
    const host = breadcrumbTarget(it?.breadcrumb)?.host;
    const key = siteNameKey(it?.website_name);
    if (host && key && !GOOGLE_HOST.test(host) && !names.has(key)) names.set(key, host);
  }
  return names;
}

/** Top-level SERP items with every Google redirect resolved, AI-overview sources matched against this SERP. */
export function resolveSerpItems(items, targetRoot) {
  return resolveSerpRedirects(items ?? [], targetRoot, 0, siteNameHosts(items));
}

/** Owner entries are { domain } objects (organic, local pack) or bare domain strings (AI overview, PAA). */
const ownerDomain = (o) => (typeof o === 'string' ? o : o?.domain);

/** Organic + local-pack results: the slots the "suspect: matching" guard measures. */
export const MATCHING_GUARD_TYPES = Object.freeze(['organic', 'local_pack']);

/**
 * Share of owner slots in a run's serp_surface_stack still on google.com after decoding.
 * @param {string[]|null} [types] only these stack element types (null = every type)
 */
export function googleOwnerShare(rows, types = null) {
  const owners = ownerSlots(rows, types);
  const google = owners.filter((o) => GOOGLE_HOST.test(String(ownerDomain(o) || ''))).length;
  return { total: owners.length, google, share: owners.length ? google / owners.length : 0 };
}

function ownerSlots(rows, types) {
  const out = [];
  for (const r of rows || []) {
    for (const e of Array.isArray(r?.serp_surface_stack) ? r.serp_surface_stack : []) {
      if (types && !types.includes(e?.type)) continue;
      if (Array.isArray(e?.owners)) out.push(...e.owners);
    }
  }
  return out;
}
