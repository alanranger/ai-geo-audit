/**
 * Confirmed cannibalisation wins (check 3).
 * WIN only when latest keyword_rankings.best_url path == locked target path.
 * Run-disappearance alone is never a win. Mark-done never creates a win.
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { createClient } from '@supabase/supabase-js';
import { normalizePagePath } from '../../lib/pagesMaster.js';
import {
  assignIntegrityFindingIds,
  integrityNormKw
} from '../../lib/configIntegrity/findingIds.mjs';

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

export function rankingPathsMatch(bestUrl, lockedTarget) {
  const a = normalizePagePath(bestUrl);
  const b = normalizePagePath(lockedTarget);
  return Boolean(a && b && a === b);
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
 * Collect check-3 rows seen across integrity runs (last state per findingId).
 */
export function collectCheck3History(runs) {
  const byId = new Map();
  let liveIds = new Set();
  for (const run of runs || []) {
    const withIds = assignIntegrityFindingIds(run.findings || []).filter(
      (f) => Number(f.check) === 3
    );
    liveIds = new Set(withIds.map((f) => f.findingId));
    for (const f of withIds) {
      byId.set(f.findingId, {
        ...summarizeFinding(f),
        last_seen_run_at: run.run_at
      });
    }
  }
  return { byId, liveIds };
}

/**
 * Wins = history candidates where latest ranking best_url path == locked target.
 * Awaiting = progress=done CANN rows without that positive match.
 */
export function classifyConfirmedWins({ historyById, rankByKw, scanDate, doneStates }) {
  const wins = [];
  const awaiting = [];
  const wonIds = new Set();

  for (const summary of historyById.values()) {
    const kw = integrityNormKw(summary.keyword);
    const target = summary.to_path;
    if (!kw || !target) continue;
    const rk = rankByKw.get(kw);
    if (!rankingPathsMatch(rk?.best_url, target)) continue;
    // Ranking is source of truth (integrity lag may still list the row briefly).
    wonIds.add(summary.findingId);
    wins.push({
      ...summary,
      status: 'won',
      best_url_now: rk?.best_url || null,
      ranking_scan_date: scanDate || rk?.audit_date || null,
      volume: summary.volume != null ? summary.volume : (rk?.search_volume ?? null)
    });
  }

  for (const st of doneStates || []) {
    const id = String(st.finding_key || st.findingId || '').trim();
    if (!id.startsWith('CANN-')) continue;
    if (wonIds.has(id)) continue;
    const summary = historyById.get(id) || {
      findingId: id,
      keyword: String(st.keyword || '').trim(),
      from_path: '',
      to_path: String(st.assigned_path || st.to_path || '').trim(),
      stream: '',
      volume: null,
      clicks: null,
      impressions: null
    };
    const kw = integrityNormKw(summary.keyword);
    const target = summary.to_path;
    const rk = kw ? rankByKw.get(kw) : null;
    if (target && rankingPathsMatch(rk?.best_url, target)) continue;
    awaiting.push({
      ...summary,
      findingId: id,
      status: 'awaiting',
      progress: 'done',
      best_url_now: rk?.best_url || null,
      ranking_scan_date: scanDate || rk?.audit_date || null,
      note: st.note || ''
    });
  }

  const byVol = (a, b) => {
    const va = a.volume == null ? -1 : a.volume;
    const vb = b.volume == null ? -1 : b.volume;
    if (vb !== va) return vb - va;
    return String(a.keyword || '').localeCompare(String(b.keyword || ''));
  };
  wins.sort(byVol);
  awaiting.sort(byVol);
  return { wins, awaiting };
}

async function fetchLatestRankings(sb, propertyUrl) {
  const { data, error } = await sb
    .from('keyword_rankings')
    .select('keyword, best_url, audit_date, search_volume')
    .eq('property_url', propertyUrl)
    .order('audit_date', { ascending: false })
    .limit(5000);
  if (error) throw error;
  const scanDate = data?.[0]?.audit_date || null;
  if (!scanDate) return { scanDate: null, rankByKw: new Map() };
  const rankByKw = new Map();
  for (const row of data || []) {
    if (row.audit_date !== scanDate) continue;
    const k = integrityNormKw(row.keyword);
    if (k && !rankByKw.has(k)) rankByKw.set(k, row);
  }
  return { scanDate, rankByKw };
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

    const { scanDate, rankByKw } = await fetchLatestRankings(sb, propertyUrl);
    const { byId } = collectCheck3History(runs);

    let doneStates = [];
    try {
      const { data: stRows } = await sb
        .from('config_integrity_finding_state')
        .select('finding_key, progress, note')
        .eq('property_url', propertyUrl)
        .eq('progress', 'done')
        .limit(500);
      doneStates = stRows || [];
    } catch {
      doneStates = [];
    }

    // Enrich done rows that are still live in latest integrity open set
    const latestFindings = assignIntegrityFindingIds(
      runs.length ? runs[runs.length - 1].findings || [] : []
    );
    for (const f of latestFindings) {
      if (Number(f.check) !== 3) continue;
      if (!byId.has(f.findingId)) byId.set(f.findingId, summarizeFinding(f));
    }

    const { wins, awaiting } = classifyConfirmedWins({
      historyById: byId,
      rankByKw,
      scanDate,
      doneStates
    });

    const volSum = wins.reduce((s, r) => s + (Number(r.volume) || 0), 0);

    return sendJson(res, 200, {
      status: 'ok',
      results: wins,
      awaiting,
      meta: {
        generatedAt: new Date().toISOString(),
        windowDays: WINDOW_DAYS,
        runsInWindow: runs.length,
        oldestRunInWindow: runs[0]?.run_at || null,
        newestRunInWindow: runs[runs.length - 1]?.run_at || null,
        rankingScanDate: scanDate,
        winCount: wins.length,
        awaitingCount: awaiting.length,
        volumeSum: volSum,
        checkFilter: 3,
        mechanism:
          'WIN only if latest keyword_rankings.best_url path equals locked target (normalize path, strip params). History candidates from check-3 integrity runs (30d). Mark-done never creates a win; done+unconfirmed = awaiting. Disappeared-without-match is not a win.'
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
