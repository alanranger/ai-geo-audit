/**
 * Strategy & Actions campaign layer writes (x-arp-admin-key). Nothing is sent, scheduled or published from here.
 * POST { type: 'override', event_key, event_date, event_title, event_url, promote_mode, offer_note, offer_code, offer_ends }
 *      → public.strategy_event_overrides (one row per event; set_by / set_at recorded)
 * POST { type: 'stage', campaign_key, kind, title, event_key, window_start, window_end, categories, stage }
 *      → public.strategy_campaigns (stage + appended stage_history)
 * POST { type: 'theme', title, window_start, window_end, categories } → new theme campaign at stage "proposed"
 */
import { createClient } from '@supabase/supabase-js';
import { requireAdminKeyOnly } from '../../lib/api/requireAdminKeyOnly.js';
import { SIDE_STAGES, STAGES, slug } from '../../lib/strategy-campaigns.mjs';

const DEFAULT_PROPERTY = 'https://www.alanranger.com';
const SET_BY = 'Alan (dashboard, admin key)';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MODES = ['normal', 'dont_promote', 'weekly'];
const KINDS = ['event', 'theme', 'weekly_email'];

function send(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
}
function client() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}
const text = (v, max) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
function dateOrNull(v, name) {
  if (v == null || v === '') return null;
  if (!DATE_RE.test(String(v))) throw new Error(`${name} must be YYYY-MM-DD`);
  return String(v);
}
function categories(v) {
  if (v == null) return null;
  if (!Array.isArray(v) || v.some((n) => !Number.isInteger(Number(n)) || Number(n) < 1 || Number(n) > 12)) throw new Error('categories must be Booking Sheet category numbers 1-12');
  return v.map(Number);
}

export function overrideRow(b, propertyUrl, now) {
  const key = String(b?.event_key || '');
  const date = key.split('|')[0];
  if (!DATE_RE.test(date) || key.length > 250) throw new Error('event_key must be "YYYY-MM-DD|page"');
  if (!MODES.includes(b?.promote_mode || 'normal')) throw new Error(`promote_mode must be one of ${MODES.join(', ')}`);
  return {
    property_url: propertyUrl, event_key: key, event_date: date,
    event_title: text(b.event_title, 200), event_url: text(b.event_url, 300),
    promote_mode: b.promote_mode || 'normal',
    offer_note: text(b.offer_note, 300), offer_code: text(b.offer_code, 40), offer_ends: dateOrNull(b.offer_ends, 'offer_ends'),
    set_by: SET_BY, set_at: now, updated_at: now
  };
}

export function stageRow(b, propertyUrl, now) {
  const key = String(b?.campaign_key || '');
  if (!/^(email|event|theme)\|/.test(key) || key.length > 300) throw new Error('campaign_key must start email| / event| / theme|');
  if (!KINDS.includes(b?.kind)) throw new Error(`kind must be one of ${KINDS.join(', ')}`);
  if (![...STAGES, ...SIDE_STAGES].includes(b?.stage)) throw new Error('unknown stage');
  return {
    property_url: propertyUrl, campaign_key: key, kind: b.kind, title: text(b.title, 200) || key,
    event_key: text(b.event_key, 250), window_start: dateOrNull(b.window_start, 'window_start'), window_end: dateOrNull(b.window_end, 'window_end'),
    categories: categories(b.categories), stage: b.stage, set_by: SET_BY, updated_at: now
  };
}

async function writeOverride(supabase, row) {
  const { error } = await supabase.from('strategy_event_overrides').upsert(row, { onConflict: 'property_url,event_key' });
  if (error) throw new Error(error.message);
  return { table: 'strategy_event_overrides', columns: Object.keys(row) };
}

async function writeStage(supabase, row) {
  const { data: prev, error } = await supabase.from('strategy_campaigns').select('stage_history')
    .eq('property_url', row.property_url).eq('campaign_key', row.campaign_key).maybeSingle();
  if (error) throw new Error(error.message);
  const history = [...(prev?.stage_history || []), { stage: row.stage, at: row.updated_at, by: SET_BY }].slice(-50);
  const full = { ...row, stage_history: history };
  const { error: e2 } = await supabase.from('strategy_campaigns').upsert(full, { onConflict: 'property_url,campaign_key' });
  if (e2) throw new Error(e2.message);
  return { table: 'strategy_campaigns', columns: Object.keys(full), stage_history: history };
}

function themeBody(b) {
  const title = text(b?.title, 200);
  const start = dateOrNull(b?.window_start, 'window_start');
  if (!title || !start) throw new Error('a theme needs a title and a start date');
  return { ...b, kind: 'theme', title, stage: 'proposed', campaign_key: `theme|${slug(title)}|${start}` };
}

const HANDLERS = {
  override: (supabase, b, prop, now) => writeOverride(supabase, overrideRow(b, prop, now)),
  stage: (supabase, b, prop, now) => writeStage(supabase, stageRow(b, prop, now)),
  theme: (supabase, b, prop, now) => writeStage(supabase, stageRow(themeBody(b), prop, now))
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
  if (!requireAdminKeyOnly(req, res, send)) return undefined;
  const b = req.body || {};
  const run = HANDLERS[b.type];
  if (!run) return send(res, 400, { ok: false, error: 'type must be override, stage or theme' });
  try {
    const out = await run(client(), b, String(b.propertyUrl || DEFAULT_PROPERTY), new Date().toISOString());
    return send(res, 200, { ok: true, set_by: SET_BY, ...out });
  } catch (err) {
    return send(res, 400, { ok: false, error: err?.message || String(err) });
  }
}
