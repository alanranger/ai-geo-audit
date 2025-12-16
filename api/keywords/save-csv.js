/**
 * Save keywords from CSV file
 * 
 * POST /api/keywords/save-csv
 * Body: { csv: string } - CSV content as string
 */

// Increase timeout for large CSV files
export const config = {
  maxDuration: 30,
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
    const { csv } = body || {};

    if (!csv || typeof csv !== 'string') {
      return res.status(400).json({
        status: 'error',
        message: 'csv field is required and must be a string',
        meta: { generatedAt: new Date().toISOString() },
      });
    }

    // Parse CSV - simple parser (one keyword per line, first column)
    const lines = csv.split('\n');
    const keywords = [];
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue; // Skip empty lines and comments
      
      // If line contains comma, take first column; otherwise use whole line
      const firstColumn = trimmed.includes(',') ? trimmed.split(',')[0].trim() : trimmed;
      if (firstColumn) {
        keywords.push(firstColumn);
      }
    }

    if (keywords.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'No keywords found in CSV',
        meta: { generatedAt: new Date().toISOString() },
      });
    }

    console.log(`[Save CSV] Parsed ${keywords.length} keywords from CSV`);

    // Use the same save logic as the regular save endpoint
    // Import and call the save function logic
    const saveModule = await import('./save.js');
    
    // Create a mock request object for the save handler
    const mockReq = {
      method: 'POST',
      body: { keywords },
    };

    // Call the save handler logic directly
    // Since we can't easily call the handler, we'll duplicate the efficient save logic
    const propertyUrl = process.env.NEXT_PUBLIC_SITE_DOMAIN || process.env.SITE_DOMAIN || 'alanranger.com';
    
    // Get latest audit
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
    if (!Array.isArray(auditRows) || auditRows.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'No audit found. Please run an audit first.',
        meta: { generatedAt: new Date().toISOString() },
      });
    }

    const latestAudit = auditRows[0];
    const auditDate = latestAudit.audit_date;

    // Get existing keywords
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

    // Find keywords to add and remove
    const keywordsToAdd = keywords.filter(k => !existingKeywords.includes(k));
    const keywordsToRemove = existingKeywords.filter(k => !keywords.includes(k));

    console.log(`[Save CSV] Adding ${keywordsToAdd.length} keywords, removing ${keywordsToRemove.length} keywords`);

    // Delete removed keywords in batches
    if (keywordsToRemove.length > 0) {
      const batchSize = 50;
      for (let i = 0; i < keywordsToRemove.length; i += batchSize) {
        const batch = keywordsToRemove.slice(i, i + batchSize);
        const deleteUrl = `${supabaseUrl}/rest/v1/keyword_rankings?property_url=eq.${encodeURIComponent(propertyUrl)}&audit_date=eq.${auditDate}&keyword=in.(${batch.map(k => `"${k.replace(/"/g, '""')}"`).join(',')})`;
        
        await fetch(deleteUrl, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
          },
        });
      }
    }

    // Add new keywords in batches
    if (keywordsToAdd.length > 0) {
      let classifierModule = null;
      if (keywordsToAdd.length <= 50) {
        try {
          classifierModule = await import('../../lib/segment/classifyKeywordSegment.js');
        } catch (err) {
          // Use fallback
        }
      }

      const batchSize = 50;
      for (let i = 0; i < keywordsToAdd.length; i += batchSize) {
        const batch = keywordsToAdd.slice(i, i + batchSize);
        const newRows = batch.map(trimmed => {
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
            page_type: 'Landing',
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
        await fetch(insertUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            Prefer: 'return=minimal',
          },
          body: JSON.stringify(newRows),
        });
      }
    }

    // Update audit_results with minimal data
    const updateUrl = `${supabaseUrl}/rest/v1/audit_results?id=eq.${latestAudit.id}`;
    await fetch(updateUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        ranking_ai_data: {
          combinedRows: [],
          summary: { totalKeywords: keywords.length },
          keywordsUpdated: new Date().toISOString()
        }
      }),
    });

    return res.status(200).json({
      status: 'ok',
      message: 'Keywords updated successfully from CSV',
      count: keywords.length,
      added: keywordsToAdd.length,
      removed: keywordsToRemove.length,
      meta: { generatedAt: new Date().toISOString() },
    });

  } catch (e) {
    console.error('[Save CSV] Error:', e);
    return res.status(500).json({
      status: 'error',
      message: e.message || 'Internal server error',
      meta: { generatedAt: new Date().toISOString() },
    });
  }
}

