// /api/supabase/save-dashboard-subsegment-windows.js
// Build and persist Latest/7d/28d dashboard sub-segment rows from DB truth.

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

const toNum = (v) => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const toDateOnly = (v) => String(v || '').slice(0, 10);

const buildPropertyCandidates = (propertyUrl) => {
  const trimmed = String(propertyUrl || '').trim().replace(/\/$/, '');
  if (!trimmed) return [];
  const set = new Set([trimmed]);
  const hasProto = /^(https?:\/\/)/.test(trimmed);
  const withProto = hasProto ? trimmed : `https://${trimmed}`;
  set.add(withProto);
  if (withProto.includes('://www.')) {
    set.add(withProto.replace('://www.', '://'));
  } else {
    set.add(withProto.replace('://', '://www.'));
  }
  return Array.from(set);
};

const normaliseStoredPagePath = (raw) => {
  const v = String(raw || '').toLowerCase().trim();
  if (!v) return '/';
  if (v.startsWith('/')) return v.replace(/\/+$/, '') || '/';
  // gsc_page_timeseries.page_url is stored as a normalized path without host.
  return `/${v.replace(/\/+$/, '')}`;
};

const classifyMoneySubsegment = (rawPagePath) => {
  const p = normaliseStoredPagePath(rawPagePath);
  if (p.includes('/beginners-photography-lessons') || p.includes('/photographic-workshops-near-me')) return 'event';
  if (p.includes('/photo-workshops-uk') || p.includes('/photography-services-near-me')) return 'product';
  return 'landing';
};

const aggregateSiteWindow = (siteRows, startDate, endDate) => {
  let clicks = 0;
  let impressions = 0;
  let posWeighted = 0;
  let posImpr = 0;
  siteRows.forEach((r) => {
    const d = toDateOnly(r.date);
    if (d < startDate || d > endDate) return;
    const c = toNum(r.clicks);
    const i = toNum(r.impressions);
    const p = Number(r.position);
    clicks += c;
    impressions += i;
    if (Number.isFinite(p) && i > 0) {
      posWeighted += (p * i);
      posImpr += i;
    }
  });
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? (clicks / impressions) : 0,
    avgPosition: posImpr > 0 ? (posWeighted / posImpr) : null,
    posWeighted
  };
};

const aggregateMoneyWindow = (pageRows, startDate, endDate) => {
  const out = {
    landing: { clicks: 0, impressions: 0, posWeighted: 0 },
    event: { clicks: 0, impressions: 0, posWeighted: 0 },
    product: { clicks: 0, impressions: 0, posWeighted: 0 }
  };

  pageRows.forEach((r) => {
    const d = toDateOnly(r.date);
    if (d < startDate || d > endDate) return;
    const seg = classifyMoneySubsegment(r.page_url);
    const c = toNum(r.clicks);
    const i = toNum(r.impressions);
    const p = Number(r.position);
    out[seg].clicks += c;
    out[seg].impressions += i;
    if (Number.isFinite(p) && i > 0) out[seg].posWeighted += (p * i);
  });

  return out;
};

const buildRangeStart = (endDate, days) => {
  const d = new Date(`${toDateOnly(endDate)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return sendJSON(res, 200, { ok: true });
  if (req.method !== 'POST') return sendJSON(res, 405, { error: 'Method not allowed. Expected POST.' });

  try {
    const {
      siteUrl,
      runId,
      dateEnd = null,
      scope = 'all_pages'
    } = req.body || {};

    if (!siteUrl || !runId) {
      return sendJSON(res, 400, { error: 'Missing required fields: siteUrl, runId' });
    }

    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));

    // Read page counts from existing calibrated 28d segment table.
    const { data: segmentCountsRows } = await supabase
      .from('portfolio_segment_metrics_28d')
      .select('segment,pages_count')
      .eq('run_id', runId)
      .eq('site_url', siteUrl)
      .eq('scope', scope)
      .in('segment', ['site', 'landing', 'event', 'product']);

    const segmentCounts = { site: 0, landing: 0, event: 0, product: 0, other: 0 };
    (segmentCountsRows || []).forEach((r) => {
      segmentCounts[r.segment] = Number.parseInt(r.pages_count || 0, 10) || 0;
    });
    segmentCounts.other = Math.max(0, segmentCounts.site - segmentCounts.landing - segmentCounts.event - segmentCounts.product);

    const propertyCandidates = buildPropertyCandidates(siteUrl);
    const maxNeededStart = buildRangeStart(dateEnd || new Date().toISOString().slice(0, 10), 28);

    const { data: siteRows, error: siteErr } = await supabase
      .from('gsc_timeseries')
      .select('date,clicks,impressions,position')
      .eq('property_url', siteUrl)
      .gte('date', maxNeededStart)
      .order('date', { ascending: true });
    if (siteErr) throw new Error(`gsc_timeseries query failed: ${siteErr.message}`);
    if (!siteRows || siteRows.length === 0) {
      return sendJSON(res, 200, { success: true, inserted: 0, message: 'No gsc_timeseries data found' });
    }

    const latestSiteDate = toDateOnly(siteRows.at(-1)?.date);
    const effectiveEndDate = toDateOnly(dateEnd || latestSiteDate);
    const earliestNeeded = buildRangeStart(effectiveEndDate, 28);

    const { data: pageRows, error: pageErr } = await supabase
      .from('gsc_page_timeseries')
      .select('date,page_url,clicks,impressions,position')
      .in('property_url', propertyCandidates)
      .gte('date', earliestNeeded)
      .lte('date', effectiveEndDate);
    if (pageErr) throw new Error(`gsc_page_timeseries query failed: ${pageErr.message}`);

    const windows = [1, 7, 28];
    const rowsToUpsert = [];

    windows.forEach((days) => {
      const startDate = buildRangeStart(effectiveEndDate, days);
      const site = aggregateSiteWindow(siteRows, startDate, effectiveEndDate);
      const money = aggregateMoneyWindow(pageRows || [], startDate, effectiveEndDate);

      const moneyClicks = toNum(money.landing.clicks) + toNum(money.event.clicks) + toNum(money.product.clicks);
      const moneyImpr = toNum(money.landing.impressions) + toNum(money.event.impressions) + toNum(money.product.impressions);
      const moneyPosWeighted = toNum(money.landing.posWeighted) + toNum(money.event.posWeighted) + toNum(money.product.posWeighted);

      const otherClicks = Math.max(0, toNum(site.clicks) - moneyClicks);
      const otherImpr = Math.max(0, toNum(site.impressions) - moneyImpr);
      const otherCtr = otherImpr > 0 ? (otherClicks / otherImpr) : 0;
      const otherPos = otherImpr > 0 ? Math.max(0, (toNum(site.posWeighted) - moneyPosWeighted) / otherImpr) : null;

      const base = {
        run_id: runId,
        site_url: siteUrl,
        scope,
        window_days: days,
        date_start: startDate,
        date_end: effectiveEndDate
      };

      const buildSegmentRow = (segment, values, pagesCount) => ({
        ...base,
        segment,
        pages_count: pagesCount,
        clicks: toNum(values.clicks),
        impressions: toNum(values.impressions),
        ctr: toNum(values.impressions) > 0 ? (toNum(values.clicks) / toNum(values.impressions)) : 0,
        avg_position: values.avgPosition ?? null
      });

      rowsToUpsert.push(
        buildSegmentRow('landing', {
          clicks: money.landing.clicks,
          impressions: money.landing.impressions,
          avgPosition: toNum(money.landing.impressions) > 0 ? (toNum(money.landing.posWeighted) / toNum(money.landing.impressions)) : null
        }, segmentCounts.landing),
        buildSegmentRow('event', {
          clicks: money.event.clicks,
          impressions: money.event.impressions,
          avgPosition: toNum(money.event.impressions) > 0 ? (toNum(money.event.posWeighted) / toNum(money.event.impressions)) : null
        }, segmentCounts.event),
        buildSegmentRow('product', {
          clicks: money.product.clicks,
          impressions: money.product.impressions,
          avgPosition: toNum(money.product.impressions) > 0 ? (toNum(money.product.posWeighted) / toNum(money.product.impressions)) : null
        }, segmentCounts.product),
        buildSegmentRow('other', {
          clicks: otherClicks,
          impressions: otherImpr,
          avgPosition: otherPos,
          ctr: otherCtr
        }, segmentCounts.other)
      );
    });

    const { error: upsertErr } = await supabase
      .from('dashboard_subsegment_windows')
      .upsert(rowsToUpsert, {
        onConflict: 'run_id,site_url,scope,window_days,segment',
        ignoreDuplicates: false
      });
    if (upsertErr) throw new Error(`dashboard_subsegment_windows upsert failed: ${upsertErr.message}`);

    return sendJSON(res, 200, {
      success: true,
      inserted: rowsToUpsert.length,
      runId,
      siteUrl,
      dateEnd: effectiveEndDate
    });
  } catch (err) {
    console.error('[save-dashboard-subsegment-windows] error:', err);
    return sendJSON(res, 500, { error: err.message || 'Internal error' });
  }
}

