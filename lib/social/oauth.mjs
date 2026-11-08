/**
 * "Connect Facebook & Instagram": Meta OAuth (Facebook Login for Business), read-only scopes.
 *   start    (admin key) → one-use state (sha256 stored, 10 min) → Meta login URL for the browser to open.
 *   callback (Meta redirect) → state claimed once → code → long-lived user token → Page token (non-expiring) + linked
 *            IG business id → Page token stored encrypted. The user token is not stored. Nothing token-shaped is ever
 *            returned, redirected with or logged; failures redirect with a short reason code only.
 */
import { encryptToken, hashState, newState } from './crypto.mjs';
import { exchangeCode, extraScopes, grantedScopes, listPages, loginUrl, metaConfig, missingMetaEnv, pickPage, tokenHealth } from './meta.mjs';

const STATE_MS = 10 * 60 * 1000;
export const DASH = '/audit-dashboard.html';
export const redirectFor = (reason) => (reason === 'ok' ? `${DASH}?social_connect=ok#marketing` : `${DASH}?social_connect=error&reason=${encodeURIComponent(reason)}#marketing`);

export async function startConnect({ repo, env = process.env, now = Date.now(), withBusiness = false }) {
  const missing = missingMetaEnv(env);
  if (missing.length) return { ok: false, error: 'not_configured', missing };
  const state = newState();
  await repo.createState(hashState(state), new Date(now + STATE_MS).toISOString());
  return { ok: true, url: loginUrl(metaConfig(env), state, { withBusiness }) };
}

/** Everything that must hold before any call to Meta: user approved, state genuine and unused, code present, env set. */
async function precheck({ query, repo, env, nowIso }) {
  if (query.error) return 'declined';
  if (!query.state || !(await repo.consumeState(hashState(query.state), nowIso))) return 'state_invalid';
  if (!query.code) return 'no_code';
  return missingMetaEnv(env).length ? 'not_configured' : null;
}

async function linkPage({ query, repo, env, fetchImpl, nowIso }) {
  const cfg = metaConfig(env);
  const userToken = await exchangeCode(cfg, query.code, fetchImpl);
  const granted = await grantedScopes(cfg, userToken, fetchImpl);
  if (extraScopes(granted).length) return 'extra_permissions';
  const page = pickPage(await listPages(cfg, userToken, fetchImpl));
  if (!page?.access_token) return 'no_pages';
  const health = await tokenHealth(cfg, page.access_token, fetchImpl).catch(() => ({ expires_at: null }));
  await repo.saveConnection({
    page_id: String(page.id), page_name: page.name || null,
    ig_user_id: page.instagram_business_account?.id || null, ig_username: page.instagram_business_account?.username || null,
    token_encrypted: encryptToken(page.access_token, env), scopes: granted, connected_at: nowIso, expires_at: health.expires_at,
    status: 'connected', last_checked_at: nowIso, last_error: null
  });
  return 'ok';
}

/** Returns the redirect path only. */
export async function handleCallback({ query = {}, repo, env = process.env, fetchImpl = fetch, now = Date.now() }) {
  const nowIso = new Date(now).toISOString();
  try {
    const bad = await precheck({ query, repo, env, nowIso });
    if (bad) return redirectFor(bad);
    return redirectFor(await linkPage({ query, repo, env, fetchImpl, nowIso }));
  } catch (e) {
    console.error(`[social-oauth] callback failed: ${e?.code || 'error'}`);
    return redirectFor('meta_error');
  }
}

/** Connection state for the tiles: never includes the token. */
export function connectionStatus(row, env = process.env) {
  const missing = missingMetaEnv(env);
  if (!row) return { state: missing.length ? 'not_configured' : 'not_connected', missing };
  return {
    state: row.status === 'connected' ? 'connected' : row.status,
    page_name: row.page_name, ig_username: row.ig_username, ig_linked: !!row.ig_user_id, since: row.connected_at,
    expires_at: row.expires_at, last_checked_at: row.last_checked_at, last_collected_at: row.last_collected_at,
    last_error: row.last_error, scopes: row.scopes || [], missing
  };
}
