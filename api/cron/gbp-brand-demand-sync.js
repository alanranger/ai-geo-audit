/**
 * Refresh current-month GBP Performance + GSC branded query monthly.
 * Used by: nightly cron, GSC & Backlink Audit button, Dashboard full refresh.
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { createClient } from '@supabase/supabase-js';
import {
  resolveGbpLocation,
  fetchPerformanceMonthly,
  fetchDiscoveryTermsForMonth,
  withGbpToken,
} from '../../lib/gbp/performance.js';
import { getGSCAccessToken } from '../aigeo/utils.js';

const PROPERTY = 'https://www.alanranger.com';
const BRAND_TERMS = ['alan ranger', 'alanranger', 'alan ranger photography'];

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(status).send(JSON.stringify(body));
};

const need = (key) => {
  const v = process.env[key];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${key}`);
  return v;
};

function authoriseRequest(req) {
  if (req.method === 'POST') return true;
  if (req.method === 'GET' && String(req.headers['x-vercel-cron'] || '') === '1') return true;
  const secret = process.env.CRON_SECRET;
  if (secret && (req.headers['x-cron-secret'] === secret || req.query?.secret === secret)) return true;
  return false;
}

function isBrandQuery(query) {
  if (!query || typeof query !== 'string') return false;
  const q = query.toLowerCase();
  return BRAND_TERMS.some((term) => q.includes(term));
}

function monthBounds() {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2);
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  return {
    year: end.getUTCFullYear(),
    month: end.getUTCMonth() + 1,
    startIso: start.toISOString().slice(0, 10),
    endIso: end.toISOString().slice(0, 10),
    monthIso: `${end.getUTCFullYear()}-${String(end.getUTCMonth() + 1).padStart(2, '0')}-01`,
  };
}

async function refreshGscBrandMonth(supabase, bounds) {
  const token = await getGSCAccessToken();
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(PROPERTY)}/searchAnalytics/query`;
  const body = {
    startDate: bounds.startIso,
    endDate: bounds.endIso,
    dimensions: ['query'],
    rowLimit: 25000,
    startRow: 0,
    dataState: 'final',
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`gsc ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  const rows = j.rows || [];

  let totalImp = 0;
  let brandImp = 0;
  let brandClicks = 0;
  let brandPosWeighted = 0;
  const brandQueries = [];

  for (const row of rows) {
    const query = row.keys?.[0] || '';
    const impressions = Math.trunc(row.impressions ?? 0);
    const clicks = Math.trunc(row.clicks ?? 0);
    const position = row.position == null ? null : Number(row.position);
    totalImp += impressions;
    if (!isBrandQuery(query)) continue;
    brandImp += impressions;
    brandClicks += clicks;
    if (position != null) brandPosWeighted += position * impressions;
    brandQueries.push({ query, impressions, clicks, position });
  }
  brandQueries.sort((a, b) => b.impressions - a.impressions);

  const payload = {
    property_url: PROPERTY,
    month: bounds.monthIso,
    brand_impressions: brandImp,
    brand_clicks: brandClicks,
    brand_ctr: brandImp > 0 ? brandClicks / brandImp : 0,
    brand_avg_position: brandImp > 0 ? brandPosWeighted / brandImp : null,
    total_query_impressions: totalImp,
    brand_share: totalImp > 0 ? brandImp / totalImp : 0,
    distinct_brand_queries: brandQueries.length,
    top_brand_queries: brandQueries.slice(0, 15),
    fetched_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('gsc_brand_query_monthly').upsert(payload, {
    onConflict: 'property_url,month',
  });
  if (error) throw new Error(`gsc upsert: ${error.message}`);
  return payload;
}

async function refreshGbpMonth(supabase, bounds) {
  return withGbpToken(async (token) => {
    const loc = await resolveGbpLocation(token);
    await supabase.from('gbp_location_registry').upsert({
      location_id: loc.location_id,
      title: loc.title,
      website_uri: loc.website_uri,
      account_name: loc.account_name,
      updated_at: new Date().toISOString(),
    });

    const monthly = await fetchPerformanceMonthly(
      token,
      loc.location_id,
      { year: bounds.year, month: bounds.month, day: 1 },
      {
        year: Number(bounds.endIso.slice(0, 4)),
        month: Number(bounds.endIso.slice(5, 7)),
        day: Number(bounds.endIso.slice(8, 10)),
      }
    );
    if (monthly.length) {
      const { error } = await supabase.from('gbp_performance_monthly').upsert(monthly, {
        onConflict: 'location_id,month',
      });
      if (error) throw new Error(`gbp perf upsert: ${error.message}`);
    }

    const terms = await fetchDiscoveryTermsForMonth(token, loc.location_id, bounds.year, bounds.month);
    if (terms.length) {
      const { error } = await supabase.from('gbp_discovery_terms_monthly').upsert(terms, {
        onConflict: 'location_id,month,search_keyword',
      });
      if (error) throw new Error(`gbp terms upsert: ${error.message}`);
    }

    return {
      location_id: loc.location_id,
      performance_months: monthly.length,
      discovery_terms: terms.length,
    };
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (!authoriseRequest(req)) return send(res, 401, { error: 'unauthorised' });

  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    const bounds = monthBounds();
    const gbp = await refreshGbpMonth(supabase, bounds);
    const gsc = await refreshGscBrandMonth(supabase, bounds);
    return send(res, 200, {
      ok: true,
      month: bounds.monthIso,
      gbp,
      gsc: {
        brand_impressions: gsc.brand_impressions,
        brand_clicks: gsc.brand_clicks,
        brand_ctr: gsc.brand_ctr,
      },
    });
  } catch (err) {
    return send(res, 500, {
      error: 'gbp_brand_demand_sync_failed',
      message: err?.message || String(err),
    });
  }
}
