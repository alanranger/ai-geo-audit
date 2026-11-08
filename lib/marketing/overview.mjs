/** Marketing tab data assembly (server side). Personal data only leaves through the admin-key route that calls these. */
import { DEFAULT_WINDOWS, engagementView } from './engagement.mjs';
import { IMPORT_BLOCK } from './import-block.mjs';
import { presendState, reconcileSends } from './list-load.mjs';
import { isListed } from './record-type.mjs';
import { describe } from './query/english.mjs';
import { meterView } from './meter.mjs';
import { overviewTileFacts } from './overview-tiles.mjs';
import { BUILTIN_SEGMENTS, DEFAULT_CENTRE, evaluate, resolveParams } from './segments.mjs';
import { normPostcode, selectAll } from './store.mjs';
import { shortId } from './query/topics.mjs';
import { londonDay } from './client-health.mjs';

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
  return {
    campaigns: rows.length, complete: rows.length - pending.length, is_complete: rows.length > 0 && !pending.length,
    pending: pending.length, pending_recent_only: recentOnly, covered: rows.length > 0 && (!pending.length || recentOnly),
    covered_through: done.length ? done[done.length - 1].slice(0, 10) : null, recent_pending_hours: RECENT_PENDING_HOURS
  };
}

export async function engagementCoverage(sb) {
  return coverageOf(await selectAll(sb, 'sqs_email_campaigns', 'email_id, sent_on, events_complete'));
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

export async function meterFor(sb) {
  const { data: latest } = await sb.from('sqs_send_meter').select('*').order('captured_at', { ascending: false }).limit(1).maybeSingle();
  const { data: camps } = await sb.from('strategy_campaigns').select('campaign_key, title, stage, reserved_sends, sqs_email_id');
  const { data: sent } = await sb.from('sqs_email_campaigns').select('email_id, subject, sent_on, message_count').order('sent_on', { ascending: false }).limit(40);
  return meterView(latest, camps || [], sent || []);
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
  const segments = (await allSegments(sb)).map((s) => {
    const def = withParams(s.definition, params);
    const r = evaluate(people, [def], ctx);
    return { segment_id: s.segment_id, name: s.name, description: s.description, is_builtin: !!s.is_builtin, definition: def, version: s.definition?.version || 1, english: describe(def.query.root), as_of: asOf, count: r.count, admin_included: r.admin_included, owner_included: r.owner_included, owner_kinds: r.owner_kinds, business_copy: r.business_copy, exclusions: r.exclusions };
  });
  const { data: exports } = await sb.from('marketing_segment_exports').select('export_id, segment_ids, campaign_key, list_name, eligible_count, owner:definition_snapshot->owner, exclusions, status, status_history, created_at, source_sync_at, is_test, sqs_list_id, loaded_at, load_result, presend_at, presend_result').order('created_at', { ascending: false }).limit(30);
  const loadRuns = await activeLoads(sb);
  return {
    centre, identity: identitySummary(people), coverage: await coverage(sb), suppression: await suppressionSummary(sb),
    runs: await latestRuns(sb), meter: await meterFor(sb), segments, import_block: IMPORT_BLOCK, reconcile: await reconcileSends(sb),
    exports: (exports || []).map((e) => ({ ...e, presend: presendState(e), load_run: loadRuns.get(e.export_id) || null })),
    engagement: { coverage: ctx.engagement_coverage, windows: ctx.windows, bands: engagementBands(people, ctx) },
    tiles: await overviewTileFacts(sb)
  };
}
