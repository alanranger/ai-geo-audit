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

const derivePlatformFromHost = (host) => {
  if (hostMatchesDomain(host, 'reddit.com')) return 'reddit';
  if (hostMatchesDomain(host, 'linkedin.com')) return 'linkedin';
  if (String(host || '').toLowerCase() === 'youtu.be' || hostMatchesDomain(host, 'youtube.com')) return 'youtube';
  return null;
};

const sanitizeMentionRows = (rows) => {
  const output = [];
  for (const row of rows || []) {
    const host = extractHostname(row?.source_url);
    const platform = derivePlatformFromHost(host);
    if (!platform) continue;
    output.push({
      ...row,
      platform
    });
  }
  return output;
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 200, { status: 'ok' });
  if (req.method !== 'GET') {
    return sendJson(res, 405, { status: 'error', message: 'Method not allowed. Use GET.' });
  }

  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    const days = Math.max(1, Math.min(180, Number(req.query.days || 30)));
    const cutoffIso = new Date(Date.now() - (days * 24 * 60 * 60 * 1000)).toISOString();

    const { data: latestRunRows, error: runError } = await supabase
      .from('mentions_baseline_runs')
      .select('*')
      .order('run_started_at', { ascending: false })
      .limit(1);

    if (runError) {
      if (String(runError.message || '').includes('does not exist')) {
        return sendJson(res, 200, {
          status: 'ok',
          data: {
            latestRun: null,
            stats: {
              windowDays: days,
              activeMentions: 0,
              alerts: 0,
              critical: 0,
              byPlatform: {}
            },
            alerts: []
          },
          meta: {
            generatedAt: new Date().toISOString(),
            warning: 'mentions_baseline_runs table not found (apply migration 20260318_mentions_baseline.sql)'
          }
        });
      }
      throw runError;
    }

    const latestRun = Array.isArray(latestRunRows) && latestRunRows.length ? latestRunRows[0] : null;

    const { data: mentionRows, error: mentionsError } = await supabase
      .from('mentions_baseline_entries')
      .select('platform,source_url,title,snippet,published_at,last_seen_at,mention_score,alert_level,is_brand_mention,matched_keywords')
      .gte('last_seen_at', cutoffIso)
      .order('mention_score', { ascending: false })
      .limit(500);

    if (mentionsError) {
      if (String(mentionsError.message || '').includes('does not exist')) {
        return sendJson(res, 200, {
          status: 'ok',
          data: {
            latestRun,
            stats: {
              windowDays: days,
              activeMentions: 0,
              alerts: 0,
              critical: 0,
              byPlatform: {}
            },
            alerts: []
          },
          meta: {
            generatedAt: new Date().toISOString(),
            warning: 'mentions_baseline_entries table not found (apply migration 20260318_mentions_baseline.sql)'
          }
        });
      }
      throw mentionsError;
    }

    const rows = sanitizeMentionRows(Array.isArray(mentionRows) ? mentionRows : []);
    const byPlatform = rows.reduce((acc, row) => {
      const key = String(row.platform || 'unknown').toLowerCase();
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const alerts = rows.filter((row) => ['alert', 'critical'].includes(String(row.alert_level || '').toLowerCase()));
    const critical = rows.filter((row) => String(row.alert_level || '').toLowerCase() === 'critical');

    return sendJson(res, 200, {
      status: 'ok',
      data: {
        latestRun,
        stats: {
          windowDays: days,
          activeMentions: rows.length,
          alerts: alerts.length,
          critical: critical.length,
          byPlatform
        },
        alerts: alerts.slice(0, 25),
        topMentions: rows.slice(0, 25)
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
