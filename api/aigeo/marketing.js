/**
 * Marketing & Campaigns tab API. Every action needs x-arp-admin-key (customer data never leaves without it), except the
 * nightly cron GET ?action=sync, which needs Vercel's cron auth and returns counts only. Nothing here sends, schedules
 * or changes anything in Squarespace (GET only); segment → list transfer is a CSV the dashboard hands to the importer.
 *
 * GET  ?action=overview[&centre=&max_miles=&promoted_date=]   sources, identity, suppression, meter, segments, exports
 * GET  ?action=customers&q=&segment_id=&page=                  customer list (50 a page)
 * GET  ?action=customer&person_id=                             one person: bookings, links, probable records, segments
 * GET  ?action=export-csv&export_id=                           import CSV (consent re-checked at download)
 * GET  ?action=collector-state                                 which sent campaigns already have complete recipient events
 * GET  ?action=suppression-review                              suppressed people subscribed again, with the evidence
 * POST { action: 'suppression-resolve', email_hash, reason }   clear one person (typed reason, logged; Squarespace untouched)
 * POST { action: 'list-load-request', export_id }              queue "Load into Squarespace list" (run on Alan's PC)
 * GET  ?action=list-load-next  ·  POST list-load-precheck / -postcheck / -fixed / -progress / -finish   (PC job runner)
 * POST { action: 'presend-check', export_id }                   consent + suppression for everyone loaded → PASS / FAIL
 * GET  ?action=run&run_id=                                      progress of a queued / running job
 * GET  ?action=query-fields | groups | group-versions&segment_id=   query builder catalogue, saved groups
 * POST { action: 'query-run', query, sort, dir, page, columns, show }   filtered customer table (server-side paging)
 * POST { action: 'customer-why', person_id, query }             detail + timeline + why in / out of the query
 * POST { action: 'group-save' | 'group-preview', ... }          versioned saved groups; who joined / left since last check
 * POST { action: 'sync', step: profiles|orders|postcodes|customers }
 * POST { action: 'segment-preview', segment_ids, params }      count + exclusion reasons + first 25 people
 * POST { action: 'segment-save', segment_id?, name, description, definition }
 * POST { action: 'export-create', segment_ids, params, campaign_key, list_name }
 * POST { action: 'export-status', export_id, status, note }
 * POST { action: 'campaign-plan', campaign_key, reserved_sends?, sqs_email_id?, segment_ids? }
 * POST { action: 'collector', kind_of: meter|campaigns|events|run, data }
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { requireAdminKeyOnly } from '../../lib/api/requireAdminKeyOnly.js';
import { ingest } from '../../lib/marketing/collector-ingest.mjs';
import { customerDetail, listCustomers } from '../../lib/marketing/customers.mjs';
import { createExport, createTestExport, exportCsv, setExportStatus } from '../../lib/marketing/exports.mjs';
import { allSegments, evalCtx, loadPeople, overview, withParams } from '../../lib/marketing/overview.mjs';
import { rebuildCustomers } from '../../lib/marketing/rebuild.mjs';
import { evaluate } from '../../lib/marketing/segments.mjs';
import { resolveOne, reviewList } from '../../lib/marketing/suppression-review.mjs';
import { finishLoad, fixFlips, nextLoad, postcheck, precheck, presendCheck, repairFailed, repairQueue, requestLoad, runProgress } from '../../lib/marketing/list-load.mjs';
import { QUERY_GETS, QUERY_POSTS } from '../../lib/marketing/query/api.mjs';
import { approveManifest, executeDryRun, freezeManifest, listManifests, reviewCleanup, verifyManifest } from '../../lib/marketing/cleanup.mjs';
import { cronOrAdmin } from '../../lib/api/cronAuth.js';
import { validateQuery } from '../../lib/marketing/query/english.mjs';
import { finishRun, logRun, serviceClient } from '../../lib/marketing/store.mjs';
import { syncOrders, syncPostcodes, syncProfiles } from '../../lib/marketing/sync.mjs';

const SET_BY = 'Alan (dashboard, admin key)';
const STEPS = { profiles: syncProfiles, orders: syncOrders, postcodes: syncPostcodes, customers: rebuildCustomers };

function send(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
}

const isCron = (req) => cronOrAdmin(req) === 'cron';

async function runStep(sb, step) {
  const fn = STEPS[step];
  if (!fn) throw new Error(`step must be one of ${Object.keys(STEPS).join(', ')}`);
  const runId = await logRun(sb, { kind: `sync:${step}`, status: 'running', host: 'vercel' });
  try {
    const out = await fn(sb);
    await finishRun(sb, runId, { status: 'ok', summary: out });
    return { step, ...out };
  } catch (err) {
    await finishRun(sb, runId, { status: 'failed', error: String(err?.message || err).slice(0, 500) });
    throw err;
  }
}

async function cronSync(sb) {
  const out = {};
  for (const step of Object.keys(STEPS)) {
    try { out[step] = await runStep(sb, step); } catch (err) { out[step] = { error: String(err?.message || err) }; }
  }
  return out;
}

const params = (q) => ({ centre: q.centre, max_miles: q.max_miles, promoted_date: q.promoted_date, include_unknown_distance: q.include_unknown_distance === '1' || q.include_unknown_distance === true });

async function preview(sb, b) {
  const segs = (await allSegments(sb)).filter((s) => (b.segment_ids || []).includes(s.segment_id));
  if (!segs.length) throw new Error('choose at least one segment');
  const p = b.params || {};
  const ctx = await evalCtx(sb, p);
  const r = evaluate(await loadPeople(sb), segs.map((s) => withParams(s.definition, p)), ctx);
  return { count: r.count, exclusions: r.exclusions, sample: r.members.slice(0, 25).map((m) => ({ person_id: m.person_id, name: m.facts.name || m.display_name, email: m.facts.email, last_booking: m.facts.last_booking })) };
}

async function saveSegment(sb, b) {
  const name = String(b.name || '').trim().slice(0, 120);
  if (!name || !b.definition?.query) throw new Error('a segment needs a name and a structured query (use Customers → Save as group)');
  b.definition = { ...b.definition, query: validateQuery(b.definition.query) };
  const id = b.segment_id || `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)}`;
  if ((await allSegments(sb)).some((s) => s.segment_id === id && s.is_builtin)) throw new Error('built-in segments are fixed; save under a new name');
  const row = { segment_id: id, name, description: b.description ? String(b.description).slice(0, 500) : null, definition: b.definition, is_builtin: false, set_by: SET_BY, updated_at: new Date().toISOString() };
  const { error } = await sb.from('marketing_segments').upsert(row, { onConflict: 'segment_id' });
  if (error) throw new Error(error.message);
  return { segment_id: id };
}

/** "Not the same person": keep a Booking Sheet name record as its own row instead of under a contact (reversible C10). */
async function separateIdentity(sb, b, rebuild) {
  const reason = String(b.reason || '').trim();
  if (reason.length < 10) throw new Error('give a reason (10+ characters)');
  const { data: p, error } = await sb.from('customer_person').select('anchor_key').eq('person_id', b.person_id).maybeSingle();
  if (error || !p) throw new Error('record not found');
  if (!p.anchor_key.startsWith('name:')) throw new Error('only Booking Sheet name records can be separated');
  const { error: e2 } = await sb.from('marketing_identity_overrides').upsert({ name_anchor: p.anchor_key, action: 'separate', reason: reason.slice(0, 300), set_by: SET_BY, set_at: new Date().toISOString() }, { onConflict: 'name_anchor' });
  if (e2) throw new Error(e2.message);
  await rebuild();
  return { separated: p.anchor_key.slice(0, 5) + '…', person_id: b.person_id };
}

async function campaignPlan(sb, b) {
  const patch = {};
  if (b.reserved_sends != null) patch.reserved_sends = Math.max(0, Math.round(Number(b.reserved_sends)) || 0);
  if (b.sqs_email_id !== undefined) patch.sqs_email_id = b.sqs_email_id ? String(b.sqs_email_id) : null;
  if (Array.isArray(b.segment_ids)) patch.segment_ids = b.segment_ids.map(String);
  if (!b.campaign_key || !Object.keys(patch).length) throw new Error('campaign_key and something to change are needed');
  const { data, error } = await sb.from('strategy_campaigns').update({ ...patch, updated_at: new Date().toISOString() }).eq('campaign_key', b.campaign_key).select('campaign_key');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('campaign not found (create it from Campaign records first)');
  if (patch.sqs_email_id) await sb.from('sqs_email_campaigns').update({ campaign_key: b.campaign_key }).eq('email_id', patch.sqs_email_id);
  return { campaign_key: b.campaign_key, ...patch };
}

const GETS = {
  overview: (sb, q) => overview(sb, params(q)),
  customers: (sb, q) => listCustomers(sb, { q: q.q, segment_id: q.segment_id, page: q.page || 0, subscribed_only: q.subscribed_only === '1', params: params(q) }),
  customer: (sb, q) => customerDetail(sb, q.person_id, params(q)),
  'collector-state': collectorState,
  'suppression-review': (sb) => reviewList(sb),
  'list-load-next': (sb) => nextLoad(sb),
  'cleanup-list': (sb) => listManifests(sb),
  'plan-import-next': async (sb) => {
    const { data } = await sb.from('marketing_collector_runs').select('run_id').eq('kind', 'plan-import').eq('status', 'queued').order('started_at').limit(1).maybeSingle();
    if (!data) return { job: null };
    await sb.from('marketing_collector_runs').update({ status: 'running', host: 'alan-pc', heartbeat_at: new Date().toISOString() }).eq('run_id', data.run_id);
    return { job: { run_id: data.run_id } };
  },
  run: async (sb, q) => {
    const { data, error } = await sb.from('marketing_collector_runs').select('run_id, kind, status, started_at, heartbeat_at, finished_at, items_done, items_total, checkpoint, summary, error').eq('run_id', q.run_id).maybeSingle();
    if (error || !data) throw new Error('run not found');
    return { run: data };
  },
  ...QUERY_GETS
};

async function collectorState(sb) {
  const { data, error } = await sb.from('sqs_email_campaigns').select('email_id, sent_on, events_complete, events_collected_at, message_count');
  if (error) throw new Error(error.message);
  return { campaigns: data || [] };
}

const POSTS = {
  sync: (sb, b) => runStep(sb, b.step),
  'segment-preview': preview,
  'segment-save': saveSegment,
  'export-create': (sb, b) => createExport(sb, { ...b, created_by: SET_BY }, () => runStep(sb, 'profiles').then(() => runStep(sb, 'customers'))),
  'export-status': (sb, b) => setExportStatus(sb, { ...b, by: SET_BY }),
  'export-test-create': (sb, b) => createTestExport(sb, { ...b, created_by: SET_BY }),
  'campaign-plan': campaignPlan,
  'suppression-resolve': (sb, b) => resolveOne(sb, b, () => runStep(sb, 'customers')),
  'list-load-request': (sb, b) => requestLoad(sb, b.export_id, SET_BY, { automations_checked: b.automations_checked === true }),
  'list-repair-next': (sb) => repairQueue(sb),
  'cleanup-review': async (sb, b) => { const { rows, ...r } = await reviewCleanup(sb, b); return r; },
  'cleanup-freeze': (sb, b) => freezeManifest(sb, b, SET_BY),
  'cleanup-approve': (sb, b) => approveManifest(sb, b, SET_BY),
  'cleanup-execute': (sb, b) => executeDryRun(sb, b, SET_BY),
  'cleanup-verify': (sb, b) => verifyManifest(sb, b, SET_BY),
  'list-repair-failed': (sb, b) => repairFailed(sb, b.export_id, b.error),
  'list-load-precheck': (sb, b) => precheck(sb, b.export_id),
  'list-load-postcheck': (sb, b) => postcheck(sb, b.export_id, b),
  'list-load-fixed': (sb, b) => fixFlips(sb, b.export_id, b),
  'list-load-progress': (sb, b) => runProgress(sb, b.run_id, { items_done: b.items_done, items_total: b.items_total, checkpoint: { export_id: b.export_id, step: String(b.step || '').slice(0, 120) } }),
  'list-load-finish': (sb, b) => finishLoad(sb, { ...b, status: b.status === 'ok' ? 'ok' : 'failed' }),
  'presend-check': (sb, b) => presendCheck(sb, b.export_id),
  'identity-separate': (sb, b) => separateIdentity(sb, b, () => runStep(sb, 'customers')),
  'plan-import-request': async (sb) => ({ run_id: await logRun(sb, { kind: 'plan-import', status: 'queued', host: 'dashboard', items_total: 0, items_done: 0, checkpoint: { step: 'waiting for Alan\'s PC (checks every 5 min)' } }) }),
  collector: ingest,
  ...QUERY_POSTS
};

async function csvDownload(res, sb, exportId) {
  const out = await exportCsv(sb, exportId);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${out.list_name.replace(/[^A-Za-z0-9 _-]/g, '').replace(/\s+/g, '_')}.csv"`);
  res.setHeader('X-Export-Rows', String(out.rows));
  res.setHeader('X-Export-Dropped', JSON.stringify(out.dropped));
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(out.csv);
}

async function route(req, res, sb) {
  const q = req.query || {};
  if (req.method === 'GET' && q.action === 'sync' && isCron(req)) return send(res, 200, { ok: true, cron: await cronSync(sb) });
  if (!requireAdminKeyOnly(req, res, send)) return undefined;
  if (req.method === 'GET' && q.action === 'export-csv') return csvDownload(res, sb, q.export_id);
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const fn = req.method === 'GET' ? GETS[q.action] : POSTS[b.action];
  if (!fn) return send(res, 400, { ok: false, error: 'unknown action' });
  return send(res, 200, { ok: true, ...(await fn(sb, req.method === 'GET' ? q : b)) });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (!['GET', 'POST'].includes(req.method)) return send(res, 405, { ok: false, error: 'Method not allowed' });
  try {
    return await route(req, res, serviceClient());
  } catch (err) {
    return send(res, 400, { ok: false, error: String(err?.message || err) });
  }
}
