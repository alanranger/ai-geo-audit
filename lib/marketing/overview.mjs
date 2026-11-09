/** Marketing tab data assembly (server side). Personal data only leaves through the admin-key route that calls these. */
import { DEFAULT_WINDOWS, engagementView } from './engagement.mjs';
import { IMPORT_BLOCK } from './import-block.mjs';
import { presendState, reconcileSends } from './list-load.mjs';
import { isListed } from './record-type.mjs';
import { describe } from './query/english.mjs';
import { meterView } from './meter.mjs';
import { deliveryInputs, draftFacts } from './delivery.mjs';
import { overviewTileFacts } from './overview-tiles.mjs';
import { BUILTIN_SEGMENTS, DEFAULT_CENTRE, evaluate, resolveParams } from './segments.mjs';
import { normPostcode, selectAll } from './store.mjs';
import { shortId } from './query/topics.mjs';
import { isOwner, londonDay } from './client-health.mjs';
import { blockedCounts } from './decision-state.mjs';

export async function centreOf(sb, postcode, fetchFn = fetch) {
  const pc = normPostcode(postcode || DEFAULT_CENTRE);
  if (!pc) throw new Error('centre postcode is not a UK postcode');
  const { data } = await sb.from('postcode_geo_cache').select('lat, lng, status').eq('postcode', pc).maybeSingle();
  if (data?.status === 'ok') return { postcode: pc, lat: data.lat, lng: data.lng };
  const r = await fetchFn(`https://api.postcodes.io/postcodes/${encodeURIComponent(pc)}`);
  const j = await r.json();
  if (!j.result) throw new Error(`centre postcode ${pc} not found`);
  await sb.from('postcode_geo_cache').upsert({ postcode: pc, lat: j.result.latitude, lng: j.result.longitude, status: 'ok' }, { onConflict: 'postcode' });
  return { postcode: pc, lat: j.result.latitude, lng: j.result.longitude };
}

/** The collector's normal lag: a campaign sent this recently and not yet collected doesn't stop negative answers. */
export const RECENT_PENDING_HOURS = 48;

/**
 * Coverage from the campaign rows ({ sent_on, events_complete }). is_complete = every campaign collected (strict).
 * covered = negative answers (cold / no recorded response / inactivity) may be given: complete, or the only uncollected
 * campaigns were sent within RECENT_PENDING_HOURS; they are then "as of the last collected campaign" (covered_through).
 */
export function coverageOf(rows, nowIso = new Date().toISOString()) {
  const pending = rows.filter((c) => !c.events_complete);
  const done = rows.filter((c) => c.events_complete).map((c) => String(c.sent_on || '')).sort();
  const cutoff = Date.parse(nowIso) - RECENT_PENDING_HOURS * 3600000;
  const recentOnly = pending.length > 0 && pending.every((c) => Date.parse(c.sent_on) >= cutoff);
  const awaiting = rows.filter((c) => c.uncollected).length;
  const readPending = pending.filter((c) => !c.uncollected);
  const recentRead = readPending.filter((c) => Date.parse(c.sent_on) >= cutoff).length;
  return {
    campaigns: rows.length, complete: rows.length - pending.length, is_complete: rows.length > 0 && !pending.length,
    pending: pending.length, pending_recent_only: recentOnly, covered: rows.length > 0 && (!pending.length || recentOnly),
    covered_through: done.length ? done[done.length - 1].slice(0, 10) : null, recent_pending_hours: RECENT_PENDING_HOURS,
    known: rows.length, collected: rows.length - awaiting, awaiting_collector: awaiting,
    collecting_recent: recentRead, incomplete_older: readPending.length - recentRead
  };
}

/**
 * Sends the dashboard knows went out but the collector hasn't read into its Sent list yet: a Squarespace schedule that
 * left the Scheduled tab after its send time, or a campaign record marked sent. Pending (never "no engagement").
 */
const leftAfterSend = (p) => p.state === 'gone' && !!p.gone_at && !!p.scheduled_for && p.gone_at >= p.scheduled_for;
const recordSentAt = (r) => r.scheduled_for || `${r.sent_on || r.planned_send_on}T12:00:00Z`;
export function knownUncollected(collected, schedules, records) {
  const have = new Set(collected.flatMap((c) => [c.email_id, c.campaign_key]).filter(Boolean));
  const out = new Map(schedules.filter((p) => leftAfterSend(p) && !have.has(p.email_id)).map((p) => [p.email_id, p.scheduled_for]));
  for (const r of records.filter((x) => ['sent', 'measured'].includes(x.stage) && !have.has(x.campaign_key))) {
    const id = r.sqs_email_id || r.sqs_draft_id;
    if (id && !have.has(id) && !out.has(id)) out.set(id, recordSentAt(r));
  }
  return [...out].map(([email_id, sent_on]) => ({ email_id, sent_on, events_complete: false, uncollected: true }));
}

export async function engagementCoverage(sb) {
  const [rows, sched, recs] = await Promise.all([
    selectAll(sb, 'sqs_email_campaigns', 'email_id, sent_on, events_complete, campaign_key'),
    sb.from('sqs_scheduled_emails').select('email_id, scheduled_for, state, gone_at'),
    sb.from('strategy_campaigns').select('campaign_key, stage, sqs_email_id, sqs_draft_id, scheduled_for, sent_on, planned_send_on').in('stage', ['sent', 'measured'])
  ]);
  return coverageOf([...rows, ...knownUncollected(rows, sched.data || [], recs.data || [])]);
}

/**
 * The campaigns whose recipients are stored per person (latest 40 fully collected, newest first): readable titles for
 * the builder, and the window that decides when "received / opened campaign X" can be a firm no.
 */
export async function recentCampaigns(sb) {
  const { data } = await sb.from('sqs_email_campaigns').select('email_id, subject, sent_on, mailing_list_names').eq('events_complete', true).order('sent_on', { ascending: false }).limit(40);
  const list = (data || []).map((c) => ({ id: shortId(c.email_id), subject: c.subject || '(no subject)', sent_on: String(c.sent_on || '').slice(0, 10), lists: c.mailing_list_names || null }));
  return { list, byId: new Map(list.map((c) => [c.id, c])), start: list.length ? list[list.length - 1].sent_on : null };
}

/** Shared evaluation context for segments (centre, today, engagement coverage + windows, stored campaign window). */
export async function evalCtx(sb, params = {}) {
  const cov = await engagementCoverage(sb);
  const windows = { warm_days: Number(params.warm_days) || DEFAULT_WINDOWS.warm_days, cooling_days: Number(params.cooling_days) || DEFAULT_WINDOWS.cooling_days };
  const { data: lastBuild } = await sb.from('marketing_collector_runs').select('summary').eq('kind', 'sync:customers').eq('status', 'ok').order('started_at', { ascending: false }).limit(1).maybeSingle();
  const campaigns = await recentCampaigns(sb);
  const now = new Date().toISOString();
  return { centre: await centreOf(sb, params.centre), today: now.slice(0, 10), asOf: londonDay(now), engagementComplete: cov.covered, engagement_coverage: cov, windows, campaigns, exposureBuilt: lastBuild?.summary?.campaign_exposure_rows > 0, academyFeed: lastBuild?.summary?.memberstack_available !== false, academyDates: lastBuild?.summary?.academy_trial_rows > 0 };
}

export async function allSegments(sb) {
  const { data, error } = await sb.from('marketing_segments').select('*').order('created_at');
  if (error) throw new Error(`marketing_segments: ${error.message}`);
  const custom = (data || []).filter((s) => !BUILTIN_SEGMENTS.some((b) => b.segment_id === s.segment_id));
  return [...BUILTIN_SEGMENTS.map((s) => ({ ...s, is_builtin: true })), ...custom];
}

/** Apply per-campaign settings ($max_miles, $promoted_date) to a segment's structured query; centre is resolved apart. */
export const withParams = (def, params = {}) => resolveParams(def, params);

export const loadPeople = (sb) => selectAll(sb, 'customer_person', 'person_id, anchor_key, display_name, facts');

const runTime = (r) => r.finished_at || r.heartbeat_at || r.started_at;

/** The newest collector run of any kind (daily or backfill): a later success clears an earlier stale / failed run. */
export function latestCollectorRun(runs) {
  return runs.filter((r) => r.kind === 'collector' || r.kind === 'collector:backfill').sort((a, b) => String(runTime(b)).localeCompare(String(runTime(a))))[0] || null;
}

async function latestRuns(sb) {
  const { data } = await sb.from('marketing_collector_runs').select('run_id, kind, started_at, finished_at, heartbeat_at, status, items_total, items_done, summary, error').order('started_at', { ascending: false }).limit(200);
  const out = {};
  for (const r of data || []) if (!out[r.kind]) out[r.kind] = r;
  out.collector_latest = latestCollectorRun(data || []);
  return out;
}

async function coverage(sb) {
  const range = async (table, col, imp) => {
    const lo = await sb.from(table).select(col).order(col, { ascending: true }).limit(1).maybeSingle();
    const hi = await sb.from(table).select(`${col}, ${imp}`).order(imp, { ascending: false }).limit(1).maybeSingle();
    const { count } = await sb.from(table).select('*', { count: 'exact', head: true });
    return { rows: count, from: lo.data?.[col] || null, last_import: hi.data?.[imp] || null };
  };
  return {
    booking_sheet_transactions: await range('booking_sheet_transactions', 'txn_date', 'imported_at'),
    booking_sheet_workshops: await range('booking_sheet_workshop_attendees', 'event_start', 'imported_at'),
    booking_sheet_courses: await range('booking_sheet_course_attendees', 'from_date', 'imported_at'),
    squarespace_orders: await range('sqs_orders', 'created_on', 'synced_at')
  };
}

function identitySummary(people) {
  const live = people.filter((p) => isListed(p.facts));
  const prof = people.filter((p) => !p.facts?.stale && p.facts.profile_state === 'active');
  const types = people.filter((p) => !p.facts?.stale).reduce((m, p) => ({ ...m, [p.facts.record_type || 'person']: (m[p.facts.record_type || 'person'] || 0) + 1 }), {});
  return {
    persons: live.length, record_types: types, attached_under_contact: people.filter((p) => p.facts?.attached_to).length,
    squarespace_profiles: prof.length, subscribed: prof.filter((p) => p.facts.subscribed).length,
    subscribed_unsuppressed: prof.filter((p) => p.facts.subscribed && !p.facts.suppressed).length,
    suppressed_but_subscribed: prof.filter((p) => p.facts.subscribed && p.facts.suppressed).length,
    with_location: prof.filter((p) => p.facts.lat != null).length, history_incomplete: prof.filter((p) => p.facts.history_incomplete).length,
    booking_sheet_name_only: live.filter((p) => p.anchor_key.startsWith('name:')).length,
    academy_linked: live.filter((p) => p.facts.academy).length
  };
}

/** Subscribed people by open band and by click band (counts only). */
function engagementBands(people, ctx) {
  const open = {};
  const click = {};
  for (const p of people) {
    if (!p.facts?.subscribed || p.facts.suppressed) continue;
    const v = engagementView(p.facts.engagement, ctx.engagementComplete, ctx.windows, ctx.today);
    open[v.open] = (open[v.open] || 0) + 1;
    click[v.click] = (click[v.click] || 0) + 1;
  }
  return { open, click };
}

async function suppressionSummary(sb) {
  const rows = await selectAll(sb, 'marketing_suppression', 'reason, resolved_at');
  const by = {};
  for (const r of rows) if (!r.resolved_at) by[r.reason] = (by[r.reason] || 0) + 1;
  return { active: rows.filter((r) => !r.resolved_at).length, by_reason: by };
}

const isOrgRecord = (p) => p.facts?.record_type === 'organisation' && !isOwner(p.facts);

/**
 * One evaluator result as the send budget counts it: people (organisations and owner addresses apart, as the saved
 * group header) + Alan's business copy once. Owner addresses and organisations matched are reported, not in `sends`.
 */
export function audienceSplit(r) {
  const organisations = r.members.filter(isOrgRecord).length;
  const businessCopy = Math.min(1, ((r.owner_kinds || {}).business || 0) + (r.business_copy || 0));
  const people = r.count - organisations;
  return { people, business_copy: businessCopy, owner_addresses: (r.owner_kinds || {}).personal || 0, organisations, sends: people + businessCopy };
}

/** The saved group a draft names in its estimate rule (e.g. "gpt-8w-pnm-review"): shown beside the plan, never reserved. */
const referencedGroup = (c, segById) => [...segById.keys()].sort((a, b) => b.length - a.length).find((id) => String(c.estimate_rule || '').includes(id)) || null;

function audienceQuery(c, people, ctx, segById) {
  const chosen = c.audience === 'segments' ? (c.segment_ids || []).filter((id) => segById.has(id)) : [];
  const ref = chosen.length || c.audience ? null : referencedGroup(c, segById);
  const ids = chosen.length ? chosen : [ref].filter(Boolean);
  if (!ids.length) return null;
  const r = evaluate(people, ids.map((id) => withParams(segById.get(id).definition, {})), ctx);
  return { ...audienceSplit(r), segment_id: ids.join(' + '), attached: !ref };
}

/**
 * Live audience for each open record with no snapshot yet; refreshed on every read until a snapshot freezes it.
 * Full list = Squarespace's own subscribed count. A record with no audience but a saved group named in its estimate
 * rule gets that group's count as `attached: false` (shown as "query now", never reserved).
 */
export function audienceEstimates(campaigns, people, ctx, segments, identity) {
  const segById = new Map(segments.map((s) => [s.segment_id, s]));
  const out = {};
  for (const c of campaigns) {
    if (c.export_id || ['sent', 'measured', 'cancelled'].includes(c.stage)) continue;
    if (c.audience === 'full_list') { out[c.campaign_key] = identity.subscribed; continue; }
    const q = audienceQuery(c, people, ctx, segById);
    if (q) out[c.campaign_key] = q;
  }
  return out;
}

export async function meterFor(sb, est = null) {
  const { data: latest } = await sb.from('sqs_send_meter').select('*').order('captured_at', { ascending: false }).limit(1).maybeSingle();
  const inputs = await deliveryInputs(sb);
  const estimates = est ? audienceEstimates(inputs.campaigns, est.people, est.ctx, est.segments, est.identity) : {};
  return meterView(latest, inputs.campaigns, inputs.sent, new Date(), { ...inputs, estimates });
}

async function activeLoads(sb) {
  const { data } = await sb.from('marketing_collector_runs').select('run_id, status, started_at, heartbeat_at, finished_at, items_done, items_total, checkpoint, error').eq('kind', 'list-load').order('started_at', { ascending: false }).limit(30);
  const out = new Map();
  for (const r of data || []) if (r.checkpoint?.export_id && !out.has(r.checkpoint.export_id)) out.set(r.checkpoint.export_id, r);
  return out;
}

export async function overview(sb, params = {}) {
  const people = await loadPeople(sb);
  const ctx = await evalCtx(sb, params);
  const { centre } = ctx;
  const asOf = new Date().toISOString();
  const segDefs = await allSegments(sb);
  const segments = segDefs.map((s) => {
    const def = withParams(s.definition, params);
    const r = evaluate(people, [def], ctx);
    return { segment_id: s.segment_id, name: s.name, description: s.description, is_builtin: !!s.is_builtin, definition: def, version: s.definition?.version || 1, english: describe(def.query.root), as_of: asOf, count: r.count, admin_included: r.admin_included, owner_included: r.owner_included, owner_kinds: r.owner_kinds, business_copy: r.business_copy, exclusions: r.exclusions };
  });
  const { data: exports } = await sb.from('marketing_segment_exports').select('export_id, segment_ids, campaign_key, list_name, eligible_count, owner:definition_snapshot->owner, exclusions, status, status_history, created_at, source_sync_at, is_test, sqs_list_id, loaded_at, load_result, presend_at, presend_result').order('created_at', { ascending: false }).limit(30);
  const loadRuns = await activeLoads(sb);
  const identity = identitySummary(people);
  const blocked = await blockedCounts(sb).catch(() => null);
  if (blocked) Object.assign(identity, { suppressed_total: blocked.total, suppressed_decided: blocked.decided, suppressed_new: blocked.open });
  const runs = await latestRuns(sb);
  return {
    centre, identity, coverage: await coverage(sb), suppression: await suppressionSummary(sb),
    runs, meter: await meterFor(sb, { people, ctx, segments: segDefs, identity }), segments, import_block: IMPORT_BLOCK, reconcile: await reconcileSends(sb),
    exports: (exports || []).map((e) => ({ ...e, presend: presendState(e), load_run: loadRuns.get(e.export_id) || null })),
    engagement: { coverage: ctx.engagement_coverage, freshness: freshnessOf(ctx.engagement_coverage, runs.collector_latest, runs['collector:backfill']), windows: ctx.windows, bands: engagementBands(people, ctx) },
    drafts: await draftFacts(sb),
    tiles: await overviewTileFacts(sb)
  };
}

const FAILED = new Set(['failed', 'stale', 'partial']);
const RECOVER = {
  stale: 'Squarespace login expired: on Alan\'s PC run npm run marketing:collector-login, then npm run marketing:collector',
  failed: 'On Alan\'s PC run npm run marketing:collector (it resumes where it stopped)',
  partial: 'On Alan\'s PC run npm run marketing:collector (it resumes where it stopped)'
};
const plural = (k, one) => `${k} ${one}${k === 1 ? '' : 's'}`;

/**
 * One collector-freshness message for every screen (final fix round item 11). "Failed" + a recovery step only when the
 * latest collector run really failed or stopped part-way; new sends the collector hasn't read yet are "awaiting next
 * collector", never a failure; older campaigns still being read by a running backfill are "collecting".
 */
export function freshnessOf(cov, latest, backfill) {
  if (!cov) return null;
  if (latest && FAILED.has(latest.status)) return { state: 'failed', text: `collector ${latest.status === 'stale' ? 'login expired' : latest.status}${latest.error ? `: ${String(latest.error).slice(0, 120)}` : ''}`, action: RECOVER[latest.status] };
  if (cov.is_complete) return { state: 'complete', text: `all ${plural(cov.campaigns, 'campaign')} collected`, action: null };
  const parts = [];
  if (cov.awaiting_collector) parts.push(`${plural(cov.awaiting_collector, 'new send')} awaiting next collector`);
  if (cov.collecting_recent) parts.push(`${plural(cov.collecting_recent, 'recent send')} still being collected`);
  if (cov.incomplete_older && backfill?.status === 'running') parts.push(`${plural(cov.incomplete_older, 'older campaign')} being read (backfill running)`);
  else if (cov.incomplete_older) return { state: 'incomplete', text: [...parts, `${plural(cov.incomplete_older, 'older campaign')} not fully read yet`].join(' · '), action: 'On Alan\'s PC run npm run marketing:collector-backfill to finish them (not a failure)' };
  return { state: parts.length ? 'awaiting' : 'complete', text: parts.join(' · ') || 'all collected', action: null };
}
