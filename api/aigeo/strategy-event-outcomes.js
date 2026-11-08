/**
 * What happened to a finished event (x-arp-admin-key) → public.strategy_event_outcomes, one row per event date keyed by
 * the shared runKey (lib/strategy-run-rate.mjs). Read by the Strategy events tile and KPI scorecard F5. Every save
 * appends to `history`. Never writes to the Booking Sheet or the website; record counts are notes, never attendees.
 * GET  → the stored records for the property
 * POST { run_key, event_title, cancelled, reason, reason_note, bookings_outcome, bookings_note, transferred_to_title,
 *        transferred_to_date, transferred_count, refunded_count, credit_held_count, credit_held_person_id, via }
 */
import { createClient } from '@supabase/supabase-js';
import { requireAdminKeyOnly } from '../../lib/api/requireAdminKeyOnly.js';
import { BOOKINGS, OUTCOMES_TABLE, REASONS } from '../../lib/strategy-run-rate.mjs';

const DEFAULT_PROPERTY = 'https://www.alanranger.com';
const SET_BY = 'Alan (dashboard, admin key)';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEY_RE = /^(\d{4}-\d{2}-\d{2})\|(day|residential|course)\|[a-z ]{0,40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
function countOrNull(v, name) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 99) throw new Error(`${name} must be a whole number 0-99 (or blank when not evidenced)`);
  return n;
}
function oneOf(v, allowed, name) {
  if (v == null || v === '') return null;
  if (!Object.hasOwn(allowed, v)) throw new Error(`${name} must be one of ${Object.keys(allowed).join(', ')}`);
  return v;
}
function uuidOrNull(v) {
  if (v == null || v === '') return null;
  if (!UUID_RE.test(String(v))) throw new Error('credit_held_person_id must be a customer_person id');
  return String(v);
}

const setByOf = (b) => (b?.via === 'claude' ? 'Alan via Claude (admin key)' : SET_BY);

/** Validated row (no history); a cancelled record needs a reason, and "other" needs a note. */
export function outcomeRow(b, propertyUrl, now) {
  const m = KEY_RE.exec(String(b?.run_key || ''));
  if (!m) throw new Error('run_key must be the events tile key "YYYY-MM-DD|day|title"');
  const cancelled = b.cancelled !== false;
  const reason = oneOf(b.reason, REASONS, 'reason');
  if (cancelled && !reason) throw new Error('a cancellation needs a reason');
  if (reason === 'other' && !text(b.reason_note, 300)) throw new Error('reason "other" needs a note');
  return {
    property_url: propertyUrl, run_key: m[0], event_date: m[1], event_title: text(b.event_title, 200), cancelled,
    reason, reason_note: text(b.reason_note, 300),
    bookings_outcome: oneOf(b.bookings_outcome, BOOKINGS, 'bookings_outcome'), bookings_note: text(b.bookings_note, 400),
    transferred_to_title: text(b.transferred_to_title, 200), transferred_to_date: dateOrNull(b.transferred_to_date, 'transferred_to_date'),
    transferred_count: countOrNull(b.transferred_count, 'transferred_count'),
    refunded_count: countOrNull(b.refunded_count, 'refunded_count'),
    credit_held_count: countOrNull(b.credit_held_count, 'credit_held_count'),
    credit_held_person_id: uuidOrNull(b.credit_held_person_id),
    set_by: setByOf(b), set_at: now
  };
}

/** One history entry per save: who, when and the typed fields (no person ids). */
export function historyEntry(row) {
  const { property_url: _p, run_key: _k, event_date: _d, event_title: _t, set_by: by, set_at: at, credit_held_person_id: pid, ...fields } = row;
  return { at, by, ...fields, credit_held_person_linked: !!pid };
}

async function save(supabase, row) {
  const { data: prev, error } = await supabase.from(OUTCOMES_TABLE).select('history')
    .eq('property_url', row.property_url).eq('run_key', row.run_key).maybeSingle();
  if (error) throw new Error(error.message);
  const history = [...(prev?.history || []), historyEntry(row)].slice(-50);
  const full = { ...row, history };
  const { error: e2 } = await supabase.from(OUTCOMES_TABLE).upsert(full, { onConflict: 'property_url,run_key' });
  if (e2) throw new Error(e2.message);
  return { table: OUTCOMES_TABLE, columns: Object.keys(full), history_entries: history.length };
}

async function list(supabase, propertyUrl) {
  const { data, error } = await supabase.from(OUTCOMES_TABLE).select('*').eq('property_url', propertyUrl).order('event_date', { ascending: true });
  if (error) throw new Error(error.message);
  return { records: data || [] };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { ok: false, error: 'Method not allowed' });
  if (!requireAdminKeyOnly(req, res, send)) return undefined;
  const b = req.body || {};
  const propertyUrl = String((req.method === 'GET' ? req.query?.propertyUrl : b.propertyUrl) || DEFAULT_PROPERTY);
  try {
    if (req.method === 'GET') return send(res, 200, { ok: true, ...(await list(client(), propertyUrl)) });
    const out = await save(client(), outcomeRow(b, propertyUrl, new Date().toISOString()));
    return send(res, 200, { ok: true, set_by: setByOf(b), ...out });
  } catch (err) {
    return send(res, 400, { ok: false, error: err?.message || String(err) });
  }
}
