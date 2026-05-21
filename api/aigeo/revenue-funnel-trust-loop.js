// Trust loop: recent page edits, per-cycle GSC deltas, URLs needing GSC refresh.

import { createClient } from '@supabase/supabase-js';
import { __INTERNAL as SP } from './revenue-funnel-smart-priorities.js';
import { buildTrustLoopPayload } from '../../lib/revenue-funnel-trust-loop.js';
import { academyTierHealth } from '../../lib/revenue-funnel-academy-economics.js';

const DEFAULT_PROPERTY = 'https://www.alanranger.com';

function need(key) {
  const v = process.env[key];
  if (!v) throw new Error('missing env ' + key);
  return v;
}

function send(res, status, body) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
  try {
    const propertyUrl = String(req.query?.propertyUrl || DEFAULT_PROPERTY).trim();
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    const cycles = await SP.fetchActiveOptimisationCycles(supabase);
    const [trust, academy] = await Promise.all([
      buildTrustLoopPayload(supabase, propertyUrl, cycles),
      academyTierHealth(supabase, propertyUrl)
    ]);
    return send(res, 200, {
      property_url: propertyUrl,
      generated_at: new Date().toISOString(),
      ...trust,
      academy_economics: academy
    });
  } catch (e) {
    return send(res, 500, { error: 'trust_loop_failed', detail: String(e && e.message || e) });
  }
}
