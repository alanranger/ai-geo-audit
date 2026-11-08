/**
 * What happened to a finished event (x-arp-admin-key) → public.strategy_event_outcomes, one row per event date keyed by
 * the shared runKey (lib/strategy-run-rate.mjs). Read by the Strategy events tile and KPI scorecard F5. Every save
 * appends to `history`. Never writes to the Booking Sheet or the website; record counts are notes, never attendees.
 * A held credit linked to a person (credit_held_person_id) is mirrored onto that person's customer facts as the
 * "credit held · <event> <month>" marker (an open commitment, never revenue) until credit_used_on is set; the customer
 * rebuild reads the same table, so the marker survives rebuilds.
 * GET  → the stored records for the property
 * POST { run_key, event_title, cancelled, reason, reason_note, bookings_outcome, bookings_note, transfers: [{ title,
 *        date, count }] (or transferred_to_title / transferred_to_date), transferred_count, refunded_count,
 *        credit_held_count, credit_held_person_id, credit_used_on, via }
 */
import { createClient } from '@supabase/supabase-js';
import { requireAdminKeyOnly } from '../../lib/api/requireAdminKeyOnly.js';
import { BOOKINGS, creditMarker, OUTCOMES_TABLE, REASONS } from '../../lib/strategy-run-rate.mjs';

const DEFAULT_PROPERTY = 'https://www.alanranger.com';
const SET_BY = 'Alan (dashboard, admin key)';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KEY_RE = /^(\d{4}-\d{2}-\d{2})\|(day|residential|course)\|[a-z ]{0,40}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TRANSFERS = 5;

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

const ukDate = (iso) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' });
/** Claude's saves carry the day they were made: "Alan via Claude, 8 Nov 2026". */
export const setByOf = (b, now) => (b?.via === 'claude' ? `Alan via Claude, ${ukDate(now)}` : SET_BY);

/** The transfers list (each with an event date; count blank when not evidenced), else the single transferred_to fields. */
export function transfersRow(b) {
  const raw = Array.isArray(b?.transfers) ? b.transfers : [{ title: b?.transferred_to_title, date: b?.transferred_to_date, count: b?.transferred_count }];
  const list = raw.filter((t) => t && (t.date || text(t.title, 200))).slice(0, MAX_TRANSFERS).map((t, i) => {
    const date = dateOrNull(t.date, `transfers[${i}].date`);
    if (!date) throw new Error(`transfers[${i}] needs the date of the event the bookings moved to`);
    return { title: text(t.title, 200), date, count: countOrNull(t.count, `transfers[${i}].count`) };
  });
  return { transfers: list, transferred_to_title: list[0]?.title ?? null, transferred_to_date: list[0]?.date ?? null };
}

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
    ...transfersRow(b),
    transferred_count: countOrNull(b.transferred_count, 'transferred_count'),
    refunded_count: countOrNull(b.refunded_count, 'refunded_count'),
    credit_held_count: countOrNull(b.credit_held_count, 'credit_held_count'),
    credit_held_person_id: uuidOrNull(b.credit_held_person_id),
    credit_used_on: dateOrNull(b.credit_used_on, 'credit_used_on'),
    set_by: setByOf(b, now), set_at: now
  };
}

/** One history entry per save: who, when and the typed fields (no person ids). */
export function historyEntry(row) {
  const { property_url: _p, run_key: _k, event_date: _d, event_title: _t, set_by: by, set_at: at, credit_held_person_id: pid, ...fields } = row;
  return { at, by, ...fields, credit_held_person_linked: !!pid };
}

/** facts.credit_held on one person: this record's marker replaced (or removed); other records' credits kept. */
async function patchPersonCredit(supabase, personId, runKey, marker) {
  const { data: p, error } = await supabase.from('customer_person').select('person_id, facts').eq('person_id', personId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!p) throw new Error('credit_held_person_id is not a customer_person');
  const credits = [...(p.facts?.credit_held || []).filter((c) => c.run_key !== runKey), ...(marker ? [marker] : [])];
  const { error: e2 } = await supabase.from('customer_person').update({ facts: { ...(p.facts || {}), credit_held: credits } }).eq('person_id', personId);
  if (e2) throw new Error(e2.message);
}

async function syncCredit(supabase, prevPid, row) {
  const pid = row.credit_held_person_id;
  if (prevPid && prevPid !== pid) await patchPersonCredit(supabase, prevPid, row.run_key, null);
  if (pid) await patchPersonCredit(supabase, pid, row.run_key, creditMarker(row));
  return pid ? { credit_marker: creditMarker(row) ? 'set' : 'cleared' } : {};
}

/** `keepPerson`: the save did not mention credit_held_person_id (the dashboard editor), so the stored link stays. */
export async function saveOutcome(supabase, input, { keepPerson = false } = {}) {
  const { data: prev, error } = await supabase.from(OUTCOMES_TABLE).select('history, credit_held_person_id')
    .eq('property_url', input.property_url).eq('run_key', input.run_key).maybeSingle();
  if (error) throw new Error(error.message);
  const row = keepPerson && !input.credit_held_person_id ? { ...input, credit_held_person_id: prev?.credit_held_person_id || null } : input;
  const history = [...(prev?.history || []), historyEntry(row)].slice(-50);
  const full = { ...row, history };
  const { error: e2 } = await supabase.from(OUTCOMES_TABLE).upsert(full, { onConflict: 'property_url,run_key' });
  if (e2) throw new Error(e2.message);
  const credit = await syncCredit(supabase, prev?.credit_held_person_id || null, row);
  return { table: OUTCOMES_TABLE, columns: Object.keys(full), history_entries: history.length, ...credit };
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
    const now = new Date().toISOString();
    const out = await saveOutcome(client(), outcomeRow(b, propertyUrl, now), { keepPerson: !Object.hasOwn(b, 'credit_held_person_id') });
    return send(res, 200, { ok: true, set_by: setByOf(b, now), ...out });
  } catch (err) {
    return send(res, 400, { ok: false, error: err?.message || String(err) });
  }
}
