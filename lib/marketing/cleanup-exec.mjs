/**
 * Real clean-up execution (QUESTION-2026-11-08 first-cleanup-unsubscribe-never-openers; Alan via Claude, option A).
 *   cohort   — server-side: subscribed in Squarespace, present, not suppressed; ≥ 4 campaigns delivered in fully
 *              collected history; no recorded open and no recorded click, ever. Protected people are kept out here.
 *   gate     — real execution only for an approved 'unsubscribe' manifest whose approval text carries an entry of
 *              REAL_APPROVALS, for that entry's cohort, with the frozen count within its tolerance; one manifest per entry.
 *   execute  — Alan's PC (collector --jobs) claims the manifest and works it in batches of BATCH: per item the server
 *              re-checks protection right before acting (changed → skipped with the reason), the PC uses Squarespace's
 *              own "Opt out of email marketing" (contacts are never deleted), a fresh consent read confirms it, then a
 *              marketing_suppression row is added and the item is done. Failed items retry on a later run only.
 *   verify   — fresh Squarespace profile read: every done person unsubscribed, protected people unchanged, no other
 *              contact changed (subscribed set before vs after minus the manifest), and a suppression row for each.
 */
import { emailHash, finishRun, logRun, normEmail, selectAll, upsertChunks } from './store.mjs';
import { engagementCoverage, evalCtx, loadPeople } from './overview.mjs';
import { isListed } from './record-type.mjs';
import { isAdminEmail } from './identity.mjs';
import { syncProfiles } from './sync.mjs';
import { badgeWatermark, badgesOf } from './client-health.mjs';
import { rowCtx } from './query/evaluate.mjs';
import { ACTIONS, executeDryRun, freezeManifest, loadManifest, probable, protectedReason, reviewCleanup, setStatus, verifyManifest } from './cleanup.mjs';

export const COHORTS = {
  never_opened_4plus: { version: 1, min_delivered: 4, english: 'Subscribed in Squarespace, present and not suppressed; 4 or more campaigns delivered in fully collected history; no recorded open and no recorded click, ever' }
};

/** Alan's recorded approvals for real execution. A later explicit approval is added here, never typed in the browser alone. */
export const REAL_APPROVALS = [
  { text: 'Alan via Claude, 8 Nov 2026 11:12, option A, buyers kept', action: 'unsubscribe', cohort: 'never_opened_4plus', expected: 250, tolerance: 5 }
];

export const SUPPRESSION_REASON = 'never opened ≥4 campaigns — cleanup approved by Alan 8 Nov 2026';
export const BATCH = 25;
export const MAX_ATTEMPTS = 5;
export const SENDING_STALE_MS = 10 * 60000;
export const RETRY_AFTER_MS = 4 * 60000;
const RUN_KIND = 'cleanup-exec';
const MANIFESTS = 'marketing_cleanup_manifests';
const ITEMS = 'marketing_cleanup_items';
const ITEM_COLS = 'person_id, email, profile_id, state, protected_reason, op_key, outcome, attempts, last_try_at';
const CHUNK = 100;

const tally = (rows, k) => rows.reduce((m, r) => (r[k] ? { ...m, [r[k]]: (m[r[k]] || 0) + 1 } : m), {});
const ms = (iso) => Date.parse(iso || '') || 0;

/* ---------- cohort (pure) ---------- */

const reachable = (p, suppressed) => !!p.email && !!p.accepts_marketing && !p.missing_since && !suppressed.has(emailHash(p.email));
const neverEngaged = (e, def) => (e?.delivered_campaigns || 0) >= def.min_delivered && !(Number(e?.engaged_events) > 0);

/** Profiles in the cohort: reachable now, enough deliveries, no open / click recorded. */
export function cohortProfiles(profiles, exposure, suppressed, def) {
  const ex = new Map(exposure.map((x) => [x.email, x]));
  return profiles.filter((p) => reachable(p, suppressed) && neverEngaged(ex.get(normEmail(p.email)), def));
}

/** Listed person records by email (a profile maps to its own contact record). */
export function personByEmail(people) {
  const out = new Map();
  for (const p of people) {
    const e = normEmail(p.facts?.email);
    if (e && isListed(p.facts) && !out.has(e)) out.set(e, p);
  }
  return out;
}

/* ---------- protection re-check (pure) ---------- */

/** Stored facts first (protectedReason), then live tables re-read right before acting. null = may act. */
export function liveReason(item, f, live, today) {
  if (!f || f.stale) return 'record_missing';
  const base = protectedReason(f, today);
  if (base) return base === 'unknown_history' && probable(f) ? 'probable_buyer' : base;
  const email = normEmail(item.email);
  const p = live.profiles.get(item.profile_id);
  const checks = [
    ['owner', () => isAdminEmail(email) || live.owners.has(email)],
    ['relationship_hold', () => live.holds.has(item.person_id)],
    ['credit_held', () => live.credit.has(item.person_id)],
    ['squarespace_order', () => live.buyers.has(email)],
    ['opened_or_clicked', () => live.engaged.has(email)],
    ['suppressed_now', () => live.suppressed.has(emailHash(email))],
    ['profile_missing', () => !p || !!p.missing_since || normEmail(p.email) !== email],
    ['already_unsubscribed', () => !p.accepts_marketing]
  ];
  return checks.find(([, test]) => test())?.[0] || null;
}

/** done (an earlier attempt's opt-out has landed since) · skip (reason) · act. */
export function decide(item, f, live, today) {
  const p = live.profiles.get(item.profile_id);
  if ((item.attempts || 0) > 0 && p && !p.accepts_marketing) return { kind: 'done', reason: 'confirmed_unsubscribed_on_retry' };
  const reason = liveReason(item, f, live, today);
  return reason ? { kind: 'skip', reason } : { kind: 'act' };
}

/** Items still to do: never tried, failed a while ago with attempts left, or claimed and never reported (stale). */
export function retryable(i, nowMs) {
  if (i.state !== 'eligible') return false;
  if (!i.outcome) return true;
  if (i.outcome === 'failed') return (i.attempts || 0) < MAX_ATTEMPTS && nowMs - ms(i.last_try_at) >= RETRY_AFTER_MS;
  return i.outcome === 'sending' && nowMs - ms(i.last_try_at) > SENDING_STALE_MS;
}

/** The PC's consent read after the opt-out: readable and not SUBSCRIBED = confirmed; unreadable is decided by a profile read. */
export function classify(sent, status = {}, error = null) {
  const out = { confirmed: [], failed: [], unread: [] };
  for (const id of sent) {
    const s = status?.[id];
    if (s && s !== 'SUBSCRIBED') out.confirmed.push(id);
    else if (s === 'SUBSCRIBED') out.failed.push({ id, error: error || 'still subscribed after the opt-out' });
    else out.unread.push(id);
  }
  return out;
}

/* ---------- the gate (pure) ---------- */

export const approvalOf = (m) => REAL_APPROVALS.find((a) => String(m?.approval_text || '').includes(a.text)) || null;

/** Why this manifest may not be executed for real (null = it may). `otherUses` = other manifests already run on the same approval. */
export function realRefusal(m, otherUses = 0) {
  if (m.mode !== 'review') return 'test manifests run as a dry run only';
  if (m.action !== 'unsubscribe') return `real execution is built only for "${ACTIONS.unsubscribe}"`;
  const a = approvalOf(m);
  if (!a) return 'real execution needs Alan\'s recorded approval for this exact manifest; it stays a reviewed plan';
  if (m.query?.cohort !== a.cohort || m.action !== a.action) return 'the recorded approval is for a different clean-up';
  const n = m.counts?.eligible ?? 0;
  if (Math.abs(n - a.expected) > a.tolerance) return `stop and report: the frozen count ${n} differs from the approved ${a.expected} by more than ${a.tolerance}`;
  if (otherUses > 0) return 'this approval has already been used by another manifest';
  return null;
}

/* ---------- reads ---------- */

async function inChunks(sb, table, cols, col, values, extra = (q) => q) {
  const out = [];
  const list = [...new Set(values.filter(Boolean))];
  for (let i = 0; i < list.length; i += CHUNK) out.push(...await selectAll(sb, table, cols, (q) => extra(q.in(col, list.slice(i, i + CHUNK)))));
  return out;
}

const activeHashes = (rows) => new Set(rows.filter((s) => !s.resolved_at).map((s) => s.email_hash));

/** Live protection inputs for these items, read now. */
export async function loadLive(sb, items) {
  const emails = items.map((i) => normEmail(i.email));
  const ids = items.map((i) => i.person_id);
  const [profiles, sup, engaged, orders, holds, credit, owners] = await Promise.all([
    inChunks(sb, 'sqs_profiles', 'profile_id, email, accepts_marketing, missing_since', 'profile_id', items.map((i) => i.profile_id)),
    inChunks(sb, 'marketing_suppression', 'email_hash, resolved_at', 'email_hash', emails.map((e) => e && emailHash(e))),
    inChunks(sb, 'sqs_email_events', 'email, event_type', 'email', emails, (q) => q.in('event_type', ['OPENED', 'CLICKED'])),
    inChunks(sb, 'sqs_orders', 'customer_email', 'customer_email', emails),
    inChunks(sb, 'marketing_relationship_holds', 'person_id', 'person_id', ids, (q) => q.is('cleared_at', null)),
    inChunks(sb, 'strategy_event_outcomes', 'credit_held_person_id', 'credit_held_person_id', ids),
    selectAll(sb, 'marketing_owner_addresses', 'email', (q) => q.is('cleared_at', null))
  ]);
  return {
    profiles: new Map(profiles.map((p) => [p.profile_id, p])), suppressed: activeHashes(sup),
    engaged: new Set(engaged.map((e) => normEmail(e.email))), buyers: new Set(orders.map((o) => normEmail(o.customer_email))),
    holds: new Set(holds.map((h) => h.person_id)), credit: new Set(credit.map((c) => c.credit_held_person_id)), owners: new Set(owners.map((o) => normEmail(o.email)))
  };
}

async function assertCovered(sb) {
  const cov = await engagementCoverage(sb);
  if (!cov.is_complete) throw new Error(`coverage incomplete: ${cov.pending} campaign(s) not fully collected yet, so "never opened" can't be relied on; nothing done (it waits for collection)`);
  return cov;
}

/* ---------- review + freeze (cohort) ---------- */

function cohortRow(i, person, d, ctx) {
  return { ...i, name: person.facts.name || person.display_name || null, protected_reason: d.kind === 'act' ? null : d.reason, badges: badgesOf(person.facts, rowCtx(person, ctx)) };
}

/** Review of a server-side cohort: same shape as reviewCleanup (rows feed freezeManifest). */
export async function reviewCohort(sb, body) {
  const def = COHORTS[body?.cohort];
  if (!def) throw new Error(`cohort must be one of ${Object.keys(COHORTS).join(', ')}`);
  if (!ACTIONS[body.cleanup_action]) throw new Error(`cleanup_action must be one of ${Object.keys(ACTIONS).join(', ')}`);
  const cov = await assertCovered(sb);
  const [profiles, exposure, sup] = await Promise.all([
    selectAll(sb, 'sqs_profiles', 'profile_id, email, accepts_marketing, missing_since'),
    selectAll(sb, 'marketing_email_exposure_v', 'email, delivered_campaigns, engaged_events'),
    selectAll(sb, 'marketing_suppression', 'email_hash, resolved_at')
  ]);
  const raw = cohortProfiles(profiles, exposure, activeHashes(sup), def);
  const ctx = await evalCtx(sb);
  const byEmail = personByEmail(await loadPeople(sb));
  const mapped = raw.map((p) => ({ p, person: byEmail.get(normEmail(p.email)) })).filter((x) => x.person);
  const items = mapped.map(({ p, person }) => ({ person_id: person.person_id, profile_id: p.profile_id, email: normEmail(p.email), outcome: null }));
  const live = await loadLive(sb, items);
  const rows = items.map((i, n) => cohortRow(i, mapped[n].person, decide(i, mapped[n].person.facts, live, ctx.today), ctx));
  const eligible = rows.filter((r) => !r.protected_reason);
  return {
    mode: 'review', cohort: body.cohort, action: body.cleanup_action, action_label: ACTIONS[body.cleanup_action], english: def.english,
    query: { cohort: body.cohort, min_delivered: def.min_delivered, version: def.version }, health: badgeWatermark(ctx), coverage: cov,
    counts: { matched: raw.length, no_person_record: raw.length - mapped.length, eligible: eligible.length, protected: rows.length - eligible.length, undecided: 0, protected_by_reason: tally(rows, 'protected_reason') },
    eligible_sample: eligible.slice(0, 50), protected_sample: rows.filter((r) => r.protected_reason).slice(0, 25), rows
  };
}

export const review = (sb, b) => (b?.cohort ? reviewCohort(sb, b) : reviewCleanup(sb, b));
export const freeze = (sb, b, by) => freezeManifest(sb, b, by, review);

/* ---------- execution: dashboard side ---------- */

async function otherUses(sb, m) {
  const a = approvalOf(m);
  if (!a) return 0;
  const rows = await selectAll(sb, MANIFESTS, 'manifest_id, approval_text', (q) => q.in('status', ['executing', 'executed', 'verified']));
  return rows.filter((r) => r.manifest_id !== m.manifest_id && String(r.approval_text || '').includes(a.text)).length;
}

async function gate(sb, m) {
  const refusal = realRefusal(m, await otherUses(sb, m));
  if (refusal) throw new Error(refusal);
}

/** "Execute": test manifests → dry run (unchanged). Real ones → gate, then queue for Alan's PC. */
export async function executeManifest(sb, b, by) {
  const m = await loadManifest(sb, b.manifest_id);
  if (m.mode === 'test') return executeDryRun(sb, b, by);
  if (!['approved', 'executing'].includes(m.status)) throw new Error(`approve the manifest first (it is ${m.status})`);
  await gate(sb, m);
  await assertCovered(sb);
  if (m.status === 'approved') await setStatus(sb, m, 'executing', by, { exec_state: { queued_at: new Date().toISOString(), queued_by: by, runs: [] } });
  return { manifest_id: m.manifest_id, status: 'executing', note: `queued for Alan's PC (checks every 5 minutes): ${m.counts?.eligible ?? 0} people, batches of ${BATCH}, each re-checked right before the opt-out` };
}

/* ---------- execution: PC job runner side ---------- */

async function runBusy(sb, id, nowIso) {
  const { data } = await sb.from('marketing_collector_runs').select('run_id, checkpoint, heartbeat_at, started_at').eq('kind', RUN_KIND).eq('status', 'running').order('started_at', { ascending: false }).limit(5);
  return (data || []).some((r) => r.checkpoint?.manifest_id === id && ms(nowIso) - ms(r.heartbeat_at || r.started_at) < SENDING_STALE_MS);
}

/** GET cleanup-exec-next: the oldest executing manifest, gate re-checked, one run at a time. */
export async function nextExecution(sb, nowIso = new Date().toISOString()) {
  const { data: m } = await sb.from(MANIFESTS).select('*').eq('status', 'executing').order('created_at').limit(1).maybeSingle();
  if (!m) return { job: null };
  if (await runBusy(sb, m.manifest_id, nowIso)) return { job: null, waiting: 'a clean-up run is already in progress' };
  const refusal = realRefusal(m, await otherUses(sb, m));
  if (refusal) return { job: null, refused: refusal };
  const runId = await logRun(sb, { kind: RUN_KIND, status: 'running', host: 'alan-pc', heartbeat_at: nowIso, items_total: m.counts?.eligible ?? 0, items_done: 0, checkpoint: { manifest_id: m.manifest_id, step: 'claimed' } });
  return { job: { run_id: runId, manifest_id: m.manifest_id, batch: BATCH } };
}

async function executing(sb, id) {
  const m = await loadManifest(sb, id);
  if (m.status !== 'executing') throw new Error(`manifest is ${m.status}, not executing`);
  await gate(sb, m);
  return m;
}

async function saveState(sb, m, patch) {
  const exec = { ...(m.exec_state || {}), ...patch };
  const { error } = await sb.from(MANIFESTS).update({ exec_state: exec }).eq('manifest_id', m.manifest_id);
  if (error) throw new Error(error.message);
  return exec;
}

/** Subscribed (present) profiles and the dashboard's "can be emailed" (also unsuppressed), from a fresh profile read. */
export function consentSnapshot(profiles, suppressed) {
  const subscribed = profiles.filter((p) => p.accepts_marketing && !p.missing_since);
  return { subscribed: subscribed.length, can_email: subscribed.filter((p) => !suppressed.has(emailHash(p.email))).length, subscribed_ids: subscribed.map((p) => p.profile_id).sort() };
}

async function freshConsent(sb) {
  await syncProfiles(sb);
  const [profiles, sup] = await Promise.all([selectAll(sb, 'sqs_profiles', 'profile_id, email, accepts_marketing, missing_since'), selectAll(sb, 'marketing_suppression', 'email_hash, resolved_at')]);
  return { profiles, snap: consentSnapshot(profiles, activeHashes(sup)) };
}

/** POST cleanup-exec-start: fresh consent read; the first run of a manifest stores the "before" set. */
export async function startExecution(sb, b, nowIso = new Date().toISOString()) {
  const m = await executing(sb, b.manifest_id);
  const { snap } = await freshConsent(sb);
  const sqs = Number.isFinite(Number(b.all_subscribers)) ? Number(b.all_subscribers) : null;
  const before = m.exec_state?.before || { at: nowIso, all_subscribers_sqs: sqs, ...snap };
  const runs = [...(m.exec_state?.runs || []), { run_id: b.run_id, at: nowIso, all_subscribers_sqs: sqs }].slice(-30);
  await saveState(sb, m, { before, runs });
  await sb.from('marketing_collector_runs').update({ heartbeat_at: nowIso, checkpoint: { manifest_id: m.manifest_id, step: 'consent read' } }).eq('run_id', b.run_id);
  return { before: { subscribed: before.subscribed, can_email: before.can_email, all_subscribers_sqs: before.all_subscribers_sqs }, now: { subscribed: snap.subscribed, can_email: snap.can_email } };
}

const guarded = (q, prev) => (prev == null ? q.is('outcome', null) : q.eq('outcome', prev));

async function setOutcome(sb, m, i, patch) {
  const { data, error } = await guarded(sb.from(ITEMS).update(patch).eq('manifest_id', m.manifest_id).eq('person_id', i.person_id), i.outcome).select('person_id');
  if (error) throw new Error(error.message);
  return (data || []).length > 0;
}

/** Suppression row for each confirmed person (reason + manifest as source); one already there from before the freeze is kept. */
async function suppress(sb, m, items, nowIso) {
  const existing = new Map((await inChunks(sb, 'marketing_suppression', 'email_hash, resolved_at, first_seen_at', 'email_hash', items.map((i) => emailHash(i.email)))).map((s) => [s.email_hash, s]));
  const keep = (s) => s && !s.resolved_at && ms(s.first_seen_at) < ms(m.created_at);
  const rows = items.filter((i) => !keep(existing.get(emailHash(i.email)))).map((i) => ({
    email_hash: emailHash(i.email), reason: SUPPRESSION_REASON, source: m.manifest_id, first_seen_at: nowIso, last_seen_at: nowIso,
    note: `Squarespace opt-out by clean-up manifest (op ${i.op_key})`, resolved_at: null, resolved_by: null, resolution_note: null
  }));
  await upsertChunks(sb, 'marketing_suppression', rows, 'email_hash');
  return { added: rows.length, kept: items.length - rows.length };
}

/** `from` = the outcome the items must still have (claimed 'sending', or 'failed' when a late opt-out is found on retry). */
async function confirmDone(sb, m, items, nowIso, how, from = 'sending') {
  if (!items.length) return 0;
  await suppress(sb, m, items, nowIso);
  let n = 0;
  for (const i of items) n += (await setOutcome(sb, m, { ...i, outcome: from }, { outcome: 'done', outcome_at: nowIso, last_error: null, recheck: { at: nowIso, confirmed: how } })) ? 1 : 0;
  return n;
}

async function applyDecision(sb, m, i, d, nowIso) {
  if (d.kind === 'done') return (await confirmDone(sb, m, [i], nowIso, d.reason, i.outcome)) ? 'done' : 'lost';
  if (d.kind === 'skip') return (await setOutcome(sb, m, i, { outcome: 'skipped', skip_reason: d.reason, outcome_at: nowIso, recheck: { at: nowIso, reason: d.reason } })) ? 'skipped' : 'lost';
  if ((i.attempts || 0) >= MAX_ATTEMPTS) return (await setOutcome(sb, m, i, { outcome: 'failed', outcome_at: nowIso, last_error: `gave up after ${i.attempts} attempts` })) ? 'failed' : 'lost';
  return (await setOutcome(sb, m, i, { outcome: 'sending', attempts: (i.attempts || 0) + 1, last_try_at: nowIso })) ? 'act' : 'lost';
}

async function factsFor(sb, items) {
  const rows = await inChunks(sb, 'customer_person', 'person_id, facts', 'person_id', items.map((i) => i.person_id));
  return new Map(rows.map((r) => [r.person_id, r.facts]));
}

/** Execution is finished when nothing is left to try (failed items out of attempts stay failed, for Alan to see). */
async function maybeFinish(sb, m, items, nowIso) {
  const open = items.filter((i) => i.state === 'eligible' && (!i.outcome || i.outcome === 'sending' || (i.outcome === 'failed' && (i.attempts || 0) < MAX_ATTEMPTS)));
  if (open.length) return { finished: false, waiting: open.length };
  await setStatus(sb, m, 'executed', 'collector (Alan\'s PC)', { executed_at: nowIso });
  return { finished: true, outcomes: tally(items, 'outcome') };
}

/** POST cleanup-exec-batch: the next BATCH items, each re-checked now; returns the ones the PC may opt out. */
export async function claimBatch(sb, b, nowIso = new Date().toISOString()) {
  const m = await executing(sb, b.manifest_id);
  await assertCovered(sb);
  const items = await selectAll(sb, ITEMS, ITEM_COLS, (q) => q.eq('manifest_id', m.manifest_id).eq('state', 'eligible'));
  const due = items.filter((i) => retryable(i, ms(nowIso)));
  const todo = due.slice(0, BATCH);
  if (!todo.length) return { act: [], more: false, ...(await maybeFinish(sb, m, items, nowIso)) };
  const [live, facts] = await Promise.all([loadLive(sb, todo), factsFor(sb, todo)]);
  const kinds = [];
  const act = [];
  for (const i of todo) {
    const k = await applyDecision(sb, m, i, decide(i, facts.get(i.person_id), live, nowIso.slice(0, 10)), nowIso);
    kinds.push({ k });
    if (k === 'act') act.push({ person_id: i.person_id, profile_id: i.profile_id });
  }
  return { act, more: due.length > todo.length, counts: tally(kinds, 'k') };
}

async function failSending(sb, m, list, nowIso) {
  let n = 0;
  for (const { item, error } of list) n += (await setOutcome(sb, m, item, { outcome: 'failed', outcome_at: nowIso, last_error: String(error).slice(0, 300) })) ? 1 : 0;
  return n;
}

/** Unreadable consent after the opt-out: a fresh profile read decides (not subscribed = confirmed). */
async function resolveUnread(sb, ids, error) {
  if (!ids.length) return { confirmed: [], failed: [] };
  const { profiles } = await freshConsent(sb);
  const by = new Map(profiles.map((p) => [p.profile_id, p]));
  const off = (id) => by.has(id) && !by.get(id).accepts_marketing;
  return { confirmed: ids.filter(off), failed: ids.filter((id) => !off(id)).map((id) => ({ id, error: error || 'consent unreadable after the opt-out and still subscribed in the profile read' })) };
}

/** POST cleanup-exec-result: the PC's opt-out + consent read for one batch. Only items claimed ('sending') change. */
export async function recordResult(sb, b, nowIso = new Date().toISOString()) {
  const m = await executing(sb, b.manifest_id);
  const sending = await selectAll(sb, ITEMS, ITEM_COLS, (q) => q.eq('manifest_id', m.manifest_id).eq('outcome', 'sending'));
  const byProfile = new Map(sending.map((i) => [i.profile_id, i]));
  const sent = (Array.isArray(b.sent) ? b.sent : []).map(String).filter((id) => byProfile.has(id));
  const c = classify(sent, b.status, b.error ? String(b.error) : null);
  const u = await resolveUnread(sb, c.unread, b.error ? String(b.error) : null);
  const done = await confirmDone(sb, m, [...c.confirmed, ...u.confirmed].map((id) => byProfile.get(id)), nowIso, 'consent read after the opt-out');
  const failed = await failSending(sb, m, [...c.failed, ...u.failed].map((f) => ({ item: byProfile.get(f.id), error: f.error })), nowIso);
  const all = await selectAll(sb, ITEMS, 'outcome', (q) => q.eq('manifest_id', m.manifest_id).eq('state', 'eligible'));
  const doneTotal = all.filter((i) => i.outcome === 'done').length;
  await sb.from('marketing_collector_runs').update({ heartbeat_at: nowIso, items_done: doneTotal, checkpoint: { manifest_id: m.manifest_id, step: `batch: ${done} done, ${failed} failed` } }).eq('run_id', b.run_id);
  return { done, failed, ignored: (b.sent || []).length - sent.length, done_total: doneTotal };
}

/** POST cleanup-exec-finish: closes this run (the manifest stays executing until every item has an outcome). */
export async function finishExecution(sb, b) {
  const m = await loadManifest(sb, b.manifest_id);
  const sqs = Number.isFinite(Number(b.all_subscribers_after)) && b.all_subscribers_after != null ? Number(b.all_subscribers_after) : null;
  await finishRun(sb, b.run_id, { status: b.status === 'ok' ? 'ok' : 'failed', error: b.error ? String(b.error).slice(0, 500) : null, summary: b.summary || null });
  if (sqs != null) await saveState(sb, m, { after_sqs: sqs, after_sqs_at: new Date().toISOString() });
  return { manifest_id: m.manifest_id, status: m.status };
}

/* ---------- verification ---------- */

const PROTECTED_BUYER = new Set(['buyer', 'probable_buyer', 'squarespace_order']);

/** Pure: compare the before set, the items and a fresh profile read. */
export function verifyReport({ before, items, profiles, suppressed, manifestId, sqsAfter }) {
  const now = consentSnapshot(profiles, suppressed);
  const nowSub = new Set(now.subscribed_ids);
  const was = new Set(before?.subscribed_ids || []);
  const done = items.filter((i) => i.outcome === 'done');
  const doneIds = new Set(done.map((i) => i.profile_id));
  const prot = items.filter((i) => i.state === 'protected' && was.has(i.profile_id));
  const buyers = prot.filter((i) => PROTECTED_BUYER.has(i.protected_reason));
  return {
    manifest_id: manifestId, outcomes: tally(items.filter((i) => i.state === 'eligible'), 'outcome'), skip_reasons: tally(items, 'skip_reason'),
    done: done.length, done_unsubscribed_now: done.filter((i) => !nowSub.has(i.profile_id)).length, done_still_subscribed: done.filter((i) => nowSub.has(i.profile_id)).length,
    done_with_suppression: done.filter((i) => suppressed.has(emailHash(i.email))).length,
    protected_subscribed_before: prot.length, protected_still_subscribed: prot.filter((i) => nowSub.has(i.profile_id)).length,
    buyers_subscribed_before: buyers.length, buyers_still_subscribed: buyers.filter((i) => nowSub.has(i.profile_id)).length,
    others_unsubscribed: [...was].filter((id) => !doneIds.has(id) && !nowSub.has(id)).length, others_subscribed: [...nowSub].filter((id) => !was.has(id)).length,
    all_subscribers: { before: before?.subscribed ?? null, after: now.subscribed, sqs_before: before?.all_subscribers_sqs ?? null, sqs_after: sqsAfter ?? null },
    can_email: { before: before?.can_email ?? null, after: now.can_email },
    nightly_sync: 'read-only on Squarespace (GET): it cannot subscribe anyone; list loads drop suppressed people before any import'
  };
}

export function verifyOk(r) {
  return r.done_still_subscribed === 0 && r.done_with_suppression === r.done && r.protected_still_subscribed === r.protected_subscribed_before && r.others_unsubscribed === 0 && r.others_subscribed === 0;
}

async function verifyExecution(sb, m, by) {
  if (!['executed', 'verified'].includes(m.status)) throw new Error(`execution is not finished (manifest is ${m.status})`);
  const { profiles } = await freshConsent(sb);
  const [items, sup] = await Promise.all([
    selectAll(sb, ITEMS, 'person_id, email, profile_id, state, protected_reason, outcome, skip_reason', (q) => q.eq('manifest_id', m.manifest_id)),
    selectAll(sb, 'marketing_suppression', 'email_hash, resolved_at')
  ]);
  const r = verifyReport({ before: m.exec_state?.before, items, profiles, suppressed: activeHashes(sup), manifestId: m.manifest_id, sqsAfter: m.exec_state?.after_sqs });
  const result = { at: new Date().toISOString(), ...r, ok: verifyOk(r), changed_anything: r.done > 0 };
  await setStatus(sb, m, 'verified', by, { verified_at: result.at, verify_result: result });
  return result;
}

/** Verify: real executions (they have a "before" set) get the full check; dry runs keep the dry-run verification. */
export async function verify(sb, b, by) {
  const m = await loadManifest(sb, b.manifest_id);
  return m.exec_state?.before ? verifyExecution(sb, m, by) : verifyManifest(sb, b, by);
}

/** GET cleanup-progress: outcome counts for one manifest (no personal data). */
export async function progress(sb, q) {
  const m = await loadManifest(sb, q.manifest_id);
  const items = await selectAll(sb, ITEMS, 'state, protected_reason, outcome, skip_reason, attempts', (x) => x.eq('manifest_id', m.manifest_id));
  const eligible = items.filter((i) => i.state === 'eligible');
  const b = m.exec_state?.before;
  const refusal = realRefusal(m, await otherUses(sb, m));
  return {
    manifest_id: m.manifest_id, status: m.status, eligible: eligible.length, outcomes: tally(eligible, 'outcome'), skip_reasons: tally(eligible, 'skip_reason'),
    not_started: eligible.filter((i) => !i.outcome).length, protected_by_reason: tally(items, 'protected_reason'), real_execution_allowed: !refusal,
    refusal, before: b ? { subscribed: b.subscribed, can_email: b.can_email, all_subscribers_sqs: b.all_subscribers_sqs, at: b.at } : null,
    after_sqs: m.exec_state?.after_sqs ?? null, verify_result: m.verify_result || null
  };
}
