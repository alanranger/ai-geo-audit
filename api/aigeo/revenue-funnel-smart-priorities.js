// Revenue Funnel smart-priority generator
//
// Reads real audit data (schema_pages_detail, gsc_page_metrics_28d,
// keyword_rankings, v_products_unified_open) and proposes a SHORT list of
// priorities that are grounded in actual gaps - never "add FAQ schema" when
// FAQ is already there.
//
// Method:
//   GET  ?propertyUrl=...          - returns candidate priorities (read-only)
//   POST { propertyUrl, mode }     - mode='replace' wipes & rewrites the
//                                    revenue_funnel_priorities list;
//                                    mode='append' adds without removing
//
// Each candidate is keyed by `signature` so the same gap doesn't get added
// twice on consecutive runs.

export const config = { runtime: 'nodejs' };

import { createClient } from '@supabase/supabase-js';
import { COMMERCIAL_TIERS, classifyCommercialTier } from './commercial-tier.js';

const DEFAULT_PROPERTY = 'https://www.alanranger.com';
const MIN_IMPRESSIONS_FOR_CTR_TASK = 500;
const TARGET_CTR_UPLIFT_PCT = 1.5;
const MIN_KEYWORD_VOL_FOR_RANK_TASK = 300;

const send = (res, status, body) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
};

const need = (key) => {
  const v = process.env[key];
  if (!v || !String(v).trim()) throw new Error(`missing_env:${key}`);
  return v;
};

function parseBody(req) {
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  if (req.body && typeof req.body === 'object') return req.body;
  return {};
}

// ----------------------------------------------------------------------
// Tier hub configuration
// ----------------------------------------------------------------------
const TIER_HUBS = {
  workshops: { hubUrl: 'https://www.alanranger.com/photography-workshops', label: 'Workshops' },
  courses:   { hubUrl: 'https://www.alanranger.com/photography-courses-coventry', label: 'Courses' },
  services:  { hubUrl: 'https://www.alanranger.com/photography-tuition-services', label: 'Services / 1-2-1' },
  hire:      { hubUrl: 'https://www.alanranger.com/hire-a-professional-photographer-in-coventry', label: 'Hire / Commercial' },
  academy:   { hubUrl: 'https://www.alanranger.com/free-online-photography-course', label: 'Academy' }
};

// ----------------------------------------------------------------------
// Data fetching helpers
// ----------------------------------------------------------------------
async function fetchSchemaDetail(supabase, propertyUrl) {
  const { data, error } = await supabase
    .from('audit_results')
    .select('audit_date, schema_pages_detail')
    .eq('property_url', propertyUrl)
    .not('schema_pages_detail', 'is', null)
    .order('audit_date', { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = (data || [])[0];
  if (!row) return new Map();
  const out = new Map();
  for (const entry of (row.schema_pages_detail || [])) {
    const url = entry && entry.url;
    if (!url) continue;
    out.set(url, {
      hasSchema: !!entry.hasSchema,
      schemaTypes: new Set(entry.schemaTypes || []),
      title: entry.title || null,
      metaDescription: entry.metaDescription || null
    });
  }
  return out;
}

async function fetchPageMetrics(supabase, propertyUrl) {
  const { data: latestRow } = await supabase
    .from('gsc_page_metrics_28d')
    .select('date_end')
    .eq('site_url', propertyUrl)
    .order('date_end', { ascending: false })
    .limit(1);
  const latestEnd = latestRow && latestRow[0] ? latestRow[0].date_end : null;
  if (!latestEnd) return [];
  const { data, error } = await supabase
    .from('gsc_page_metrics_28d')
    .select('page_url, clicks_28d, impressions_28d, ctr_28d, position_28d')
    .eq('site_url', propertyUrl)
    .eq('date_end', latestEnd)
    .limit(2000);
  if (error) throw error;
  return data || [];
}

async function fetchKeywordRankings(supabase, propertyUrl) {
  const { data, error } = await supabase
    .from('keyword_rankings')
    .select('keyword, best_rank_group, search_volume, has_ai_overview, ai_alan_citations_count, best_url, segment')
    .eq('property_url', propertyUrl)
    .order('audit_date', { ascending: false })
    .limit(2000);
  if (error) throw error;
  const latestByKw = new Map();
  for (const row of (data || [])) {
    if (!latestByKw.has(row.keyword)) latestByKw.set(row.keyword, row);
  }
  return Array.from(latestByKw.values());
}

async function fetchProducts(supabase) {
  const { data, error } = await supabase
    .from('v_products_unified_open')
    .select('product_url, product_title, display_price_gbp');
  if (error) throw error;
  const seen = new Set();
  const out = [];
  for (const row of (data || [])) {
    if (!row.product_url || seen.has(row.product_url)) continue;
    seen.add(row.product_url);
    out.push(row);
  }
  return out;
}

// ----------------------------------------------------------------------
// Candidate builders - one per priority type
// ----------------------------------------------------------------------
function ctrPriorityForTier(tierId, tierMetrics) {
  const eligible = tierMetrics.filter(r => (Number(r.impressions_28d) || 0) >= MIN_IMPRESSIONS_FOR_CTR_TASK);
  if (!eligible.length) return null;
  const scored = eligible.map(r => {
    const impr = Number(r.impressions_28d) || 0;
    const ctr = Number(r.ctr_28d) || 0;
    const targetCtr = Math.max(ctr * 1.5, TARGET_CTR_UPLIFT_PCT / 100);
    const uplift = Math.max(0, Math.round((targetCtr - ctr) * impr));
    return { row: r, uplift, ctrPct: ctr * 100, targetPct: targetCtr * 100, impr };
  }).filter(x => x.uplift >= 5)
    .sort((a, b) => b.uplift - a.uplift);
  if (!scored.length) return null;
  const top = scored[0];
  const cleanedUrl = cleanUrl(top.row.page_url);
  return {
    signature: `ctr|${cleanedUrl}`,
    title: `Lift CTR on ${labelOf(cleanedUrl)}`,
    description: `${cleanedUrl} has ${top.impr.toLocaleString()} impressions/28d at ${top.ctrPct.toFixed(2)}% CTR. Rewrite the SERP title (~60ch) and meta description (~155ch) to lead with the customer's outcome + price + location. Target ${top.targetPct.toFixed(1)}% CTR.`,
    pages_affected: [cleanedUrl],
    primary_kpi: 'ctr_28d_pct',
    kpi_baseline_value: top.ctrPct,
    kpi_target_value: top.targetPct,
    kpi_target_direction: 'up',
    estimated_lift: `+${top.uplift} clicks/28d (~£${Math.round(top.uplift * estimatedAovPerClick(tierId)).toLocaleString()} potential)`
  };
}

function rankPriorityForTier(tierId, tierKeywords, _hubUrl) {
  const eligible = tierKeywords
    .filter(k => {
      const r = k.best_rank_group;
      return r != null && r >= 5 && r <= 20 && (Number(k.search_volume) || 0) >= MIN_KEYWORD_VOL_FOR_RANK_TASK;
    })
    .sort((a, b) => (Number(b.search_volume) || 0) - (Number(a.search_volume) || 0));
  if (!eligible.length) return null;
  const top = eligible[0];
  const targetRank = Math.max(3, Math.floor(Number(top.best_rank_group) / 2));
  const cleanedUrl = cleanUrl(top.best_url || '');
  return {
    signature: `rank|${top.keyword}|${cleanedUrl}`,
    title: `Lift "${top.keyword}" from rank ${top.best_rank_group} to top ${targetRank}`,
    description: `${cleanedUrl || '(no URL)'} ranks #${top.best_rank_group} for "${top.keyword}" (${Number(top.search_volume).toLocaleString()} searches/mo). Strengthen the page: add a comparison table, customer outcome paragraphs, and 6-8 FAQ items mirroring the People-Also-Ask block. Re-build the internal link block from the tier hub.`,
    pages_affected: cleanedUrl ? [cleanedUrl] : [],
    primary_kpi: 'rank_position',
    kpi_baseline_value: Number(top.best_rank_group),
    kpi_target_value: targetRank,
    kpi_target_direction: 'down',
    estimated_lift: `Rank ${top.best_rank_group} -> top ${targetRank} on a ${Number(top.search_volume).toLocaleString()}/mo keyword`
  };
}

function aioCitationPriority(tierId, tierKeywords) {
  const uncited = tierKeywords
    .filter(k => k.has_ai_overview && !(Number(k.ai_alan_citations_count) > 0))
    .sort((a, b) => (Number(b.search_volume) || 0) - (Number(a.search_volume) || 0));
  if (!uncited.length) return null;
  const top = uncited[0];
  const cleanedUrl = cleanUrl(top.best_url || '');
  return {
    signature: `aio|${top.keyword}`,
    title: `Get cited in Google's AI Overview for "${top.keyword}"`,
    description: `An AI Overview exists for "${top.keyword}" (${Number(top.search_volume).toLocaleString()}/mo) but no alanranger.com citation. Add a short, structured answer block on ${cleanedUrl || 'the best matching page'} that directly answers the AIO query, followed by 3-5 supporting FAQs using question/answer schema markup mirroring the AIO summary.`,
    pages_affected: cleanedUrl ? [cleanedUrl] : [],
    primary_kpi: 'aio_citations',
    kpi_baseline_value: 0,
    kpi_target_value: 1,
    kpi_target_direction: 'up',
    estimated_lift: `Citation on a ${Number(top.search_volume).toLocaleString()}/mo AIO query in the ${tierId} tier`
  };
}

function orphanProductPriority(tierId, products, tierMetricsByUrl) {
  const orphans = products
    .filter(p => {
      const m = tierMetricsByUrl.get(p.product_url);
      return !m || (Number(m.impressions_28d) || 0) === 0;
    })
    .sort((a, b) => (Number(b.display_price_gbp) || 0) - (Number(a.display_price_gbp) || 0));
  if (!orphans.length) return null;
  const top = orphans[0];
  const cleanedUrl = cleanUrl(top.product_url || '');
  return {
    signature: `orphan|${cleanedUrl}`,
    title: `Surface orphan product: ${top.product_title}`,
    description: `${cleanedUrl} has 0 GSC impressions in the last 28 days (price £${Number(top.display_price_gbp) || 0}). Add it to the ${TIER_HUBS[tierId].label} hub's product grid, write 250-400 words of unique content above the booking widget answering "who is this for / what you'll learn / what's included", and link from a relevant blog post.`,
    pages_affected: [cleanedUrl, TIER_HUBS[tierId].hubUrl],
    primary_kpi: 'impressions_28d',
    kpi_baseline_value: 0,
    kpi_target_value: 100,
    kpi_target_direction: 'up',
    estimated_lift: `Recover a £${Number(top.display_price_gbp) || 0} price-point product from zero-impression status`
  };
}

function schemaGapPriority(tierId, schemaDetail) {
  // Only fire if the hub is actually MISSING expected schema types.
  const hub = schemaDetail.get(TIER_HUBS[tierId].hubUrl);
  if (!hub) return null;
  const expected = expectedSchemaForTier(tierId);
  const missing = expected.filter(t => !hub.schemaTypes.has(t));
  if (!missing.length) return null;
  return {
    signature: `schema|${tierId}|${missing.join(',')}`,
    title: `Add missing schema (${missing.join(', ')}) to ${TIER_HUBS[tierId].label} hub`,
    description: `${TIER_HUBS[tierId].hubUrl} is missing ${missing.join(', ')} schema. Adding these unlocks richer SERP features (review stars, FAQ accordion, course aggregate).`,
    pages_affected: [TIER_HUBS[tierId].hubUrl],
    primary_kpi: 'schema_coverage_pct',
    kpi_baseline_value: null,
    kpi_target_value: 100,
    kpi_target_direction: 'up',
    estimated_lift: `Unlock SERP rich result for ${missing.join('/')}`
  };
}

function expectedSchemaForTier(tierId) {
  const baseline = ['Service', 'FAQPage', 'AggregateRating', 'Review'];
  if (tierId === 'workshops' || tierId === 'courses') baseline.push('Event', 'Product');
  if (tierId === 'academy') baseline.push('Course');
  if (tierId === 'hire') baseline.push('LocalBusiness');
  return baseline;
}

// ----------------------------------------------------------------------
// Per-tier classifier wrappers
// ----------------------------------------------------------------------
function tierFor(url, name) {
  return classifyCommercialTier({ productUrl: url || '', productName: name || '' });
}

function groupByTier(items, urlField, nameField) {
  const byTier = new Map();
  for (const tier of COMMERCIAL_TIERS) byTier.set(tier.id, []);
  byTier.set('other', []);
  for (const item of (items || [])) {
    const url = item[urlField] || '';
    const name = nameField ? (item[nameField] || '') : '';
    const tid = tierFor(url, name);
    if (byTier.has(tid)) byTier.get(tid).push(item);
    else byTier.get('other').push(item);
  }
  return byTier;
}

function labelOf(url) {
  if (!url) return '(no URL)';
  try {
    const u = new URL(url, 'https://x/');
    const segs = u.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    return segs.length ? segs[segs.length - 1].replace(/[-_]+/g, ' ') : '/';
  } catch {
    return url;
  }
}

// Strip tracking parameters (srsltid, utm_*, gclid, fbclid, mc_eid, _gl)
// from URLs returned by GSC/keyword data so priorities display clean paths.
const TRACKING_PARAM_PREFIXES = ['srsltid', 'utm_', 'gclid', 'fbclid', 'mc_eid', '_gl'];
function cleanUrl(rawUrl) {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl, 'https://www.alanranger.com');
    const keys = Array.from(u.searchParams.keys());
    keys.forEach(k => {
      const lk = k.toLowerCase();
      if (TRACKING_PARAM_PREFIXES.some(p => lk === p || lk.startsWith(p))) u.searchParams.delete(k);
    });
    u.hash = '';
    return u.toString();
  } catch {
    return String(rawUrl).replace(/[?&](srsltid|utm_[^=]+|gclid|fbclid|mc_eid|_gl)=[^&]*/gi, '');
  }
}

const AOV_PER_CLICK = { workshops: 2.5, courses: 2, services: 1, hire: 2, academy: 0.8 };
function estimatedAovPerClick(tierId) {
  return AOV_PER_CLICK[tierId] || 1.5;
}

// ----------------------------------------------------------------------
// Master builder
// ----------------------------------------------------------------------
function buildPrioritiesForTier(tierId, tierData) {
  const candidates = [
    schemaGapPriority(tierId, tierData.schemaDetail),
    ctrPriorityForTier(tierId, tierData.pages),
    rankPriorityForTier(tierId, tierData.keywords, tierData.hubUrl),
    aioCitationPriority(tierId, tierData.keywords),
    orphanProductPriority(tierId, tierData.products, tierData.pagesByUrl)
  ].filter(Boolean);
  return candidates;
}

function buildAllPriorities(snapshot) {
  const out = [];
  let sortOrder = 0;
  for (const tier of COMMERCIAL_TIERS) {
    const tierId = tier.id;
    const tierData = {
      hubUrl: TIER_HUBS[tierId].hubUrl,
      schemaDetail: snapshot.schemaDetail,
      pages: snapshot.pagesByTier.get(tierId) || [],
      pagesByUrl: snapshot.pagesByUrl,
      keywords: snapshot.keywordsByTier.get(tierId) || [],
      products: snapshot.productsByTier.get(tierId) || []
    };
    const cands = buildPrioritiesForTier(tierId, tierData);
    for (const c of cands) {
      sortOrder += 10;
      out.push({
        ...c,
        property_url: snapshot.propertyUrl,
        tier_id: tierId,
        tier_label: tier.label,
        sort_order: sortOrder,
        status: 'not_started'
      });
    }
  }
  return out;
}

// ----------------------------------------------------------------------
// Data assembly
// ----------------------------------------------------------------------
async function buildSnapshot(supabase, propertyUrl) {
  const [schemaDetail, pages, keywords, products] = await Promise.all([
    fetchSchemaDetail(supabase, propertyUrl),
    fetchPageMetrics(supabase, propertyUrl),
    fetchKeywordRankings(supabase, propertyUrl),
    fetchProducts(supabase)
  ]);
  const pagesByUrl = new Map();
  for (const p of pages) pagesByUrl.set(p.page_url, p);
  const pagesByTier = groupByTier(pages, 'page_url');
  const keywordsByTier = groupByTier(keywords, 'best_url');
  const productsByTier = groupByTier(products, 'product_url', 'product_title');
  return { propertyUrl, schemaDetail, pagesByUrl, pagesByTier, keywordsByTier, productsByTier };
}

// ----------------------------------------------------------------------
// Persistence
// ----------------------------------------------------------------------
function toRow(candidate) {
  return {
    property_url: candidate.property_url,
    title: candidate.title,
    description: candidate.description || null,
    pages_affected: candidate.pages_affected || [],
    primary_kpi: candidate.primary_kpi || null,
    kpi_target_value: candidate.kpi_target_value ?? null,
    kpi_target_direction: candidate.kpi_target_direction || null,
    kpi_baseline_value: candidate.kpi_baseline_value ?? null,
    estimated_lift: candidate.estimated_lift || null,
    sort_order: candidate.sort_order || 0,
    status: candidate.status || 'not_started',
    notes: `tier:${candidate.tier_id}|sig:${candidate.signature}`
  };
}

async function applyReplace(supabase, propertyUrl, candidates) {
  const { error: delErr } = await supabase
    .from('revenue_funnel_priorities')
    .delete()
    .eq('property_url', propertyUrl)
    .in('status', ['not_started']);
  if (delErr) throw delErr;
  if (!candidates.length) return [];
  const rows = candidates.map(toRow);
  const { data, error } = await supabase
    .from('revenue_funnel_priorities')
    .insert(rows)
    .select();
  if (error) throw error;
  return data || [];
}

async function applyAppend(supabase, propertyUrl, candidates) {
  if (!candidates.length) return [];
  // Skip candidates whose signature is already present in notes
  const { data: existing } = await supabase
    .from('revenue_funnel_priorities')
    .select('notes')
    .eq('property_url', propertyUrl);
  const seenSigs = new Set();
  for (const e of (existing || [])) {
    const m = /sig:([^|]+)/.exec(e.notes || '');
    if (m) seenSigs.add(m[1]);
  }
  const fresh = candidates.filter(c => !seenSigs.has(c.signature));
  if (!fresh.length) return [];
  const rows = fresh.map(toRow);
  const { data, error } = await supabase
    .from('revenue_funnel_priorities')
    .insert(rows)
    .select();
  if (error) throw error;
  return data || [];
}

// ----------------------------------------------------------------------
// Handler
// ----------------------------------------------------------------------
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return send(res, 405, { error: 'method_not_allowed' });
  }

  const body = req.method === 'POST' ? parseBody(req) : (req.query || {});
  const propertyUrl = String(body.propertyUrl || req.query?.propertyUrl || DEFAULT_PROPERTY).trim();
  const mode = req.method === 'POST' ? String(body.mode || 'replace').trim() : null;

  try {
    const supabase = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'));
    const snapshot = await buildSnapshot(supabase, propertyUrl);
    const candidates = buildAllPriorities(snapshot);

    if (req.method === 'GET') {
      return send(res, 200, {
        property_url: propertyUrl,
        generated_at: new Date().toISOString(),
        candidate_count: candidates.length,
        candidates: candidates.map(c => ({
          tier_id: c.tier_id, tier_label: c.tier_label, signature: c.signature,
          title: c.title, description: c.description, pages_affected: c.pages_affected,
          primary_kpi: c.primary_kpi, kpi_baseline_value: c.kpi_baseline_value,
          kpi_target_value: c.kpi_target_value, kpi_target_direction: c.kpi_target_direction,
          estimated_lift: c.estimated_lift
        }))
      });
    }

    let saved;
    if (mode === 'append') saved = await applyAppend(supabase, propertyUrl, candidates);
    else saved = await applyReplace(supabase, propertyUrl, candidates);

    return send(res, 200, {
      ok: true,
      mode: mode || 'replace',
      candidate_count: candidates.length,
      saved_count: saved.length,
      saved
    });
  } catch (err) {
    return send(res, 500, { error: 'smart_priorities_failed', message: err?.message || String(err) });
  }
}
