// Daily warm of the Revenue Truth payload cache (Vercel cron).
//
// Precomputes the heavy findings + diagnosis payloads and writes them to
// `public.revenue_truth_payload_cache` so the dashboard tab serves the cached
// blob (<2s) instead of recomputing for 10-26s on every visit. Runs after the
// morning revenue syncs; also invoked (best-effort) after a manual Booking
// Sheet upload via `?reason=upload`.

export const config = { runtime: 'nodejs', maxDuration: 300 };

import { createClient } from '@supabase/supabase-js';
import {
  buildDiagnosisPayload,
  buildDiagnosisOpts
} from '../aigeo/revenue-funnel-diagnosis.js';
import { buildFindingsPayload } from '../aigeo/revenue-truth-findings.js';
import {
  diagnosisCacheKey,
  findingsCacheKey,
  writeCache
} from '../../lib/revenue-truth-cache.mjs';

const DEFAULT_PROPERTY = 'https://www.alanranger.com';

// The combinations the dashboard requests on load (windowMonths=12,
// minImpressions=1000). includeJlr defaults to TRUE in the client, so jlr1:event0
// is the most important to keep warm and is built first. We deliberately warm
// only the two event:false combos: each diagnosis build runs ~9 heavy Supabase
// queries and they slow down when chained, so keeping the cron to 3 builds keeps
// it well inside its time budget. The rarer event:true combos populate lazily
// via the endpoint's write-through cache on first use (one slow load, then fast).
const DIAGNOSIS_COMBOS = [
  { includeJlr: true, includeEvent: false },   // client default
  { includeJlr: false, includeEvent: false }   // JLR-excluded view
];

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).send(JSON.stringify(body));
};

const need = (key) => {
  const v = process.env[key];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${key}`);
  return v;
};

function authoriseRequest(req) {
  if (req.method === 'POST') return true;
  if (req.method === 'GET' && String(req.headers['x-vercel-cron'] || '') === '1') return true;
  return false;
}

async function warmFindings(supabase, propertyUrl, results) {
  const t0 = Date.now();
  try {
    const payload = await buildFindingsPayload(supabase, propertyUrl);
    const ms = Date.now() - t0;
    const ok = await writeCache(supabase, propertyUrl, findingsCacheKey(), payload, ms);
    results.push({ key: findingsCacheKey(), ok, ms });
  } catch (err) {
    results.push({ key: findingsCacheKey(), ok: false, error: err?.message || String(err) });
  }
}

async function warmDiagnosis(supabase, propertyUrl, combo, results) {
  const opts = buildDiagnosisOpts({ propertyUrl, ...combo });
  const key = diagnosisCacheKey(opts);
  const t0 = Date.now();
  try {
    const payload = await buildDiagnosisPayload(supabase, opts);
    const ms = Date.now() - t0;
    const ok = await writeCache(supabase, propertyUrl, key, payload, ms);
    results.push({ key, ok, ms });
  } catch (err) {
    results.push({ key, ok: false, error: err?.message || String(err) });
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (!authoriseRequest(req)) return send(res, 401, { error: 'unauthorised' });

  const propertyUrl = String(req.query?.propertyUrl || DEFAULT_PROPERTY).trim();
  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false }
    });
    const results = [];
    // Sequential on purpose: each build runs ~9 heavy Supabase queries; running
    // them back-to-back keeps peak DB load and function memory bounded.
    await warmFindings(supabase, propertyUrl, results);
    for (const combo of DIAGNOSIS_COMBOS) {
      await warmDiagnosis(supabase, propertyUrl, combo, results);
    }
    const okCount = results.filter(r => r.ok).length;
    return send(res, 200, {
      ok: okCount === results.length,
      property_url: propertyUrl,
      reason: String(req.query?.reason || 'cron'),
      warmed: okCount,
      total: results.length,
      results
    });
  } catch (err) {
    return send(res, 500, { error: 'revenue_truth_cache_refresh_failed', message: err?.message || String(err) });
  }
}
