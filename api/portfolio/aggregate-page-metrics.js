// /api/portfolio/aggregate-page-metrics.js
// Aggregate gsc_page_metrics_28d by segment for portfolio snapshots

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
  if (!pageUrl || typeof pageUrl !== 'string') return 'money'; // Default
  
  // Extract path from URL
  let path = pageUrl.toLowerCase();
  try {
    const urlObj = new URL(path);
    path = urlObj.pathname || '/';
  } catch {
    // If not a full URL, assume it's already a path
    path = path.split('?')[0].split('#')[0];
  }
  
  // Remove trailing slash (except root)
  if (path.length > 1) path = path.replace(/\/+$/, '');
  
  // Event pages (workshops, courses) - matches frontend classifyMoneyPageSubSegment
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
  
  // Product pages (services) - matches frontend classifyMoneyPageSubSegment
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
  
  // Landing pages (root or specific landing patterns)
  if (path === '/' || path === '' || 
      path.includes('/landing') || path.includes('/lp/')) {
    return 'landing';
  }
  
  // Default to 'money' (all commercial pages that aren't events/products/landing)
  return 'money';
}

// Calculate median from array
function calculateMedian(values) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export default async function handler(req, res) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return sendJSON(res, 405, { error: `Method not allowed. Received: ${req.method}, Expected: POST` });
  }

  try {
    const { 
      runId,
      siteUrl,
      dateStart,
      dateEnd
    } = req.body;

    if (!runId || !siteUrl) {
      return sendJSON(res, 400, { 
        error: 'Missing required fields: runId, siteUrl' 
      });
    }

    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    // Fetch all page metrics for this run
    let query = supabase
      .from('gsc_page_metrics_28d')
      .select('*')
      .eq('run_id', runId)
      .eq('site_url', siteUrl);

    if (dateStart) {
      query = query.eq('date_start', dateStart);
    }
    if (dateEnd) {
      query = query.eq('date_end', dateEnd);
    }

    const { data: pages, error } = await query;

    if (error) {
      console.error('[Aggregate Page Metrics] Query error:', error);
      return sendJSON(res, 500, { error: error.message });
    }

    if (!pages || pages.length === 0) {
      return sendJSON(res, 200, { 
        segments: {},
        message: 'No page metrics found for this run'
      });
    }

    // Group pages by segment
    const segmentData = {
      money: [],
      landing: [],
      event: [],
      product: [],
      all_tracked: []
    };

    pages.forEach(page => {
      const segment = classifyPageSegment(page.page_url);
      segmentData[segment].push(page);
      segmentData.all_tracked.push(page); // Include in all_tracked
    });

    // Aggregate metrics per segment
    const aggregates = {};

    ['money', 'landing', 'event', 'product', 'all_tracked'].forEach(segment => {
      const segmentPages = segmentData[segment];
      if (segmentPages.length === 0) {
        aggregates[segment] = {
          ctr_28d: 0,
          clicks_28d: 0,
          impressions_28d: 0,
          avg_position: null,
          page_count: 0
        };
        return;
      }

      // Sum clicks and impressions
      const totalClicks = segmentPages.reduce((sum, p) => sum + (parseFloat(p.clicks_28d) || 0), 0);
      const totalImpressions = segmentPages.reduce((sum, p) => sum + (parseFloat(p.impressions_28d) || 0), 0);
      
      // Calculate CTR (weighted by impressions)
      const ctr = totalImpressions > 0 ? totalClicks / totalImpressions : 0;
      
      // Calculate weighted average position
      let totalPositionWeight = 0;
      let totalPositionImpressions = 0;
      segmentPages.forEach(p => {
        const impressions = parseFloat(p.impressions_28d) || 0;
        const position = parseFloat(p.position_28d);
        if (position && impressions > 0) {
          totalPositionWeight += position * impressions;
          totalPositionImpressions += impressions;
        }
      });
      const avgPosition = totalPositionImpressions > 0 ? totalPositionWeight / totalPositionImpressions : null;

      aggregates[segment] = {
        ctr_28d: ctr,
        clicks_28d: totalClicks,
        impressions_28d: totalImpressions,
        avg_position: avgPosition,
        page_count: segmentPages.length
      };
    });

    return sendJSON(res, 200, { 
      segments: aggregates,
      pageCount: pages.length,
      message: `Aggregated ${pages.length} pages into segments`
    });

  } catch (err) {
    console.error('[Aggregate Page Metrics] Error:', err);
    return sendJSON(res, 500, { error: err.message });
  }
}

