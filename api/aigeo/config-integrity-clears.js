/**
 * Recently cleared (wins) — findings present in prior integrity runs
 * but absent from the latest run (true data-driven clears only).
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { createClient } from '@supabase/supabase-js';
import { assignIntegrityFindingIds } from '../../lib/configIntegrity/findingIds.mjs';

const WINDOW_DAYS = 30;

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
};

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

function summarizeFinding(f) {
  return {
    findingId: f.findingId,
    check: Number(f.check || 0),
    keyword: String(f.subject || '').trim(),
    from_path: String(f.preferred_path || '').trim(),
    to_path: String(f.assigned_path || '').trim(),
    stream: f.workstream || null
  };
}

/**
 * Walk runs oldest→newest. When a finding disappears after being present,
 * record first clear date. If it reappears, drop until it clears again.
 * Final wins = currently absent + last clear within window.
 */
export function computeClears(runs) {
  // runs: [{ run_at, findings[] }] ascending by run_at
  /** @type {Map<string, object>} */
  const live = new Map(); // id -> summary
  /** @type {Map<string, { cleared_at: string, last: object }>} */
  const openClears = new Map();
  /** @type {Map<string, object>} */
  const finalClears = new Map();

  for (const run of runs) {
    const runAt = run.run_at;
    const withIds = assignIntegrityFindingIds(run.findings || []);
    const nowIds = new Set(withIds.map((f) => f.findingId));
    // drops
    for (const [id, summary] of live.entries()) {
      if (!nowIds.has(id)) {
        openClears.set(id, { ...summary, cleared_at: runAt });
        live.delete(id);
      }
    }
    // presents / reappearances
    for (const f of withIds) {
      const id = f.findingId;
      const summary = summarizeFinding(f);
      if (openClears.has(id)) openClears.delete(id); // reappeared — not a current win
      live.set(id, summary);
    }
  }

  // Only wins that remain clear (not in final live set)
  for (const [id, row] of openClears.entries()) {
    if (!live.has(id)) finalClears.set(id, row);
  }

  const cutoff = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return [...finalClears.values()]
    .filter((r) => {
      const t = Date.parse(String(r.cleared_at || ''));
      return Number.isFinite(t) && t >= cutoff;
    })
    .sort((a, b) => String(b.cleared_at).localeCompare(String(a.cleared_at)));
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  if (req.method !== 'GET') {
    return sendJson(res, 405, { status: 'error', message: 'Use GET.' });
  }
  try {
    const sb = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false }
    });
    const propertyUrl = String(req.query?.propertyUrl || 'https://www.alanranger.com').trim();
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await sb
      .from('config_integrity_runs')
      .select('id, run_at, findings, finding_count')
      .eq('property_url', propertyUrl)
      .gte('run_at', since)
      .order('run_at', { ascending: true })
      .limit(200);
    if (error) throw error;

    const runs = (data || []).map((r) => ({
      run_at: r.run_at,
      findings: Array.isArray(r.findings) ? r.findings : []
    }));

    // Also fetch oldest/newest overall for honesty meta
    const { data: bounds } = await sb
      .from('config_integrity_runs')
      .select('run_at')
      .eq('property_url', propertyUrl)
      .order('run_at', { ascending: true })
      .limit(1);
    const oldestEver = bounds?.[0]?.run_at || null;

    const clears = computeClears(runs);

    return sendJson(res, 200, {
      status: 'ok',
      results: clears,
      meta: {
        generatedAt: new Date().toISOString(),
        windowDays: WINDOW_DAYS,
        runsInWindow: runs.length,
        oldestRunInWindow: runs[0]?.run_at || null,
        newestRunInWindow: runs[runs.length - 1]?.run_at || null,
        oldestRunEver: oldestEver,
        mechanism:
          'Diff config_integrity_runs over the last 30 days: finding id present in an older run, absent from later runs and still absent in the latest. First disappearance date = cleared_at. Reappearance cancels the win until it clears again. Independent of Option B progress (mark-done does not remove findings from runs).',
        note:
          'Mark-done alone never creates a clear — wins are only data-driven re-ranks/integrity drops.'
      }
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (msg.includes('missing_env:')) {
      return sendJson(res, 500, { status: 'error', message: 'Supabase env not configured.' });
    }
    return sendJson(res, 500, { status: 'error', message: msg });
  }
}
