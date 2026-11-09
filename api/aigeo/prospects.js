/**
 * Strategy Prospects (QUESTION-2026-11-09 (i)): non-dated enquiries. Admin only (x-arp-admin-key) for reads and writes,
 * because rows hold personal data. Nothing is emailed to anyone from here; no £ is added to actual sales.
 * GET  → { rows, config, history } for the Strategy table (admin key).
 * POST { action: 'upsert', via: 'gpt' | 'claude', enquiry: { id?, client_or_org, type, value_gbp, stage, cash_month,
 *        next_action, next_action_date, owner, last_touch_at, source, lost_reason, notes, person_id }, matched_sale? }
 *   - idempotent by id: an unchanged payload writes nothing; a new id (or none) creates the row;
 *   - every create / change appends a history row (stage from → to, changed fields, who, when);
 *   - stage booked_paid needs matched_sale { txn_date, amount } (or { source_workbook, source_row }) that exists in the
 *     Booking Sheet: the enquiry then leaves the pipeline and its money counts only as that actual sale;
 *   - stage closed_lost needs lost_reason.
 */
import { createClient } from '@supabase/supabase-js';
import { requireAdminKeyOnly } from '../../lib/api/requireAdminKeyOnly.js';
import { OWNERS, SOURCES, STAGES, TYPES } from '../../lib/strategy-prospects.mjs';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^(\d{4}-\d{2})(-\d{2})?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ID_RE = /^[A-Za-z0-9._:-]{3,80}$/;

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

/* ---------- validation ---------- */

const text = (max) => (v) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, max));
const oneOf = (list, name) => (v) => {
  if (!list.includes(v)) throw new Error(`${name} must be one of: ${list.join(', ')}`);
  return v;
};
const oneOfOrNull = (list, name) => (v) => (v == null || v === '' ? null : oneOf(list, name)(v));
function date(v) {
  if (v == null || v === '') return null;
  if (!DATE_RE.test(String(v))) throw new Error('dates must be YYYY-MM-DD');
  return String(v);
}
function cashMonth(v) {
  if (v == null || v === '') return null;
  const m = MONTH_RE.exec(String(v));
  if (!m) throw new Error('cash_month must be YYYY-MM (or a date in that month)');
  return `${m[1]}-01`;
}
function money(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1e6) throw new Error('value_gbp must be a number of pounds ≥ 0');
  return Math.round(n * 100) / 100;
}
function stamp(v) {
  if (v == null || v === '') return null;
  const t = Date.parse(String(v));
  if (!Number.isFinite(t)) throw new Error('last_touch_at must be a date or ISO time');
  return new Date(t).toISOString();
}
function uuid(v) {
  if (v == null || v === '') return null;
  if (!UUID_RE.test(String(v))) throw new Error('person_id must be a customer_person uuid');
  return String(v);
}
const FIELDS = {
  client_or_org: text(200), person_id: uuid, type: oneOf(TYPES, 'type'), value_gbp: money, stage: oneOf(STAGES, 'stage'), cash_month: cashMonth,
  next_action: text(300), next_action_date: date, owner: oneOf(OWNERS, 'owner'), last_touch_at: stamp, source: oneOfOrNull(SOURCES, 'source'),
  lost_reason: text(300), notes: text(500)
};
/** Only the fields sent are validated and written. */
export function enquiryPatch(e) {
  const patch = {};
  for (const [f, fn] of Object.entries(FIELDS)) if (e?.[f] !== undefined) patch[f] = fn(e[f]);
  if (patch.client_or_org === null) throw new Error('client_or_org cannot be empty');
  return patch;
}
export function idOf(v) {
  if (v == null || v === '') return null;
  if (!ID_RE.test(String(v))) throw new Error('id: 3–80 letters, digits, . _ : -');
  return String(v);
}
const same = (a, b) => (a == null && b == null) || String(a) === String(b) || (Number.isFinite(Number(a)) && Number(a) === Number(b) && a !== '' && b !== '');
export function changesOf(prev, patch) {
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    const was = k === 'cash_month' || k === 'next_action_date' ? (prev?.[k] ? String(prev[k]).slice(0, 10) : null) : prev?.[k] ?? null;
    if (!same(was, v)) out[k] = { from: was, to: v };
  }
  return out;
}
/** Stage rules: booked_paid needs a Booking Sheet match; closed_lost needs a reason; a new row needs who and what. */
export function stageRule(prev, patch, matched) {
  const stage = patch.stage || prev?.stage || 'qualify';
  if (!prev && (!patch.client_or_org || !patch.type)) throw new Error('a new enquiry needs client_or_org and type');
  if (stage === 'booked_paid' && prev?.stage !== 'booked_paid' && !matched) throw new Error('booked_paid needs matched_sale { txn_date, amount } from the Booking Sheet');
  if (stage === 'closed_lost' && !(patch.lost_reason || prev?.lost_reason)) throw new Error('closed_lost needs lost_reason');
  return stage;
}

/* ---------- reads / writes ---------- */

const one = async (q) => {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data || [])[0] || null;
};
/** The Booking Sheet sale a booked_paid enquiry is matched to (no client name is copied). */
async function matchSale(sb, m) {
  if (!m) return null;
  let q = sb.from('booking_sheet_transactions').select('source_workbook, source_row, txn_date, amount, category_label').limit(1);
  if (m.source_workbook && m.source_row != null) q = q.eq('source_workbook', String(m.source_workbook)).eq('source_row', Number(m.source_row));
  else if (DATE_RE.test(String(m.txn_date || '')) && Number.isFinite(Number(m.amount))) q = q.eq('txn_date', m.txn_date).eq('amount', Number(m.amount));
  else throw new Error('matched_sale needs { txn_date, amount } or { source_workbook, source_row }');
  const sale = await one(q);
  if (!sale) throw new Error('matched_sale not found in the Booking Sheet');
  return sale;
}
async function writeHistory(sb, row) {
  const { error } = await sb.from('prospect_enquiry_history').insert(row);
  if (error) throw new Error(`history: ${error.message}`);
}
async function upsertEnquiry(sb, b, now, by) {
  const e = b.enquiry || {};
  const id = idOf(e.id);
  const patch = enquiryPatch(e);
  const prev = id ? await one(sb.from('prospect_enquiry').select('*').eq('id', id)) : null;
  const matched = await matchSale(sb, b.matched_sale);
  const stage = stageRule(prev, patch, matched);
  if (!prev) return createEnquiry(sb, { id, patch, stage, matched, now, by });
  const changes = changesOf(prev, patch);
  if (!Object.keys(changes).length && !matched) return { id, unchanged: true };
  const { error } = await sb.from('prospect_enquiry').update({ ...patch, updated_at: now }).eq('id', id);
  if (error) throw new Error(error.message);
  await writeHistory(sb, { enquiry_id: id, at: now, by, from_stage: prev.stage, to_stage: stage, changes, matched_sale: matched });
  return { id, updated: true, changes, stage };
}
async function createEnquiry(sb, { id, patch, stage, matched, now, by }) {
  const row = { ...(id ? { id } : {}), stage, owner: 'Alan', ...patch, last_touch_at: patch.last_touch_at || now, created_by: by, created_at: now, updated_at: now };
  const { data, error } = await sb.from('prospect_enquiry').insert(row).select('id').single();
  if (error) throw new Error(error.message);
  await writeHistory(sb, { enquiry_id: data.id, at: now, by, from_stage: null, to_stage: stage, changes: { created: true }, matched_sale: matched });
  return { id: data.id, created: true, stage };
}
async function getAll(sb) {
  const [rows, config, history] = await Promise.all([
    sb.from('prospect_enquiry').select('*').order('created_at', { ascending: true }).limit(2000),
    sb.from('prospect_stage_config').select('stage, probability, label, sort').order('sort', { ascending: true }),
    sb.from('prospect_enquiry_history').select('enquiry_id, at, by, from_stage, to_stage, changes, matched_sale').order('at', { ascending: true }).limit(10000)
  ]);
  for (const r of [rows, config, history]) if (r.error) throw new Error(r.error.message);
  return { rows: rows.data || [], config: config.data || [], history: history.data || [] };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { ok: false, error: 'Method not allowed' });
  if (!requireAdminKeyOnly(req, res, send)) return undefined;
  try {
    if (req.method === 'GET') return send(res, 200, { ok: true, ...(await getAll(client())) });
    const b = req.body || {};
    if (b.action !== 'upsert') return send(res, 400, { ok: false, error: "action must be 'upsert'" });
    const by = setByOf(b);
    return send(res, 200, { ok: true, set_by: by, ...(await upsertEnquiry(client(), b, new Date().toISOString(), by)) });
  } catch (err) {
    return send(res, 400, { ok: false, error: err?.message || String(err) });
  }
}
