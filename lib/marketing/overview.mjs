/** Marketing tab data assembly (server side). Personal data only leaves through the admin-key route that calls these. */
import { DEFAULT_WINDOWS, engagementView } from './engagement.mjs';
import { IMPORT_BLOCK } from './import-block.mjs';
import { meterView } from './meter.mjs';
import { BUILTIN_SEGMENTS, DEFAULT_CENTRE, evaluate } from './segments.mjs';
import { normPostcode, selectAll } from './store.mjs';

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

/** Engagement coverage: complete only when every sent campaign's recipient lists have been read to the end. */
export async function engagementCoverage(sb) {
  const { count: total } = await sb.from('sqs_email_campaigns').select('*', { count: 'exact', head: true });
  const { count: done } = await sb.from('sqs_email_campaigns').select('*', { count: 'exact', head: true }).eq('events_complete', true);
  return { campaigns: total || 0, complete: done || 0, is_complete: !!total && total === done };
}

/** Shared evaluation context for segments (centre, today, engagement coverage + windows). */
export async function evalCtx(sb, params = {}) {
  const cov = await engagementCoverage(sb);
  const windows = { warm_days: Number(params.warm_days) || DEFAULT_WINDOWS.warm_days, cooling_days: Number(params.cooling_days) || DEFAULT_WINDOWS.cooling_days };
  return { centre: await centreOf(sb, params.centre), today: new Date().toISOString().slice(0, 10), engagementComplete: cov.is_complete, engagement_coverage: cov, windows };
}

export async function allSegments(sb) {
  const { data, error } = await sb.from('marketing_segments').select('*').order('created_at');
  if (error) throw new Error(`marketing_segments: ${error.message}`);
  const custom = (data || []).filter((s) => !BUILTIN_SEGMENTS.some((b) => b.segment_id === s.segment_id));
  return [...BUILTIN_SEGMENTS.map((s) => ({ ...s, is_builtin: true })), ...custom];
}

/** Apply per-campaign settings (centre is resolved separately; radius / promoted date override the stored definition). */
export function withParams(def, params = {}) {
  const d = JSON.parse(JSON.stringify(def));
  if (d.distance && params.max_miles) d.distance.max_miles = Number(params.max_miles);
  if (d.distance && params.include_unknown_distance) d.distance.include_unknown = true;
  if ('exclude_booked_on_date' in d && params.promoted_date) d.exclude_booked_on_date = params.promoted_date;
  return d;
}

export const loadPeople = (sb) => selectAll(sb, 'customer_person', 'person_id, anchor_key, display_name, facts');

async function latestRuns(sb) {
  const { data } = await sb.from('marketing_collector_runs').select('run_id, kind, started_at, finished_at, heartbeat_at, status, items_total, items_done, summary, error').order('started_at', { ascending: false }).limit(60);
  const out = {};
  for (const r of data || []) if (!out[r.kind]) out[r.kind] = r;
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
  const live = people.filter((p) => !p.facts?.stale);
  const prof = live.filter((p) => p.facts.profile_state === 'active');
  return {
    persons: live.length, squarespace_profiles: prof.length, subscribed: prof.filter((p) => p.facts.subscribed).length,
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

export async function overview(sb, params = {}) {
  const people = await loadPeople(sb);
  const ctx = await evalCtx(sb, params);
  const { centre } = ctx;
  const segments = (await allSegments(sb)).map((s) => {
    const r = evaluate(people, [withParams(s.definition, params)], ctx);
    return { segment_id: s.segment_id, name: s.name, description: s.description, is_builtin: !!s.is_builtin, definition: s.definition, count: r.count, exclusions: r.exclusions };
  });
  const { data: exports } = await sb.from('marketing_segment_exports').select('export_id, segment_ids, campaign_key, list_name, eligible_count, exclusions, status, status_history, created_at, source_sync_at').order('created_at', { ascending: false }).limit(30);
  return {
    centre, identity: identitySummary(people), coverage: await coverage(sb), suppression: await suppressionSummary(sb),
    runs: await latestRuns(sb), meter: await meterFor(sb), segments, exports: exports || [], import_block: IMPORT_BLOCK,
    engagement: { coverage: ctx.engagement_coverage, windows: ctx.windows, bands: engagementBands(people, ctx) }
  };
}
