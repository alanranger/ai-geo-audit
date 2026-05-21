// Weekly GA4 cache refresh for Revenue Funnel (Vercel cron).
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { createClient } from '@supabase/supabase-js';
import { getGa4MetricsForProperty } from '../aigeo/ga4-data.js';

const DEFAULT_PROPERTY = 'https://www.alanranger.com';

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

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (!authoriseRequest(req)) return send(res, 401, { error: 'unauthorised' });

  const propertyUrl = String(req.query?.propertyUrl || DEFAULT_PROPERTY).trim();
  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    const { row, refreshed } = await getGa4MetricsForProperty(supabase, propertyUrl, { forceRefresh: true });
    return send(res, 200, {
      ok: true,
      property_url: propertyUrl,
      refreshed,
      date_end: row?.date_end || null,
      money_page_enquiry_events_28d: row?.money_page_enquiry_events_28d ?? null,
      enquiry_events_28d: row?.enquiry_events_28d ?? null
    });
  } catch (err) {
    return send(res, 500, { error: 'ga4_cron_sync_failed', message: err?.message || String(err) });
  }
}
