/**
 * Strategy & Actions tick states for lead-time moments and weekly campaign steps.
 * GET  ?propertyUrl= → { ok, ticks: { [tick_key]: { is_ticked, ticked_at, moved_to, status, reason, set_by, set_at, history } } }
 * PATCH { propertyUrl, keys: [tick_key…], is_ticked, via? } → done / untick (status 'done' / cleared), who + when, logged.
 * PATCH { propertyUrl, keys: [step key], status: 'skipped' | 'not_needed' | null, reason, via? } → skip (reason required) / clear.
 * PATCH { propertyUrl, keys: [step key], moved_to: 'YYYY-MM-DD' | null, via? } → reschedules one step (tick state unchanged).
 * Who: "Alan (dashboard)" unless `via` says ChatGPT. Every change appends { action, by, at, … } to history (last 50).
 * Table: public.strategy_campaign_ticks. Automatic states (evidence) are derived on read, never written here.
 */
import { createClient } from '@supabase/supabase-js';
import { loadCampaignTicks } from '../../lib/strategy-moments.mjs';

const DEFAULT_PROPERTY = 'https://www.alanranger.com';
const KEY_RE = /^(moment|catchup|lastchance|step|plan)\|/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ['skipped', 'not_needed'];

function send(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
}

function client() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

const readTicks = loadCampaignTicks;
export const whoOf = (b) => (/chatgpt/i.test(String(b?.via || '')) ? 'ChatGPT' : 'Alan (dashboard)');

/** Done / untick: done sets status 'done'; untick clears a 'done' status (a skip stays a skip). */
export function tickPatch(isTicked, now) {
  return (prev) => ({
    fields: { is_ticked: isTicked, ticked_at: isTicked ? now : null, status: isTicked ? 'done' : (prev?.status === 'done' ? null : prev?.status ?? null), ...(isTicked ? { reason: null } : {}) },
    entry: { action: isTicked ? 'done' : 'untick' }
  });
}
export function statusPatch(status, reason) {
  if (status !== null && !STATUSES.includes(status)) throw new Error('status must be skipped, not_needed or null');
  const why = reason == null ? '' : String(reason).trim().slice(0, 300);
  if (status === 'skipped' && !why) throw new Error('a skip needs a reason');
  return () => ({ fields: { status, reason: status ? why || null : null, ...(status ? { is_ticked: false, ticked_at: null } : {}) }, entry: { action: status || 'clear', ...(why ? { reason: why } : {}) } });
}
export function movePatch(movedTo) {
  if (movedTo !== null && !DATE_RE.test(String(movedTo))) throw new Error('moved_to must be YYYY-MM-DD or null');
  return () => ({ fields: { moved_to: movedTo }, entry: { action: 'move', moved_to: movedTo } });
}

/** One row per key: the patch's fields + who / when, with the change appended to that row's history. */
export function patchedRows(keys, prevByKey, patch, { propertyUrl, by, now }) {
  return keys.map((k) => {
    const prev = prevByKey.get(k) || null;
    const { fields, entry } = patch(prev);
    const history = [...(prev?.history || []), { ...entry, by, at: now }].slice(-50);
    return { property_url: propertyUrl, tick_key: k, is_ticked: prev?.is_ticked ?? false, ...fields, set_by: by, set_at: now, history, updated_at: now };
  });
}

async function writePatch(supabase, propertyUrl, keys, patch, by) {
  const now = new Date().toISOString();
  const { data, error } = await supabase.from('strategy_campaign_ticks').select('tick_key, is_ticked, status, history').eq('property_url', propertyUrl).in('tick_key', keys);
  if (error) throw new Error(error.message);
  const rows = patchedRows(keys, new Map((data || []).map((r) => [r.tick_key, r])), patch, { propertyUrl, by, now });
  const { error: e2 } = await supabase.from('strategy_campaign_ticks').upsert(rows, { onConflict: 'property_url,tick_key' });
  if (e2) throw new Error(e2.message);
  return rows.length;
}

function validKeys(body) {
  const keys = Array.isArray(body?.keys) ? body.keys.map(String) : [];
  return keys.length && keys.length <= 100 && keys.every((k) => KEY_RE.test(k) && k.length <= 200) ? keys : null;
}

/** Which change the body asks for. Move / status apply to the first key only. */
export function patchFor(body, now) {
  const b = body || {};
  if ('moved_to' in b) return { patch: movePatch(b.moved_to || null), single: true };
  if ('status' in b) return { patch: statusPatch(b.status || null, b.reason), single: true };
  return { patch: tickPatch(!!b.is_ticked, now), single: false };
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
    if (!keys) return send(res, 400, { ok: false, error: 'keys must be 1-100 moment|… / lastchance|… / step|… / plan|… keys' });
    let change;
    try { change = patchFor(req.body, new Date().toISOString()); } catch (err) { return send(res, 400, { ok: false, error: err.message }); }
    const by = whoOf(req.body);
    const written = await writePatch(supabase, String(req.body.propertyUrl || DEFAULT_PROPERTY), change.single ? keys.slice(0, 1) : keys, change.patch, by);
    return send(res, 200, { ok: true, written, set_by: by, table: 'strategy_campaign_ticks' });
  } catch (err) {
    return send(res, 500, { ok: false, error: err?.message || String(err) });
  }
}
