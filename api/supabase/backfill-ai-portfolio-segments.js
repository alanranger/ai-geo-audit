// /api/supabase/backfill-ai-portfolio-segments.js
// Backfill AI citations and AI overview data to portfolio_segment_metrics_28d from keyword_rankings

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
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(obj));
};

// Map audit_date to run_id format
// Try to match existing run_ids in portfolio_segment_metrics_28d
// First try YYYY-MM format, then try YYYY-MM-DD format
async function findMatchingRunId(supabase, auditDate, siteUrl) {
  if (!auditDate) return null;
  
  const date = new Date(auditDate);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  // Try YYYY-MM format first (for monthly backfills)
  const monthlyRunId = `${year}-${month}`;
  const { data: monthlyMatch } = await supabase
    .from('portfolio_segment_metrics_28d')
    .select('run_id')
    .eq('run_id', monthlyRunId)
    .eq('site_url', siteUrl)
    .limit(1);
  
  if (monthlyMatch && monthlyMatch.length > 0) {
    return monthlyRunId;
  }
  
  // Try YYYY-MM-DD format (for daily audits)
  const dailyRunId = `${year}-${month}-${day}`;
  const { data: dailyMatch } = await supabase
    .from('portfolio_segment_metrics_28d')
    .select('run_id')
    .eq('run_id', dailyRunId)
    .eq('site_url', siteUrl)
    .limit(1);
  
  if (dailyMatch && dailyMatch.length > 0) {
    return dailyRunId;
  }
  
  // If no match found, default to monthly format
  return monthlyRunId;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return sendJSON(res, 405, { error: `Method not allowed. Expected: POST` });
  }

  try {
    const { auditDate, siteUrl } = req.body;
    
    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Get all unique audit_dates if auditDate not specified
    let auditDates = [];
    if (auditDate) {
      auditDates = [auditDate];
    } else {
      const { data: audits } = await supabase
        .from('keyword_rankings')
        .select('audit_date')
        .order('audit_date', { ascending: false });
      
      auditDates = [...new Set(audits?.map(a => a.audit_date) || [])];
    }

    // Get site URL if not provided
    const targetSiteUrl = siteUrl || 'https://www.alanranger.com';

    let totalUpdated = 0;
    const results = [];

    for (const currentAuditDate of auditDates) {
      const runId = await findMatchingRunId(supabase, currentAuditDate, targetSiteUrl);
      
      if (!runId) {
        console.warn(`[Backfill AI] Skipping invalid audit_date: ${currentAuditDate}`);
        continue;
      }

      // Get keyword rankings for this audit date
      const { data: keywords, error: keywordsError } = await supabase
        .from('keyword_rankings')
        .select('*')
        .eq('audit_date', currentAuditDate)
        .eq('property_url', targetSiteUrl);

      if (keywordsError) {
        console.error(`[Backfill AI] Error fetching keywords for ${currentAuditDate}:`, keywordsError);
        results.push({ auditDate: currentAuditDate, runId, success: false, error: keywordsError.message });
        continue;
      }

      if (!keywords || keywords.length === 0) {
        console.log(`[Backfill AI] No keywords found for ${currentAuditDate}`);
        results.push({ auditDate: currentAuditDate, runId, success: true, updated: 0, reason: 'No keywords found' });
        continue;
      }

      // Group keywords by segment
      const segmentKeywords = {
        money: [],
        landing: [],
        event: [],
        product: [],
        all_tracked: []
      };

      keywords.forEach(keyword => {
        const keywordSegment = (keyword.segment || '').toLowerCase();
        const pageType = (keyword.page_type || '').toLowerCase();
        
        // Map keyword segments and page types to portfolio segments
        // Portfolio segments: money, landing, event, product, all_tracked
        
        // Only process "money" segment keywords (exclude "brand", "education", "other")
        if (keywordSegment !== 'money') {
          return; // Skip non-money keywords
        }
        
        // All "money" keywords go to "money" segment
        segmentKeywords.money.push(keyword);
        
        // Map page_type to specific sub-segments (landing, event, product)
        // page_type values: "Landing", "Product", "Event", "Blog", "GBP", "Other"
        if (pageType === 'landing') {
          segmentKeywords.landing.push(keyword);
        } else if (pageType === 'product') {
          segmentKeywords.product.push(keyword);
        } else if (pageType === 'event') {
          segmentKeywords.event.push(keyword);
        } else {
          // If page_type is not landing/product/event but keyword is "money", default to "landing"
          segmentKeywords.landing.push(keyword);
        }
      });

      // Get tracked URLs for all_tracked segment
      const { data: tasks } = await supabase
        .from('optimisation_tasks')
        .select('target_url')
        .not('status', 'in', '(done,cancelled,deleted)')
        .not('target_url', 'is', null);
      
      const trackedUrls = new Set();
      if (tasks) {
        tasks.forEach(t => {
          if (t.target_url) {
            // Normalize URL for matching
            const url = String(t.target_url).toLowerCase().trim();
            trackedUrls.add(url);
          }
        });
      }

      // Add keywords to all_tracked if their best_url matches a tracked task
      keywords.forEach(keyword => {
        if (keyword.best_url) {
          const url = String(keyword.best_url).toLowerCase().trim();
          if (trackedUrls.has(url)) {
            segmentKeywords.all_tracked.push(keyword);
          }
        }
      });

      // Aggregate AI metrics per segment
      const updates = [];
      const scope = 'active_cycles_only';

      for (const [segment, segmentKeywordList] of Object.entries(segmentKeywords)) {
        if (segmentKeywordList.length === 0) continue;

        // Calculate AI citations (sum of ai_alan_citations_count)
        const totalCitations = segmentKeywordList.reduce((sum, k) => {
          return sum + (parseInt(k.ai_alan_citations_count) || 0);
        }, 0);

        // Count keywords with AI overview present
        const overviewCount = segmentKeywordList.filter(k => 
          k.has_ai_overview === true || k.ai_overview_present_any === true
        ).length;

        // Check if portfolio_segment_metrics_28d row exists for this run_id + segment
        const { data: existing } = await supabase
          .from('portfolio_segment_metrics_28d')
          .select('id')
          .eq('run_id', runId)
          .eq('site_url', targetSiteUrl)
          .eq('segment', segment)
          .eq('scope', scope)
          .limit(1);

        if (existing && existing.length > 0) {
          // Update existing row
          const { error: updateError } = await supabase
            .from('portfolio_segment_metrics_28d')
            .update({
              ai_citations_28d: totalCitations,
              ai_overview_present_count: overviewCount
            })
            .eq('run_id', runId)
            .eq('site_url', targetSiteUrl)
            .eq('segment', segment)
            .eq('scope', scope);

          if (updateError) {
            console.error(`[Backfill AI] Error updating ${segment} for ${runId}:`, updateError);
            updates.push({ segment, success: false, error: updateError.message });
          } else {
            updates.push({ segment, success: true, citations: totalCitations, overviewCount });
            totalUpdated++;
          }
        } else {
          // Row doesn't exist - we can't create it without GSC page data
          // Just log a warning
          console.warn(`[Backfill AI] No portfolio_segment_metrics_28d row found for run_id=${runId}, segment=${segment}. Skipping (requires GSC page data first).`);
          updates.push({ segment, success: false, reason: 'No portfolio row exists (requires GSC data first)' });
        }
      }

      results.push({
        auditDate: currentAuditDate,
        runId,
        success: true,
        keywordsProcessed: keywords.length,
        updates
      });
    }

    return sendJSON(res, 200, {
      success: true,
      totalUpdated,
      auditsProcessed: auditDates.length,
      results
    });

  } catch (err) {
    console.error('[Backfill AI Portfolio Segments] Error:', err);
    return sendJSON(res, 500, { error: err.message });
  }
}

