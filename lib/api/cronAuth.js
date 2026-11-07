// lib/api/cronAuth.js
// The one check for every scheduled / sync route (7 Nov 2026). A request runs only if it carries
//   Authorization: Bearer <CRON_SECRET>   (Vercel Cron sends this itself when CRON_SECRET is set; internal calls too)
//   x-arp-admin-key: <ARP_ADMIN_KEY>      (dashboard buttons)
// Nothing else: no x-vercel-cron header on its own, no x-cron-secret, no ?secret= in the URL, no open POST.
import crypto from 'node:crypto';

function same(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** 'cron' | 'admin' | null */
export function cronOrAdmin(req) {
  const secret = String(process.env.CRON_SECRET || '').trim();
  if (secret && same(req?.headers?.authorization, `Bearer ${secret}`)) return 'cron';
  const admin = String(process.env.ARP_ADMIN_KEY || '').trim();
  if (admin && same(req?.headers?.['x-arp-admin-key'], admin)) return 'admin';
  return null;
}

/** Sends 401 and returns false when the caller is neither Vercel Cron / an internal job nor the dashboard admin key. */
export function requireCronOrAdmin(req, res, send) {
  if (cronOrAdmin(req)) return true;
  if (typeof send === 'function') send(res, 401, { ok: false, error: 'unauthorized' });
  else res.status(401).json({ ok: false, error: 'unauthorized' });
  return false;
}

/** Headers for one scheduled route calling another. */
export function cronHeaders() {
  const secret = String(process.env.CRON_SECRET || '').trim();
  return secret ? { Authorization: `Bearer ${secret}` } : {};
}

export const CORS_AUTH_HEADERS = 'Content-Type, Authorization, x-arp-admin-key';
