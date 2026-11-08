/**
 * Emails per person in rolling 7 days (server side; only counts leave the server, never member lists or names).
 * Counted: Squarespace campaigns scheduled or sent from a frozen / saved audience (marketing_segment_export_members),
 * sent Squarespace campaigns without a record audience (sqs_email_events DELIVERED), and the Academy lapsed-trial
 * re-engagement automation (Academy Supabase academy_trial_history: last send + the next attempt it would make).
 * Owner / business copies (the snapshot's owner ids) are counted apart, never as clients. Drafts with no saved audience
 * are listed as "estimate" and are not in the per-person counts. Exceptions: a snapshot whose frequency_policy records an
 * Alan-approved exception covers that campaign in the window it sends in (per campaign and week, never blanket).
 * Levels: amber = someone gets more than 2 without an approved exception in that window; red = anyone gets 4+.
 */
import { selectAll } from './store.mjs';

export const PER_PERSON_LIMIT = 2;
const LIVE = new Set(['approved', 'scheduled', 'sent', 'measured']);
const DRAFT = new Set(['drafted', 'proposed']);
const ACADEMY_OFFSETS = [20, 30, 60];
const ACADEMY_GAPS = [0, 10, 30];
const ACADEMY_REACH_DAYS = 180;
const DAY = 86400000;

const londonDay = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const addDays = (s, n) => new Date(Date.parse(`${s}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const keyOf = (email, pid) => (email ? String(email).trim().toLowerCase() : `pid:${pid}`);
export const isApprovedException = (policy) => /approved/i.test(String(policy || '')) && /exception/i.test(String(policy || ''));

function sendDayOf(c) {
  if (c.scheduled_for) return londonDay(c.scheduled_for);
  if (c.sent_on) return String(c.sent_on).slice(0, 10);
  return c.planned_send_on ? String(c.planned_send_on).slice(0, 10) : null;
}
const ownerIdsOf = (exp) => {
  const o = exp?.owner || {};
  return o.included === false ? [] : [...(o.person_ids || []), ...(o.business_copy_ids || [])].map(String);
};

/* ---------- pure aggregation (tested) ---------- */

function countWindow(emails, academy, from, to) {
  const per = new Map();
  const excepted = new Set();
  const bump = (p) => per.set(p, (per.get(p) || 0) + 1);
  const inWin = emails.filter((e) => e.day >= from && e.day <= to);
  for (const e of inWin) {
    for (const p of e.people) bump(p);
    if (e.exception) e.people.forEach((p) => excepted.add(p));
  }
  const auto = academy.filter((a) => a.day >= from && a.day <= to);
  auto.forEach((a) => bump(a.person));
  return { per, excepted, inWin, auto };
}
function buckets(per, excepted) {
  const b = { 1: 0, 2: 0, 3: 0, '4+': 0 };
  let approved = 0;
  let unapproved = 0;
  for (const [p, n] of per) {
    b[n >= 4 ? '4+' : n] += 1;
    if (n > PER_PERSON_LIMIT && n < 4) excepted.has(p) ? (approved += 1) : (unapproved += 1);
  }
  return { b, approved, unapproved };
}
/** One rolling window (UK days from..to inclusive): counts only. */
export function windowStats(input, from, to) {
  const { per, excepted, inWin, auto } = countWindow(input.emails || [], input.academy || [], from, to);
  const { b, approved, unapproved } = buckets(per, excepted);
  const drafts = (input.drafts || []).filter((d) => d.day >= from && d.day <= to);
  const owners = inWin.reduce((t, e) => t + e.owners, 0);
  const level = b['4+'] > 0 ? 'red' : (unapproved > 0 ? 'amber' : 'ok');
  return {
    from, to, emails: inWin.length, sends: inWin.reduce((t, e) => t + e.people.length, 0) + owners, owner_copies: owners,
    people: per.size, by_count: b, approved_over: approved, unapproved_over: unapproved, academy_auto: auto.length, level,
    exception_campaigns: inWin.filter((e) => e.exception).map((e) => e.key), drafts: drafts.length,
    draft_sends: drafts.reduce((t, d) => t + (d.sends || 0), 0), estimate: drafts.length > 0
  };
}
const RANK = { ok: 0, amber: 1, red: 2 };
const worse = (a, b) => RANK[b.level] - RANK[a.level] || b.unapproved_over - a.unapproved_over || b.approved_over - a.approved_over || b.sends - a.sends;
/** A week (Mon..Sun) is judged by its worst rolling 7 days ending on one of its days. */
export function weekStats(input, week) {
  const list = Array.from({ length: 7 }, (_, i) => addDays(week, i)).map((d) => windowStats(input, addDays(d, -6), d));
  const worst = list.sort(worse)[0];
  const drafts = (input.drafts || []).filter((d) => d.day >= week && d.day <= addDays(week, 6)).length;
  return { ...worst, week_drafts: drafts, estimate: worst.estimate || drafts > 0 };
}
export function frequencyView(input, today, weeks = 10) {
  const monday = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  const out = {};
  for (let i = -1; i < weeks; i += 1) out[addDays(monday, i * 7)] = weekStats(input, addDays(monday, i * 7));
  return {
    as_of: today, limit: PER_PERSON_LIMIT, weeks: out, next_7_days: windowStats(input, today, addDays(today, 6)), notes: input.notes || [],
    basis: 'people per rolling 7 days (UK days): Squarespace scheduled / sent campaigns from frozen audiences or sent recipients + Academy re-engagement automation; owner / business copies apart; drafts without a saved audience = estimate, not in per-person counts'
  };
}

/* ---------- loading (read-only) ---------- */

async function memberRows(sb, exportIds) {
  if (!exportIds.length) return [];
  return selectAll(sb, 'marketing_segment_export_members', 'export_id, person_id, email', (q) => q.in('export_id', exportIds));
}
function snapshotEmails(live, rows, expById, ownerKeys) {
  const byExp = new Map();
  for (const r of rows) (byExp.get(r.export_id) || byExp.set(r.export_id, []).get(r.export_id)).push(r);
  return live.map((c) => {
    const exp = expById.get(c.export_id);
    const owners = new Set(ownerIdsOf(exp));
    const mine = byExp.get(c.export_id) || [];
    const people = mine.filter((r) => !owners.has(String(r.person_id))).map((r) => keyOf(r.email, r.person_id));
    mine.filter((r) => owners.has(String(r.person_id))).forEach((r) => ownerKeys.add(keyOf(r.email, r.person_id)));
    return { key: c.campaign_key, day: sendDayOf(c), people, owners: mine.length - people.length, exception: isApprovedException(exp?.frequency_policy), source: 'snapshot' };
  });
}
async function sentEmails(sb, from, known, ownerKeys) {
  const { data, error } = await sb.from('sqs_email_campaigns').select('email_id, sent_on, campaign_key').gte('sent_on', from);
  if (error) throw new Error(`sqs_email_campaigns: ${error.message}`);
  const list = (data || []).filter((c) => !known.has(c.campaign_key));
  if (!list.length) return [];
  const ev = await selectAll(sb, 'sqs_email_events', 'email_id, email', (q) => q.eq('event_type', 'DELIVERED').in('email_id', list.map((c) => c.email_id)));
  return list.map((c) => {
    const all = [...new Set(ev.filter((e) => e.email_id === c.email_id && e.email).map((e) => keyOf(e.email)))];
    const people = all.filter((p) => !ownerKeys.has(p));
    return { key: `sqs:${c.email_id}`, day: londonDay(c.sent_on), people, owners: all.length - people.length, exception: false, source: 'sent recipients' };
  });
}

/** The automation's last send and its next attempt (day 20 / 30 / 60 after trial end, with the minimum gaps). */
export function academySends(row, today) {
  const out = [];
  if (row.reengagement_last_sent_at) out.push(londonDay(row.reengagement_last_sent_at));
  const n = row.reengagement_send_count || 0;
  if (row.converted_at || row.reengagement_opted_out || n >= ACADEMY_OFFSETS.length || !row.trial_end_at) return out;
  const end = String(row.trial_end_at).slice(0, 10);
  if (end < addDays(today, -ACADEMY_REACH_DAYS)) return out;
  const due = [addDays(end, ACADEMY_OFFSETS[n]), row.reengagement_last_sent_at ? addDays(londonDay(row.reengagement_last_sent_at), ACADEMY_GAPS[n]) : null].filter(Boolean).sort().pop();
  if (due >= today) out.push(due);
  return out;
}
async function academyRows() {
  const url = process.env.ACADEMY_SUPABASE_URL;
  const key = process.env.ACADEMY_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const cols = 'member_id,trial_end_at,converted_at,reengagement_send_count,reengagement_last_sent_at,reengagement_opted_out';
  const r = await fetch(`${url}/rest/v1/academy_trial_history?select=${cols}&limit=10000`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!r.ok) throw new Error(`academy_trial_history ${r.status}`);
  return r.json();
}
async function academyAuto(sb, today, from, to) {
  const rows = await academyRows();
  if (!rows) return { list: [], note: 'Academy automation not counted: ACADEMY_SUPABASE_URL / key not set' };
  const sends = rows.flatMap((r) => academySends(r, today).filter((d) => d >= from && d <= to).map((day) => ({ member: r.member_id, day })));
  if (!sends.length) return { list: [], note: null };
  const ids = [...new Set(sends.map((s) => s.member))];
  const links = await selectAll(sb, 'customer_identity_link', 'source_id, person_id', (q) => q.eq('source', 'memberstack').in('source_id', ids));
  const pids = [...new Set(links.map((l) => l.person_id).filter(Boolean))];
  const persons = pids.length ? await selectAll(sb, 'customer_person', 'person_id, email:facts->>email', (q) => q.in('person_id', pids)) : [];
  const email = new Map(persons.map((p) => [p.person_id, p.email]));
  const person = new Map(links.map((l) => [l.source_id, keyOf(email.get(l.person_id), l.person_id)]));
  return { list: sends.map((s) => ({ day: s.day, person: person.get(s.member) || `ms:${s.member}` })), note: null };
}

/** Everything frequencyView needs; `campaigns` / `exports` as read by deliveryInputs (frequency_policy included). */
export async function frequencyInputs(sb, { campaigns = [], exports = [] }, today) {
  const from = addDays(today, -20);
  const to = addDays(today, 80);
  const inRange = (c) => { const d = sendDayOf(c); return d && d >= from && d <= to; };
  const live = campaigns.filter((c) => LIVE.has(c.stage) && c.export_id && inRange(c));
  const expById = new Map(exports.map((e) => [e.export_id, e]));
  const ownerKeys = new Set();
  const emails = snapshotEmails(live, await memberRows(sb, live.map((c) => c.export_id)), expById, ownerKeys);
  emails.push(...await sentEmails(sb, from, new Set(live.map((c) => c.campaign_key)), ownerKeys));
  const drafts = campaigns.filter((c) => DRAFT.has(c.stage) && !c.export_id && c.kind !== 'weekly_email' && inRange(c)).map((c) => ({ key: c.campaign_key, day: sendDayOf(c), sends: Number(c.estimate_sends) || 0 }));
  const academy = await academyAuto(sb, today, from, to).catch((e) => ({ list: [], note: `Academy automation not counted: ${String(e?.message || e).slice(0, 120)}` }));
  return { emails, drafts, academy: academy.list, notes: [academy.note].filter(Boolean) };
}

export async function emailFrequency(sb, base, today = londonDay(new Date().toISOString())) {
  return frequencyView(await frequencyInputs(sb, base, today), today);
}
