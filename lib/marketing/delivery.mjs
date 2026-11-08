/**
 * Email deliveries for the capacity lines and the "Scheduled & planned delivery" section (server side). One delivery
 * per stored campaign record, plus every Squarespace schedule the collector read that is not that record's (unlinked,
 * ambiguous, or a second schedule on the same campaign): those are budgeted once, by their own recipient count.
 * Evidence: "seen" = collector read (Scheduled or Sent list); "operator_verified" / "manual" = from the campaign
 * record's schedule columns; nothing = planned / unverified (a database stage alone is never evidence).
 * Reservation rules: lib/marketing/delivery-reserve.mjs.
 */
import { bucketOf, capacityOf, cycleOf, cycleSide, londonDay, releaseOf, reservationOf } from './delivery-reserve.mjs';

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
  const base = { export_id: exp.export_id, list_name: exp.list_name, list_id: exp.sqs_list_id };
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
  if (SENT_STAGES.has(c.stage)) return { email_id: null, at: sentAtOf(c), count: c.actual_sends ?? null, seen: false, note: 'marked sent on the record' };
  return null;
}

const slimProvider = (p) => (p ? { email_id: p.email_id, subject: p.subject, scheduled_for: p.scheduled_for, tz: p.scheduled_tz, lists: p.mailing_list_names, list_ids: p.mailing_list_ids, recipients: p.recipients, recipients_basis: p.recipients_basis, state: p.state, collected_at: p.collected_at, gone_at: p.gone_at, changed_at: p.changed_at, history: (p.history || []).slice(-3), link_state: p.link_state, link_basis: p.link_basis, link_candidates: p.link_candidates } : null);

function evidenceOf(d) {
  if (d.sent?.seen || d.provider?.state === 'scheduled') return { kind: 'seen', at: d.sent?.seen ? d.sent.at : d.provider.collected_at, by: 'Squarespace collector' };
  if (d.operator) return { kind: d.operator.evidence, at: d.operator.evidence_at, by: d.operator.by };
  return null;
}

function sendAtOf(c, provider, sent) {
  if (sent?.at) return sent.at;
  if (provider?.state === 'scheduled') return provider.scheduled_for;
  return c.scheduled_for || null;
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
    segment_ids: c.segment_ids || [], cancelled: c.stage === 'cancelled', record_stage: c.stage, send_day: c.kind === 'weekly_email' ? c.window_start : null,
    window_end: c.window_end || null, app_scheduled_for: c.scheduled_for || null, purpose: tag.purpose, initiative: tag.initiative, owner: c.owner ?? null, set_by: c.set_by || null
  };
}

export function campaignDelivery(c, ctx) {
  const provider = ctx.providerFor(c.campaign_key);
  const snapshot = snapshotOf(c, ctx.expById.get(c.export_id));
  const operator = operatorOf(c, provider);
  const r = reservationOf({ provider, operator, snapshot, manual: c.export_id ? 0 : Number(c.reserved_sends) || 0, estimate: ctx.estimates[c.campaign_key] ?? null });
  const sent = sentOf(c, ctx.sentById, provider);
  const d = { ...recordFields(c, tagsFor(ctx.tags, c.campaign_key)), ...r, provider: slimProvider(provider), operator, snapshot, sent, send_at: sendAtOf(c, provider, sent) };
  if (sent) d.stage = 'sent';
  if (sent?.count != null) d.amount = sent.count;
  d.evidence = evidenceOf(d);
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
  return out;
}

export function finishDelivery(d, cycle, meterAt, today) {
  const release = releaseOf(d, meterAt);
  const out = { ...d, release };
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
  if (d.record_stage === 'scheduled' && d.provider?.state === 'gone') return W('amber', `${d.title}: Squarespace no longer lists it as scheduled (read ${ukShort(d.provider.gone_at)}) and it is not in Sent`, 'Check Squarespace: schedule it again, or mark the record cancelled. Its snapshot stays reserved until then.', d.key);
  if (d.record_stage === 'scheduled' && !d.evidence) return W('amber', `${d.title}: marked scheduled with no platform evidence`, 'Confirm the schedule in Squarespace (or let the collector read it).', d.key);
  return null;
}

function lifecycleWarnings(d, now) {
  const out = [];
  if (d.release === 'cancel_unconfirmed') out.push(W('amber', `${d.title}: cancelled on the record but Squarespace still lists it as scheduled — its reservation is kept`, 'Cancel (unschedule) it in Squarespace; the next complete read releases it.', d.key));
  if (d.release === 'pending_reconciliation') out.push(W('amber', `${d.title}: sent ${ukShort(d.sent.at)}, not yet in a meter read — still reserved`, 'Nothing to do: the next collector meter read reconciles it.', d.key));
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

export function deliveryWarnings(deliveries, capacity, read, cycle, now) {
  const out = [];
  if (capacity?.overage > 0) out.push(W('red', `Committed sends this cycle are ${capacity.overage.toLocaleString('en-GB')} over what Squarespace has left before the reset (${ukShort(cycle.reset)})`, 'Move or shrink a delivery to after the reset. No delivery in this cycle can be READY until this is resolved.'));
  for (const d of deliveries.filter((x) => x.bucket !== 'released')) {
    out.push(...[dateMismatch(d), evidenceGap(d), presendGap(d, now)].filter(Boolean), ...lifecycleWarnings(d, now));
  }
  return [...out, ...reviewWarnings(deliveries), ...readWarnings(read)];
}

/** Everything the capacity lines and the delivery section need from the database side. */
export function deliveryView(meterRow, inputs, estimates = {}, now = new Date()) {
  const cycle = cycleOf(meterRow.cycle_reset_at);
  const today = londonDay(now.toISOString());
  const deliveries = emailDeliveries(inputs, estimates).map((d) => finishDelivery(d, cycle, meterRow.captured_at, today));
  const capacity = { ...capacityOf({ quota: meterRow.quota_emails, used: meterRow.used_emails }, deliveries, cycle), today };
  const read = readState(inputs.runs, now.getTime());
  return { cycle, deliveries, capacity, read, warnings: deliveryWarnings(deliveries, capacity, read, cycle, now.getTime()), step_tags: stepTags(inputs) };
}

/** Initiative / purpose per plan step key (ref_type delivery), for the posts and notes in the delivery section. */
function stepTags(inputs) {
  const out = {};
  for (const [k, v] of tagIndex(inputs.links, inputs.initiatives)) if (k.startsWith('delivery|step|')) out[k.slice('delivery|'.length)] = v;
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
    sb.from('marketing_segment_exports').select('export_id, campaign_key, list_name, eligible_count, status, sqs_list_id, load_result, owner:definition_snapshot->owner, is_test').eq('is_test', false),
    sb.from('sqs_scheduled_emails').select('*'),
    sb.from('sqs_email_campaigns').select('email_id, subject, sent_on, message_count, mailing_list_names, collected_at').order('sent_on', { ascending: false }).limit(60),
    sb.from('marketing_collector_runs').select('kind, status, started_at, finished_at, error, summary').eq('kind', SCHEDULE_READ_KIND).order('started_at', { ascending: false }).limit(10)
  ]);
  for (const [name, r] of [['strategy_campaigns', camps], ['marketing_segment_exports', exps], ['sqs_scheduled_emails', sched]]) if (r.error) throw new Error(`${name}: ${r.error.message}`);
  return { ...(await linkInputs(sb)), campaigns: (camps.data || []).map(({ stage_history: h, results_snapshot: _r, sent_audience: _s, ...c }) => ({ ...c, stage_history: (h || []).map((e) => ({ stage: e.stage, at: e.at })) })), exports: exps.data || [], schedules: sched.data || [], sent: sent.data || [], runs: runs.data || [] };
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
  const { data, error } = await sb.from('sqs_scheduled_emails').update(patch).eq('email_id', String(b.email_id)).select('email_id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('schedule not found');
  return { email_id: b.email_id, ...patch };
}
