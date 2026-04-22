// /api/aigeo/citation-movement.js
//
// Returns three AI-citation snapshots from keyword_rankings so the dashboard
// can render "what we gained / lost since the last audit" and "vs 7 days ago":
//
//   1. current     — the most recent audit_date (or a caller-supplied date)
//   2. last_audit  — the previous audit_date with real ranking data
//   3. seven_days  — the audit_date closest to (current - 7 days) with real data
//
// Each snapshot is a minimal list of rows — keyword + ai_alan_citations + has_ai_overview
// — so the client can compute keyword-level, URL-level, and money-URL-level
// deltas using the same classifyPortfolioSegmentFromUrl() it already uses for
// every other pillar tile. Keeping classification client-side keeps the new
// tile perfectly consistent with the existing ones.

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';

const SNAPSHOT_COLS = 'keyword, ai_alan_citations, ai_alan_citations_count, has_ai_overview, best_url, updated_at';

function need(key) {
  const v = process.env[key];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${key}`);
  return v;
}

function sendJson(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.status(status).send(JSON.stringify(body));
}

function daysBetween(a, b) {
  const ms = new Date(`${a}T00:00:00Z`).getTime() - new Date(`${b}T00:00:00Z`).getTime();
  return Math.round(ms / 86400000);
}

function isoDateMinusDays(base, days) {
  const d = new Date(`${base}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Return the single most-recent audit_date that has at least one row with
 * AI-overview data (has_ai_overview=true OR ai_alan_citations_count IS NOT NULL).
 * Used to pick a baseline that is not an empty placeholder run.
 */
async function findMostRecentAuditDate(supabase, propertyUrl, beforeDate) {
  let q = supabase
    .from('keyword_rankings')
    .select('audit_date')
    .eq('property_url', propertyUrl)
    .eq('has_ai_overview', true)
    .order('audit_date', { ascending: false })
    .limit(1);
  if (beforeDate) q = q.lt('audit_date', beforeDate);
  const { data, error } = await q;
  if (error) throw error;
  return data?.length ? data[0].audit_date : null;
}

/**
 * Return the audit_date closest to (currentDate - 7 days) that has real data.
 * Prefers the closest match either side (ties broken toward the older date so
 * the delta always spans at least 7 days).
 */
async function findSevenDayBaseline(supabase, propertyUrl, currentDate) {
  const target = isoDateMinusDays(currentDate, 7);
  const { data, error } = await supabase
    .from('keyword_rankings')
    .select('audit_date')
    .eq('property_url', propertyUrl)
    .eq('has_ai_overview', true)
    .lt('audit_date', currentDate)
    .order('audit_date', { ascending: false })
    .limit(50);
  if (error) throw error;
  if (!data || data.length === 0) return null;
  const uniqueDates = [...new Set(data.map(r => r.audit_date))];
  let best = uniqueDates[0];
  let bestGap = Math.abs(daysBetween(target, best));
  for (const d of uniqueDates) {
    const gap = Math.abs(daysBetween(target, d));
    if (gap < bestGap || (gap === bestGap && d < best)) {
      best = d;
      bestGap = gap;
    }
  }
  return best;
}

async function loadSnapshot(supabase, propertyUrl, auditDate) {
  if (!auditDate) return null;
  const { data, error } = await supabase
    .from('keyword_rankings')
    .select(SNAPSHOT_COLS)
    .eq('property_url', propertyUrl)
    .eq('audit_date', auditDate)
    .limit(2000);
  if (error) throw error;
  return {
    audit_date: auditDate,
    rows: Array.isArray(data) ? data : []
  };
}

async function resolveDates(supabase, propertyUrl, query) {
  const current = query.currentDate || await findMostRecentAuditDate(supabase, propertyUrl, null);
  if (!current) return { current: null, last_audit: null, seven_days: null };
  const lastAudit = query.lastAuditDate
    || await findMostRecentAuditDate(supabase, propertyUrl, current);
  const sevenDays = query.sevenDayDate
    || await findSevenDayBaseline(supabase, propertyUrl, current);
  return { current, last_audit: lastAudit, seven_days: sevenDays };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }
  if (req.method !== 'GET') {
    return sendJson(res, 405, { status: 'error', error: 'Method not allowed. Expected: GET' });
  }

  try {
    const propertyUrl = String(req.query.propertyUrl || req.query.property || '').trim();
    if (!propertyUrl) {
      return sendJson(res, 400, { status: 'error', error: 'propertyUrl is required' });
    }

    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    const dates = await resolveDates(supabase, propertyUrl, req.query);

    if (!dates.current) {
      return sendJson(res, 200, {
        status: 'ok',
        data: {
          property_url: propertyUrl,
          current: null,
          last_audit: null,
          seven_days: null,
          note: 'No keyword_rankings rows found for this property'
        }
      });
    }

    const [current, lastAudit, sevenDays] = await Promise.all([
      loadSnapshot(supabase, propertyUrl, dates.current),
      loadSnapshot(supabase, propertyUrl, dates.last_audit),
      loadSnapshot(supabase, propertyUrl, dates.seven_days)
    ]);

    return sendJson(res, 200, {
      status: 'ok',
      data: {
        property_url: propertyUrl,
        current,
        last_audit: lastAudit,
        seven_days: sevenDays,
        meta: {
          generated_at: new Date().toISOString(),
          days_since_last_audit: lastAudit ? daysBetween(dates.current, lastAudit) : null,
          days_since_seven_day_baseline: sevenDays ? daysBetween(dates.current, sevenDays) : null
        }
      }
    });
  } catch (err) {
    console.error('[citation-movement] Error:', err);
    return sendJson(res, 500, { status: 'error', error: err.message || String(err) });
  }
}
