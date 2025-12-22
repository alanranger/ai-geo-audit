// /api/supabase/get-keyword-rankings.js
// Get keyword rankings by audit_date and property_url

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

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return sendJSON(res, 405, { error: `Method not allowed. Expected: GET` });
  }

  try {
    const { auditDate, propertyUrl } = req.query;
    
    if (!auditDate || !propertyUrl) {
      return sendJSON(res, 400, { error: 'auditDate and propertyUrl are required' });
    }
    
    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    const { data: keywords, error } = await supabase
      .from('keyword_rankings')
      .select('*')
      .eq('audit_date', auditDate)
      .eq('property_url', propertyUrl);

    if (error) {
      throw error;
    }

    return sendJSON(res, 200, {
      success: true,
      keywords: keywords || []
    });

  } catch (err) {
    console.error('[Get Keyword Rankings] Error:', err);
    return sendJSON(res, 500, { error: err.message });
  }
}

