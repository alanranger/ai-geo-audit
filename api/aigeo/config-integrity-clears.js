/**
 * Recently cleared cannibalisation wins (check 3 only).
 * Present in prior integrity runs, absent from latest — genuine re-rank wins.
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

export function parseAtStake(atStake) {
  const t = String(atStake || '');
  const vol = t.match(/([\d,]+)\s*\/?\s*mo(?:nth)?\s*search volume/i);
  const traffic = t.match(/([\d,]+|—|-)\s*clicks\s*\/\s*([\d,]+|—|-)\s*imps/i);
  const n = (x) => {
    if (x == null || x === '—' || x === '-') return null;
    const v = Number(String(x).replace(/,/g, ''));
    return Number.isFinite(v) ? v : null;
  };
  return {
    volume: vol ? n(vol[1]) : null,
    clicks: traffic ? n(traffic[1]) : null,
    impressions: traffic ? n(traffic[2]) : null
  };
}

function mapStream(ws) {
  const raw = String(ws || '').trim();
  if (!raw) return '';
  const k = raw.toLowerCase();
  if (k.includes('hub')) return 'Hub';
  if (k.includes('swap')) return 'Swap';
  if (k.includes('blog')) return 'Blog';
  if (k.includes('config')) return 'Config';
  return raw;
}

function summarizeFinding(f) {
  const metrics = parseAtStake(f.at_stake);
  return {
    findingId: f.findingId,
    check: Number(f.check || 0),
    keyword: String(f.subject || '').trim(),
    from_path: String(f.preferred_path || '').trim(),
    to_path: String(f.assigned_path || '').trim(),
    stream: mapStream(f.workstream),
    volume: metrics.volume,
    clicks: metrics.clicks,
    impressions: metrics.impressions
  };
}

/**
 * Check-3 only. Walk runs oldest→newest; record first clear of each id still absent.
 */
export function computeClears(runs) {
  const live = new Map();
  const openClears = new Map();

  for (const run of runs) {
    const runAt = run.run_at;
    const withIds = assignIntegrityFindingIds(run.findings || []).filter(
      (f) => Number(f.check) === 3
    );
    const nowIds = new Set(withIds.map((f) => f.findingId));

    for (const [id, summary] of live.entries()) {
      if (!nowIds.has(id)) {
        openClears.set(id, { ...summary, cleared_at: runAt });
        live.delete(id);
      }
    }
    for (const f of withIds) {
      const id = f.findingId;
      const summary = summarizeFinding(f);
      if (openClears.has(id)) openClears.delete(id);
      live.set(id, summary);
    }
  }

  const cutoff = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return [...openClears.values()]
    .filter((r) => !live.has(r.findingId))
    .filter((r) => {
      const t = Date.parse(String(r.cleared_at || ''));
      return Number.isFinite(t) && t >= cutoff;
    })
    .map((r) => {
      const clearedMs = Date.parse(String(r.cleared_at || ''));
      const daysAgo = Number.isFinite(clearedMs)
        ? Math.floor((Date.now() - clearedMs) / 86400000)
        : null;
      return { ...r, days_ago: daysAgo };
    })
    .sort((a, b) => {
      const va = a.volume == null ? -1 : a.volume;
      const vb = b.volume == null ? -1 : b.volume;
      if (vb !== va) return vb - va;
      return String(b.cleared_at || '').localeCompare(String(a.cleared_at || ''));
    });
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

    const { data: bounds } = await sb
      .from('config_integrity_runs')
      .select('run_at')
      .eq('property_url', propertyUrl)
      .order('run_at', { ascending: true })
      .limit(1);

    const clears = computeClears(runs);
    const volSum = clears.reduce((s, r) => s + (Number(r.volume) || 0), 0);

    return sendJson(res, 200, {
      status: 'ok',
      results: clears,
      meta: {
        generatedAt: new Date().toISOString(),
        windowDays: WINDOW_DAYS,
        runsInWindow: runs.length,
        oldestRunInWindow: runs[0]?.run_at || null,
        newestRunInWindow: runs[runs.length - 1]?.run_at || null,
        oldestRunEver: bounds?.[0]?.run_at || null,
        winCount: clears.length,
        volumeSum: volSum,
        checkFilter: 3,
        mechanism:
          'Check-3 only. Diff config_integrity_runs (30d): keyword present, then absent from later runs and still absent latest. Volume from at_stake on last seen run. Mark-done is not a win.'
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
