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

// Classify page segment from URL (matches frontend logic)
function classifyPageSegment(pageUrl) {
  if (!pageUrl || typeof pageUrl !== 'string') return 'money';
  
  let path = pageUrl.toLowerCase();
  try {
    const urlObj = new URL(path);
    path = urlObj.pathname || '/';
  } catch {
    path = path.split('?')[0].split('#')[0];
  }
  
  if (path.length > 1) path = path.replace(/\/+$/, '');
  
  // Event pages
  if (path.startsWith('/beginners-photography-lessons') ||
      path.startsWith('/photographic-workshops-near-me') ||
      path === '/photography-workshops' ||
      path === '/photography-workshops-near-me' ||
      path === '/landscape-photography-workshops' ||
      path === '/outdoor-photography-workshops' ||
      path === '/photography-courses-coventry' ||
      path === '/course-finder-photography-classes-near-me' ||
      path.includes('/workshop') || path.includes('/workshops')) {
    return 'event';
  }
  
  // Product pages
  if (path.startsWith('/photo-workshops-uk') ||
      path.startsWith('/photography-services-near-me') ||
      path === '/photography-tuition-services' ||
      path === '/photography-shop-services' ||
      path === '/hire-a-professional-photographer-in-coventry' ||
      path === '/professional-commercial-photographer-coventry' ||
      path === '/professional-photographer-near-me' ||
      path === '/coventry-photographer' ||
      path === '/photographer-in-coventry' ||
      path === '/photography-mentoring-programme' ||
      path === '/photography-academy-membership' ||
      path === '/photography-academy' ||
      path === '/photography-session-vouchers' ||
      path === '/photography-gift-vouchers' ||
      path === '/photography-presents-for-photographers' ||
      path === '/rps-courses-mentoring-distinctions') {
    return 'product';
  }
  
  // Landing pages
  if (path === '/' || path === '' || 
      path.includes('/landing') || path.includes('/lp/')) {
    return 'landing';
  }
  
  return 'money';
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

      // Group pages by segment
      const segmentPages = {
        money: [],
        landing: [],
        event: [],
        product: [],
        all_tracked: []
      };

      pages.forEach(page => {
        const segment = classifyPageSegment(page.page_url);
        if (segmentPages[segment]) {
          segmentPages[segment].push(page);
        }
        // All pages go into all_tracked
        segmentPages.all_tracked.push(page);
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
        const ctr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;

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
          clicks_28d: totalClicks,
          impressions_28d: totalImpressions,
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

