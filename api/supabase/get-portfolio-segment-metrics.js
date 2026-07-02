// /api/supabase/get-portfolio-segment-metrics.js
// Fetch portfolio segment-level 28d metrics from Supabase

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { isRowIndexable } from '../../lib/page-indexability-policy.js';
import { classifyPageSegment as classifySitePageSegment, PageSegment } from '../aigeo/pageSegment.js';

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

const sendJSON = (res, status, obj) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(obj));
};

function classifyMoneySubSegment(pageUrl) {
  if (!pageUrl || typeof pageUrl !== 'string') return null;
  if (classifySitePageSegment(pageUrl) !== PageSegment.MONEY) return null;
  const urlLower = pageUrl.toLowerCase();
  if (urlLower.includes('/beginners-photography-lessons') ||
      urlLower.includes('/photographic-workshops-near-me')) return 'event';
  if (urlLower.includes('/photo-workshops-uk') ||
      urlLower.includes('/photography-services-near-me')) return 'product';
  return 'landing';
}

function slugFromPageUrl(pageUrl) {
  const urlLower = String(pageUrl || '').toLowerCase();
  try {
    const u = new URL(urlLower, 'https://x/');
    const p = (u.pathname || '/').replace(/\/+$/, '') || '/';
    return p === '/' ? '' : p.replace(/^\/+/, '');
  } catch {
    return urlLower.replace(/^https?:\/\/[^/]+/, '').replace(/^\/+/, '').replace(/\/+$/, '');
  }
}

async function fetchPolicyBySlug(supabase, propertyUrl) {
  const pageSize = 1000;
  const map = new Map();
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from('revenue_gsc_joined_with_policy')
      .select('page_slug, policy_value, policy_effective_date')
      .eq('property_url', propertyUrl)
      .order('page_slug', { ascending: true })
      .order('period_start', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const batch = data || [];
    for (const row of batch) {
      if (!map.has(row.page_slug)) {
        map.set(row.page_slug, {
          policy_value: row.policy_value ?? null,
          policy_effective_date: row.policy_effective_date ?? null
        });
      }
    }
    if (batch.length < pageSize) break;
    from += pageSize;
  }
  return map;
}

function enrichPages(pages, policyBySlug, periodStart) {
  return (pages || []).map((row) => {
    const pol = policyBySlug.get(slugFromPageUrl(row.page_url)) || {};
    return {
      ...row,
      period_start: periodStart,
      policy_value: pol.policy_value ?? null,
      policy_effective_date: pol.policy_effective_date ?? null
    };
  });
}

async function fetchRunPages(supabase, runId, dateStart, dateEnd) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    let q = supabase
      .from('gsc_page_metrics_28d')
      .select('*')
      .eq('run_id', runId)
      .order('page_url', { ascending: true })
      .range(from, from + pageSize - 1);
    if (dateStart) q = q.eq('date_start', dateStart);
    if (dateEnd) q = q.eq('date_end', dateEnd);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function loadRunBundle(supabase, runId, dateStart, dateEnd, policyBySlug, cache) {
  const cacheKey = `${runId}|${dateStart}|${dateEnd}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const pages = await fetchRunPages(supabase, runId, dateStart, dateEnd);
  if (!pages.length) {
    cache.set(cacheKey, null);
    return null;
  }
  const siteUrl = pages[0].site_url;
  const periodStart = `${String(dateEnd).slice(0, 7)}-01`;
  const enriched = enrichPages(pages, policyBySlug, periodStart);

  let scaleClicks = 1;
  let scaleImpressions = 1;
  let overview = null;
  const { data: tsRows } = await supabase
    .from('gsc_timeseries')
    .select('clicks, impressions, position')
    .eq('property_url', siteUrl)
    .gte('date', String(dateStart).slice(0, 10))
    .lte('date', String(dateEnd).slice(0, 10));
  if (tsRows?.length) {
    const overviewClicks = tsRows.reduce((s, r) => s + (parseFloat(r.clicks) || 0), 0);
    const overviewImpr = tsRows.reduce((s, r) => s + (parseFloat(r.impressions) || 0), 0);
    let posWeight = 0;
    let posImpr = 0;
    tsRows.forEach((r) => {
      const impr = parseFloat(r.impressions) || 0;
      const pos = parseFloat(r.position);
      if (impr > 0 && Number.isFinite(pos) && pos > 0) {
        posWeight += pos * impr;
        posImpr += impr;
      }
    });
    overview = {
      clicks: overviewClicks,
      impressions: overviewImpr,
      position: posImpr > 0 ? posWeight / posImpr : null
    };
    const rawClicks = pages.reduce((s, p) => s + (parseFloat(p.clicks_28d) || 0), 0);
    const rawImpr = pages.reduce((s, p) => s + (parseFloat(p.impressions_28d) || 0), 0);
    if (overviewClicks > 0 && rawClicks > 0) scaleClicks = overviewClicks / rawClicks;
    if (overviewImpr > 0 && rawImpr > 0) scaleImpressions = overviewImpr / rawImpr;
  }

  const bundle = { enriched, overview, scaleClicks, scaleImpressions, siteUrl, dateStart, dateEnd };
  cache.set(cacheKey, bundle);
  return bundle;
}

function pagesForSegment(enriched, segment) {
  const out = [];
  enriched.forEach((page) => {
    const urlLower = String(page.page_url || '').toLowerCase();
    const isBlog = urlLower.includes('/blog-on-photography/');
    const isAcademy = urlLower.includes('/free-online-photography-course');
    const sub = classifyMoneySubSegment(page.page_url);
    const isOther = !sub && !isBlog && !isAcademy;
    if (segment === 'site') out.push(page);
    else if (segment === 'blog' && isBlog) out.push(page);
    else if (segment === 'academy' && isAcademy) out.push(page);
    else if (segment === 'other' && isOther) out.push(page);
    else if (segment === 'money' && sub) out.push(page);
    else if (sub === segment) out.push(page);
  });
  return out;
}

function computeSegmentKpis(segmentPages, bundle, segment, scope) {
  const applyCalibration = scope === 'all_pages';
  if (segment === 'site' && scope === 'all_pages' && bundle.overview) {
    return {
      pages_count: segmentPages.length,
      clicks_28d: bundle.overview.clicks,
      impressions_28d: bundle.overview.impressions,
      ctr_28d: bundle.overview.impressions > 0 ? bundle.overview.clicks / bundle.overview.impressions : 0,
      position_28d: bundle.overview.position
    };
  }
  const totalClicks = segmentPages.reduce((s, p) => s + (parseFloat(p.clicks_28d) || 0), 0);
  const totalImpr = segmentPages.reduce((s, p) => s + (parseFloat(p.impressions_28d) || 0), 0);
  const clicks = applyCalibration ? totalClicks * bundle.scaleClicks : totalClicks;
  const impr = applyCalibration ? totalImpr * bundle.scaleImpressions : totalImpr;
  let posWeight = 0;
  let posImpr = 0;
  segmentPages.forEach((p) => {
    const impressions = parseFloat(p.impressions_28d) || 0;
    const position = parseFloat(p.position_28d);
    if (position && impressions > 0) {
      posWeight += position * impressions;
      posImpr += impressions;
    }
  });
  return {
    pages_count: segmentPages.length,
    clicks_28d: clicks,
    impressions_28d: impr,
    ctr_28d: impr > 0 ? clicks / impr : 0,
    position_28d: posImpr > 0 ? posWeight / posImpr : null
  };
}

function appendIndexableFields(metric, indexableKpis, rowCounts) {
  const kpiKeys = ['pages_count', 'clicks_28d', 'impressions_28d', 'ctr_28d', 'position_28d'];
  const out = { ...metric };
  for (const key of kpiKeys) out[`${key}_indexable`] = indexableKpis[key];
  out.ai_citations_28d_indexable = metric.ai_citations_28d;
  out.ai_overview_present_count_indexable = metric.ai_overview_present_count;
  out.rows_total_count = rowCounts.total;
  out.rows_indexable_count = rowCounts.indexable;
  return out;
}

async function enrichMetricsWithIndexable(supabase, metrics, siteUrl) {
  const runCache = new Map();
  const policyBySlug = await fetchPolicyBySlug(supabase, siteUrl);
  const runKeys = [...new Map((metrics || []).map((m) => [
    `${m.run_id}|${m.date_start}|${m.date_end}`,
    { runId: m.run_id, dateStart: m.date_start, dateEnd: m.date_end }
  ])).values()];
  await Promise.all(runKeys.map(({ runId, dateStart, dateEnd }) =>
    loadRunBundle(supabase, runId, dateStart, dateEnd, policyBySlug, runCache)
  ));

  return (metrics || []).map((metric) => {
    const bundle = runCache.get(`${metric.run_id}|${metric.date_start}|${metric.date_end}`);
    if (!bundle) {
      return appendIndexableFields(metric, {
        pages_count: metric.pages_count,
        clicks_28d: metric.clicks_28d,
        impressions_28d: metric.impressions_28d,
        ctr_28d: metric.ctr_28d,
        position_28d: metric.position_28d
      }, { total: metric.pages_count || 0, indexable: metric.pages_count || 0 });
    }
    const segmentPages = pagesForSegment(bundle.enriched, metric.segment);
    const indexablePages = segmentPages.filter(isRowIndexable);
    const indexableKpis = computeSegmentKpis(indexablePages, bundle, metric.segment, metric.scope);
    return appendIndexableFields(metric, indexableKpis, {
      total: segmentPages.length,
      indexable: indexablePages.length
    });
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return sendJSON(res, 405, { error: `Method not allowed. Received: ${req.method}, Expected: GET` });
  }

  try {
    const { 
      siteUrl,
      scope,
      segment,
      from,
      to,
      limit,
      order = 'desc'
    } = req.query;

    if (!siteUrl) {
      return sendJSON(res, 400, { error: 'Missing required field: siteUrl' });
    }

    const supabase = createClient(
      need('SUPABASE_URL'),
      need('SUPABASE_SERVICE_ROLE_KEY')
    );

    const toDateOnly = (v) => {
      if (!v) return null;
      const s = String(v);
      if (s.length >= 10) return s.slice(0, 10);
      return s;
    };

    let query = supabase
      .from('portfolio_segment_metrics_28d')
      .select('*')
      .eq('site_url', siteUrl);

    if (scope) query = query.eq('scope', scope);
    if (segment) query = query.eq('segment', segment);
    const fromDate = toDateOnly(from);
    const toDate = toDateOnly(to);
    if (fromDate) query = query.gte('date_end', fromDate);
    if (toDate) query = query.lte('date_end', toDate);

    query = query
      .order('date_end', { ascending: order === 'asc' })
      .order('created_at', { ascending: order === 'asc' });

    if (limit) {
      const limitNum = parseInt(limit, 10);
      if (limitNum > 0) query = query.limit(limitNum);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[Get Portfolio Segment Metrics] Query error:', error);
      if (error.message && error.message.includes('does not exist')) {
        return sendJSON(res, 200, { metrics: [], count: 0, message: 'Table not found - migration may not be applied yet' });
      }
      return sendJSON(res, 500, { error: error.message });
    }

    const skipIndexable = ['1', 'true', 'yes'].includes(String(req.query.skipIndexable || '').toLowerCase());
    const metrics = skipIndexable
      ? (data || [])
      : await enrichMetricsWithIndexable(supabase, data || [], siteUrl);

    return sendJSON(res, 200, { 
      metrics,
      count: metrics.length
    });

  } catch (err) {
    console.error('[Get Portfolio Segment Metrics] Error:', err);
    if (err.message && err.message.includes('does not exist')) {
      return sendJSON(res, 200, { metrics: [], count: 0, message: 'Table not found - migration may not be applied yet' });
    }
    return sendJSON(res, 500, { error: err.message });
  }
}
