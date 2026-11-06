/**
 * Google OAuth refresh-token exchange. Google's own temporary errors (internal_failure, temporarily_unavailable,
 * 5xx, network) are retried with a short backoff; invalid_grant / invalid_client are not, as only re-connecting in
 * Google fixes them. Logs the error code and outcome only, never a token or secret.
 */
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TRANSIENT = new Set(['internal_failure', 'temporarily_unavailable', 'server_error', 'backend_error', 'network_error']);
const RECONNECT = new Set(['invalid_grant', 'invalid_client', 'unauthorized_client']);
export const RETRY_DELAYS_MS = [2000, 5000];
const NAMES = { youtube: 'YouTube', ga4: 'GA4', gsc: 'Search Console', gbp: 'Business Profile' };

export function tokenErrorPlain(label, code) {
  const name = NAMES[label] || label;
  if (RECONNECT.has(code)) return `${name}: Google sign-in for this connection has expired or was revoked — re-connect it in Google.`;
  if (TRANSIENT.has(code) || /^http_5\d\d$/.test(code)) return `${name}: Google's sign-in service had a temporary error — try again in a few minutes.`;
  return `${name}: Google sign-in failed (${code}).`;
}

async function tryOnce(fetchImpl, body) {
  try {
    const res = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.access_token) return { ok: true, json };
    const code = String(json?.error || `http_${res.status}`);
    return { ok: false, code, transient: TRANSIENT.has(code) || res.status >= 500 };
  } catch {
    return { ok: false, code: 'network_error', transient: true };
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function refreshGoogleAccessToken({ clientId, clientSecret, refreshToken, label = 'google', fetchImpl = fetch, delays = RETRY_DELAYS_MS }) {
  const body = new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' });
  let last = null;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    if (attempt) await sleep(delays[attempt - 1]);
    last = await tryOnce(fetchImpl, body);
    if (last.ok) {
      if (attempt) console.info(`[${label}_oauth] token ok after ${attempt} retr${attempt === 1 ? 'y' : 'ies'}`);
      return { accessToken: last.json.access_token, scope: String(last.json.scope || '') };
    }
    console.warn(`[${label}_oauth] token attempt ${attempt + 1} failed: ${last.code}`);
    if (!last.transient) break;
  }
  const err = new Error(`${label}_oauth: ${last.code}`);
  Object.assign(err, { code: last.code, transient: last.transient, reconnect: RECONNECT.has(last.code), plain: tokenErrorPlain(label, last.code) });
  throw err;
}
