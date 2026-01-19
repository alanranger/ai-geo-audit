export const config = { runtime: 'nodejs' };

import { requireAdminKeyOnly } from '../../lib/api/requireAdminKeyOnly.js';

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-arp-admin-key');
  res.status(status).send(JSON.stringify(body));
};

const parseProjectRef = (supabaseUrl) => {
  if (!supabaseUrl) return null;
  const match = /https?:\/\/([^.]+)\.supabase\.co/.exec(String(supabaseUrl));
  return match ? match[1] : null;
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return sendJson(res, 200, {});
  }

  if (req.method !== 'GET') {
    return sendJson(res, 405, { status: 'error', message: 'Method not allowed. Use GET.' });
  }

  if (!requireAdminKeyOnly(req, res, sendJson)) return;

  const supabaseUrl = process.env.SUPABASE_URL || '';
  const projectRef = parseProjectRef(supabaseUrl);

  return sendJson(res, 200, {
    status: 'ok',
    supabaseUrlHost: supabaseUrl ? new URL(supabaseUrl).host : null,
    projectRef,
    hasServiceKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    hasSupabaseUrl: Boolean(supabaseUrl)
  });
}
