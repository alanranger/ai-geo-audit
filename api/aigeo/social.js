/**
 * Social channels (Marketing & Campaigns): tiles, Meta connection, collector, LinkedIn manual entry.
 * Every action needs the dashboard admin key (x-arp-admin-key); the nightly Vercel Cron (Bearer CRON_SECRET) may only
 * run action=collect. Nothing here posts, messages, sends or changes consent. Tokens never appear in a response or log.
 *   GET  ?action=summary            five tiles + the last 10 posts (read-only, writes nothing)
 *   GET  ?action=steps              collector steps for the progress window
 *   POST {action:'connect-start'}   one-use state → Meta login URL ({ with_business: true } adds business_management)
 *   POST {action:'disconnect'}      deletes the social_connections row only (collected figures stay)
 *   POST|GET action=collect&step=…  one collector step (progress window) or all steps (no step / cron)
 *   POST {action:'linkedin-entry'}  LinkedIn weekly figures (source = manual)
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { cronOrAdmin } from '../../lib/api/cronAuth.js';
import { startRun, finishRun } from '../../lib/acquisition/sync-runs.js';
import { supabaseAdmin, supabaseRepo } from '../../lib/social/repo.mjs';
import { buildSummary } from '../../lib/social/summary.mjs';
import { startConnect, connectionStatus } from '../../lib/social/oauth.mjs';
import { STEPS, runAll, runStep } from '../../lib/social/collect.mjs';
import { saveLinkedinEntry } from '../../lib/social/linkedin.mjs';
import { loadGbpStatus } from '../../lib/strategy-gbp.mjs';

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
};

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

async function collect(d, req, who) {
  const step = String(req.query?.step || bodyOf(req).step || '');
  const deps = { repo: d.repo, env: d.env, fetchImpl: d.fetchImpl, now: d.now() };
  if (step && step !== 'all') return runStep(step, deps);
  const runId = await d.runLog.start('social_meta', who === 'cron' ? 'vercel_cron' : 'dashboard');
  const r = await runAll(deps);
  await d.runLog.finish(runId, { status: r.skipped ? 'skipped' : (r.ok ? 'ok' : 'error'), rows_written: r.rows, error_message: r.skipped || r.results.find((x) => !x.ok)?.error || null, meta: { steps: r.results.map((x) => ({ step: x.step, ok: x.ok, rows: x.rows ?? 0, error: x.error || null })) } });
  return r;
}

const ACTIONS = {
  'GET summary': (d) => buildSummary({ repo: d.repo, env: d.env, now: d.now(), gbpStatus: d.gbpStatus }),
  'GET status': async (d) => ({ ok: true, connection: connectionStatus(await d.repo.getConnectionStatus(), d.env) }),
  'GET steps': async () => ({ ok: true, steps: STEPS }),
  'POST connect-start': (d, req) => startConnect({ repo: d.repo, env: d.env, now: d.now(), withBusiness: bodyOf(req).with_business === true }),
  'POST disconnect': async (d) => ({ ok: true, removed: await d.repo.deleteConnection() }),
  'POST collect': (d, req, who) => collect(d, req, who),
  'GET collect': (d, req, who) => collect(d, req, who),
  'POST linkedin-entry': (d, req) => saveLinkedinEntry(d.repo, bodyOf(req), { now: d.now(), by: 'admin' })
};

/** Admin key for everything; Vercel Cron only for collect. */
const allowed = (who, action) => !!who && (who === 'admin' || action === 'collect');
/** A refused input (LinkedIn entry) is a 400; a collector step that failed, or "not configured", still answers 200. */
const statusFor = (out) => (out?.ok === false && out.error !== 'not_configured' && !out.step ? 400 : 200);

export function makeHandler(deps) {
  return async function handler(req, res) {
    if (req.method === 'OPTIONS') return send(res, 204, {});
    const who = cronOrAdmin(req);
    const action = String(req.query?.action || bodyOf(req).action || '');
    const fn = ACTIONS[`${req.method} ${action}`];
    if (!allowed(who, action)) return send(res, 401, { ok: false, error: 'unauthorized' });
    if (!fn) return send(res, 400, { ok: false, error: 'unknown action' });
    const d = { ...deps, repo: deps.repo() };
    if (!d.repo) return send(res, 500, { ok: false, error: 'missing_supabase_credentials' });
    try {
      const out = await fn(d, req, who);
      return send(res, statusFor(out), out);
    } catch (e) {
      console.error(`[social] ${action} failed: ${e?.code || 'error'}`);
      return send(res, 500, { ok: false, error: `${action} failed: ${String(e?.message || e).slice(0, 200)}` });
    }
  };
}

export default makeHandler({
  repo: () => { const sb = supabaseAdmin(); return sb ? supabaseRepo(sb) : null; },
  env: process.env,
  fetchImpl: (...a) => fetch(...a),
  now: () => Date.now(),
  gbpStatus: () => loadGbpStatus(),
  runLog: { start: startRun, finish: finishRun }
});
