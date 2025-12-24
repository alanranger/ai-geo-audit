// /api/supabase/backfill-ai-portfolio-segments.js
// Backfill AI citations and AI overview data to portfolio_segment_metrics_28d from keyword_rankings

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

// Map audit_date to run_id format(s).
// We can have BOTH:
// - daily snapshots: run_id=YYYY-MM-DD (normal audits)
// - monthly snapshots: run_id=YYYY-MM (historical backfills)
// Return all run_ids that exist for this site so we update whichever rows the UI will pick.
async function findMatchingRunIds(supabase, auditDate, siteUrl) {
  if (!auditDate) return [];
  const date = new Date(auditDate);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const monthlyRunId = `${year}-${month}`;
  const dailyRunId = `${year}-${month}-${day}`;

  const out = [];
  const checkExists = async (runId) => {
    const { data } = await supabase
      .from('portfolio_segment_metrics_28d')
      .select('run_id')
      .eq('run_id', runId)
      .eq('site_url', siteUrl)
      .limit(1);
    return !!(data && data.length > 0);
  };

  // Prefer daily first (most current), but include monthly if it exists too.
  if (await checkExists(dailyRunId)) out.push(dailyRunId);
  if (await checkExists(monthlyRunId)) out.push(monthlyRunId);

  // If nothing exists, still return the daily run_id as a sensible default for logging
  if (out.length === 0) out.push(dailyRunId);
  return out;
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
      const runIds = await findMatchingRunIds(supabase, currentAuditDate, targetSiteUrl);

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

      const normalizeUrl = (u) => {
        if (!u) return '';
        let s = String(u).trim().toLowerCase();
        // Strip query params
        s = s.split('?')[0];
        // Strip hash
        s = s.split('#')[0];
        // Remove trailing slash
        s = s.replace(/\/$/, '');
        return s;
      };

      // Get tracked URLs for all_tracked segment
      const { data: tasks } = await supabase
        .from('optimisation_tasks')
        .select('target_url, status, cycle_active')
        .in('status', ['in_progress', 'monitoring', 'planned'])
        .gt('cycle_active', 0)
        .not('target_url', 'is', null);
      
      const trackedUrls = new Set();
      if (tasks) {
        tasks.forEach(t => {
          if (t.target_url) {
            // Normalize URL for matching
            const url = normalizeUrl(t.target_url);
            trackedUrls.add(url);
          }
        });
      }

      const getCitedUrls = (row) => {
        const raw = row?.ai_alan_citations;
        if (!raw) return [];
        if (!Array.isArray(raw)) return [];
        return raw
          .map(v => {
            if (!v) return null;
            if (typeof v === 'string') return v;
            if (typeof v === 'object' && v.url) return v.url;
            return null;
          })
          .filter(Boolean);
      };

      // Classify citations by cited URL (not by best_url).
      // This matches the user intent: see which page segments are truly being cited.
      const classifyCitedUrlToSegments = (url) => {
        if (!url) return [];
        const u = normalizeUrl(url);
        // Only count citations to our domain
        if (!u.includes('alanranger.com')) return [];

        // Academy override (single URL)
        if (u.includes('/free-online-photography-course')) {
          return ['academy'];
        }

        // Blog
        if (u.includes('/blog-on-photography/')) {
          return ['blog'];
        }

        // Money pages (landing/event/product)
        try {
          const main = classifySitePageSegment(url);
          if (main !== PageSegment.MONEY) return [];
        } catch {
          // If classifier fails, be conservative and do not count it as money.
          return [];
        }

        // Use the same heuristics as the money pages segmenter
        const lower = u;
        if (lower.includes('/beginners-photography-lessons') || lower.includes('/photographic-workshops-near-me')) {
          return ['event', 'money'];
        }
        if (lower.includes('/photo-workshops-uk') || lower.includes('/photography-services-near-me')) {
          return ['product', 'money'];
        }
        return ['landing', 'money'];
      };

      // Aggregate AI metrics per segment
      const segments = ['site', 'money', 'academy', 'landing', 'event', 'product', 'blog', 'all_tracked'];
      const scopes = ['all_pages', 'active_cycles_only'];

      const initCounts = () => ({
        citations: Object.fromEntries(segments.map(s => [s, 0])),
        overviewKeywords: Object.fromEntries(segments.map(s => [s, 0]))
      });

      const countsAll = initCounts();
      const countsTracked = initCounts();

      // For each keyword, distribute citations to segments based on cited URLs.
      keywords.forEach(k => {
        const hasOverview = k.has_ai_overview === true || k.ai_overview_present_any === true;
        const citationCount = parseInt(k.ai_alan_citations_count, 10) || 0;
        const citedUrls = getCitedUrls(k);

        // Site overview count = keywords with overview present (regardless of citations)
        if (hasOverview) {
          countsAll.overviewKeywords.site += 1;
          countsTracked.overviewKeywords.site += 1;
        }
        
        // Site citation total should match Ranking & AI summary (uses ai_alan_citations_count).
        // Note: ai_alan_citations array can sometimes be shorter than ai_alan_citations_count (e.g. dedup/truncation),
        // so per-segment attribution uses the array, but site total uses the count field.
        countsAll.citations.site += citationCount;

        // Track which segments were cited for this keyword (for overview keyword counts)
        const citedSegsAll = new Set();
        const citedSegsTracked = new Set();

        citedUrls.forEach(citedUrl => {
          const segs = classifyCitedUrlToSegments(citedUrl); // may include money rollup
          if (!segs || segs.length === 0) return;

          // Count as a citation for each inferred segment
          segs.forEach(seg => {
            if (!countsAll.citations[seg] && countsAll.citations[seg] !== 0) return;
            countsAll.citations[seg] += 1;
            citedSegsAll.add(seg);
          });

          // Tracked subset: only count citations where the cited URL is a tracked task URL
          const citedNorm = normalizeUrl(citedUrl);
          const isTrackedUrl = trackedUrls.has(citedNorm);
          if (isTrackedUrl) {
            segs.forEach(seg => {
              if (!countsTracked.citations[seg] && countsTracked.citations[seg] !== 0) return;
              countsTracked.citations[seg] += 1;
              citedSegsTracked.add(seg);
            });
            // For tracked subset, we only have per-URL citation attribution available.
            countsTracked.citations.site += 1;
            countsTracked.citations.all_tracked += 1;
          }
        });

        // all_tracked keyword count: if any cited URL is tracked
        if (hasOverview && citedSegsTracked.size > 0) {
          countsTracked.overviewKeywords.all_tracked += 1;
        }

        // For overview keyword counts per segment: count keyword once per segment that appears in its citations
        if (hasOverview) {
          citedSegsAll.forEach(seg => {
            if (!countsAll.overviewKeywords[seg] && countsAll.overviewKeywords[seg] !== 0) return;
            countsAll.overviewKeywords[seg] += 1;
          });
          citedSegsTracked.forEach(seg => {
            if (!countsTracked.overviewKeywords[seg] && countsTracked.overviewKeywords[seg] !== 0) return;
            countsTracked.overviewKeywords[seg] += 1;
          });
        }
      });

      const updates = [];
      for (const runId of runIds) {
        const { data: existingRows, error: existingErr } = await supabase
          .from('portfolio_segment_metrics_28d')
          .select('segment, scope')
          .eq('run_id', runId)
          .eq('site_url', targetSiteUrl)
          .in('segment', segments)
          .in('scope', scopes);

        if (existingErr) {
          console.error(`[Backfill AI] Error loading portfolio rows for ${runId}:`, existingErr);
          updates.push({ runId, success: false, error: existingErr.message });
          continue;
        }

        const existingSet = new Set((existingRows || []).map(r => `${r.segment}::${r.scope}`));
        for (const seg of segments) {
          for (const scope of scopes) {
            if (!existingSet.has(`${seg}::${scope}`)) continue;
            const source = scope === 'active_cycles_only' ? countsTracked : countsAll;
            const totalCitations = source.citations[seg] || 0;
            const overviewCount = source.overviewKeywords[seg] || 0;

            const { error: updateError } = await supabase
              .from('portfolio_segment_metrics_28d')
              .update({
                ai_citations_28d: totalCitations,
                ai_overview_present_count: overviewCount
              })
              .eq('run_id', runId)
              .eq('site_url', targetSiteUrl)
              .eq('segment', seg)
              .eq('scope', scope);

            if (updateError) {
              console.error(`[Backfill AI] Error updating ${seg} (${scope}) for ${runId}:`, updateError);
              updates.push({ runId, segment: seg, scope, success: false, error: updateError.message });
            } else {
              updates.push({ runId, segment: seg, scope, success: true, citations: totalCitations, overviewCount });
              totalUpdated++;
            }
          }
        }
      }

      results.push({
        auditDate: currentAuditDate,
        runIds,
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

