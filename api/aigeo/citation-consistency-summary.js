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

    const rows = Array.isArray(entryRows) ? entryRows : [];
    const driftRows = rows.filter((row) => String(row.status || '').toLowerCase() !== 'pass');
    const alertsCount = rows.filter((row) => ['alert', 'critical'].includes(String(row.alert_level || '').toLowerCase())).length;
    const averageScore = rows.length
      ? Math.round(rows.reduce((sum, row) => sum + Number(row.consistency_score || 0), 0) / rows.length)
      : 0;

    return sendJson(res, 200, {
      status: 'ok',
      data: {
        latestRun,
        stats: {
          windowDays: days,
          entriesChecked: rows.length,
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
