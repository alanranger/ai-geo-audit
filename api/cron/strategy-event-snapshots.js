// Daily strategy_event_snapshots — Vercel cron + manual POST.
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { createClient } from '@supabase/supabase-js';
import { runStrategyEventSnapshots } from '../../lib/strategy-snapshots.mjs';

const PROP = 'https://www.alanranger.com';

function authorise(req) {
  if (req.method === 'POST') return true;
  if (req.method === 'GET' && String(req.headers['x-vercel-cron'] || '') === '1') return true;
  const secret = process.env.CRON_SECRET || process.env.STRATEGY_SNAPSHOT_SECRET;
  if (secret && (req.headers.authorization === `Bearer ${secret}` || req.query?.secret === secret)) return true;
  return false;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!['GET', 'POST'].includes(req.method)) {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!authorise(req)) return res.status(401).json({ ok: false, error: 'Unauthorized' });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE;
  if (!url || !key) return res.status(500).json({ ok: false, error: 'Missing Supabase credentials' });
  try {
    const propertyUrl = String(req.query?.propertyUrl || PROP);
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const result = await runStrategyEventSnapshots(supabase, propertyUrl);
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || String(e) });
  }
}
