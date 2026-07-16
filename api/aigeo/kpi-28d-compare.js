/**
 * Whole-site + money-page aggregates for latest rolling 28d vs prior NON-OVERLAPPING 28d.
 * Money set = classifyPageSegment === MONEY (same SoT as URL Money Pages tab).
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { createClient } from '@supabase/supabase-js';
import { PageSegment, classifyPageSegment } from './pageSegment.js';

const PROPERTY = 'https://www.alanranger.com';

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(status).send(JSON.stringify(body));
};

const need = (k) => {
  const v = process.env[k];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${k}`);
  return v;
};

function addDaysIso(iso, days) {
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function aggregate(rows) {
  let clicks = 0;
  let impressions = 0;
  let posSum = 0;
  let posN = 0;
  let moneyClicks = 0;
  let moneyImpressions = 0;
  let moneyWPos = 0;
  let moneyPages = 0;
  for (const r of rows || []) {
    const c = Number(r.clicks_28d) || 0;
    const i = Number(r.impressions_28d) || 0;
    const p = Number(r.position_28d);
    clicks += c;
    impressions += i;
    if (Number.isFinite(p)) {
      posSum += p;
      posN += 1;
    }
    if (classifyPageSegment(r.page_url) === PageSegment.MONEY) {
      moneyPages += 1;
      moneyClicks += c;
      moneyImpressions += i;
      if (Number.isFinite(p) && i > 0) moneyWPos += p * i;
    }
  }
  const ctrPct = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const moneyCtr = moneyImpressions > 0 ? moneyClicks / moneyImpressions : 0;
  return {
    pages: (rows || []).length,
    clicks,
    impressions,
    ctr_pct: ctrPct,
    avg_position: posN > 0 ? posSum / posN : null,
    money: {
      pages: moneyPages,
      clicks: moneyClicks,
      impressions: moneyImpressions,
      ctr: moneyCtr,
      avg_position: moneyImpressions > 0 ? moneyWPos / moneyImpressions : null,
    },
  };
}

async function fetchWindow(supabase, siteUrl, dateEnd) {
  const { data, error } = await supabase
    .from('gsc_page_metrics_28d')
    .select('page_url, clicks_28d, impressions_28d, position_28d, date_start, date_end')
    .eq('site_url', siteUrl)
    .eq('date_end', dateEnd);
  if (error) throw new Error(error.message);
  const rows = data || [];
  const dateStart = rows[0]?.date_start || addDaysIso(dateEnd, -27);
  return { date_start: dateStart, date_end: dateEnd, ...aggregate(rows) };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });

  try {
    const siteUrl = String(req.query?.siteUrl || PROPERTY).trim() || PROPERTY;
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));

    const { data: latest, error: latestErr } = await supabase
      .from('gsc_page_metrics_28d')
      .select('date_end, date_start')
      .eq('site_url', siteUrl)
      .order('date_end', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestErr) throw new Error(latestErr.message);
    if (!latest?.date_end) return send(res, 404, { error: 'no_gsc_28d_capture' });

    const currentEnd = String(latest.date_end).slice(0, 10);
    const priorEnd = addDaysIso(currentEnd, -28);

    const [current, prior] = await Promise.all([
      fetchWindow(supabase, siteUrl, currentEnd),
      fetchWindow(supabase, siteUrl, priorEnd),
    ]);

    return send(res, 200, {
      ok: true,
      site_url: siteUrl,
      current,
      prior,
      money_classifier: 'api/aigeo/pageSegment.js classifyPageSegment === MONEY',
    });
  } catch (e) {
    return send(res, 500, { error: e.message || String(e) });
  }
}
