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
    const { auditDate, propertyUrl, latestOnly } = req.query;
    
    if (!propertyUrl) {
      return sendJSON(res, 400, { error: 'propertyUrl is required' });
    }
    
    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    // If latestOnly=true, return the latest audit_date AND timestamp from audit_results
    if (latestOnly === 'true') {
      // Get latest audit_date from keyword_rankings
      const { data: latestRow, error } = await supabase
        .from('keyword_rankings')
        .select('audit_date')
        .eq('property_url', propertyUrl)
        .order('audit_date', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        throw error;
      }

      let latestTimestamp = null;
      // If we have an audit_date, try to get the timestamp from audit_results
      if (latestRow?.audit_date) {
        const { data: auditResult, error: auditError } = await supabase
          .from('audit_results')
          .select('timestamp, audit_date')
          .eq('property_url', propertyUrl)
          .eq('audit_date', latestRow.audit_date)
          .not('ranking_ai_data', 'is', null) // Only audits that have ranking_ai_data
          .order('timestamp', { ascending: false })
          .limit(1)
          .single();

        if (!auditError && auditResult?.timestamp) {
          latestTimestamp = auditResult.timestamp;
        }
      }

      return sendJSON(res, 200, {
        status: 'ok',
        data: {
          latestAuditDate: latestRow?.audit_date || null,
          latestTimestamp: latestTimestamp || null
        }
      });
    }

    // Otherwise, require auditDate and return keywords for that date
    if (!auditDate) {
      return sendJSON(res, 400, { error: 'auditDate is required when latestOnly is not true' });
    }

    const { data: keywords, error } = await supabase
      .from('keyword_rankings')
      .select('*')
      .eq('audit_date', auditDate)
      .eq('property_url', propertyUrl);

    if (error) {
      throw error;
    }

    return sendJSON(res, 200, {
      status: 'ok',
      data: {
        keywords: keywords || []
      }
    });

  } catch (err) {
    console.error('[Get Keyword Rankings] Error:', err);
    return sendJSON(res, 500, { status: 'error', error: err.message });
  }
}

