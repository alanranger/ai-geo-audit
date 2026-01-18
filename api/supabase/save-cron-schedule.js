import { computeNextRunAt } from '../../lib/cron/schedule.js';

export const config = { runtime: 'nodejs' };

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
};

const computeNextRun = (config) => computeNextRunAt(config);

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { status: 'error', message: 'Method not allowed. Use POST.' });
  }

  try {
    const supabaseUrl = need('SUPABASE_URL');
    const supabaseKey = need('SUPABASE_SERVICE_ROLE_KEY');
    const { jobs } = req.body || {};

    if (!jobs || typeof jobs !== 'object') {
      return sendJson(res, 400, { status: 'error', message: 'Missing jobs payload.' });
    }

    const nowIso = new Date().toISOString();
    const rows = Object.entries(jobs).map(([jobKey, config]) => {
      const frequency = config?.frequency || 'off';
      const timeOfDay = config?.timeOfDay || '';
      const lastRunAt = config?.lastRunAt || null;
      const nextRunAt = computeNextRun({ frequency, timeOfDay, lastRunAt });
      return {
        job_key: jobKey,
        frequency,
        time_of_day: timeOfDay || '00:00',
        last_run_at: lastRunAt,
        next_run_at: nextRunAt,
        updated_at: nowIso
      };
    });

    const resp = await fetch(`${supabaseUrl}/rest/v1/audit_cron_schedule?on_conflict=job_key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: 'resolution=merge-duplicates,return=representation'
      },
      body: JSON.stringify(rows)
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      if (errText.includes('does not exist')) {
        return sendJson(res, 200, {
          status: 'missing_table',
          message: 'audit_cron_schedule table not found. Apply migration 20260118_add_audit_cron_schedule.sql.'
        });
      }
      return sendJson(res, 500, { status: 'error', message: errText || `HTTP ${resp.status}` });
    }

    const savedRows = await resp.json();
    const responseJobs = {};
    (savedRows || []).forEach((row) => {
      if (!row?.job_key) return;
      responseJobs[row.job_key] = {
        frequency: row.frequency,
        timeOfDay: row.time_of_day,
        lastRunAt: row.last_run_at,
        nextRunAt: row.next_run_at
      };
    });

    return sendJson(res, 200, {
      status: 'ok',
      data: { jobs: responseJobs, updatedAt: nowIso },
      meta: { generatedAt: nowIso }
    });
  } catch (err) {
    return sendJson(res, 500, { status: 'error', message: err.message });
  }
}
