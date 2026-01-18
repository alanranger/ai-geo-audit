export const config = { runtime: 'nodejs' };

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const sendJson = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return sendJson(res, 405, { status: 'error', message: 'Method not allowed. Use GET.' });
  }

  try {
    const supabaseUrl = need('SUPABASE_URL');
    const supabaseKey = need('SUPABASE_SERVICE_ROLE_KEY');
    const jobKey = req.query.jobKey ? String(req.query.jobKey) : null;

    const selectFields = 'job_key,frequency,time_of_day,last_run_at,next_run_at,updated_at';
    const query = jobKey
      ? `${supabaseUrl}/rest/v1/audit_cron_schedule?job_key=eq.${encodeURIComponent(jobKey)}&select=${encodeURIComponent(selectFields)}`
      : `${supabaseUrl}/rest/v1/audit_cron_schedule?select=${encodeURIComponent(selectFields)}`;

    const resp = await fetch(query, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`
      }
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

    const rows = await resp.json();
    const jobs = {};
    (rows || []).forEach((row) => {
      if (!row?.job_key) return;
      jobs[row.job_key] = {
        frequency: row.frequency,
        timeOfDay: row.time_of_day,
        lastRunAt: row.last_run_at,
        nextRunAt: row.next_run_at
      };
    });

    const updatedAt = rows?.[0]?.updated_at || null;

    return sendJson(res, 200, {
      status: 'ok',
      data: { jobs, updatedAt },
      meta: { generatedAt: new Date().toISOString() }
    });
  } catch (err) {
    return sendJson(res, 500, { status: 'error', message: err.message });
  }
}
