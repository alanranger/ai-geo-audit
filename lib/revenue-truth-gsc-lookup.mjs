/** GSC clicks/CTR lookup for Revenue Truth §4b/§4c breakdown tables. */

import { normalizePageSlug } from './revenue-tier-mapping.js';
import { slugFromCanonicalUrl } from './revenue-stream-gsc-roles.js';

export const GSC_FIRST_DAY = '2025-01-13';

export function lastClosedMonthKeys(currentYear, currentMonth, count = 3) {
  const keys = [];
  let y = Number(currentYear);
  let m = Number(currentMonth) - 1;
  if (m < 1) {
    y -= 1;
    m = 12;
  }
  while (keys.length < count) {
    keys.push(`${y}-${String(m).padStart(2, '0')}-01`);
    m -= 1;
    if (m < 1) {
      y -= 1;
      m = 12;
    }
  }
  return keys;
}

export function gscTotalsForMonths(cell, monthKeys) {
  const want = new Set(monthKeys || []);
  let clicks = 0;
  let impressions = 0;
  for (const row of cell?.monthly_series || []) {
    if (!want.has(row.period_start)) continue;
    clicks += Number(row.clicks) || 0;
    impressions += Number(row.impressions) || 0;
  }
  return {
    clicks,
    impressions,
    ctr_pct: impressions > 0 ? round2(100 * clicks / impressions) : null
  };
}

export function slugForProductFinding(f) {
  return slugFromCanonicalUrl(f.meta?.product_url)
    || slugFromCanonicalUrl(f.meta?.service_page_url);
}

export function slugFromLandingUrl(url) {
  const slug = String(url || '').replace(/^https?:\/\/[^/]+/i, '');
  return normalizePageSlug(slug);
}

export function slugForPageFinding(f) {
  return slugFromLandingUrl(f.unit_id);
}

export function collectBreakdownSlugs(findings) {
  const slugs = new Set();
  for (const f of findings?.products?.all || []) {
    const s = slugForProductFinding(f);
    if (s) slugs.add(s);
  }
  for (const f of findings?.pages?.all || []) {
    const s = slugForPageFinding(f);
    if (s) slugs.add(s);
  }
  return [...slugs];
}

export async function fetchGscTotalsBySlug(supabase, propertyUrl, slugs) {
  const out = new Map();
  if (!slugs?.length) return out;
  const pageSize = 1000;
  for (let i = 0; i < slugs.length; i += 150) {
    const chunk = slugs.slice(i, i + 150);
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from('gsc_page_timeseries')
        .select('page_url, date, impressions, clicks')
        .eq('property_url', propertyUrl)
        .gte('date', GSC_FIRST_DAY)
        .in('page_url', chunk)
        .range(from, from + pageSize - 1);
      if (error) throw error;
      const batch = data || [];
      for (const row of batch) {
        const slug = normalizePageSlug(row.page_url);
        if (!slug) continue;
        let cell = out.get(slug);
        if (!cell) {
          cell = { impressions: 0, clicks: 0, monthly: new Map() };
          out.set(slug, cell);
        }
        const imp = Number(row.impressions) || 0;
        const clicks = Number(row.clicks) || 0;
        cell.impressions += imp;
        cell.clicks += clicks;
        const periodStart = String(row.date || '').slice(0, 7) + '-01';
        let month = cell.monthly.get(periodStart);
        if (!month) {
          month = { period_start: periodStart, impressions: 0, clicks: 0 };
          cell.monthly.set(periodStart, month);
        }
        month.impressions += imp;
        month.clicks += clicks;
      }
      if (batch.length < pageSize) break;
      from += pageSize;
    }
  }
  for (const cell of out.values()) {
    cell.monthly_series = [...cell.monthly.values()]
      .sort((a, b) => String(a.period_start).localeCompare(String(b.period_start)));
    delete cell.monthly;
  }
  return out;
}

function attachOneFinding(f, slug, gscBySlug, monthKeys) {
  const cell = slug ? gscBySlug.get(slug) : null;
  f.gsc_last_3mo = {
    slug: slug || null,
    ...gscTotalsForMonths(cell, monthKeys)
  };
}

export function attachGscToFindings(findings, gscBySlug, monthKeys) {
  for (const f of findings?.products?.all || []) {
    attachOneFinding(f, slugForProductFinding(f), gscBySlug, monthKeys);
  }
  for (const f of findings?.pages?.all || []) {
    attachOneFinding(f, slugForPageFinding(f), gscBySlug, monthKeys);
  }
  findings.gsc_overlay = {
    month_keys: monthKeys,
    source: 'gsc_page_timeseries',
    note: 'GSC clicks/CTR = last 3 closed calendar months on matched page slug.'
  };
  return findings;
}

function round2(n) {
  return Number((Number(n) || 0).toFixed(2));
}
