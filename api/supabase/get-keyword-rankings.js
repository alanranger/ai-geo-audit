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
      // Prefer latest timestamp directly from keyword_rankings rows
      try {
        const { data: latestRankingRow } = await supabase
          .from('keyword_rankings')
          .select('updated_at, created_at, audit_date')
          .eq('property_url', propertyUrl)
          .order('updated_at', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (latestRankingRow?.updated_at || latestRankingRow?.created_at) {
          latestTimestamp = latestRankingRow.updated_at || latestRankingRow.created_at;
          console.log(`[Get Keyword Rankings] Using keyword_rankings timestamp: ${latestTimestamp} (audit_date ${latestRankingRow.audit_date})`);
        }
      } catch (rankingTsErr) {
        console.log(`[Get Keyword Rankings] Failed to read keyword_rankings timestamp: ${rankingTsErr.message}`);
      }
      // If we have an audit_date, try to get the timestamp from audit_results
      // CRITICAL FIX: Query for ANY audit_result with ranking_ai_data, not just matching audit_date
      // This ensures we get the timestamp even if audit_date formats differ slightly
      if (!latestTimestamp && latestRow?.audit_date) {
        // First try exact match - check for non-null AND non-empty ranking_ai_data
        let { data: auditResult, error: auditError } = await supabase
          .from('audit_results')
          .select('timestamp, audit_date, ranking_ai_data')
          .eq('property_url', propertyUrl)
          .eq('audit_date', latestRow.audit_date)
          .not('ranking_ai_data', 'is', null)
          .order('timestamp', { ascending: false })
          .limit(1)
          .maybeSingle(); // Use maybeSingle() instead of single() to avoid error if no rows

        // Check if ranking_ai_data is not empty (might be {} instead of null)
        if (auditResult && auditResult.ranking_ai_data) {
          try {
            const rankingData = typeof auditResult.ranking_ai_data === 'string' 
              ? JSON.parse(auditResult.ranking_ai_data) 
              : auditResult.ranking_ai_data;
            // If it's an empty object or has no combinedRows, treat as no data
            if (!rankingData || (typeof rankingData === 'object' && Object.keys(rankingData).length === 0)) {
              auditResult = null;
              auditError = { message: 'ranking_ai_data is empty object' };
            }
          } catch (e) {
            // If parsing fails, treat as no data
            auditResult = null;
            auditError = { message: 'Failed to parse ranking_ai_data' };
          }
        }

        // If no exact match or no timestamp, try to find any audit_result with ranking_ai_data for this property
        if (auditError || !auditResult?.timestamp) {
          const { data: anyAuditResult, error: anyError } = await supabase
            .from('audit_results')
            .select('timestamp, audit_date, ranking_ai_data')
            .eq('property_url', propertyUrl)
            .not('ranking_ai_data', 'is', null)
            .order('timestamp', { ascending: false })
            .limit(1)
            .maybeSingle(); // Use maybeSingle() instead of single()
          
          // Check if ranking_ai_data is not empty
          if (anyAuditResult && anyAuditResult.ranking_ai_data) {
            try {
              const rankingData = typeof anyAuditResult.ranking_ai_data === 'string' 
                ? JSON.parse(anyAuditResult.ranking_ai_data) 
                : anyAuditResult.ranking_ai_data;
              if (rankingData && typeof rankingData === 'object' && Object.keys(rankingData).length > 0) {
                auditResult = anyAuditResult;
                auditError = null;
                console.log(`[Get Keyword Rankings] Found timestamp from any audit_result: ${auditResult.timestamp}`);
              }
            } catch (e) {
              console.log(`[Get Keyword Rankings] Failed to parse ranking_ai_data: ${e.message}`);
            }
          }
          
          if (anyError && !auditResult) {
            console.log(`[Get Keyword Rankings] No audit_result with ranking_ai_data found. Error: ${anyError?.message || 'none'}`);
          }
        }

        if (!auditError && auditResult?.timestamp) {
          latestTimestamp = auditResult.timestamp;
          console.log(`[Get Keyword Rankings] Using timestamp: ${latestTimestamp} from audit_date: ${auditResult.audit_date}`);
        } else {
          console.log(`[Get Keyword Rankings] No timestamp found. auditError: ${auditError?.message || 'none'}, hasTimestamp: ${!!auditResult?.timestamp}, audit_date: ${latestRow.audit_date}`);
        }
      }

      // Fallback: if we still have no timestamp but do have an audit_date, use midnight of that date
      if (!latestTimestamp && latestRow?.audit_date) {
        const ts = new Date(`${latestRow.audit_date}T00:00:00Z`);
        if (!isNaN(ts.getTime())) {
          latestTimestamp = ts.toISOString();
          console.log(`[Get Keyword Rankings] Fallback timestamp using audit_date midnight: ${latestTimestamp}`);
        }
      }
      // Secondary fallback: if still null, take the most recent audit_results row with a timestamp for this property
      if (!latestTimestamp) {
        const { data: recentResult, error: recentErr } = await supabase
          .from('audit_results')
          .select('timestamp, audit_date')
          .eq('property_url', propertyUrl)
          .not('timestamp', 'is', null)
          .order('timestamp', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (recentResult?.timestamp) {
          latestTimestamp = recentResult.timestamp;
          console.log(`[Get Keyword Rankings] Using recent audit_results timestamp fallback: ${latestTimestamp} (audit_date ${recentResult.audit_date})`);
        } else if (recentErr) {
          console.log(`[Get Keyword Rankings] No recent audit_results timestamp fallback. Error: ${recentErr.message}`);
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

