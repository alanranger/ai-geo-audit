/**
 * Save updated keyword list to latest audit_results
 * 
 * POST /api/keywords/save
 * Body: { keywords: string[] }
 */

// Increase timeout for large keyword lists (Vercel Pro: 60s, Hobby: 10s)
export const config = {
  maxDuration: 30, // 30 seconds should be enough for keyword updates
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({
      status: 'error',
      message: 'Method not allowed. Use POST.',
      meta: { generatedAt: new Date().toISOString() },
    });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      status: 'error',
      message: 'Supabase not configured.',
      meta: { generatedAt: new Date().toISOString() },
    });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { keywords } = body || {};

    if (!Array.isArray(keywords)) {
      return res.status(400).json({
        status: 'error',
        message: 'keywords must be an array',
        meta: { generatedAt: new Date().toISOString() },
      });
    }

    // Log keyword count for debugging
    console.log(`[Save Keywords] Processing ${keywords.length} keywords`);

    const propertyUrl = process.env.NEXT_PUBLIC_SITE_DOMAIN || process.env.SITE_DOMAIN || 'alanranger.com';
    
    // Get latest audit_results with full ranking_ai_data
    const auditUrl = `${supabaseUrl}/rest/v1/audit_results?property_url=eq.${encodeURIComponent(propertyUrl)}&order=audit_date.desc&limit=1`;
    const auditResp = await fetch(auditUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });

    if (!auditResp.ok) {
      return res.status(auditResp.status).json({
        status: 'error',
        message: 'Failed to fetch audit results',
        meta: { generatedAt: new Date().toISOString() },
      });
    }

    const auditRows = await auditResp.json();
    let latestAudit;
    
    // If no audit exists, create a minimal one
    if (!Array.isArray(auditRows) || auditRows.length === 0) {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const newAudit = {
        property_url: propertyUrl,
        audit_date: today,
        ranking_ai_data: {
          combinedRows: [],
          summary: { totalKeywords: 0 },
          lastRunTimestamp: null
        }
      };
      
      // Create new audit record
      const createUrl = `${supabaseUrl}/rest/v1/audit_results`;
      const createResp = await fetch(createUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          Prefer: 'return=representation',
        },
        body: JSON.stringify(newAudit),
      });
      
      if (!createResp.ok) {
        const errorText = await createResp.text();
        return res.status(createResp.status).json({
          status: 'error',
          message: 'Failed to create audit record',
          details: errorText,
          meta: { generatedAt: new Date().toISOString() },
        });
      }
      
      const created = await createResp.json();
      latestAudit = Array.isArray(created) ? created[0] : created;
    } else {
      latestAudit = auditRows[0];
    }
    const rankingAiData = latestAudit.ranking_ai_data || { combinedRows: [], summary: {} };

    // Update combinedRows to only include keywords from the new list
    // Preserve existing data for keywords that are still in the list
    const existingRowsMap = new Map();
    rankingAiData.combinedRows?.forEach(row => {
      if (row.keyword) {
        existingRowsMap.set(row.keyword, row);
      }
    });

    // Create new combinedRows with updated keywords
    const newCombinedRows = keywords.map(keyword => {
      const trimmed = String(keyword).trim();
      if (!trimmed) return null;
      
      // Use existing row data if available, otherwise create new structure
      const existing = existingRowsMap.get(trimmed);
      if (existing) {
        return existing;
      }
      
      // New keyword - create minimal structure with intent-based segment classification
      let classification = { segment: 'other', confidence: 0.5, reason: 'other: no matching intent signals' };
      try {
        const classifierModule = await import('../../lib/segment/classifyKeywordSegment.js');
        classification = classifierModule.classifyKeywordSegment({ keyword: trimmed });
      } catch (err) {
        console.error('[Save Keywords] Error importing classifier, using fallback:', err.message);
      }
      
      return {
        keyword: trimmed,
        segment: classification.segment,
        segment_confidence: classification.confidence,
        segment_reason: classification.reason,
        segment_source: 'auto',
        best_rank_group: null,
        best_rank_absolute: null,
        best_url: null,
        best_title: trimmed,
        has_ai_overview: false,
        ai_total_citations: 0,
        ai_alan_citations_count: 0,
        ai_alan_citations: [],
        ai_sample_citations: [],
        serp_features: {
          has_ai_overview: false,
          has_local_pack: false,
          has_featured_snippet: false,
          has_people_also_ask: false
        },
        competitor_counts: {}
      };
    }).filter(Boolean);

    // Update ranking_ai_data
    const updatedRankingAiData = {
      ...rankingAiData,
      combinedRows: newCombinedRows,
      summary: {
        ...rankingAiData.summary,
        totalKeywords: newCombinedRows.length
      }
    };

    // Check payload size before sending (Supabase has limits)
    const payload = JSON.stringify({
      ranking_ai_data: updatedRankingAiData
    });
    const payloadSizeMB = Buffer.byteLength(payload, 'utf8') / (1024 * 1024);
    
    if (payloadSizeMB > 4) {
      console.warn(`[Save Keywords] Large payload: ${payloadSizeMB.toFixed(2)}MB. This may cause timeouts.`);
    }

    // Update the audit_results record
    const updateUrl = `${supabaseUrl}/rest/v1/audit_results?id=eq.${latestAudit.id}`;
    const updateResp = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: 'return=representation',
      },
      body: payload,
    });

    if (!updateResp.ok) {
      let errorText = 'Unknown error';
      try {
        errorText = await updateResp.text();
        // Try to parse as JSON if possible
        try {
          const errorJson = JSON.parse(errorText);
          errorText = errorJson.message || errorJson.error || errorText;
        } catch {
          // Keep as plain text if not JSON
        }
      } catch (textErr) {
        errorText = `HTTP ${updateResp.status}: ${updateResp.statusText}`;
      }
      
      return res.status(updateResp.status >= 400 && updateResp.status < 600 ? updateResp.status : 500).json({
        status: 'error',
        message: 'Failed to update keywords',
        details: errorText.substring(0, 500), // Limit length
        meta: { generatedAt: new Date().toISOString() },
      });
    }

    return res.status(200).json({
      status: 'ok',
      message: 'Keywords updated successfully',
      count: newCombinedRows.length,
      meta: { generatedAt: new Date().toISOString() },
    });

  } catch (e) {
    console.error('[Save Keywords] Error:', e);
    // Ensure we always return JSON, even on unexpected errors
    try {
      return res.status(500).json({
        status: 'error',
        message: e.message || 'Internal server error',
        details: e.stack ? e.stack.substring(0, 500) : undefined,
        meta: { generatedAt: new Date().toISOString() },
      });
    } catch (jsonErr) {
      // Fallback if JSON.stringify fails
      res.status(500).setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({
        status: 'error',
        message: 'Internal server error',
        meta: { generatedAt: new Date().toISOString() },
      }));
    }
  }
}

