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
import { createExport, exportCsv, setExportStatus } from '../../lib/marketing/exports.mjs';
import { allSegments, evalCtx, loadPeople, overview, withParams } from '../../lib/marketing/overview.mjs';
import { rebuildCustomers } from '../../lib/marketing/rebuild.mjs';
import { evaluate } from '../../lib/marketing/segments.mjs';
import { finishRun, logRun, serviceClient } from '../../lib/marketing/store.mjs';
import { syncOrders, syncPostcodes, syncProfiles } from '../../lib/marketing/sync.mjs';

const SET_BY = 'Alan (dashboard, admin key)';
const STEPS = { profiles: syncProfiles, orders: syncOrders, postcodes: syncPostcodes, customers: rebuildCustomers };

function send(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
}

function isCron(req) {
  const secret = process.env.CRON_SECRET;
  if (secret) return String(req.headers.authorization || '') === `Bearer ${secret}`;
  return String(req.headers['x-vercel-cron'] || '') === '1';
}

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
  if (!name || !b.definition || typeof b.definition !== 'object') throw new Error('a segment needs a name and a definition');
  const id = b.segment_id || `custom-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)}`;
  if ((await allSegments(sb)).some((s) => s.segment_id === id && s.is_builtin)) throw new Error('built-in segments are fixed; save under a new name');
  const row = { segment_id: id, name, description: b.description ? String(b.description).slice(0, 500) : null, definition: b.definition, is_builtin: false, set_by: SET_BY, updated_at: new Date().toISOString() };
  const { error } = await sb.from('marketing_segments').upsert(row, { onConflict: 'segment_id' });
  if (error) throw new Error(error.message);
  return { segment_id: id };
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
  'collector-state': collectorState
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
  'campaign-plan': campaignPlan,
  collector: ingest
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
