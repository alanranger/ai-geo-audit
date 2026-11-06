/**
 * Strategy & Actions tick states for lead-time moments and weekly campaign steps.
 * GET  ?propertyUrl= → { ok, ticks: { [tick_key]: { is_ticked, ticked_at } } }
 * PATCH { propertyUrl, keys: [tick_key…], is_ticked } → writes public.strategy_campaign_ticks (one row per key).
 */
import { createClient } from '@supabase/supabase-js';
import { loadCampaignTicks } from '../../lib/strategy-moments.mjs';

const DEFAULT_PROPERTY = 'https://www.alanranger.com';
const KEY_RE = /^(moment|catchup|lastchance|step)\|/;

function send(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
}

function client() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

const readTicks = loadCampaignTicks;

async function writeTicks(supabase, propertyUrl, keys, isTicked) {
  const now = new Date().toISOString();
  const rows = keys.map((k) => ({ property_url: propertyUrl, tick_key: k, is_ticked: isTicked, ticked_at: isTicked ? now : null, updated_at: now }));
  const { error } = await supabase.from('strategy_campaign_ticks').upsert(rows, { onConflict: 'property_url,tick_key' });
  if (error) throw new Error(error.message);
  return rows.length;
}

function validKeys(body) {
  const keys = Array.isArray(body?.keys) ? body.keys.map(String) : [];
  return keys.length && keys.length <= 100 && keys.every((k) => KEY_RE.test(k) && k.length <= 200) ? keys : null;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  try {
    const supabase = client();
    if (req.method === 'GET') {
      const propertyUrl = String(req.query?.propertyUrl || DEFAULT_PROPERTY);
      return send(res, 200, { ok: true, ticks: await readTicks(supabase, propertyUrl) });
    }
    if (req.method !== 'PATCH') return send(res, 405, { ok: false, error: 'Method not allowed' });
    const keys = validKeys(req.body);
    if (!keys) return send(res, 400, { ok: false, error: 'keys must be 1-100 moment|… / lastchance|… / step|… keys' });
    const written = await writeTicks(supabase, String(req.body.propertyUrl || DEFAULT_PROPERTY), keys, !!req.body.is_ticked);
    return send(res, 200, { ok: true, written, table: 'strategy_campaign_ticks' });
  } catch (err) {
    return send(res, 500, { ok: false, error: err?.message || String(err) });
  }
}
