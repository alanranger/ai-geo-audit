/**
 * Token encryption for social_connections.token_encrypted: AES-256-GCM, key = SOCIAL_TOKEN_KEY (Vercel env, 32 random
 * bytes as base64). Stored as "v1:<iv>:<tag>:<ciphertext>" (base64 parts). Error messages never include the token.
 */
import crypto from 'node:crypto';

export const KEY_ENV = 'SOCIAL_TOKEN_KEY';

export function tokenKey(env = process.env) {
  const raw = String(env[KEY_ENV] || '').trim();
  if (!raw) throw Object.assign(new Error('social_token_key_missing'), { code: 'social_token_key_missing' });
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw Object.assign(new Error('social_token_key_invalid'), { code: 'social_token_key_invalid' });
  return key;
}

export function encryptToken(token, env = process.env) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey(env), iv);
  const ct = Buffer.concat([cipher.update(String(token), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function decryptToken(stored, env = process.env) {
  const [v, iv, tag, ct] = String(stored || '').split(':');
  if (v !== 'v1' || !iv || !tag || !ct) throw Object.assign(new Error('social_token_unreadable'), { code: 'social_token_unreadable' });
  try {
    const d = crypto.createDecipheriv('aes-256-gcm', tokenKey(env), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
  } catch {
    throw Object.assign(new Error('social_token_unreadable'), { code: 'social_token_unreadable' });
  }
}

/** One-use OAuth state: the browser never sees more than the random value; only its sha256 is stored. */
export const newState = () => crypto.randomBytes(32).toString('hex');
export const hashState = (s) => crypto.createHash('sha256').update(String(s || '')).digest('hex');
