// /api/supabase/backfill-historical-gsc.js
// Backfill historical GSC page-level data for the last 12 months

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { getGSCAccessToken, normalizePropertyUrl } from '../aigeo/utils.js';

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

// Helper to get the last day of a month
function getLastDayOfMonth(year, month) {
  return new Date(year, month + 1, 0);
}

// Helper to format date as YYYY-MM-DD
function formatDate(date) {
  return date.toISOString().split('T')[0];
}

// Helper to calculate rolling 28-day window ending on a specific date
function getRolling28dWindow(endDate) {
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 27); // 27 days back = 28 days total (inclusive)
  start.setHours(0, 0, 0, 0);
  return {
    startDate: formatDate(start),
    endDate: formatDate(end)
  };
}

// Fetch GSC page-level data for a date range
async function fetchGscPageData(siteUrl, startDate, endDate) {
  const accessToken = await getGSCAccessToken();
  const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  
  const requestBody = {
    startDate,
    endDate,
    dimensions: ['page'],
    rowLimit: 25000, // Fetch up to 25k pages
  };
  
  console.log(`[Backfill GSC] Fetching data for ${startDate} to ${endDate}...`);
  
  const response = await fetch(searchConsoleUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });
  
  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`GSC API error: ${errorData.error?.message || 'Unknown error'}`);
  }
  
  const data = await response.json();
  return data.rows || [];
}

// Classify page segment from URL (matches frontend logic)
function classifyPageSegment(pageUrl) {
  if (!pageUrl || typeof pageUrl !== 'string') return 'landing';
  
  const urlLower = pageUrl.toLowerCase();
  
  // Event Pages
  if (urlLower.includes('/beginners-photography-lessons') ||
      urlLower.includes('/photographic-workshops-near-me')) {
    return 'event';
  }
  
  // Product Pages
  if (urlLower.includes('/photo-workshops-uk') ||
      urlLower.includes('/photography-services-near-me')) {
    return 'product';
  }
  
  // Landing Pages (default)
  return 'landing';
}

// Calculate and save segment metrics for a run
async function calculateAndSaveSegmentMetrics(supabase, runId, siteUrl, dateStart, dateEnd, pages) {
  // Get active optimisation tasks for all_tracked segment
  const { data: tasks } = await supabase
    .from('optimisation_tasks')
    .select('target_url')
    .not('status', 'in', '(done,cancelled,deleted)')
    .not('target_url', 'is', null);
  
  // Normalize URL for matching (extracts path and normalizes)
  function normalizeUrlForMatching(url) {
    if (!url) return '';
    try {
      // Handle path-only URLs
      let u = url.trim();
      if (u.startsWith('/')) {
        u = `https://www.alanranger.com${u}`;
      } else if (!u.startsWith('http')) {
        u = `https://www.alanranger.com/${u.replace(/^\/+/, '')}`;
      }
      
      const urlObj = new URL(u);
      let path = urlObj.pathname || '/';
      // Remove trailing slash (except root)
      if (path.length > 1) path = path.replace(/\/+$/, '');
      return (urlObj.origin + path).toLowerCase();
    } catch {
      // Fallback: simple normalization
      return url.toLowerCase().replace(/\/+$/, '');
    }
  }
  
  const trackedUrls = new Set();
  if (tasks) {
    tasks.forEach(t => {
      if (t.target_url) {
        const normalized = normalizeUrlForMatching(t.target_url);
        if (normalized) trackedUrls.add(normalized);
      }
    });
  }
  
  // Group pages by segment
  const segmentPages = {
    money: [],
    landing: [],
    event: [],
    product: [],
    all_tracked: []
  };
  
  pages.forEach(page => {
    const segment = classifyPageSegment(page.keys[0]); // page.keys[0] is the page URL
    const pageUrl = page.keys[0];
    const normalizedPageUrl = normalizeUrlForMatching(pageUrl);
    
    // Add to specific segment
    if (segmentPages[segment]) {
      segmentPages[segment].push(page);
    }
    
    // Also add to 'money' segment (aggregate of all money pages)
    if (segment === 'event' || segment === 'product' || segment === 'landing') {
      segmentPages.money.push(page);
    }
    
    // Add to all_tracked if it matches a tracked task URL
    // Check exact match or if page URL contains task URL or vice versa
    const isTracked = trackedUrls.has(normalizedPageUrl) || 
      Array.from(trackedUrls).some(tu => {
        return normalizedPageUrl.includes(tu) || tu.includes(normalizedPageUrl);
      });
    
    if (isTracked) {
      segmentPages.all_tracked.push(page);
    }
  });
  
  // Aggregate metrics per segment
  const segmentRows = [];
  const scope = 'active_cycles_only';
  
  ['money', 'landing', 'event', 'product', 'all_tracked'].forEach(segment => {
    const segmentPageList = segmentPages[segment];
    
    if (segmentPageList.length === 0) {
      segmentRows.push({
        run_id: runId,
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
    
    const totalClicks = segmentPageList.reduce((sum, p) => sum + (p.clicks || 0), 0);
    const totalImpressions = segmentPageList.reduce((sum, p) => sum + (p.impressions || 0), 0);
    const ctr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
    
    let totalPositionWeight = 0;
    let totalPositionImpressions = 0;
    segmentPageList.forEach(p => {
      const impressions = p.impressions || 0;
      const position = p.position;
      if (position && impressions > 0) {
        totalPositionWeight += position * impressions;
        totalPositionImpressions += impressions;
      }
    });
    const avgPosition = totalPositionImpressions > 0 ? totalPositionWeight / totalPositionImpressions : null;
    
    segmentRows.push({
      run_id: runId,
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
  
  // Upsert segment metrics
  const { error: segmentError } = await supabase
    .from('portfolio_segment_metrics_28d')
    .upsert(segmentRows, {
      onConflict: 'run_id,site_url,segment,scope',
      ignoreDuplicates: false
    });
  
  if (segmentError) {
    throw new Error(`Failed to save segment metrics: ${segmentError.message}`);
  }
  
  return segmentRows.length;
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
    const { propertyUrl, months = 12, startFromMonth } = req.body;
    
    if (!propertyUrl) {
      return sendJSON(res, 400, { error: 'Missing required parameter: propertyUrl' });
    }
    
    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );
    
    const siteUrl = normalizePropertyUrl(propertyUrl);
    
    // Generate list of months to backfill
    const monthsToProcess = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    for (let i = 0; i < months; i++) {
      const monthDate = new Date(today);
      monthDate.setMonth(monthDate.getMonth() - i);
      
      // Get last day of that month
      const lastDay = getLastDayOfMonth(monthDate.getFullYear(), monthDate.getMonth());
      
      // Only process if the last day is in the past (not future)
      if (lastDay <= today) {
        monthsToProcess.push({
          year: lastDay.getFullYear(),
          month: lastDay.getMonth(),
          lastDay: lastDay
        });
      }
    }
    
    // If startFromMonth is provided, only process from that month onwards
    if (startFromMonth) {
      const startDate = new Date(startFromMonth);
      const filtered = monthsToProcess.filter(m => m.lastDay >= startDate);
      monthsToProcess.length = 0;
      monthsToProcess.push(...filtered);
    }
    
    console.log(`[Backfill GSC] Processing ${monthsToProcess.length} months for ${siteUrl}`);
    
    const results = [];
    let totalPagesSaved = 0;
    let totalRunsProcessed = 0;
    
    for (const monthInfo of monthsToProcess) {
      const { year, month, lastDay } = monthInfo;
      
      // Calculate rolling 28-day window ending on last day of month
      const { startDate, endDate } = getRolling28dWindow(lastDay);
      
      // Create run_id based on month (YYYY-MM format)
      const runId = `${year}-${String(month + 1).padStart(2, '0')}`;
      
      // Check if this run already exists
      const { data: existing } = await supabase
        .from('gsc_page_metrics_28d')
        .select('id')
        .eq('run_id', runId)
        .eq('site_url', siteUrl)
        .limit(1);
      
      if (existing && existing.length > 0) {
        console.log(`[Backfill GSC] Run ${runId} already exists, skipping...`);
        results.push({
          runId,
          status: 'skipped',
          reason: 'Already exists'
        });
        continue;
      }
      
      try {
        // Fetch GSC data
        const gscRows = await fetchGscPageData(siteUrl, startDate, endDate);
        
        if (gscRows.length === 0) {
          console.log(`[Backfill GSC] No data for ${runId}, skipping...`);
          results.push({
            runId,
            status: 'skipped',
            reason: 'No GSC data available'
          });
          continue;
        }
        
        // Prepare pages for insertion
        const pagesToInsert = gscRows.map(row => ({
          run_id: runId,
          site_url: siteUrl,
          page_url: row.keys[0], // First dimension is page URL
          date_start: startDate,
          date_end: endDate,
          clicks_28d: row.clicks || 0,
          impressions_28d: row.impressions || 0,
          ctr_28d: row.ctr || 0,
          position_28d: row.position || null
        }));
        
        // Insert page metrics in batches
        const batchSize = 500;
        for (let i = 0; i < pagesToInsert.length; i += batchSize) {
          const batch = pagesToInsert.slice(i, i + batchSize);
          const { error: insertError } = await supabase
            .from('gsc_page_metrics_28d')
            .upsert(batch, {
              onConflict: 'run_id,page_url',
              ignoreDuplicates: false
            });
          
          if (insertError) {
            throw new Error(`Failed to insert page metrics batch: ${insertError.message}`);
          }
        }
        
        totalPagesSaved += pagesToInsert.length;
        
        // Calculate and save segment metrics
        const segmentsSaved = await calculateAndSaveSegmentMetrics(
          supabase,
          runId,
          siteUrl,
          startDate,
          endDate,
          gscRows
        );
        
        totalRunsProcessed++;
        
        results.push({
          runId,
          status: 'success',
          pages: pagesToInsert.length,
          segments: segmentsSaved,
          dateRange: { startDate, endDate }
        });
        
        console.log(`[Backfill GSC] ✓ Processed ${runId}: ${pagesToInsert.length} pages, ${segmentsSaved} segments`);
        
        // Add a small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`[Backfill GSC] Error processing ${runId}:`, error);
        results.push({
          runId,
          status: 'error',
          error: error.message
        });
      }
    }
    
    return sendJSON(res, 200, {
      success: true,
      message: `Backfill completed. Processed ${totalRunsProcessed} months, saved ${totalPagesSaved} pages.`,
      totalMonths: monthsToProcess.length,
      runsProcessed: totalRunsProcessed,
      totalPagesSaved,
      results
    });
    
  } catch (error) {
    console.error('[Backfill GSC] Fatal error:', error);
    return sendJSON(res, 500, {
      error: 'Internal server error',
      message: error.message
    });
  }
}

