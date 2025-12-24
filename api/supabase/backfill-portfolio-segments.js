// /api/supabase/backfill-portfolio-segments.js
// Backfill portfolio_segment_metrics_28d from existing gsc_page_metrics_28d data

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { classifyPageSegment as classifySitePageSegment, PageSegment } from '../aigeo/pageSegment.js';

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

// Classify Money Pages sub-segment (event/product/landing) but ONLY for true money pages.
// This matches the intent of the Money Pages module: exclude blogs/support/system pages.
function classifyMoneySubSegment(pageUrl) {
  if (!pageUrl || typeof pageUrl !== 'string') return null;
  const main = classifySitePageSegment(pageUrl);
  if (main !== PageSegment.MONEY) return null;

  const urlLower = pageUrl.toLowerCase();
  // Event pages (substring match for consistency with frontend)
  if (urlLower.includes('/beginners-photography-lessons') ||
      urlLower.includes('/photographic-workshops-near-me')) {
    return 'event';
  }
  // Product pages
  if (urlLower.includes('/photo-workshops-uk') ||
      urlLower.includes('/photography-services-near-me')) {
    return 'product';
  }
  // Default money page bucket
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
      let overviewClicks = null;
      let overviewImpr = null;
      let overviewPos = null;
      try {
        const { data: tsRows, error: tsErr } = await supabase
          .from('gsc_timeseries')
          .select('clicks, impressions, position')
          .eq('property_url', siteUrl)
          .gte('date', String(dateStart).slice(0, 10))
          .lte('date', String(dateEnd).slice(0, 10));

        if (tsErr) {
          console.warn(`[Backfill] gsc_timeseries query error for ${currentRunId} (skipping calibration):`, tsErr.message);
        } else if (tsRows && tsRows.length > 0) {
          overviewClicks = tsRows.reduce((s, r) => s + (parseFloat(r.clicks) || 0), 0);
          overviewImpr = tsRows.reduce((s, r) => s + (parseFloat(r.impressions) || 0), 0);
          // Approximate period-average position: weight daily position by daily impressions (best available for overview).
          // NOTE: gsc_timeseries stores daily position; not perfect, but consistent with the overview/time-series basis.
          let posWeight = 0;
          let posImpr = 0;
          tsRows.forEach(r => {
            const impr = parseFloat(r.impressions) || 0;
            const pos = parseFloat(r.position);
            if (impr > 0 && !isNaN(pos) && isFinite(pos) && pos > 0) {
              posWeight += pos * impr;
              posImpr += impr;
            }
          });
          overviewPos = posImpr > 0 ? (posWeight / posImpr) : null;
          const rawClicksAll = pages.reduce((s, p) => s + (parseFloat(p.clicks_28d) || 0), 0);
          const rawImprAll = pages.reduce((s, p) => s + (parseFloat(p.impressions_28d) || 0), 0);
          if (overviewClicks > 0 && rawClicksAll > 0) scaleClicks = overviewClicks / rawClicksAll;
          if (overviewImpr > 0 && rawImprAll > 0) scaleImpressions = overviewImpr / rawImprAll;
          console.log(`[Backfill] ${currentRunId} calibration: scaleClicks=${scaleClicks.toFixed(4)}, scaleImpr=${scaleImpressions.toFixed(4)} (overviewImpr=${overviewImpr}, rawImpr=${rawImprAll})`);
        }
      } catch (calErr) {
        console.warn(`[Backfill] Calibration error for ${currentRunId} (skipping):`, calErr.message);
      }

      // Group pages by segment for two scopes:
      // - all_pages: all pages in the segment (calibrated to gsc_timeseries totals)
      // - active_cycles_only: only pages currently tracked by active optimisation tasks (NOT calibrated)
      const segmentPagesAll = {
        site: [],
        money: [],
        academy: [],
        landing: [],
        event: [],
        product: [],
        blog: [],
        other: [],
        all_tracked: []
      };
      const segmentPagesActive = {
        site: [],
        money: [],
        academy: [],
        landing: [],
        event: [],
        product: [],
        blog: [],
        other: [],
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
        // Entire site segment: always include every page row
        segmentPagesAll.site.push(page);

        // Blog segment: any URL containing /blog-on-photography/
        const urlLower = String(page.page_url || '').toLowerCase();
        const isBlog = urlLower.includes('/blog-on-photography/');
        if (isBlog) {
          segmentPagesAll.blog.push(page);
        }
        
        // Academy segment: single signup page only
        const isAcademy = urlLower.includes('/free-online-photography-course');
        if (isAcademy) {
          segmentPagesAll.academy.push(page);
        }

        // Money Pages segments (exclude blogs/support/system)
        const subSegment = classifyMoneySubSegment(page.page_url);
        const isOther = !subSegment && !isBlog && !isAcademy;
        
        if (subSegment && segmentPagesAll[subSegment]) segmentPagesAll[subSegment].push(page);
        if (subSegment) segmentPagesAll.money.push(page); // money = aggregate of landing+event+product (money pages only)
        if (isOther) segmentPagesAll.other.push(page);
        
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
          segmentPagesAll.all_tracked.push(page);

          // active_cycles_only scope is the tracked subset
          segmentPagesActive.site.push(page);
          if (isBlog) segmentPagesActive.blog.push(page);
          if (isAcademy) segmentPagesActive.academy.push(page);
          if (isOther) segmentPagesActive.other.push(page);
          if (subSegment && segmentPagesActive[subSegment]) segmentPagesActive[subSegment].push(page);
          if (subSegment) segmentPagesActive.money.push(page);
          segmentPagesActive.all_tracked.push(page);
        }
      });

      // --- AI metrics (keyword-driven) ---
      // AI Citations / AI Overview are stored per keyword. We infer segment from each keyword's best_url.
      const initAi = () => ({
        site: { citations: 0, overviewCount: 0 },
        money: { citations: 0, overviewCount: 0 },
        academy: { citations: 0, overviewCount: 0 },
        other: { citations: 0, overviewCount: 0 },
        landing: { citations: 0, overviewCount: 0 },
        event: { citations: 0, overviewCount: 0 },
        product: { citations: 0, overviewCount: 0 },
        blog: { citations: 0, overviewCount: 0 },
        all_tracked: { citations: 0, overviewCount: 0 }
      });

      const aiAll = initAi();
      const aiActive = initAi(); // tracked subset only

      const normalizeUrlForPathMatch = (url) => {
        if (!url) return { path: '' };
        let u = String(url);
        // Strip query params (GSC + SERP tooling often adds tracking params)
        u = u.split('?')[0];
        // Remove protocol and www
        u = u.replace(/^https?:\/\//i, '');
        u = u.replace(/^www\./i, '');
        // Remove trailing slash
        u = u.replace(/\/$/, '');
        u = u.toLowerCase();
        const m = u.match(/\/(.+)$/);
        return { path: m ? m[1] : '' };
      };

      const inferSegmentFromBestUrl = (bestUrl) => {
        if (!bestUrl) return null;
        const lower = String(bestUrl).toLowerCase();
        if (lower.includes('/blog-on-photography/')) return 'blog';
        if (lower.includes('/free-online-photography-course')) return 'academy';
        const sub = classifyMoneySubSegment(bestUrl); // landing|event|product for money pages only
        if (sub === 'landing' || sub === 'event' || sub === 'product') return sub;
        return 'other';
      };

      try {
        const auditDate = String(dateEnd).slice(0, 10);
        const { data: keywords, error: kwErr } = await supabase
          .from('keyword_rankings')
          .select('best_url, ai_alan_citations_count, has_ai_overview, ai_overview_present_any')
          .eq('property_url', siteUrl)
          .eq('audit_date', auditDate);

        if (kwErr) {
          console.warn(`[Backfill] keyword_rankings query error for ${currentRunId} (${auditDate}):`, kwErr.message);
        } else if (keywords && keywords.length > 0) {
          keywords.forEach(k => {
            const citations = parseInt(k.ai_alan_citations_count, 10) || 0;
            const hasOverview = k.has_ai_overview === true || k.ai_overview_present_any === true;

            // Total (site) = all keywords
            aiAll.site.citations += citations;
            if (hasOverview) aiAll.site.overviewCount += 1;

            const inferred = inferSegmentFromBestUrl(k.best_url);
            if (inferred && aiAll[inferred]) {
              aiAll[inferred].citations += citations;
              if (hasOverview) aiAll[inferred].overviewCount += 1;
            }
            if (inferred === 'landing' || inferred === 'event' || inferred === 'product') {
              aiAll.money.citations += citations;
              if (hasOverview) aiAll.money.overviewCount += 1;
            }

            // Tracked subset (active cycles only) = keywords whose best_url matches a tracked URL pattern.
            const { path } = normalizeUrlForPathMatch(k.best_url);
            const isTrackedKeyword = trackedUrlPatterns.some(pattern => {
              if (!pattern) return true;
              return path.includes(pattern) || path.startsWith(pattern + '/');
            });

            if (isTrackedKeyword) {
              aiActive.site.citations += citations;
              if (hasOverview) aiActive.site.overviewCount += 1;

              aiAll.all_tracked.citations += citations;
              if (hasOverview) aiAll.all_tracked.overviewCount += 1;

              aiActive.all_tracked.citations += citations;
              if (hasOverview) aiActive.all_tracked.overviewCount += 1;

              if (inferred && aiActive[inferred]) {
                aiActive[inferred].citations += citations;
                if (hasOverview) aiActive[inferred].overviewCount += 1;
              }
              if (inferred === 'landing' || inferred === 'event' || inferred === 'product') {
                aiActive.money.citations += citations;
                if (hasOverview) aiActive.money.overviewCount += 1;
              }
            }
          });
        }
      } catch (aiErr) {
        console.warn(`[Backfill] AI metrics aggregation error for ${currentRunId}:`, aiErr.message);
      }

      const aiForScope = (scopeName) => (scopeName === 'active_cycles_only' ? aiActive : aiAll);

      const buildRowsForScope = (segmentPages, scopeName, applyCalibration) => {
        const segmentRows = [];
        const aiMap = aiForScope(scopeName);
        ['site', 'money', 'academy', 'landing', 'event', 'product', 'blog', 'other', 'all_tracked'].forEach(segment => {
          const segmentPageList = segmentPages[segment];
          if (segmentPageList.length === 0) {
            const ai = aiMap[segment] || { citations: 0, overviewCount: 0 };
            segmentRows.push({
              run_id: currentRunId,
              site_url: siteUrl,
              segment,
              scope: scopeName,
              date_start: dateStart,
              date_end: dateEnd,
              pages_count: 0,
              clicks_28d: 0,
              impressions_28d: 0,
              ctr_28d: 0,
              position_28d: null,
              ai_citations_28d: ai.citations,
              ai_overview_present_count: ai.overviewCount
            });
            return;
          }

          // Entire site (all_pages) should reflect the overview totals (gsc_timeseries).
          if (segment === 'site' && scopeName === 'all_pages' && overviewClicks !== null && overviewImpr !== null) {
            const ai = aiMap[segment] || { citations: 0, overviewCount: 0 };
            segmentRows.push({
              run_id: currentRunId,
              site_url: siteUrl,
              segment,
              scope: scopeName,
              date_start: dateStart,
              date_end: dateEnd,
              pages_count: segmentPageList.length,
              clicks_28d: overviewClicks,
              impressions_28d: overviewImpr,
              ctr_28d: overviewImpr > 0 ? (overviewClicks / overviewImpr) : 0,
              position_28d: overviewPos,
              ai_citations_28d: ai.citations,
              ai_overview_present_count: ai.overviewCount
            });
            return;
          }

          const totalClicks = segmentPageList.reduce((sum, p) => sum + (parseFloat(p.clicks_28d) || 0), 0);
          const totalImpressions = segmentPageList.reduce((sum, p) => sum + (parseFloat(p.impressions_28d) || 0), 0);
          const scaledClicks = applyCalibration ? (totalClicks * scaleClicks) : totalClicks;
          const scaledImpressions = applyCalibration ? (totalImpressions * scaleImpressions) : totalImpressions;
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
          const ai = aiMap[segment] || { citations: 0, overviewCount: 0 };

          segmentRows.push({
            run_id: currentRunId,
            site_url: siteUrl,
            segment,
            scope: scopeName,
            date_start: dateStart,
            date_end: dateEnd,
            pages_count: segmentPageList.length,
            clicks_28d: scaledClicks,
            impressions_28d: scaledImpressions,
            ctr_28d: ctr,
            position_28d: avgPosition,
            ai_citations_28d: ai.citations,
            ai_overview_present_count: ai.overviewCount
          });
        });
        return segmentRows;
      };

      // Ensure we have a "site" segment:
      // - all_pages.site represents the whole property (overview totals)
      // - active_cycles_only.site is equivalent to active_cycles_only.all_tracked (tracked subset)
      // Ensure "site" and "active site" consistency:
      // - all_pages.site represents the whole property (overview totals)
      // - active_cycles_only.site is equivalent to active_cycles_only.all_tracked (tracked subset)
      segmentPagesAll.site = pages;
      segmentPagesActive.site = segmentPagesActive.all_tracked;

      // Aggregate per scope
      const segmentRows = [
        ...buildRowsForScope(segmentPagesAll, 'all_pages', true),
        ...buildRowsForScope(segmentPagesActive, 'active_cycles_only', false)
      ];

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

