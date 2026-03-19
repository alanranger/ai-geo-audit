export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

const need = (key) => {
  const value = process.env[key];
  if (!value || !String(value).trim()) throw new Error(`missing_env:${key}`);
  return value;
};

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
};

const extractHostname = (url) => {
  const raw = String(url || '').trim();
  if (!raw || !URL.canParse(raw)) return '';
  return String(new URL(raw).hostname || '').toLowerCase();
};

const hostMatchesDomain = (host, domain) => {
  const normalizedHost = String(host || '').toLowerCase().trim();
  const normalizedDomain = String(domain || '').toLowerCase().trim();
  if (!normalizedHost || !normalizedDomain) return false;
  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
};

const sanitizeCitationRows = (rows) => {
  const output = [];
  for (const row of rows || []) {
    const domain = String(row?.directory_domain || '').toLowerCase().trim();
    const host = extractHostname(row?.source_url);
    if (!hostMatchesDomain(host, domain)) continue;
    output.push(row);
  }
  return output;
};

const isGenericFallbackRow = (row) => {
  const domain = String(row?.directory_domain || '').toLowerCase().trim();
  const source = String(row?.source_url || '').trim().toLowerCase();
  const fetchError = String(row?.fetch_error || '').toLowerCase();
  const canonicalFallback = domain ? `https://${domain}/` : '';
  return source === canonicalFallback || fetchError.includes('no indexed listing candidate found');
};

const toTimestamp = (value) => {
  const ts = Date.parse(String(value || ''));
  return Number.isFinite(ts) ? ts : 0;
};

const pickPreferredDirectoryRow = (current, candidate) => {
  const currentGeneric = isGenericFallbackRow(current);
  const candidateGeneric = isGenericFallbackRow(candidate);
  if (currentGeneric !== candidateGeneric) return candidateGeneric ? current : candidate;

  const currentSeenTs = toTimestamp(current?.last_seen_at);
  const candidateSeenTs = toTimestamp(candidate?.last_seen_at);
  if (currentSeenTs !== candidateSeenTs) return candidateSeenTs > currentSeenTs ? candidate : current;

  const currentScore = Number(current?.consistency_score || 0);
  const candidateScore = Number(candidate?.consistency_score || 0);
  if (currentScore !== candidateScore) return candidateScore > currentScore ? candidate : current;

  const currentSignals = Array.isArray(current?.matched_signals) ? current.matched_signals.length : 0;
  const candidateSignals = Array.isArray(candidate?.matched_signals) ? candidate.matched_signals.length : 0;
  if (currentSignals !== candidateSignals) return candidateSignals > currentSignals ? candidate : current;

  return current;
};

const collapseCitationRowsByDirectory = (rows) => {
  const byDirectory = new Map();
  for (const row of rows || []) {
    const key = String(row?.directory_domain || '').toLowerCase().trim();
    if (!key) continue;
    const existing = byDirectory.get(key);
    if (!existing) {
      byDirectory.set(key, row);
      continue;
    }
    byDirectory.set(key, pickPreferredDirectoryRow(existing, row));
  }
  return [...byDirectory.values()];
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  if (req.method !== 'GET') {
    return sendJson(res, 405, { status: 'error', message: 'Method not allowed. Use GET.' });
  }

  try {
    const days = Math.max(1, Math.min(180, Number(req.query.days || 30)));
    const cutoffIso = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString();
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));

    const { data: runRows, error: runError } = await supabase
      .from('citation_consistency_runs')
      .select('*')
      .order('run_started_at', { ascending: false })
      .limit(1);

    if (runError) {
      if (String(runError.message || '').includes('does not exist')) {
        return sendJson(res, 200, {
          status: 'ok',
          data: {
            latestRun: null,
            stats: { windowDays: days, entriesChecked: 0, driftCount: 0, alerts: 0, averageScore: 0 },
            drifts: []
          },
          meta: {
            generatedAt: new Date().toISOString(),
            warning: 'citation_consistency_runs table not found (apply migration 20260318_citation_consistency.sql)'
          }
        });
      }
      throw runError;
    }

    const latestRun = Array.isArray(runRows) && runRows.length ? runRows[0] : null;

    const { data: entryRows, error: entriesError } = await supabase
      .from('citation_consistency_entries')
      .select('directory_domain,source_url,title,status,consistency_score,missing_signals,alert_level,last_seen_at,fetch_error')
      .gte('last_seen_at', cutoffIso)
      .order('consistency_score', { ascending: true })
      .limit(500);

    if (entriesError) {
      if (String(entriesError.message || '').includes('does not exist')) {
        return sendJson(res, 200, {
          status: 'ok',
          data: {
            latestRun,
            stats: { windowDays: days, entriesChecked: 0, driftCount: 0, alerts: 0, averageScore: 0 },
            drifts: []
          },
          meta: {
            generatedAt: new Date().toISOString(),
            warning: 'citation_consistency_entries table not found (apply migration 20260318_citation_consistency.sql)'
          }
        });
      }
      throw entriesError;
    }

    const rows = sanitizeCitationRows(Array.isArray(entryRows) ? entryRows : []);
    const collapsedRows = collapseCitationRowsByDirectory(rows);
    const driftRows = collapsedRows.filter((row) => String(row.status || '').toLowerCase() !== 'pass');
    const alertsCount = collapsedRows.filter((row) => ['alert', 'critical'].includes(String(row.alert_level || '').toLowerCase())).length;
    const averageScore = collapsedRows.length
      ? Math.round(collapsedRows.reduce((sum, row) => sum + Number(row.consistency_score || 0), 0) / collapsedRows.length)
      : 0;

    return sendJson(res, 200, {
      status: 'ok',
      data: {
        latestRun,
        stats: {
          windowDays: days,
          entriesChecked: collapsedRows.length,
          driftCount: driftRows.length,
          alerts: alertsCount,
          averageScore
        },
        drifts: driftRows.slice(0, 25)
      },
      meta: { generatedAt: new Date().toISOString() }
    });
  } catch (error) {
    return sendJson(res, 500, {
      status: 'error',
      message: error.message,
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}
