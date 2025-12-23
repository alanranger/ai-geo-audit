// /api/supabase/backfill-portfolio-segments.js
// Backfill portfolio_segment_metrics_28d from existing gsc_page_metrics_28d data

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

// Classify page segment from URL (matches frontend classifyMoneyPageSubSegment logic)
function classifyPageSegment(pageUrl) {
  if (!pageUrl || typeof pageUrl !== 'string') return 'landing';
  
  const urlLower = pageUrl.toLowerCase();
  
  // Event Pages: Use same pattern as frontend (substring match for consistency)
  if (urlLower.includes('/beginners-photography-lessons') ||
      urlLower.includes('/photographic-workshops-near-me')) {
    return 'event';
  }
  
  // Product Pages: Use same pattern as frontend (substring match for consistency)
  if (urlLower.includes('/photo-workshops-uk') ||
      urlLower.includes('/photography-services-near-me')) {
    return 'product';
  }
  
  // Landing Pages (default - anything not matching above)
  return 'landing';
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
    const { runId } = req.body;
    
    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Get all unique run_ids if runId not specified
    let runIds = [];
    if (runId) {
      runIds = [runId];
    } else {
      const { data: runs } = await supabase
        .from('gsc_page_metrics_28d')
        .select('run_id')
        .order('run_id', { ascending: false });
      
      runIds = [...new Set(runs?.map(r => r.run_id) || [])];
    }

    let totalInserted = 0;
    const results = [];

    for (const currentRunId of runIds) {
      // Get page metrics for this run
      const { data: pages, error: pagesError } = await supabase
        .from('gsc_page_metrics_28d')
        .select('*')
        .eq('run_id', currentRunId);

      if (pagesError) {
        console.error(`[Backfill] Error fetching pages for ${currentRunId}:`, pagesError);
        continue;
      }

      if (!pages || pages.length === 0) continue;

      // Get run metadata (site_url, date_start, date_end)
      const firstPage = pages[0];
      const siteUrl = firstPage.site_url;
      const dateStart = firstPage.date_start;
      const dateEnd = firstPage.date_end;

      // Calibrate to GSC overview/date totals using cached gsc_timeseries (matches GSC headline totals).
      let scaleClicks = 1;
      let scaleImpressions = 1;
      try {
        const { data: tsRows, error: tsErr } = await supabase
          .from('gsc_timeseries')
          .select('clicks, impressions')
          .eq('property_url', siteUrl)
          .gte('date', String(dateStart).slice(0, 10))
          .lte('date', String(dateEnd).slice(0, 10));

        if (tsErr) {
          console.warn(`[Backfill] gsc_timeseries query error for ${currentRunId} (skipping calibration):`, tsErr.message);
        } else if (tsRows && tsRows.length > 0) {
          const overviewClicks = tsRows.reduce((s, r) => s + (parseFloat(r.clicks) || 0), 0);
          const overviewImpr = tsRows.reduce((s, r) => s + (parseFloat(r.impressions) || 0), 0);
          const rawClicksAll = pages.reduce((s, p) => s + (parseFloat(p.clicks_28d) || 0), 0);
          const rawImprAll = pages.reduce((s, p) => s + (parseFloat(p.impressions_28d) || 0), 0);
          if (overviewClicks > 0 && rawClicksAll > 0) scaleClicks = overviewClicks / rawClicksAll;
          if (overviewImpr > 0 && rawImprAll > 0) scaleImpressions = overviewImpr / rawImprAll;
          console.log(`[Backfill] ${currentRunId} calibration: scaleClicks=${scaleClicks.toFixed(4)}, scaleImpr=${scaleImpressions.toFixed(4)} (overviewImpr=${overviewImpr}, rawImpr=${rawImprAll})`);
        }
      } catch (calErr) {
        console.warn(`[Backfill] Calibration error for ${currentRunId} (skipping):`, calErr.message);
      }

      // Group pages by segment
      const segmentPages = {
        money: [],
        landing: [],
        event: [],
        product: [],
        all_tracked: []
      };

      // Get tracked URLs from active optimization tasks for all_tracked segment
      const { data: activeTasks } = await supabase
        .from('optimisation_tasks')
        .select('target_url, target_url_clean')
        .in('status', ['in_progress', 'monitoring', 'planned'])
        .gt('cycle_active', 0);
      
      const trackedUrlPatterns = [];
      if (activeTasks) {
        activeTasks.forEach(task => {
          // Normalize URLs - handle both full URLs and relative paths
          let url = task.target_url_clean || task.target_url;
          if (url) {
            // Remove protocol if present
            url = url.replace(/^https?:\/\//, '');
            // Remove www. if present
            url = url.replace(/^www\./, '');
            // If relative path (starts with /), make it absolute by adding domain
            if (url.startsWith('/')) {
              const domain = siteUrl.replace(/^https?:\/\//, '').replace(/^www\./, '');
              url = domain + url;
            }
            // Normalize: remove trailing slash, convert to lowercase for matching
            url = url.replace(/\/$/, '').toLowerCase();
            // Extract the path part (everything after domain) for substring matching
            const pathMatch = url.match(/\/(.+)$/);
            if (pathMatch) {
              trackedUrlPatterns.push(pathMatch[1]); // e.g., "photography-workshops"
            } else if (url.includes('/')) {
              // If it's a full URL, extract path
              const parts = url.split('/');
              if (parts.length > 1) {
                trackedUrlPatterns.push(parts.slice(1).join('/')); // Everything after domain
              }
            } else {
              // Just the domain, match all pages
              trackedUrlPatterns.push('');
            }
          }
        });
      }

      pages.forEach(page => {
        const segment = classifyPageSegment(page.page_url);
        
        // Add to specific segment (event, product, or landing)
        if (segmentPages[segment]) {
          segmentPages[segment].push(page);
        }
        
        // ALSO add to 'money' segment (aggregate of all money pages: event + product + landing)
        if (segment === 'event' || segment === 'product' || segment === 'landing') {
          segmentPages.money.push(page);
        }
        
        // Add to all_tracked if this page URL is tracked by an active optimization task
        // Normalize page URL: remove protocol, www, trailing slash, extract path
        let pageUrlNormalized = page.page_url;
        pageUrlNormalized = pageUrlNormalized.replace(/^https?:\/\//, '');
        pageUrlNormalized = pageUrlNormalized.replace(/^www\./, '');
        pageUrlNormalized = pageUrlNormalized.replace(/\/$/, '').toLowerCase();
        
        // Extract path part (everything after domain)
        const pagePathMatch = pageUrlNormalized.match(/\/(.+)$/);
        const pagePath = pagePathMatch ? pagePathMatch[1] : '';
        
        // Check if page path contains any tracked URL pattern (substring match)
        const isTracked = trackedUrlPatterns.some(pattern => {
          if (!pattern) return true; // Empty pattern matches all
          // Match if page path contains the pattern or pattern is a prefix
          return pagePath.includes(pattern) || pagePath.startsWith(pattern + '/');
        });
        
        if (isTracked) {
          segmentPages.all_tracked.push(page);
        }
      });

      // Aggregate per segment
      const segmentRows = [];
      const scope = 'active_cycles_only';

      ['money', 'landing', 'event', 'product', 'all_tracked'].forEach(segment => {
        const segmentPageList = segmentPages[segment];
        if (segmentPageList.length === 0) {
          segmentRows.push({
            run_id: currentRunId,
            site_url: siteUrl,
            segment,
            scope,
            date_start: dateStart,
            date_end: dateEnd,
            pages_count: 0,
            clicks_28d: 0,
            impressions_28d: 0,
            ctr_28d: 0,
            position_28d: null
          });
          return;
        }

        const totalClicks = segmentPageList.reduce((sum, p) => sum + (parseFloat(p.clicks_28d) || 0), 0);
        const totalImpressions = segmentPageList.reduce((sum, p) => sum + (parseFloat(p.impressions_28d) || 0), 0);
        const scaledClicks = totalClicks * scaleClicks;
        const scaledImpressions = totalImpressions * scaleImpressions;
        const ctr = scaledImpressions > 0 ? scaledClicks / scaledImpressions : 0;

        let totalPositionWeight = 0;
        let totalPositionImpressions = 0;
        segmentPageList.forEach(p => {
          const impressions = parseFloat(p.impressions_28d) || 0;
          const position = parseFloat(p.position_28d);
          if (position && impressions > 0) {
            totalPositionWeight += position * impressions;
            totalPositionImpressions += impressions;
          }
        });
        const avgPosition = totalPositionImpressions > 0 ? totalPositionWeight / totalPositionImpressions : null;

        segmentRows.push({
          run_id: currentRunId,
          site_url: siteUrl,
          segment,
          scope,
          date_start: dateStart,
          date_end: dateEnd,
          pages_count: segmentPageList.length,
          clicks_28d: scaledClicks,
          impressions_28d: scaledImpressions,
          ctr_28d: ctr,
          position_28d: avgPosition
        });
      });

      // Upsert segment rows
      const { error: upsertError } = await supabase
        .from('portfolio_segment_metrics_28d')
        .upsert(segmentRows, {
          onConflict: 'run_id,site_url,segment,scope',
          ignoreDuplicates: false
        });

      if (upsertError) {
        console.error(`[Backfill] Error upserting for ${currentRunId}:`, upsertError);
        results.push({ runId: currentRunId, success: false, error: upsertError.message });
      } else {
        totalInserted += segmentRows.length;
        results.push({ runId: currentRunId, success: true, segments: segmentRows.length });
      }
    }

    return sendJSON(res, 200, {
      success: true,
      totalInserted,
      runsProcessed: runIds.length,
      results
    });

  } catch (err) {
    console.error('[Backfill Portfolio Segments] Error:', err);
    return sendJSON(res, 500, { error: err.message });
  }
}

