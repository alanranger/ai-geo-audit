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
    const auditDate = latestAudit.audit_date;
    const rankingAiData = latestAudit.ranking_ai_data || { combinedRows: [], summary: {} };

    // Get existing keywords from keyword_rankings table (more efficient than parsing JSON)
    const existingKeywordsUrl = `${supabaseUrl}/rest/v1/keyword_rankings?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=eq.${auditDate}&select=keyword`;
    const existingKeywordsResp = await fetch(existingKeywordsUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });

    const existingKeywords = existingKeywordsResp.ok 
      ? (await existingKeywordsResp.json()).map(r => r.keyword).filter(Boolean)
      : [];

    // Normalize new keywords
    const newKeywords = keywords
      .map(k => String(k).trim())
      .filter(k => k.length > 0);

    // Find keywords to add and remove
    const keywordsToAdd = newKeywords.filter(k => !existingKeywords.includes(k));
    const keywordsToRemove = existingKeywords.filter(k => !newKeywords.includes(k));

    console.log(`[Save Keywords] Adding ${keywordsToAdd.length} keywords, removing ${keywordsToRemove.length} keywords`);

    // Delete removed keywords from keyword_rankings table (batch delete)
    if (keywordsToRemove.length > 0) {
      // Delete in batches to avoid timeout
      const batchSize = 50;
      for (let i = 0; i < keywordsToRemove.length; i += batchSize) {
        const batch = keywordsToRemove.slice(i, i + batchSize);
        const deleteUrl = `${supabaseUrl}/rest/v1/keyword_rankings?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=eq.${auditDate}&keyword=in.(${batch.map(k => `"${k.replace(/"/g, '""')}"`).join(',')})`;
        
        const deleteResp = await fetch(deleteUrl, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
          },
        });

        if (!deleteResp.ok) {
          console.warn(`[Save Keywords] Failed to delete batch ${i / batchSize + 1}: ${deleteResp.status}`);
        }
      }
    }

    // Add new keywords to keyword_rankings table (batch insert)
    if (keywordsToAdd.length > 0) {
      // Get existing row data to preserve structure
      const existingRowsMap = new Map();
      rankingAiData.combinedRows?.forEach(row => {
        if (row.keyword) {
          existingRowsMap.set(row.keyword, row);
        }
      });

      // Classify new keywords (skip for large lists to avoid timeout)
      let classifierModule = null;
      if (keywordsToAdd.length <= 50) {
        try {
          classifierModule = await import('../../lib/segment/classifyKeywordSegment.js');
        } catch (err) {
          console.warn('[Save Keywords] Could not load classifier, using fallback');
        }
      }

      // Insert in batches
      const batchSize = 50;
      for (let i = 0; i < keywordsToAdd.length; i += batchSize) {
        const batch = keywordsToAdd.slice(i, i + batchSize);
        const newRows = batch.map(trimmed => {
          // Use existing data if available, otherwise create new
          const existing = existingRowsMap.get(trimmed);
          if (existing) {
            return {
              property_url: propertyUrl,
              audit_date: auditDate,
              keyword: trimmed,
              segment: existing.segment || 'Other',
              segment_source: existing.segment_source || 'auto',
              segment_confidence: existing.segment_confidence || 0.5,
              segment_reason: existing.segment_reason || 'other: no matching intent signals',
              page_type: existing.pageType || 'Landing',
              best_rank_group: existing.best_rank_group,
              best_rank_absolute: existing.best_rank_absolute,
              best_url: existing.best_url,
              best_title: existing.best_title || trimmed,
              search_volume: existing.search_volume,
              has_ai_overview: existing.has_ai_overview || false,
              ai_total_citations: existing.ai_total_citations || 0,
              ai_alan_citations_count: existing.ai_alan_citations_count || 0,
            };
          }

          // New keyword - classify if possible
          let classification = { segment: 'Other', confidence: 0.5, reason: 'other: no matching intent signals' };
          if (classifierModule) {
            try {
              classification = classifierModule.classifyKeywordSegment({ keyword: trimmed });
            } catch (err) {
              // Use fallback
            }
          }

          return {
            property_url: propertyUrl,
            audit_date: auditDate,
            keyword: trimmed,
            segment: classification.segment,
            segment_source: 'auto',
            segment_confidence: classification.confidence,
            segment_reason: classification.reason,
            page_type: 'Landing', // Will be updated on next Ranking & AI check
            best_rank_group: null,
            best_rank_absolute: null,
            best_url: null,
            best_title: trimmed,
            search_volume: null,
            has_ai_overview: false,
            ai_total_citations: 0,
            ai_alan_citations_count: 0,
          };
        });

        const insertUrl = `${supabaseUrl}/rest/v1/keyword_rankings`;
        const insertResp = await fetch(insertUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            Prefer: 'return=minimal',
          },
          body: JSON.stringify(newRows),
        });

        if (!insertResp.ok) {
          const errorText = await insertResp.text();
          console.error(`[Save Keywords] Failed to insert batch ${i / batchSize + 1}: ${errorText}`);
        }
      }
    }

    // Update audit_results with minimal ranking_ai_data (just keyword count)
    // The full data will be rebuilt on next Ranking & AI check
    const updatedRankingAiData = {
      combinedRows: [], // Empty - will be rebuilt from keyword_rankings table
      summary: {
        totalKeywords: newKeywords.length
      },
      keywordsUpdated: new Date().toISOString()
    };

    const updateUrl = `${supabaseUrl}/rest/v1/audit_results?id=eq.${latestAudit.id}`;
    const updateResp = await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        ranking_ai_data: updatedRankingAiData
      }),
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

