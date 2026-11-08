/**
 * Quarter plan / initiative records (lib/strategy-initiatives.mjs). Nothing is sent, scheduled or published from here.
 * GET  → the stored records (initiatives, quarter plans, links, assets) + the action mapping counts per quarter.
 * POST (x-arp-admin-key), every write appends { at, by, changes } to the row's history; nothing is deleted:
 *   { type: 'initiative', initiative_key, ...fields, create? } → public.strategy_initiatives
 *   { type: 'link', ref_type: campaign|delivery|action, ref_key, initiative_key, role: primary|supporting,
 *     purpose_primary, purpose_secondary, module_purposes, related_ref, note } → public.strategy_initiative_links
 *     (a new primary initiative for a ref moves the existing primary row, keeping its history: one primary per ref)
 *   { type: 'asset', asset_key, kind, title, url, status, reuse, used_in, note } → public.strategy_content_assets
 *   { type: 'quarter', quarter_key, label, theme, review_note, milestone_key, initiative_keys } → public.strategy_quarter_plans
 */
import { createClient } from '@supabase/supabase-js';
import { requireAdminKeyOnly } from '../../lib/api/requireAdminKeyOnly.js';
import { OWNERS, PURPOSES, actionMapping, actionViews, linkIndex } from '../../lib/strategy-initiatives.mjs';

const DEFAULT_PROPERTY = 'https://www.alanranger.com';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REF_TYPES = ['campaign', 'delivery', 'action'];
const ASSET_KINDS = ['page', 'email', 'newsletter', 'video', 'blog', 'image', 'post', 'document'];
const ASSET_STATUS = ['existing', 'draft', 'planned', 'retired'];

function send(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
}
function client() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}
const BY = { claude: 'Alan via Claude (admin key)', gpt: 'Alan via GPT (admin key)', cursor: 'Cursor self-test (admin key)' };
export const setByOf = (b) => BY[b?.via] || 'Alan (dashboard, admin key)';

const text = (max) => (v) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
function date(v) {
  if (v == null || v === '') return null;
  if (!DATE_RE.test(String(v))) throw new Error('dates must be YYYY-MM-DD');
  return String(v);
}
function owner(v) {
  if (!OWNERS.includes(v)) throw new Error(`owner must be one of ${OWNERS.join(', ')}`);
  return v;
}
function obj(v) {
  if (v != null && (typeof v !== 'object' || Array.isArray(v))) throw new Error('target / forecast / focus / status_rule must be objects');
  return v ?? null;
}
const strList = (v) => (Array.isArray(v) ? v.map((s) => String(s).slice(0, 300)).filter(Boolean).slice(0, 60) : []);
const INITIATIVE_FIELDS = {
  title: text(200), summary: text(1500), delivery_plan: text(500), why_now: text(500), owner_detail: text(200), next_action: text(300), status_label: text(40),
  owner, next_action_date: date, review_date: date, start_date: date, end_date: date,
  target: obj, forecast: obj, focus: obj, status_rule: obj, quarter_keys: strList
};

/** Only the fields present in the body, validated. */
export function initiativePatch(b) {
  const key = text(80)(b?.initiative_key);
  if (!key || !/^[a-z0-9-]+$/.test(key)) throw new Error('initiative_key must be lower-case letters, digits and dashes');
  const patch = {};
  for (const [f, fn] of Object.entries(INITIATIVE_FIELDS)) if (b[f] !== undefined) patch[f] = fn(b[f]);
  if (patch.title === null) throw new Error('title cannot be empty');
  if (!Object.keys(patch).length) throw new Error('nothing to change');
  return { key, patch };
}
function purposeList(v) {
  const list = strList(v);
  if (list.some((p) => !PURPOSES.includes(p))) throw new Error(`purposes must be ${PURPOSES.join(', ')}`);
  return list;
}
function linkRefs(b) {
  if (!REF_TYPES.includes(b?.ref_type)) throw new Error(`ref_type must be one of ${REF_TYPES.join(', ')}`);
  const ref_key = text(300)(b.ref_key);
  const initiative_key = text(80)(b.initiative_key);
  if (!ref_key || !initiative_key) throw new Error('ref_key and initiative_key are required');
  const role = b.role || 'primary';
  if (!['primary', 'supporting'].includes(role)) throw new Error('role must be primary or supporting');
  return { ref_key, initiative_key, role };
}
function primaryPurpose(b, role) {
  const p = b.purpose_primary == null || b.purpose_primary === '' ? null : String(b.purpose_primary);
  if (p && !PURPOSES.includes(p)) throw new Error(`purpose_primary must be one of ${PURPOSES.join(', ')}`);
  if (role === 'supporting' && (p || (b.purpose_secondary || []).length)) throw new Error('purpose tags go on the primary link only (counted once)');
  return p;
}
/** Only the fields sent are written (a purpose change never clears related_ref / note, a move never clears purposes). */
function optionalLinkFields(b, role) {
  const out = {};
  if (b.purpose_primary !== undefined || role === 'supporting') out.purpose_primary = primaryPurpose(b, role);
  if (b.purpose_secondary !== undefined) out.purpose_secondary = purposeList(b.purpose_secondary);
  if (Array.isArray(b.module_purposes)) out.module_purposes = b.module_purposes.slice(0, 40).map((m) => ({ label: String(m?.label || '').slice(0, 120), purpose: purposeList([m?.purpose])[0] }));
  if (b.related_ref !== undefined) out.related_ref = text(300)(b.related_ref);
  if (b.note !== undefined) out.note = text(300)(b.note);
  return out;
}
export function linkRow(b) {
  const { ref_key, initiative_key, role } = linkRefs(b);
  return { ref_type: b.ref_type, ref_key, initiative_key, role, ...optionalLinkFields(b, role) };
}
export function assetRow(b) {
  const asset_key = text(120)(b?.asset_key);
  const title = text(200)(b?.title);
  if (!asset_key || !title) throw new Error('asset_key and title are required');
  if (!ASSET_KINDS.includes(b.kind)) throw new Error(`kind must be one of ${ASSET_KINDS.join(', ')}`);
  if (b.status && !ASSET_STATUS.includes(b.status)) throw new Error(`status must be one of ${ASSET_STATUS.join(', ')}`);
  return { asset_key, kind: b.kind, title, url: text(400)(b.url), status: b.status || 'existing', reuse: b.reuse !== false, used_in: strList(b.used_in), note: text(300)(b.note) };
}
const QUARTER_FIELDS = { label: text(60), theme: text(200), review_note: text(200), milestone_key: text(10), initiative_keys: strList };
export function quarterPatch(b) {
  const key = text(20)(b?.quarter_key);
  if (!key) throw new Error('quarter_key is required');
  const patch = {};
  for (const [f, fn] of Object.entries(QUARTER_FIELDS)) if (b[f] !== undefined) patch[f] = fn(b[f]);
  if (patch.theme === null) throw new Error('theme cannot be empty');
  if (!Object.keys(patch).length) throw new Error('nothing to change');
  return { key, patch };
}

/** { field: { from, to } } for the fields that actually change. */
export function changesOf(prev, patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch)) if (JSON.stringify(prev?.[k] ?? null) !== JSON.stringify(v ?? null)) out[k] = { from: prev?.[k] ?? null, to: v ?? null };
  return out;
}
const histEntry = (by, now, changes, extra = {}) => ({ at: now, by, changes, ...extra });

async function one(q) {
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
async function writeInitiative(sb, b, prop, now, by) {
  const { key, patch } = initiativePatch(b);
  const prev = await one(sb.from('strategy_initiatives').select('*').eq('property_url', prop).eq('initiative_key', key));
  if (!prev && !b.create) throw new Error(`initiative ${key} not found (send create: true to add one)`);
  const changes = changesOf(prev, patch);
  if (prev && !Object.keys(changes).length) return { table: 'strategy_initiatives', initiative_key: key, unchanged: true };
  const history = [...(prev?.history || []), histEntry(by, now, changes)].slice(-100);
  const row = prev ? { ...patch, history, set_by: by, updated_at: now } : { property_url: prop, initiative_key: key, kind: b.kind === 'programme' ? 'programme' : 'initiative', owner: 'Claude', ...patch, history, set_by: by };
  const q = prev ? sb.from('strategy_initiatives').update(row).eq('property_url', prop).eq('initiative_key', key) : sb.from('strategy_initiatives').insert(row);
  const { error } = await q;
  if (error) throw new Error(error.message);
  return { table: 'strategy_initiatives', initiative_key: key, created: !prev, changes };
}
async function existingPrimary(sb, prop, r) {
  return one(sb.from('strategy_initiative_links').select('*').eq('property_url', prop).eq('ref_type', r.ref_type).eq('ref_key', r.ref_key).eq('role', 'primary'));
}
async function writeLink(sb, b, prop, now, by) {
  const r = linkRow(b);
  const prev = r.role === 'primary' ? await existingPrimary(sb, prop, r) : await one(sb.from('strategy_initiative_links').select('*').eq('property_url', prop).eq('ref_type', r.ref_type).eq('ref_key', r.ref_key).eq('initiative_key', r.initiative_key));
  const changes = changesOf(prev, r);
  if (prev && !Object.keys(changes).length) return { table: 'strategy_initiative_links', ref: `${r.ref_type}|${r.ref_key}`, unchanged: true };
  const history = [...(prev?.history || []), histEntry(by, now, changes)].slice(-100);
  const row = { ...r, history, set_by: by, set_at: now };
  const q = prev
    ? sb.from('strategy_initiative_links').update(row).eq('property_url', prop).eq('ref_type', prev.ref_type).eq('ref_key', prev.ref_key).eq('initiative_key', prev.initiative_key)
    : sb.from('strategy_initiative_links').insert({ property_url: prop, ...row });
  const { error } = await q;
  if (error) throw new Error(error.message);
  return { table: 'strategy_initiative_links', ref: `${r.ref_type}|${r.ref_key}`, initiative_key: r.initiative_key, moved_from: prev && prev.initiative_key !== r.initiative_key ? prev.initiative_key : null, changes };
}
async function writeAsset(sb, b, prop, now, by) {
  const r = assetRow(b);
  const prev = await one(sb.from('strategy_content_assets').select('*').eq('property_url', prop).eq('asset_key', r.asset_key));
  const changes = changesOf(prev, r);
  const { error } = await sb.from('strategy_content_assets').upsert({ property_url: prop, ...r, history: [...(prev?.history || []), histEntry(by, now, changes)].slice(-100), set_by: by, set_at: now }, { onConflict: 'property_url,asset_key' });
  if (error) throw new Error(error.message);
  return { table: 'strategy_content_assets', asset_key: r.asset_key, created: !prev, changes };
}
async function writeQuarter(sb, b, prop, now, by) {
  const { key, patch } = quarterPatch(b);
  const prev = await one(sb.from('strategy_quarter_plans').select('*').eq('property_url', prop).eq('quarter_key', key));
  if (!prev) throw new Error(`quarter ${key} not found`);
  const changes = changesOf(prev, patch);
  const { error } = await sb.from('strategy_quarter_plans').update({ ...patch, history: [...(prev.history || []), histEntry(by, now, changes)].slice(-100), set_by: by, updated_at: now }).eq('property_url', prop).eq('quarter_key', key);
  if (error) throw new Error(error.message);
  return { table: 'strategy_quarter_plans', quarter_key: key, changes };
}

const HANDLERS = { initiative: writeInitiative, link: writeLink, asset: writeAsset, quarter: writeQuarter };

async function getRecords(sb, prop) {
  const all = (t) => sb.from(t).select('*').eq('property_url', prop).limit(2000).then((r) => { if (r.error) throw new Error(`${t}: ${r.error.message}`); return r.data || []; });
  const [initiatives, quarters, links, assets, actions] = await Promise.all([all('strategy_initiatives'), all('strategy_quarter_plans'), all('strategy_initiative_links'), all('strategy_content_assets'), all('strategy_quarter_actions')]);
  return { initiatives, quarters, links, assets, action_mapping: actionMapping(actionViews(actions, linkIndex(links))) };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const prop = String(req.query?.propertyUrl || req.body?.propertyUrl || DEFAULT_PROPERTY);
  try {
    if (req.method === 'GET') return send(res, 200, { ok: true, ...(await getRecords(client(), prop)) });
    if (req.method !== 'POST') return send(res, 405, { ok: false, error: 'Method not allowed' });
    if (!requireAdminKeyOnly(req, res, send)) return undefined;
    const b = req.body || {};
    const run = HANDLERS[b.type];
    if (!run) return send(res, 400, { ok: false, error: 'type must be initiative, link, asset or quarter' });
    const by = setByOf(b);
    return send(res, 200, { ok: true, set_by: by, ...(await run(client(), b, prop, new Date().toISOString(), by)) });
  } catch (err) {
    return send(res, 400, { ok: false, error: err?.message || String(err) });
  }
}
