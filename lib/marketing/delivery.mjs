/**
 * Email deliveries for the capacity lines and the "Scheduled & planned delivery" section (server side). One delivery
 * per stored campaign record, plus every Squarespace schedule the collector read that is not that record's (unlinked,
 * ambiguous, or a second schedule on the same campaign): those are budgeted once, by their own recipient count.
 * Evidence: "seen" = collector read (Scheduled or Sent list); "operator_verified" / "manual" = from the campaign
 * record's schedule columns; nothing = planned / unverified (a database stage alone is never evidence).
 * Reservation rules: lib/marketing/delivery-reserve.mjs.
 */
import { audienceOf, bucketOf, capacityOf, cycleOf, cycleSide, goneAfterSend, liveSends, londonDay, releaseNote, releaseOf, reservationOf } from './delivery-reserve.mjs';
import { frequencyInputs, frequencyView } from './frequency.mjs';
import { emailStatus } from './delivery-status.mjs';
import { selectAll } from './store.mjs';

export const SCHEDULE_READ_KIND = 'collector:scheduled';
export const READ_STALE_HOURS = 26;
const SENT_STAGES = new Set(['sent', 'measured']);
const PRESEND_MINUTES = 30;
const hoursSince = (iso, now) => (iso ? (now - Date.parse(iso)) / 3600000 : Infinity);

/** Owner copy + business copy frozen with the snapshot (unique addresses include Alan's copy). */
function ownerCopies(exp) {
  const o = exp.owner || (exp.definition_snapshot || {}).owner || {};
  return o.included === false ? 0 : (Number(o.count) || 0) + (Number(o.business_copy) || 0);
}

export function snapshotOf(c, exp) {
  if (!c.export_id) return null;
  if (!exp) return c.reserved_sends > 0 ? { amount: c.reserved_sends, export_id: c.export_id, basis: 'reservation on the record (snapshot not read)' } : null;
  if (exp.status === 'cancelled') return null;
  const base = { export_id: exp.export_id, list_name: exp.list_name, list_id: exp.sqs_list_id, review: exp.status === 'blocked' };
  const listCount = Number((exp.load_result || {}).list_count);
  if (Number.isFinite(listCount) && listCount > 0) return { ...base, amount: listCount, basis: 'Squarespace list count after the load' };
  return { ...base, amount: Number(exp.eligible_count) + ownerCopies(exp), basis: 'frozen snapshot (clients + owner / business copy)' };
}

/** The schedule recorded on the campaign record; dropped once a complete read shows Squarespace no longer has it. */
export function operatorOf(c, provider) {
  if (!c.scheduled_for || !c.schedule_evidence || provider?.state === 'gone') return null;
  return { at: c.scheduled_for, tz: c.scheduled_tz || null, recipients: c.scheduled_recipients ?? null, evidence: c.schedule_evidence, by: c.schedule_evidence_by || null, evidence_at: c.schedule_evidence_at || null };
}

function sentAtOf(c) {
  const h = (c.stage_history || []).filter((e) => SENT_STAGES.has(e.stage)).map((e) => e.at).sort().pop();
  return h || (c.sent_on ? `${c.sent_on}T23:59:59Z` : null);
}

/** Sent = the email is in Squarespace's Sent list (by any of its ids), or linked / marked sent on the record. */
export function sentOf(c, sentById, provider) {
  for (const id of [c.sqs_email_id, c.sqs_draft_id, provider?.email_id].filter(Boolean)) {
    const e = sentById.get(id);
    if (e) return { email_id: id, at: e.sent_on, count: e.message_count ?? null, seen: true, subject: e.subject || null, lists: e.mailing_list_names || [] };
  }
  if (c.sqs_email_id) return { email_id: c.sqs_email_id, at: null, count: c.actual_sends ?? null, seen: false, note: 'linked, not collected yet' };
  if (SENT_STAGES.has(c.stage)) return { email_id: null, at: markedSentAt(c, provider), recorded_at: sentAtOf(c), count: c.actual_sends ?? null, seen: false, note: 'marked sent on the record' };
  return null;
}

/** A record marked sent went out at its schedule's instant (Squarespace, else the record's), not when it was marked. */
function markedSentAt(c, provider) {
  const marked = sentAtOf(c);
  const due = provider?.scheduled_for || c.scheduled_for;
  return due && (!marked || Date.parse(due) <= Date.parse(marked)) ? new Date(due).toISOString() : marked;
}

const slimProvider = (p) => (p ? { email_id: p.email_id, subject: p.subject, scheduled_for: p.scheduled_for, tz: p.scheduled_tz, lists: p.mailing_list_names, list_ids: p.mailing_list_ids, recipients: p.recipients, recipients_basis: p.recipients_basis, state: p.state, collected_at: p.collected_at, gone_at: p.gone_at, changed_at: p.changed_at, history: (p.history || []).slice(-3), link_state: p.link_state, link_basis: p.link_basis, link_candidates: p.link_candidates } : null);

function evidenceOf(d) {
  if (d.sent?.seen || d.provider?.state === 'scheduled') return { kind: 'seen', at: d.sent?.seen ? d.sent.at : d.provider.collected_at, by: 'Squarespace collector' };
  if (d.operator) return { kind: d.operator.evidence, at: d.operator.evidence_at, by: d.operator.by };
  if (goneAfterSend(d.provider)) return { kind: 'schedule_gone_after_send', at: d.provider.gone_at, by: 'Squarespace collector' };
  return null;
}

/** App-intended send instant: the column, else the latest stage_history entry that recorded one (not evidence). */
export function intendedAt(c) {
  if (c.scheduled_for) return c.scheduled_for;
  const h = (c.stage_history || []).filter((e) => e.scheduled_for && !Number.isNaN(Date.parse(e.scheduled_for))).sort((a, b) => String(a.at).localeCompare(String(b.at))).pop();
  return h ? new Date(h.scheduled_for).toISOString() : null;
}

function sendAtOf(c, provider, sent) {
  if (sent?.at) return sent.at;
  if (provider?.state === 'scheduled') return provider.scheduled_for;
  return intendedAt(c);
}

/**
 * Initiative + purpose tags from the quarter plan's stored links (public.strategy_initiative_links): the delivery's
 * own link (send|<campaign_key>, or a step key) first, else the campaign's. Absent table / link = no tag shown.
 */
export function tagIndex(links = [], initiatives = []) {
  const title = new Map(initiatives.map((i) => [i.initiative_key, i.title]));
  const out = new Map();
  for (const l of links.filter((x) => x.role === 'primary')) {
    const purpose = l.purpose_primary ? [l.purpose_primary, ...(l.purpose_secondary || [])] : null;
    out.set(`${l.ref_type}|${l.ref_key}`, { initiative_key: l.initiative_key, initiative: title.get(l.initiative_key) || l.initiative_key, purpose });
  }
  return out;
}
function tagsFor(tags, key) {
  const own = tags.get(`delivery|send|${key}`) || {};
  const camp = tags.get(`campaign|${key}`) || {};
  return { initiative: own.initiative || camp.initiative || null, purpose: own.purpose || camp.purpose || null };
}

/** Record fields shown as-is (purpose / initiative from the quarter-plan links, owner only when the record has one). */
function recordFields(c, tag) {
  return {
    key: c.campaign_key, campaign_key: c.campaign_key, title: c.title || c.campaign_key, kind: c.kind, channel: 'email', audience: c.audience || (c.export_id ? 'snapshot' : null),
    segment_ids: c.segment_ids || [], sqs_draft_id: c.sqs_draft_id || null, cancelled: c.stage === 'cancelled', record_stage: c.stage, send_day: c.planned_send_on || (c.kind === 'weekly_email' ? c.window_start : null),
    window_end: c.window_end || null, app_scheduled_for: intendedAt(c), purpose: tag.purpose, initiative: tag.initiative, owner: c.owner ?? null, set_by: c.set_by || null
  };
}

/** A live segment estimate (refreshed on every read) wins over a labelled estimate stored on the record. */
function estimateOf(c, live) {
  if (live != null) return { sends: live, live: true, as_of: null, rule: null };
  if (c.estimate_sends == null) return null;
  return { sends: Number(c.estimate_sends), live: false, as_of: c.estimate_as_of || null, rule: c.estimate_rule || null };
}

export function campaignDelivery(c, ctx) {
  const provider = ctx.providerFor(c.campaign_key);
  const snapshot = snapshotOf(c, ctx.expById.get(c.export_id));
  const operator = operatorOf(c, provider);
  const estimate = estimateOf(c, liveSends(ctx.estimates[c.campaign_key]));
  const r = reservationOf({ provider, operator, snapshot, manual: c.export_id ? 0 : Number(c.reserved_sends) || 0, estimate: estimate ? estimate.sends : null });
  const sent = sentOf(c, ctx.sentById, provider);
  const d = { ...recordFields(c, tagsFor(ctx.tags, c.campaign_key)), ...r, estimate, provider: slimProvider(provider), operator, snapshot, sent, send_at: sendAtOf(c, provider, sent) };
  if (sent) d.stage = 'sent';
  if (sent?.count != null) d.amount = sent.count;
  d.evidence = evidenceOf(d);
  d.aud = audienceOf(d, c, ctx.estimates[c.campaign_key], ctx.expById.get(c.export_id));
  return d;
}

/** A Squarespace schedule budgeted on its own: not linked to a record, ambiguous, external, or a second schedule. */
export function scheduleDelivery(p, sentById) {
  const e = sentById.get(p.email_id);
  const sent = e ? { email_id: p.email_id, at: e.sent_on, count: e.message_count ?? null, seen: true } : null;
  const d = {
    key: `sqs:${p.email_id}`, campaign_key: p.link_state === 'linked' ? p.campaign_key : null, title: p.subject || '(no subject)', kind: 'squarespace_schedule', channel: 'email', audience: (p.mailing_list_names || []).join(' + ') || null,
    stage: sent ? 'sent' : 'scheduled', amount: sent?.count ?? p.recipients ?? null, amount_from: 'squarespace_schedule', provider: slimProvider(p), operator: null, snapshot: null, sent,
    cancelled: !sent && p.state === 'gone', send_at: sent?.at || p.scheduled_for, send_day: null, review: ['unlinked', 'ambiguous'].includes(p.link_state)
  };
  d.evidence = { kind: 'seen', at: sent ? sent.at : p.collected_at, by: 'Squarespace collector' };
  return d;
}

function providersByCampaign(schedules) {
  const map = new Map();
  const live = (p) => (p.state === 'scheduled' ? 1 : 0);
  for (const p of schedules.filter((x) => x.link_state === 'linked' && x.campaign_key)) map.set(p.campaign_key, [...(map.get(p.campaign_key) || []), p]);
  for (const list of map.values()) list.sort((a, b) => live(b) - live(a) || String(b.collected_at).localeCompare(String(a.collected_at)));
  return map;
}

/** Every email delivery: stored records, then the schedules not already a record's own (budgeted once). */
export function emailDeliveries({ campaigns = [], exports = [], schedules = [], sent = [], links = [], initiatives = [] }, estimates = {}) {
  const byCampaign = providersByCampaign(schedules);
  const known = new Set(campaigns.map((c) => c.campaign_key));
  const ctx = { estimates, tags: tagIndex(links, initiatives), expById: new Map(exports.map((e) => [e.export_id, e])), sentById: new Map(sent.map((e) => [e.email_id, e])), providerFor: (k) => (known.has(k) ? byCampaign.get(k)?.[0] || null : null) };
  const own = new Set(campaigns.map((c) => ctx.providerFor(c.campaign_key)?.email_id).filter(Boolean));
  const out = campaigns.map((c) => campaignDelivery(c, ctx));
  for (const p of schedules) if (!own.has(p.email_id)) out.push(scheduleDelivery(p, ctx.sentById));
  return markScheduledDrafts(out);
}

/**
 * A record's Squarespace draft now in Scheduled under a schedule not linked to it (unlinked / ambiguous): that schedule
 * is the delivery, so the record is marked `scheduled_as` and not counted again as a draft or provisional plan.
 */
export function markScheduledDrafts(out) {
  const sched = new Map(out.filter((d) => d.kind === 'squarespace_schedule' && d.provider?.state === 'scheduled').map((d) => [d.provider.email_id, d.key]));
  for (const d of out) if (d.sqs_draft_id && !d.sent && d.stage !== 'scheduled' && sched.has(d.sqs_draft_id)) d.scheduled_as = sched.get(d.sqs_draft_id);
  return out;
}

export function finishDelivery(d, cycle, meterAt, today) {
  const release = releaseOf(d, meterAt);
  const out = { ...d, release, release_note: releaseNote(d, release) };
  out.bucket = bucketOf(out);
  out.side = cycleSide(out, cycle, today);
  return out;
}

/** The latest Scheduled-tab read and the latest good one (a failed read keeps the last good state, never releases). */
const runAt = (r) => (r ? r.finished_at || r.started_at : null);
function lastRun(last) {
  if (!last) return { last_status: null, last_at: null, last_error: null, failed_since_ok: false };
  const bad = last.status !== 'ok';
  return { last_status: last.status, last_at: runAt(last), last_error: bad ? last.error || null : null, failed_since_ok: bad };
}
export function readState(runs, now) {
  const mine = (runs || []).filter((r) => r.kind === SCHEDULE_READ_KIND).sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)));
  const ok = mine.find((r) => r.status === 'ok') || null;
  const at = runAt(ok);
  let state = 'never_read';
  if (ok) state = hoursSince(at, now) > READ_STALE_HOURS ? 'stale' : 'fresh';
  return { state, last_ok_at: at, ...lastRun(mine[0]) };
}

const W = (level, text, action, key) => ({ level, text, action, key: key || null });
const ukShort = (iso) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }).replace(',', '');

function dateMismatch(d) {
  const p = d.provider;
  if (!p || p.state !== 'scheduled' || !d.app_scheduled_for) return null;
  if (Math.abs(Date.parse(p.scheduled_for) - Date.parse(d.app_scheduled_for)) <= 60000) return null;
  return W('amber', `${d.title}: the record says ${ukShort(d.app_scheduled_for)} but Squarespace has ${ukShort(p.scheduled_for)}`, 'Decide which is right and change the other (the dashboard never reschedules).', d.key);
}

function evidenceGap(d) {
  if (d.sent || d.cancelled) return null;
  if (d.record_stage === 'scheduled' && d.provider?.state === 'gone' && !goneAfterSend(d.provider)) return W('amber', `${d.title}: Squarespace no longer lists it as scheduled (read ${ukShort(d.provider.gone_at)}) and it is not in Sent`, 'Check Squarespace: schedule it again, or mark the record cancelled. Its snapshot stays reserved until then.', d.key);
  if (d.record_stage === 'scheduled' && !d.evidence) return W('amber', `${d.title}: marked scheduled with no platform evidence`, 'Confirm the schedule in Squarespace (or let the collector read it).', d.key);
  return null;
}

function lifecycleWarnings(d, now) {
  const out = [];
  if (d.release === 'cancel_unconfirmed') out.push(W('amber', `${d.title}: cancelled on the record but Squarespace still lists it as scheduled — its reservation is kept`, 'Cancel (unschedule) it in Squarespace; the next complete read releases it.', d.key));
  if (d.release === 'pending_reconciliation') out.push(W('amber', `${d.title}: sent ${ukShort(d.sent.at)}, not yet reconciled (needs a meter read after the send plus the Sent collector's link, or 30 minutes after Squarespace stops listing the schedule) — still reserved`, 'Nothing to do: the next collector run reconciles it.', d.key));
  if (d.provider?.changed_at && hoursSince(d.provider.changed_at, now) < 72) out.push(W('amber', `${d.title}: the schedule was edited in Squarespace (${ukShort(d.provider.changed_at)})`, 'Check the change is intended (time, list, subject).', d.key));
  const day = d.send_at ? londonDay(d.send_at) : d.send_day;
  if (!d.sent && day && d.window_end && day > d.window_end && d.kind !== 'weekly_email') out.push(W('amber', `${d.title}: sends ${day} after the campaign window ends (${d.window_end}: offer end / event start)`, 'Move the send earlier or change the offer / event wording.', d.key));
  return out;
}

function presendGap(d, now) {
  if (d.sent || d.cancelled || (d.provider?.state !== 'scheduled' && !d.operator)) return null;
  const mins = (Date.parse(d.send_at) - now) / 60000;
  if (!(mins > PRESEND_MINUTES)) return null;
  return W('amber', `${d.title} is scheduled ${Math.round(mins / 1440 * 10) / 10} days ahead: the 30-minute pre-send check doesn't cover it. Squarespace itself skips anyone unsubscribed in Squarespace at dispatch; a dashboard-only block is not applied by Squarespace`, 'A decision for Alan (scheduled-send consent options); nothing changed automatically.', d.key);
}

function readWarnings(read) {
  if (read.state === 'never_read') return [W('amber', 'Squarespace\'s Scheduled tab has not been read by the collector yet: schedules made outside the dashboard are not counted', 'Run the collector on Alan\'s PC (npm run marketing:collector), or wait for the hourly read.')];
  const out = [];
  if (read.state === 'stale') out.push(W('amber', `Squarespace Scheduled tab last read ${ukShort(read.last_ok_at)} (stale)`, 'Check the collector on Alan\'s PC (login may have expired).'));
  if (read.failed_since_ok) out.push(W('amber', `The latest Scheduled-tab read ${read.last_status}${read.last_error ? `: ${String(read.last_error).slice(0, 120)}` : ''} — reservations kept from the last good read`, 'Re-run the collector; nothing was released or deleted.'));
  return out;
}

function reviewWarnings(deliveries) {
  return deliveries.filter((d) => d.review && !d.sent && !d.cancelled).map((d) => W('amber', `Squarespace schedule not matched to a campaign${d.provider?.link_state === 'ambiguous' ? ` (could be ${d.provider.link_candidates.join(' or ')})` : ''}: "${d.title}" ${ukShort(d.send_at)} · ${d.amount ?? 'count unknown'} — budgeted once`, 'Link it to its campaign in the send budget (or mark it external).', d.key));
}

export const DUPLICATE_SHARE = 0.9;
const sendDayOf = (d) => (d.send_at ? londonDay(d.send_at) : d.send_day);

/**
 * Two unsent email deliveries on the same UK day whose frozen audiences are (nearly) the same people: probably one
 * email recorded twice (two reservations). Flagged only; neither record is changed.
 */
export function duplicateWarnings(deliveries, members) {
  const open = deliveries.filter((d) => d.bucket !== 'released' && !d.sent && !d.cancelled && d.snapshot?.export_id && members.has(d.snapshot.export_id) && sendDayOf(d));
  const out = [];
  for (let i = 0; i < open.length; i += 1) {
    for (const b of open.slice(i + 1)) {
      const a = open[i];
      if (sendDayOf(a) !== sendDayOf(b)) continue;
      const [sa, sb] = [members.get(a.snapshot.export_id), members.get(b.snapshot.export_id)];
      const shared = [...sa].filter((p) => sb.has(p)).length;
      if (shared < DUPLICATE_SHARE * Math.min(sa.size, sb.size)) continue;
      out.push({ ...W('amber', `Possible duplicate reservation: "${a.title}" and "${b.title}" both send ${sendDayOf(a)} to nearly the same people (${shared} shared of ${sa.size} / ${sb.size}) — reserved twice (${a.amount ?? '?'} + ${b.amount ?? '?'})`, 'If they are the same email, cancel the extra record\'s snapshot so it is reserved once; if they are two emails, keep both (each person counts twice).', a.key), pair: [a.key, b.key] });
    }
  }
  return out;
}

export function deliveryWarnings(deliveries, capacity, read, cycle, now, members = new Map()) {
  const out = [...duplicateWarnings(deliveries, members)];
  if (capacity?.overage > 0) out.push(W('red', `Committed sends this cycle are ${capacity.overage.toLocaleString('en-GB')} over what Squarespace has left before the reset (${ukShort(cycle.reset)})`, 'Move or shrink a delivery to after the reset. No delivery in this cycle can be READY until this is resolved.'));
  const live = deliveries.filter((x) => x.bucket !== 'released');
  for (const d of live) out.push(...[dateMismatch(d), evidenceGap(d)].filter(Boolean), ...lifecycleWarnings(d, now));
  return [...out, ...presendGaps(live, now), ...reviewWarnings(deliveries), ...readWarnings(read)];
}

/** One consent-gap warning for all emails scheduled more than 30 minutes ahead (a list, not one line each). */
function presendGaps(live, now) {
  const gaps = live.map((d) => presendGap(d, now)).filter(Boolean);
  if (gaps.length < 2) return gaps;
  const names = live.filter((d) => presendGap(d, now)).map((d) => `${d.title} (${ukShort(d.send_at)})`);
  return [W('amber', `${gaps.length} emails are scheduled more than 30 minutes ahead: ${names.join('; ')}. The 30-minute pre-send check doesn't cover them. Squarespace itself skips anyone unsubscribed in Squarespace at dispatch; a dashboard-only block is not applied by Squarespace`, gaps[0].action)];
}

/** Everything the capacity lines and the delivery section need from the database side. */
export function deliveryView(meterRow, inputs, estimates = {}, now = new Date()) {
  const cycle = cycleOf(meterRow.cycle_reset_at);
  const today = londonDay(now.toISOString());
  const read = readState(inputs.runs, now.getTime());
  const deliveries = emailDeliveries(inputs, estimates).map((d) => finishDelivery(d, cycle, meterRow.captured_at, today)).map((d) => ({ ...d, status: emailStatus(d, { now: now.getTime(), read }) }));
  const capacity = { ...capacityOf({ quota: meterRow.quota_emails, used: meterRow.used_emails }, deliveries, cycle), today };
  const members = inputs.members || new Map();
  const frequency = inputs.frequency ? frequencyView(inputs.frequency, today) : null;
  return { cycle, deliveries, capacity, read, warnings: deliveryWarnings(deliveries, capacity, read, cycle, now.getTime(), members), step_tags: stepTags(inputs), frequency };
}

/** Initiative / purpose per plan step key (ref_type delivery: generated step|… and GPT's manual steps), not theme sends. */
export function stepTags(inputs) {
  const out = {};
  for (const [k, v] of tagIndex(inputs.links, inputs.initiatives)) if (k.startsWith('delivery|') && !k.startsWith('delivery|send|')) out[k.slice('delivery|'.length)] = v;
  return out;
}

/** person ids per open snapshot (for the duplicate check only; never leaves the server). */
async function snapshotMembers(sb, exportIds) {
  const out = new Map();
  if (!exportIds.length) return out;
  const rows = await selectAll(sb, 'marketing_segment_export_members', 'export_id, person_id', (q) => q.in('export_id', exportIds));
  for (const r of rows) out.set(r.export_id, (out.get(r.export_id) || new Set()).add(r.person_id));
  return out;
}

async function linkInputs(sb) {
  const [l, i] = await Promise.all([
    sb.from('strategy_initiative_links').select('ref_type, ref_key, initiative_key, role, purpose_primary, purpose_secondary'),
    sb.from('strategy_initiatives').select('initiative_key, title')
  ]);
  return l.error || i.error ? { links: [], initiatives: [] } : { links: l.data || [], initiatives: i.data || [] };
}

export async function deliveryInputs(sb) {
  const [camps, exps, sched, sent, runs] = await Promise.all([
    sb.from('strategy_campaigns').select('*'),
    sb.from('marketing_segment_exports').select('export_id, campaign_key, list_name, eligible_count, status, sqs_list_id, load_result, owner:definition_snapshot->owner, frequency_policy:definition_snapshot->>frequency_policy, is_test').eq('is_test', false),
    sb.from('sqs_scheduled_emails').select('*'),
    sb.from('sqs_email_campaigns').select('email_id, subject, sent_on, message_count, mailing_list_names, collected_at').order('sent_on', { ascending: false }).limit(60),
    sb.from('marketing_collector_runs').select('kind, status, started_at, finished_at, error, summary').eq('kind', SCHEDULE_READ_KIND).order('started_at', { ascending: false }).limit(10)
  ]);
  for (const [name, r] of [['strategy_campaigns', camps], ['marketing_segment_exports', exps], ['sqs_scheduled_emails', sched]]) if (r.error) throw new Error(`${name}: ${r.error.message}`);
  const open = (camps.data || []).filter((c) => c.export_id && !['sent', 'measured', 'cancelled'].includes(c.stage)).map((c) => c.export_id);
  const frequency = await frequencyInputs(sb, { campaigns: camps.data || [], exports: exps.data || [] }, londonDay(new Date().toISOString()))
    .catch((e) => ({ emails: [], drafts: [], academy: [], notes: [`per-person frequency not available: ${String(e?.message || e).slice(0, 160)}`] }));
  return { ...(await linkInputs(sb)), frequency, members: await snapshotMembers(sb, open), campaigns: (camps.data || []).map(({ stage_history: h, results_snapshot: _r, sent_audience: _s, ...c }) => ({ ...c, stage_history: (h || []).map((e) => ({ stage: e.stage, at: e.at, scheduled_for: e.scheduled_for || null })) })), exports: exps.data || [], schedules: sched.data || [], sent: sent.data || [], runs: runs.data || [] };
}

/* ---------- campaign-plan fields (POST /api/aigeo/marketing { action: 'campaign-plan' }) ---------- */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const PROVIDER_ID = /^[a-f0-9]{24}$/;
function dayOrNull(v, name) {
  if (v == null || v === '') return null;
  if (!DAY.test(String(v))) throw new Error(`${name} must be YYYY-MM-DD`);
  return String(v);
}
function instantOrNull(v) {
  if (v == null || v === '') return null;
  if (!/T\d{2}:\d{2}/.test(String(v)) || Number.isNaN(Date.parse(v))) throw new Error('scheduled_for must be an ISO date-time (the app-intended send instant)');
  return new Date(v).toISOString();
}
function estimatePatch(e) {
  if (e === null) return { estimate_sends: null, estimate_as_of: null, estimate_rule: null };
  const sends = Math.round(Number(e?.sends));
  if (!Number.isFinite(sends) || sends < 0) throw new Error('estimate.sends must be a whole number of unique addresses (business copy included)');
  return { estimate_sends: sends, estimate_as_of: dayOrNull(e.as_of, 'estimate.as_of'), estimate_rule: e.rule ? String(e.rule).slice(0, 400) : null };
}

/** Marketing-side plan fields. Never sets schedule evidence: a schedule is seen by the collector or confirmed by an operator. */
export function planPatch(b) {
  const p = {};
  if (b.sqs_draft_id !== undefined) {
    if (b.sqs_draft_id && !PROVIDER_ID.test(String(b.sqs_draft_id))) throw new Error('sqs_draft_id must be a Squarespace email id (24 hex characters)');
    p.sqs_draft_id = b.sqs_draft_id ? String(b.sqs_draft_id) : null;
  }
  if (b.planned_send_on !== undefined) p.planned_send_on = dayOrNull(b.planned_send_on, 'planned_send_on');
  if (b.scheduled_for !== undefined) {
    p.scheduled_for = instantOrNull(b.scheduled_for);
    p.scheduled_tz = p.scheduled_for ? String(b.scheduled_tz || 'Europe/London').slice(0, 40) : null;
  }
  if (b.estimate !== undefined) Object.assign(p, estimatePatch(b.estimate));
  if (b.export_id !== undefined) p.export_id = b.export_id ? String(b.export_id) : null;
  return p;
}

/** Refuse what would double-count or overwrite evidence; returns the export to link to this campaign (if any). */
export async function checkPlan(sb, campaignKey, patch) {
  const { data: rec, error } = await sb.from('strategy_campaigns').select('campaign_key, schedule_evidence').eq('campaign_key', campaignKey).maybeSingle();
  if (error) throw new Error(error.message);
  if (!rec) throw new Error('campaign not found (create it from Campaign records first)');
  if (patch.scheduled_for !== undefined && rec.schedule_evidence) throw new Error('this record\'s send time comes from a platform confirmation; change it in Squarespace (the collector reads it)');
  if (!patch.export_id) return null;
  const { data: exp, error: e2 } = await sb.from('marketing_segment_exports').select('export_id, campaign_key, status, is_test').eq('export_id', patch.export_id).maybeSingle();
  if (e2) throw new Error(e2.message);
  if (!exp || exp.is_test || exp.status === 'cancelled') throw new Error('export not found, a test snapshot, or cancelled');
  if (exp.campaign_key && exp.campaign_key !== campaignKey) throw new Error(`that snapshot already belongs to ${exp.campaign_key} (one email = one reservation)`);
  const { data: other } = await sb.from('strategy_campaigns').select('campaign_key').eq('export_id', patch.export_id).neq('campaign_key', campaignKey).limit(1);
  if (other?.length) throw new Error(`that snapshot is already the reservation of ${other[0].campaign_key}`);
  return exp.campaign_key ? null : exp.export_id;
}

/** Link the snapshot to its campaign (as a new snapshot made for a campaign would be). */
export async function linkExport(sb, exportId, campaignKey) {
  if (!exportId) return null;
  const { error } = await sb.from('marketing_segment_exports').update({ campaign_key: campaignKey }).eq('export_id', exportId).is('campaign_key', null);
  if (error) throw new Error(error.message);
  return exportId;
}

/** "Link this Squarespace schedule": to a campaign record, or "external" (still budgeted, out of the review queue). */
export async function linkSchedule(sb, b, by) {
  if (!b.email_id) throw new Error('email_id is needed');
  const external = b.external === true;
  if (!external && !b.campaign_key) throw new Error('campaign_key (or external: true) is needed');
  if (!external) {
    const { data } = await sb.from('strategy_campaigns').select('campaign_key').eq('campaign_key', b.campaign_key).maybeSingle();
    if (!data) throw new Error('campaign not found');
  }
  const patch = { campaign_key: external ? null : b.campaign_key, link_state: external ? 'external' : 'linked', link_basis: 'manual', link_set_by: by, link_set_at: new Date().toISOString() };
  const table = b.kind === 'draft' ? 'sqs_draft_emails' : 'sqs_scheduled_emails';
  const { data, error } = await sb.from(table).update(patch).eq('email_id', String(b.email_id)).select('email_id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error(b.kind === 'draft' ? 'draft not found' : 'schedule not found');
  return { email_id: b.email_id, kind: b.kind === 'draft' ? 'draft' : 'schedule', ...patch };
}

/**
 * Squarespace Drafts for the schedule and Rules & data sources: the unmatched ones (no campaign record has the draft id
 * or its list) with the latest read. A draft is never a send or a reservation; nothing is created from one.
 */
export async function draftFacts(sb) {
  const { data, error } = await sb.from('sqs_draft_emails').select('email_id, subject, created_on, modified_on, mailing_list_names, state, collected_at, campaign_key, link_state, link_candidates').eq('state', 'draft').order('modified_on', { ascending: false }).limit(100);
  if (error) return { available: false, error: error.message, unmatched: [], drafts: 0 };
  const rows = data || [];
  const unmatched = rows.filter((r) => ['unlinked', 'ambiguous'].includes(r.link_state));
  return { available: true, drafts: rows.length, read_at: rows.map((r) => r.collected_at).sort().pop() || null, unmatched, linked: rows.length - unmatched.length };
}
