/**
 * Meta Graph API client for the social tiles: read-only. Facebook Login for Business (OAuth code flow) plus the Page /
 * Instagram business reads the nightly collector needs. Nothing here posts, messages or touches ads.
 * Tokens travel only in request URLs to graph.facebook.com and are never put in an error message or a log line.
 */
import crypto from 'node:crypto';

export const READ_SCOPES = ['pages_show_list', 'pages_read_engagement', 'read_insights', 'instagram_basic', 'instagram_manage_insights'];
/** Only asked for on a retry when the Page is held in a Business portfolio and /me/accounts lists nothing without it. */
export const BUSINESS_SCOPE = 'business_management';
const ALLOWED_GRANTS = new Set([...READ_SCOPES, BUSINESS_SCOPE, 'public_profile']);
export const DEFAULT_REDIRECT = 'https://ai-geo-audit.vercel.app/api/aigeo/social-oauth-callback';
export const META_ENV = ['META_APP_ID', 'META_APP_SECRET'];

export function metaConfig(env = process.env) {
  const v = (k) => String(env[k] || '').trim();
  return {
    appId: v('META_APP_ID'),
    appSecret: v('META_APP_SECRET'),
    configId: v('META_LOGIN_CONFIG_ID'),
    version: v('META_GRAPH_VERSION') || 'v23.0',
    redirectUri: v('META_REDIRECT_URI') || DEFAULT_REDIRECT
  };
}

/** Env names still to add in Vercel (names only, never values). */
export function missingMetaEnv(env = process.env) {
  const out = META_ENV.filter((k) => !String(env[k] || '').trim());
  if (!String(env.SOCIAL_TOKEN_KEY || '').trim()) out.push('SOCIAL_TOKEN_KEY');
  return out;
}

export function loginUrl(cfg, state, { withBusiness = false } = {}) {
  const scope = withBusiness ? [...READ_SCOPES, BUSINESS_SCOPE] : READ_SCOPES;
  const p = new URLSearchParams({ client_id: cfg.appId, redirect_uri: cfg.redirectUri, state, response_type: 'code', scope: scope.join(',') });
  if (cfg.configId) p.set('config_id', cfg.configId);
  return `https://www.facebook.com/${cfg.version}/dialog/oauth?${p}`;
}

export class GraphError extends Error {
  constructor(code, subcode, message) {
    super(`meta_graph_${code || 'error'}${subcode ? `_${subcode}` : ''}: ${message || 'request failed'}`);
    this.code = code;
    this.subcode = subcode;
  }
  /** 190 = invalid / expired token; 102 = session; 10 / 200 = permission withdrawn. */
  get tokenProblem() { return [190, 102].includes(this.code) || [458, 460, 463, 467].includes(this.subcode); }
}

const proof = (token, secret) => crypto.createHmac('sha256', secret).update(token).digest('hex');

function queryOf(cfg, params, token) {
  const p = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== ''));
  if (!token) return p;
  p.set('access_token', token);
  if (cfg.appSecret) p.set('appsecret_proof', proof(token, cfg.appSecret));
  return p;
}
function errorOf(r, j) {
  const e = j?.error;
  if (r.ok && !e) return null;
  return new GraphError(e?.code || r.status, e?.error_subcode, e?.message);
}

/** GET graph.facebook.com/{version}/{path}. `token` is added (with appsecret_proof) only inside the request URL. */
export async function graphGet(cfg, path, params = {}, { token, fetchImpl = fetch } = {}) {
  const r = await fetchImpl(`https://graph.facebook.com/${cfg.version}/${path}?${queryOf(cfg, params, token)}`);
  const j = await r.json().catch(() => null);
  const err = errorOf(r, j);
  if (err) throw err;
  return j || {};
}

/** OAuth: code → short-lived user token → long-lived user token (about 60 days). */
export async function exchangeCode(cfg, code, fetchImpl) {
  const base = { client_id: cfg.appId, client_secret: cfg.appSecret };
  const short = await graphGet(cfg, 'oauth/access_token', { ...base, redirect_uri: cfg.redirectUri, code }, { fetchImpl });
  const long = await graphGet(cfg, 'oauth/access_token', { ...base, grant_type: 'fb_exchange_token', fb_exchange_token: short.access_token }, { fetchImpl });
  return long.access_token;
}

export async function grantedScopes(cfg, userToken, fetchImpl) {
  const j = await graphGet(cfg, 'me/permissions', {}, { token: userToken, fetchImpl });
  return (j.data || []).filter((x) => x.status === 'granted').map((x) => x.permission);
}
export const extraScopes = (granted) => granted.filter((s) => !ALLOWED_GRANTS.has(s));

/** Pages the user manages; a Page token from a long-lived user token does not expire. */
export async function listPages(cfg, userToken, fetchImpl) {
  const j = await graphGet(cfg, 'me/accounts', { fields: 'id,name,access_token,instagram_business_account{id,username}', limit: 50 }, { token: userToken, fetchImpl });
  return j.data || [];
}

/** Prefer a Page with a linked Instagram business account (one connection covers both tiles). */
export function pickPage(pages) {
  return pages.find((p) => p.instagram_business_account?.id) || pages[0] || null;
}

const unixIso = (s) => (Number(s) > 0 ? new Date(Number(s) * 1000).toISOString() : null);
/** expires_at 0 = never; data_access_expires_at = 90 days without use (the nightly run keeps it fresh). */
export async function tokenHealth(cfg, token, fetchImpl) {
  const j = await graphGet(cfg, 'debug_token', { input_token: token, access_token: `${cfg.appId}|${cfg.appSecret}` }, { fetchImpl });
  const d = j.data || {};
  return { valid: d.is_valid === true, expires_at: unixIso(d.expires_at) || unixIso(d.data_access_expires_at), scopes: d.scopes || [] };
}

/** Insights with metric-name fallbacks (Meta renames metrics between versions); null when none is accepted. */
export async function insightsWithFallback(cfg, path, metricSets, params, opts) {
  for (const metrics of metricSets) {
    try {
      const j = await graphGet(cfg, `${path}/insights`, { metric: metrics.join(','), ...params }, opts);
      return { metrics, data: j.data || [] };
    } catch (e) {
      if (e instanceof GraphError && e.tokenProblem) throw e;
    }
  }
  return null;
}

/** Follows cursor pages (never the `next` URL, which carries the token) until `stop(item)` or `max` items. */
export async function pagedList(cfg, path, params, opts, { stop = () => false, max = 200 } = {}) {
  const out = [];
  let after = null;
  for (let i = 0; i < 20; i += 1) {
    const j = await graphGet(cfg, path, { ...params, after }, opts);
    const items = j.data || [];
    const keep = items.filter((x) => !stop(x));
    out.push(...keep);
    after = j.paging?.cursors?.after;
    if (keep.length < items.length || !j.paging?.next || !after || out.length >= max) break;
  }
  return out.slice(0, max);
}
