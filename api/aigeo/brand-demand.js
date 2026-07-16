/**
 * Brand demand from stored GBP Performance + branded GSC monthly tables.
 * Headline = latest FULL calendar month (excludes partial current month).
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { createClient } from '@supabase/supabase-js';
import { computeBrandDemandForMonth } from '../../lib/audit/brandOverlay.js';

const PROPERTY = 'https://www.alanranger.com';

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(status).send(JSON.stringify(body));
};

const need = (key) => {
  const v = process.env[key];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${key}`);
  return v;
};

function monthKey(iso) {
  return String(iso).slice(0, 7);
}

function isPartialCurrentMonth(monthIso) {
  const now = new Date();
  now.setUTCDate(now.getUTCDate() - 2); // GSC/GBP lag
  const cur = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  return monthKey(monthIso) === cur;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });

  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    const propertyUrl = String(req.query?.propertyUrl || PROPERTY).trim();

    const [{ data: gbpRows, error: gbpErr }, { data: gscRows, error: gscErr }] = await Promise.all([
      supabase.from('gbp_performance_monthly').select('*').order('month', { ascending: true }),
      supabase.from('gsc_brand_query_monthly').select('*').eq('property_url', propertyUrl).order('month', { ascending: true }),
    ]);
    if (gbpErr) throw new Error(`gbp: ${gbpErr.message}`);
    if (gscErr) throw new Error(`gsc: ${gscErr.message}`);

    const gscByMonth = new Map((gscRows || []).map((r) => [monthKey(r.month), r]));
    const monthly = [];

    for (const gbp of gbpRows || []) {
      const mk = monthKey(gbp.month);
      const gsc = gscByMonth.get(mk) || null;
      // Need GSC brand row for full blend; still score GBP-only months with 0 brand clicks
      const overlay = computeBrandDemandForMonth(gbp, gsc || {});
      monthly.push({
        month: mk,
        month_date: String(gbp.month).slice(0, 10),
        partial: isPartialCurrentMonth(gbp.month),
        score: overlay.score,
        label: overlay.label,
        gbp_interactions: overlay.gbpInteractions,
        gbp_profile_impressions: overlay.gbpProfileImpressions,
        gbp_action_rate: overlay.gbpActionRate,
        brand_clicks: overlay.brandClicks,
        brand_ctr: overlay.brandCtr,
        brand_share: overlay.brandQueryShare,
        components: overlay.components,
        has_gsc: Boolean(gsc),
      });
    }

    const fullMonths = monthly.filter((m) => !m.partial && m.has_gsc);
    const headline = fullMonths.length ? fullMonths[fullMonths.length - 1] : null;
    const prev = fullMonths.length >= 2 ? fullMonths[fullMonths.length - 2] : null;

    let trend = { direction: 'flat', delta: 0 };
    if (headline && prev) {
      const delta = headline.score - prev.score;
      trend = {
        direction: delta > 1 ? 'up' : delta < -1 ? 'down' : 'flat',
        delta,
        from_month: prev.month,
        to_month: headline.month,
      };
    }

    const brandOverlay = headline
      ? computeBrandDemandForMonth(
        (gbpRows || []).find((r) => monthKey(r.month) === headline.month),
        gscByMonth.get(headline.month) || {}
      )
      : null;

    if (brandOverlay) {
      brandOverlay.headlineMonth = headline.month;
      brandOverlay.trend = trend;
      brandOverlay.stats = {
        gbpInteractions: headline.gbp_interactions,
        gbpActionRate: headline.gbp_action_rate,
        brandCtr: headline.brand_ctr,
        brandClicks: headline.brand_clicks,
        gbpProfileImpressions: headline.gbp_profile_impressions,
      };
    }

    return send(res, 200, {
      ok: true,
      property_url: propertyUrl,
      formula: 'gbp_weighted_2026_07_16',
      headline_month: headline?.month || null,
      brandOverlay,
      trend,
      monthly,
      note: 'Headline uses latest full month with both GBP + GSC brand rows; partial current month excluded.',
    });
  } catch (err) {
    return send(res, 500, { error: 'brand_demand_failed', message: err?.message || String(err) });
  }
}
