/**
 * Local CLI env: prefer .env.vercel.prod sb_secret / sb_publishable over
 * disabled legacy JWTs in .env.local (legacy keys disabled 2026-09-21).
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JWT = /^eyJ/;

function parseEnvFile(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    const val = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '');
    const cur = process.env[m[1]] || '';
    if (!cur || (JWT.test(cur) && (val.startsWith('sb_') || !JWT.test(val)))) {
      process.env[m[1]] = val;
    }
  }
}

export function loadLocalSupabaseEnv(root = ROOT) {
  for (const name of ['.env.vercel.prod', '.env.local', '.env']) {
    parseEnvFile(resolve(root, name));
  }
  return {
    url: process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE || ''
  };
}

export function isLegacyJwt(value) {
  return JWT.test(String(value || '').trim());
}
