export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const sendJSON = (res, status, obj) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(obj));
};

const parseJson = (value) => {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return sendJSON(res, 405, { status: 'error', message: 'Method not allowed. Use GET.' });
  }

  try {
    const { propertyUrl } = req.query;
    if (!propertyUrl) {
      return sendJSON(res, 400, { status: 'error', message: 'propertyUrl is required' });
    }

    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    const { data: auditRow } = await supabase
      .from('audit_results')
      .select('audit_date,updated_at,ranking_ai_data')
      .eq('property_url', propertyUrl)
      .not('ranking_ai_data', 'is', null)
      .order('updated_at', { ascending: false })
      .order('audit_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: rankingRow } = await supabase
      .from('keyword_rankings')
      .select('audit_date,updated_at,created_at')
      .eq('property_url', propertyUrl)
      .order('updated_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const rankingData = parseJson(auditRow?.ranking_ai_data);

    return sendJSON(res, 200, {
      status: 'ok',
      data: {
        auditResults: {
          auditDate: auditRow?.audit_date || null,
          updatedAt: auditRow?.updated_at || null,
          lastRunTimestamp: rankingData?.lastRunTimestamp || null
        },
        keywordRankings: {
          auditDate: rankingRow?.audit_date || null,
          updatedAt: rankingRow?.updated_at || null,
          createdAt: rankingRow?.created_at || null
        }
      }
    });
  } catch (err) {
    return sendJSON(res, 500, { status: 'error', message: err.message });
  }
}
