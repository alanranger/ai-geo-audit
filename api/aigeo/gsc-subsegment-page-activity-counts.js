/**
 * GSC Sub-segment Page Activity Counts API
 *
 * Returns real unique page activity counts for a date range by dashboard sub-segment:
 * - landing, event, product, other
 * For each segment:
 *   - clickPages: unique pages with clicks > 0
 *   - impressionPages: unique pages with impressions > 0
 */

import { createClient } from '@supabase/supabase-js';
import { getGSCAccessToken, normalizePropertyUrl, parseDateRange } from './utils.js';
import { classifyPageSegment, PageSegment } from './pageSegment.js';
import { isRowIndexable } from '../../lib/page-indexability-policy.js';

const need = (key) => {
  const v = process.env[key];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${key}`);
  return v;
};

const normalisePageUrl = (rawUrl, fallbackSiteUrl) => {
  try {
    const base = normalizePropertyUrl(fallbackSiteUrl || '');
    const u = new URL(String(rawUrl || ''), base);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();
    let path = (u.pathname || '/').toLowerCase();
    path = path.replace(/\/+$/, '') || '/';
    return `https://${host}${path}`;
  } catch {
    return String(rawUrl || '').trim().toLowerCase();
  }
};

const classifyMoneySubsegment = (url) => {
  const u = String(url || '').toLowerCase();
  if (u.includes('/beginners-photography-lessons') || u.includes('/photographic-workshops-near-me')) return 'event';
  if (u.includes('/photo-workshops-uk') || u.includes('/photography-services-near-me')) return 'product';
  return 'landing';
};

const getDashboardSubsegment = (url) => {
  try {
    const main = classifyPageSegment(url);
    if (main !== PageSegment.MONEY) return 'other';
    return classifyMoneySubsegment(url);
  } catch {
    return 'other';
  }
};

function slugFromPageUrl(pageUrl) {
  try {
    const u = new URL(String(pageUrl || ''), 'https://x/');
    const p = (u.pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';
    return p === '/' ? '' : p.replace(/^\/+/, '');
  } catch {
    return String(pageUrl || '').toLowerCase().replace(/^\/+/, '');
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

function policyRowForPage(pageUrl, policyBySlug, periodStart) {
  const pol = policyBySlug.get(slugFromPageUrl(pageUrl)) || {};
  return {
    page_url: pageUrl,
    period_start: periodStart,
    policy_value: pol.policy_value ?? null,
    policy_effective_date: pol.policy_effective_date ?? null
  };
}

function emptySegmentSets() {
  return {
    landing: new Set(),
    event: new Set(),
    product: new Set(),
    other: new Set()
  };
}

function toSegmentCounts(segment, sets) {
  return {
    clickPages: sets.click[segment].size,
    impressionPages: sets.impression[segment].size,
    clickPages_indexable: sets.clickIndexable[segment].size,
    impressionPages_indexable: sets.impressionIndexable[segment].size,
    rows_total_count: sets.allPages[segment].size,
    rows_indexable_count: sets.indexablePages[segment].size
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({
      status: 'error',
      source: 'gsc-subsegment-page-activity-counts',
      message: 'Method not allowed. Use GET.',
      meta: { generatedAt: new Date().toISOString() }
    });
  }

  try {
    const { property } = req.query;
    if (!property) {
      return res.status(400).json({
        status: 'error',
        source: 'gsc-subsegment-page-activity-counts',
        message: 'Missing required parameter: property',
        meta: { generatedAt: new Date().toISOString() }
      });
    }

    const { startDate, endDate } = parseDateRange(req);
    const siteUrl = normalizePropertyUrl(property);
    const periodStart = `${String(endDate).slice(0, 7)}-01`;
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    const policyBySlug = await fetchPolicyBySlug(supabase, siteUrl);
    const accessToken = await getGSCAccessToken();
    const searchConsoleUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;

    const sets = {
      click: emptySegmentSets(),
      impression: emptySegmentSets(),
      clickIndexable: emptySegmentSets(),
      impressionIndexable: emptySegmentSets(),
      allPages: emptySegmentSets(),
      indexablePages: emptySegmentSets()
    };

    const rowLimit = 25000;
    let startRow = 0;
    let fetchedRows = 0;

    while (true) {
      const response = await fetch(searchConsoleUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          startDate,
          endDate,
          dimensions: ['page'],
          rowLimit,
          startRow
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(response.status).json({
          status: 'error',
          source: 'gsc-subsegment-page-activity-counts',
          message: 'Failed to fetch Search Console page activity',
          details: errorText,
          meta: { generatedAt: new Date().toISOString() }
        });
      }

      const data = await response.json();
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      if (rows.length === 0) break;

      rows.forEach((row) => {
        const rawPage = row?.keys?.[0] || '';
        const pageUrl = normalisePageUrl(rawPage, siteUrl);
        const segment = getDashboardSubsegment(pageUrl);
        const clicks = Number(row?.clicks || 0);
        const impressions = Number(row?.impressions || 0);
        const indexable = isRowIndexable(policyRowForPage(pageUrl, policyBySlug, periodStart));

        sets.allPages[segment].add(pageUrl);
        if (indexable) sets.indexablePages[segment].add(pageUrl);
        if (clicks > 0) {
          sets.click[segment].add(pageUrl);
          if (indexable) sets.clickIndexable[segment].add(pageUrl);
        }
        if (impressions > 0) {
          sets.impression[segment].add(pageUrl);
          if (indexable) sets.impressionIndexable[segment].add(pageUrl);
        }
      });

      fetchedRows += rows.length;
      if (rows.length < rowLimit) break;
      startRow += rowLimit;
    }

    return res.status(200).json({
      status: 'ok',
      source: 'gsc-subsegment-page-activity-counts',
      params: { property: siteUrl, startDate, endDate },
      data: {
        landing: toSegmentCounts('landing', sets),
        event: toSegmentCounts('event', sets),
        product: toSegmentCounts('product', sets),
        other: toSegmentCounts('other', sets)
      },
      meta: {
        fetchedRows,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    return res.status(500).json({
      status: 'error',
      source: 'gsc-subsegment-page-activity-counts',
      message: error.message || 'Unknown error',
      meta: { generatedAt: new Date().toISOString() }
    });
  }
}
