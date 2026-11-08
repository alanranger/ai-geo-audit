/**
 * AR-social-v1 social standard (x-arp-admin-key).
 *  GET  ?view=all            event facts records (joined live, never copied), facts check, social placements (with
 *                            short-lived preview URLs for rendered assets) and the Facebook caption-link quota. Read-only.
 *  POST { action: 'render-request', step_key, event_id }
 *                            queues a render on Alan's PC (marketing_collector_runs kind 'social-render'); the progress
 *                            window polls GET /api/aigeo/marketing?action=run. The PC job (scripts/social-render/
 *                            render-job.mjs --jobs) renders feed / Story / LinkedIn PNGs and stores them per placement.
 * Nothing here publishes, schedules or marks anything scheduled.
 */
import { createClient } from '@supabase/supabase-js';
import { requireAdminKeyOnly } from '../../lib/api/requireAdminKeyOnly.js';
import { socialStandardView } from '../../lib/social-standard/facts.mjs';
import { checkUrls, markersIn, urlsInCaption } from '../../lib/social-standard/caption.mjs';
import { loadSquarespaceEventFeeds } from '../../lib/squarespace-events-feed.mjs';

const PROP = 'https://www.alanranger.com';
const BUCKET = 'social-renders';
const send = (res, status, body) => res.status(status).json(body);
const todayUk = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });

async function withPreviewUrls(sb, placements) {
  const paths = placements.flatMap((p) => Object.values(p.assets || {}).map((a) => a?.storage_path).filter(Boolean));
  if (!paths.length) return placements;
  const { data } = await sb.storage.from(BUCKET).createSignedUrls(paths, 3600);
  const url = new Map((data || []).map((d) => [d.path, d.signedUrl]));
  return placements.map((p) => ({ ...p, assets: Object.fromEntries(Object.entries(p.assets || {}).map(([k, a]) => [k, { ...a, url: url.get(a?.storage_path) || null }])) }));
}

/** Internal marker phrases per public caption, and whether each booking / caption URL resolves (cached HEAD). */
async function captionChecks(v) {
  const placements = v.placements.map((p) => ({ ...p, caption_markers: markersIn(p.public_caption) }));
  const urls = [...v.facts.map((f) => f.booking_url), ...placements.flatMap((p) => urlsInCaption(p.public_caption))];
  return { placements, url_checks: await checkUrls(urls) };
}
async function view(sb, propertyUrl) {
  const v = await socialStandardView(sb, propertyUrl, { todayIso: todayUk(), feeds: loadSquarespaceEventFeeds });
  const c = await captionChecks(v);
  return { ...v, url_checks: c.url_checks, placements: await withPreviewUrls(sb, c.placements) };
}

async function renderRequest(sb, b, propertyUrl) {
  if (!b.event_id) throw new Error('event_id required');
  const { data: fact } = await sb.from('marketing_event_facts').select('event_id').eq('property_url', propertyUrl).eq('event_id', String(b.event_id)).maybeSingle();
  if (!fact) throw new Error(`no facts record for ${b.event_id}`);
  const row = { kind: 'social-render', status: 'queued', host: 'dashboard', items_total: 3, items_done: 0, checkpoint: { step: 'waiting for Alan\'s PC (checks every 5 min)', event_id: String(b.event_id), step_key: b.step_key ? String(b.step_key) : null, property_url: propertyUrl } };
  const { data, error } = await sb.from('marketing_collector_runs').insert(row).select('run_id').single();
  if (error) throw new Error(error.message);
  return { run_id: data.run_id };
}

function client() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE;
  return url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
}

export default async function handler(req, res) {
  if (!requireAdminKeyOnly(req, res, send)) return undefined;
  const sb = client();
  if (!sb) return send(res, 500, { ok: false, error: 'Missing Supabase credentials' });
  const propertyUrl = String(req.query?.propertyUrl || req.body?.propertyUrl || PROP);
  try {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET') return send(res, 200, { ok: true, ...(await view(sb, propertyUrl)) });
    if (req.method === 'POST' && req.body?.action === 'render-request') return send(res, 200, { ok: true, ...(await renderRequest(sb, req.body, propertyUrl)) });
    res.setHeader('Allow', 'GET, POST');
    return send(res, 405, { ok: false, error: 'Method not allowed' });
  } catch (e) {
    return send(res, 500, { ok: false, error: e?.message || String(e) });
  }
}
