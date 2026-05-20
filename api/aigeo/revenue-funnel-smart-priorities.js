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
import { validateUrlsLive } from './lib/live-page-validator.js';

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
// Hub URLs per tier. COMMERCIAL_TIERS now splits workshops into
// residential / non-residential, but both still funnel through the
// single /photography-workshops hub, so we alias them here. Without
// these aliases the iteration over COMMERCIAL_TIERS crashes with
// "Cannot read properties of undefined (reading 'hubUrl')".
const TIER_HUBS = {
  workshops:              { hubUrl: 'https://www.alanranger.com/photography-workshops', label: 'Workshops' },
  workshops_residential:  { hubUrl: 'https://www.alanranger.com/photography-workshops', label: 'Workshops (Residential)' },
  workshops_nonres:       { hubUrl: 'https://www.alanranger.com/photography-workshops', label: 'Workshops (Non-Res)' },
  courses:                { hubUrl: 'https://www.alanranger.com/photography-courses-coventry', label: 'Courses' },
  services:               { hubUrl: 'https://www.alanranger.com/photography-tuition-services', label: 'Services / 1-2-1' },
  hire:                   { hubUrl: 'https://www.alanranger.com/hire-a-professional-photographer-in-coventry', label: 'Hire / Commercial' },
  academy:                { hubUrl: 'https://www.alanranger.com/free-online-photography-course', label: 'Academy' }
};
// Defensive: if a future tier appears without a hub, skip it instead of
// crashing the whole endpoint.
function tierHub(tierId) {
  return TIER_HUBS[tierId] || null;
}

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
// Page-content validation helpers (Phase 1, 2026-05-20 v4)
// ----------------------------------------------------------------------
// Filter blog posts out of money-page picks. Blog posts can rank and earn
// AIO citations but they are NOT money pages — Alan flagged that the picker
// was surfacing /blog-on-photography/headshots-at-home-guide as a Top 3
// "Lift CTR" candidate, which both duplicates the Money Pages Opportunity
// Table view and pushes him toward a sub-tier (portraits/headshots are
// <0.5% of revenue) instead of his real high-profit tiers.
function isBlogUrl(url) {
  if (!url) return false;
  const s = String(url);
  return /\/blog-on-photography\//i.test(s);
}

// Find the top-ranking keyword (by search volume) whose `best_url` matches
// this page. Used so the picker description can say WHICH commercial-intent
// query the page is competing on, not just "rewrite the title".
function topKeywordForPage(cleanedUrl, keywords) {
  if (!cleanedUrl || !keywords) return null;
  let best = null;
  let bestVol = -1;
  for (const k of keywords) {
    if (cleanUrl(k.best_url || '') !== cleanedUrl) continue;
    const v = Number(k.search_volume) || 0;
    if (v > bestVol) { best = k; bestVol = v; }
  }
  return best;
}

// Pull what the latest audit captured for this page: current title, current
// meta description, schema types it carries. This is what makes the picker
// recommendations data-driven instead of generic — we can SEE what's there
// and only suggest changes that the data justifies.
function pageEnrichment(cleanedUrl, schemaDetail, keywords) {
  const schema = schemaDetail.get(cleanedUrl);
  return {
    title: (schema && schema.title) || null,
    meta: (schema && schema.metaDescription) || null,
    schemaTypes: schema && schema.schemaTypes ? Array.from(schema.schemaTypes) : [],
    topKw: topKeywordForPage(cleanedUrl, keywords)
  };
}

// Three small diagnostic helpers so the parent stays under the 15-complexity
// limit. Each returns either a string describing a specific issue, or null.
function diagnoseTitleIssue(title, topKw) {
  if (!title) return 'Title not captured in last audit (likely missing or blocked).';
  const len = title.length;
  if (len > 60) return `Title is ${len}ch — Google truncates at ~60.`;
  if (len < 30) return `Title is only ${len}ch — under-using SERP real estate.`;
  if (topKw && topKw.keyword && !title.toLowerCase().includes(String(topKw.keyword).toLowerCase())) {
    return `Title doesn't lead with head term "${topKw.keyword}" (the query you actually rank for).`;
  }
  return null;
}
function diagnoseMetaIssue(meta) {
  if (!meta) return 'No meta description captured — Google will auto-snippet (usually badly).';
  const len = meta.length;
  if (len > 160) return `Meta is ${len}ch — truncated in SERP.`;
  if (len < 120) return `Meta is only ${len}ch — under-using SERP real estate.`;
  return null;
}
function diagnosePositionIssue(avgPosition, ctrPct) {
  const pos = Number(avgPosition);
  if (!Number.isFinite(pos)) return null;
  if (pos <= 3 && ctrPct < 5) {
    return `Position ${pos.toFixed(1)} should drive ~10–30% CTR; you're at ${ctrPct.toFixed(2)}% — almost certainly AIO / rich-snippet features eating the clicks. Fix that first, not the title.`;
  }
  if (pos >= 11 && ctrPct >= 1) {
    return `CTR ${ctrPct.toFixed(2)}% is normal for position ${pos.toFixed(1)} — focus on rank improvement (page 1) before title rewrites.`;
  }
  return null;
}
function diagnoseLowCtr({ ctrPct, avgPosition, title, meta, topKw }) {
  const issues = [];
  const tIssue = diagnoseTitleIssue(title, topKw);
  if (tIssue) issues.push(tIssue);
  const mIssue = diagnoseMetaIssue(meta);
  if (mIssue) issues.push(mIssue);
  const pIssue = diagnosePositionIssue(avgPosition, ctrPct);
  if (pIssue) issues.push(pIssue);
  if (!issues.length) {
    issues.push('Title + meta look reasonable for length and contain the head term. Lift is likely from schema enrichment or AIO citation, not a title rewrite.');
  }
  return issues.join(' ');
}

// ----------------------------------------------------------------------
// Description builders (live-validation aware, Phase 2.0)
// ----------------------------------------------------------------------
// The description string the dashboard renders in the "Why" row of each
// Top Actions card is built from BOTH "stable" data (impressions, CTR,
// rank, search volume — these come from GSC/keyword tables and the
// snapshot is the source of truth) and "page state" data (current
// title, current meta, current schema types — these can change between
// audits, so we live-fetch them for the Top N picks in a post-pass).
//
// Each lever has its own description builder that takes the stable
// args + a pageState object (whichever source — live or audit). The
// post-pass calls the SAME builder with live data after fanning out
// validateUrlsLive(), so the audit→live swap is one line, not a
// re-implementation.
function buildCtrDescription(args, pageState, sourceTag) {
  const { cleanedUrl, top, posTxt, kwInfo } = args;
  const title = pageState && pageState.title;
  const meta = pageState && pageState.metaDescription;
  const schemaTypes = (pageState && pageState.schemaTypes) || [];
  const kwLine = kwInfo
    ? `Top ranking keyword: "${kwInfo.keyword}" at rank #${kwInfo.rank ?? '?'} (${Number(kwInfo.searchVolume || 0).toLocaleString()}/mo).`
    : 'No tracked keyword found for this page yet.';
  const titleLine = title ? `Current title: "${title}" (${title.length}ch).` : 'Current title: (not captured).';
  const metaShort = meta ? (meta.length > 140 ? meta.slice(0, 137) + '…' : meta) : null;
  const metaLine = metaShort ? `Current meta: "${metaShort}" (${meta.length}ch).` : 'Current meta: (not captured).';
  const schemaLine = schemaTypes.length
    ? `Schema present: ${schemaTypes.slice(0, 8).join(', ')}.`
    : 'Schema present: none captured.';
  const diag = diagnoseLowCtr({
    ctrPct: top.ctrPct,
    avgPosition: (args.pos != null ? args.pos : null),
    title, meta,
    topKw: kwInfo ? { keyword: kwInfo.keyword } : null
  });
  const base = `${cleanedUrl} — ${top.impr.toLocaleString()} impressions/28d, ${top.ctrPct.toFixed(2)}% CTR, ${posTxt}. ${kwLine} ${titleLine} ${metaLine} ${schemaLine} Diagnosis: ${diag} Target: ${top.targetPct.toFixed(2)}% CTR.`;
  return sourceTag ? `${base} ${sourceTag}` : base;
}

// ----------------------------------------------------------------------
// Candidate builders - one per priority type
// ----------------------------------------------------------------------
function ctrPriorityForTier(tierId, tierMetrics, ctx) {
  const eligible = tierMetrics
    .filter(r => !isBlogUrl(r.page_url))
    .filter(r => (Number(r.impressions_28d) || 0) >= MIN_IMPRESSIONS_FOR_CTR_TASK);
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
  const upliftMonthly = top.uplift * (30 / 28);
  const revLift = Math.round(upliftMonthly * estimatedAovPerClick(tierId));
  const gpLift = Math.round(upliftMonthly * estimatedGpPerClick(tierId));
  const gpPct = estimatedGpPctForTier(tierId);
  // Audit-derived enrichment is the seed value used when the live
  // post-pass either isn't run (e.g. low-priority candidates) or fails
  // to fetch the URL. The Top N candidates get this overwritten with
  // live data before the response is sent.
  const auditState = pageEnrichment(cleanedUrl, ctx.schemaDetail, ctx.keywords);
  const pos = top.row.position_28d != null ? Number(top.row.position_28d) : null;
  const posTxt = pos != null ? `avg pos ${pos.toFixed(1)}` : 'pos n/a';
  const kwInfo = auditState.topKw
    ? { keyword: auditState.topKw.keyword, rank: auditState.topKw.best_rank_group, searchVolume: auditState.topKw.search_volume }
    : null;
  const builderArgs = { cleanedUrl, top, posTxt, pos, kwInfo };
  return {
    signature: `ctr|${cleanedUrl}`,
    title: `Lift CTR on ${labelOf(cleanedUrl)}`,
    description: buildCtrDescription(builderArgs, { title: auditState.title, metaDescription: auditState.meta, schemaTypes: auditState.schemaTypes }, '[data: last audit]'),
    pages_affected: [cleanedUrl],
    primary_kpi: 'ctr_28d_pct',
    kpi_baseline_value: top.ctrPct,
    kpi_target_value: top.targetPct,
    kpi_target_direction: 'up',
    estimated_lift: `~£${revLift.toLocaleString()}/mo revenue \u2192 ~£${gpLift.toLocaleString()}/mo profit at ${gpPct}% GP (from +${Math.round(upliftMonthly)} clicks/mo)`,
    estimated_lift_gbp_revenue: revLift,
    estimated_lift_gbp_profit: gpLift,
    lever_id: 'ctr',
    _rebuild: { type: 'ctr', args: builderArgs }
  };
}

function buildRankDescription(args, pageState, sourceTag) {
  const { cleanedUrl, keyword, rank, sv } = args;
  const title = pageState && pageState.title;
  const h1 = pageState && pageState.h1;
  const schemaTypes = (pageState && pageState.schemaTypes) || [];
  const headInTitle = title ? title.toLowerCase().includes(String(keyword).toLowerCase()) : false;
  const headInH1 = h1 ? h1.toLowerCase().includes(String(keyword).toLowerCase()) : false;
  const titleLine = title ? `Current title: "${title}" (${title.length}ch, head term ${headInTitle ? 'present' : 'MISSING'}).` : 'Current title: (not captured).';
  const h1Line = h1 ? `Current H1: "${h1}" (head term ${headInH1 ? 'present' : 'MISSING'}).` : '';
  const schemaLine = schemaTypes.length
    ? `Schema present: ${schemaTypes.slice(0, 8).join(', ')}.`
    : 'Schema present: none captured — adding FAQPage + Service is the cheapest first step.';
  const action = (headInTitle && headInH1)
    ? 'Action: head term is in title + H1 already, so focus on depth — add a comparison table, customer-outcome paragraphs, 6–8 People-Also-Ask FAQ items, and rebuild internal links from the tier hub.'
    : 'Action: lift the head term into the H1 + page title first (cheapest move), then add comparison table + 6–8 FAQ items + tier-hub internal links.';
  const base = `${cleanedUrl || '(no URL)'} ranks #${rank} for "${keyword}" (${Number(sv).toLocaleString()}/mo). ${titleLine} ${h1Line} ${schemaLine} ${action}`.replace(/\s{2,}/g, ' ');
  return sourceTag ? `${base} ${sourceTag}` : base;
}

// Approximate Google organic CTR by rank position. Used to model the
// click uplift from a rank improvement so rank candidates can carry a
// numeric estimated_lift_gbp_profit (without that the UI filter drops
// them from the "Do these 3 things" grid and Phase F's reordering is
// invisible to the user). Values are industry-published rough means;
// they overstate top-3 and understate bottom-of-page slightly but
// stay consistent enough for relative prioritisation.
const CTR_BY_RANK = {
  1: 0.275, 2: 0.155, 3: 0.110, 4: 0.083, 5: 0.063,
  6: 0.049, 7: 0.038, 8: 0.030, 9: 0.024, 10: 0.020,
  11: 0.017, 12: 0.014, 13: 0.012, 14: 0.011, 15: 0.010,
  16: 0.009, 17: 0.008, 18: 0.008, 19: 0.007, 20: 0.007
};
function ctrForRank(rank) {
  const r = Math.round(Number(rank) || 0);
  if (r <= 0) return 0;
  if (r >= 20) return CTR_BY_RANK[20];
  return CTR_BY_RANK[r] || CTR_BY_RANK[20];
}

function rankPriorityForTier(tierId, tierKeywords, ctx) {
  const eligible = tierKeywords
    .filter(k => !isBlogUrl(k.best_url || ''))
    .filter(k => {
      const r = k.best_rank_group;
      return r != null && r >= 5 && r <= 20 && (Number(k.search_volume) || 0) >= MIN_KEYWORD_VOL_FOR_RANK_TASK;
    })
    .sort((a, b) => (Number(b.search_volume) || 0) - (Number(a.search_volume) || 0));
  if (!eligible.length) return null;
  const top = eligible[0];
  const targetRank = Math.max(3, Math.floor(Number(top.best_rank_group) / 2));
  const cleanedUrl = cleanUrl(top.best_url || '');
  const auditState = pageEnrichment(cleanedUrl, ctx.schemaDetail, ctx.keywords);
  // Model the click uplift from the rank improvement so this
  // candidate carries an estimated_lift_gbp_profit and survives the
  // UI's >0 filter. Same dimensional analysis the CTR picker uses:
  // uplift_clicks/mo * aov_per_click * gp_pct.
  const currentCtr = ctrForRank(top.best_rank_group);
  const targetCtr  = ctrForRank(targetRank);
  const sv         = Number(top.search_volume) || 0;
  const upliftMonthlyClicks = Math.max(0, sv * (targetCtr - currentCtr));
  const aov   = estimatedAovPerClick(tierId);
  const gpPct = estimatedGpPctForTier(tierId);
  const revLift = Math.round(upliftMonthlyClicks * aov);
  const gpLift  = Math.round(revLift * (gpPct / 100));
  const builderArgs = { cleanedUrl, keyword: top.keyword, rank: top.best_rank_group, sv: top.search_volume };
  return {
    signature: `rank|${top.keyword}|${cleanedUrl}`,
    title: `Lift "${top.keyword}" from rank ${top.best_rank_group} to top ${targetRank}`,
    description: buildRankDescription(builderArgs, { title: auditState.title, schemaTypes: auditState.schemaTypes }, '[data: last audit]'),
    pages_affected: cleanedUrl ? [cleanedUrl] : [],
    primary_kpi: 'rank_position',
    kpi_baseline_value: Number(top.best_rank_group),
    kpi_target_value: targetRank,
    kpi_target_direction: 'down',
    estimated_lift: `Rank ${top.best_rank_group} \u2192 top ${targetRank} on a ${sv.toLocaleString()}/mo keyword \u2192 ~£${revLift.toLocaleString()}/mo revenue \u2192 ~£${gpLift.toLocaleString()}/mo profit at ${gpPct}% GP`,
    estimated_lift_gbp_revenue: revLift,
    estimated_lift_gbp_profit: gpLift,
    lever_id: 'rank',
    _rebuild: { type: 'rank', args: builderArgs }
  };
}

function buildAioDescription(args, pageState, sourceTag) {
  const { cleanedUrl, keyword, sv, rankInfo } = args;
  const schemaTypes = (pageState && pageState.schemaTypes) || [];
  const hasFaq = schemaTypes.includes('FAQPage');
  const hasCourse = schemaTypes.includes('Course');
  const schemaLine = schemaTypes.length
    ? `Schema present: ${schemaTypes.slice(0, 8).join(', ')}${hasFaq ? '' : ' — FAQPage missing.'}`
    : 'Schema present: none captured — FAQPage + the actual answer block both need adding.';
  const action = hasFaq
    ? `Action: FAQPage already present — append a 60–90 word direct-answer block at the top of the page mirroring the AIO summary, then extend the existing FAQPage with 3–5 question/answer pairs that match the People-Also-Ask cluster for "${keyword}".`
    : `Action: add a 60–90 word direct-answer block at the top of the page mirroring the AIO summary, then publish 5 question/answer pairs in FAQPage JSON-LD${hasCourse ? ' (you already have Course schema — extend with FAQPage in the same block)' : ''}.`;
  const base = `AI Overview exists for "${keyword}" (${sv.toLocaleString()}/mo) — you ${rankInfo} but aren't cited. Target page: ${cleanedUrl || '(no URL)'}. ${schemaLine} ${action}`;
  return sourceTag ? `${base} ${sourceTag}` : base;
}

function aioCitationPriority(tierId, tierKeywords, ctx) {
  // Re-rank uncited AIO keywords by GP-weighted potential rather than
  // raw search volume. A 1k/mo academy keyword (99% GP) outranks a
  // 5k/mo residential workshops keyword (35% GP) because the profit
  // captured per click is dramatically higher even at lower volume.
  const gpPct = estimatedGpPctForTier(tierId);
  const aov = estimatedAovPerClick(tierId);
  const uncited = tierKeywords
    .filter(k => !isBlogUrl(k.best_url || ''))
    .filter(k => k.has_ai_overview && !(Number(k.ai_alan_citations_count) > 0))
    .map(k => ({ kw: k, vol: Number(k.search_volume) || 0 }))
    // Assume an AIO citation captures ~3% of the AIO query volume as
    // an aggressive-but-realistic monthly click lift, then convert to
    // monthly profit via the tier's GP%.
    .map(x => ({ ...x, gpLift: Math.round(x.vol * 0.03 * aov * (gpPct / 100)) }))
    .sort((a, b) => b.gpLift - a.gpLift);
  if (!uncited.length) return null;
  const top = uncited[0];
  const cleanedUrl = cleanUrl(top.kw.best_url || '');
  const revLift = Math.round(top.vol * 0.03 * aov);
  const auditState = pageEnrichment(cleanedUrl, ctx.schemaDetail, ctx.keywords);
  const rankInfo = top.kw.best_rank_group != null ? `currently rank #${top.kw.best_rank_group}` : 'are not ranking yet';
  const builderArgs = { cleanedUrl, keyword: top.kw.keyword, sv: top.vol, rankInfo };
  return {
    signature: `aio|${top.kw.keyword}`,
    title: `Get cited in Google's AI Overview for "${top.kw.keyword}"`,
    description: buildAioDescription(builderArgs, { schemaTypes: auditState.schemaTypes }, '[data: last audit]'),
    pages_affected: cleanedUrl ? [cleanedUrl] : [],
    primary_kpi: 'aio_citations',
    kpi_baseline_value: 0,
    kpi_target_value: 1,
    kpi_target_direction: 'up',
    estimated_lift: `${top.vol.toLocaleString()}/mo AIO query \u00b7 ~£${revLift.toLocaleString()}/mo revenue \u2192 ~£${top.gpLift.toLocaleString()}/mo profit at ${gpPct}% GP`,
    estimated_lift_gbp_revenue: revLift,
    estimated_lift_gbp_profit: top.gpLift,
    lever_id: 'aio',
    _rebuild: { type: 'aio', args: builderArgs }
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
    estimated_lift: `Recover a £${Number(top.display_price_gbp) || 0} price-point product from zero-impression status`,
    lever_id: 'surfacing'
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
    estimated_lift: `Unlock SERP rich result for ${missing.join('/')}`,
    lever_id: 'schema'
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

// GP% per tier — mirrors the constants in revenue-funnel-summary.js.
// Used to convert revenue-side lift estimates ("£X potential")
// into PROFIT-side lift ("£X profit kept"), which is what the
// smart-priorities ranker should optimise for. Workshops splits
// residential (35%) vs nonres (75%); the smart-priorities engine still
// uses the legacy "workshops" mega-tier, so we use the conservative 55%
// blend until that's refactored. Hire blends prints+commissions.
const GP_PCT_PER_TIER = {
  workshops: 55,
  workshops_residential: 35,
  workshops_nonres: 75,
  courses: 90,
  services: 78,
  hire: 92,
  academy: 99
};
function estimatedGpPctForTier(tierId) {
  return GP_PCT_PER_TIER[tierId] != null ? GP_PCT_PER_TIER[tierId] : 60;
}
function estimatedGpPerClick(tierId) {
  return estimatedAovPerClick(tierId) * (estimatedGpPctForTier(tierId) / 100);
}

// ----------------------------------------------------------------------
// Master builder
// ----------------------------------------------------------------------
function buildPrioritiesForTier(tierId, tierData) {
  // ctx bundles the cross-page data the enrichment helpers need so each
  // picker can produce a research-validated description without re-fetching.
  const ctx = {
    schemaDetail: tierData.schemaDetail,
    keywords: tierData.allKeywords || tierData.keywords
  };
  const candidates = [
    schemaGapPriority(tierId, tierData.schemaDetail),
    ctrPriorityForTier(tierId, tierData.pages, ctx),
    rankPriorityForTier(tierId, tierData.keywords, ctx),
    aioCitationPriority(tierId, tierData.keywords, ctx),
    orphanProductPriority(tierId, tierData.products, tierData.pagesByUrl)
  ].filter(Boolean);
  return candidates;
}

// ----------------------------------------------------------------------
// Scenario-weighted sort (Phase F) + effort heuristics (Phase C)
// ----------------------------------------------------------------------
// Baseline GP-lift estimates for candidates that don't carry a numeric
// estimated_lift_gbp_profit (rank/schema/orphan are qualitative). These
// constants are NEVER displayed to the user - they exist only so the
// candidate participates in the weighted sort against tier_weight and
// lever_weight from the active scenario. Tuned so a baseline qualitative
// action sits below a typical CTR/AIO lift (~£100-300/mo) but can be
// boosted ABOVE them by a high tier+lever weight combination.
const BASELINE_LIFT_GBP_PROFIT_BY_LEVER = {
  rank: 120,
  schema: 60,
  surfacing: 50
};
// Phase C: time-and-effort heuristics keyed by lever_id. effort_hours
// is "person-time to do the action once" (Alan's hands on keyboard).
// time_to_realise_days is "calendar days from action ship to measurable
// move" (so the user sees not just the lift but how long they have to
// wait for it). Values are conservative averages tuned against Alan's
// own playbook on alanranger.com.
const EFFORT_BY_LEVER = {
  ctr:       { effort_hours: 0.5, time_to_realise_days: 14, label: 'Rewrite title + meta description (in Squarespace).' },
  rank:      { effort_hours: 4.0, time_to_realise_days: 60, label: 'Content depth pass: head term into title + H1, 250-400w body extension, 6-8 FAQ items, hub backlinks.' },
  aio:       { effort_hours: 2.0, time_to_realise_days: 30, label: '60-90 word direct-answer block + FAQPage JSON-LD with 5 Q/A pairs.' },
  schema:    { effort_hours: 1.0, time_to_realise_days: 14, label: 'Drop the missing JSON-LD block into the hub page <head>.' },
  surfacing: { effort_hours: 2.0, time_to_realise_days: 21, label: 'Add to hub product grid + 250-400w product page + one blog backlink.' }
};
const WEIGHT_ZERO_THRESHOLD = 0.05; // <= treat as "park this tier/lever"

function effortFor(leverId) {
  return EFFORT_BY_LEVER[leverId] || { effort_hours: null, time_to_realise_days: null, label: null };
}

function effectiveLiftForSort(candidate) {
  const numeric = Number(candidate.estimated_lift_gbp_profit);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  return BASELINE_LIFT_GBP_PROFIT_BY_LEVER[candidate.lever_id] || 0;
}

// Resolves a weights bundle into the {tier:Fn, lever:Fn} lookup pair
// that the collector loop uses. Extracted from buildAllPriorities so
// the main function's cognitive complexity stays under 15.
function makeWeightLookups(weights) {
  const tierMap  = (weights && weights.tier)  || new Map();
  const leverMap = (weights && weights.lever) || new Map();
  return {
    tierWeightOf:  id => (tierMap.has(id)  ? Number(tierMap.get(id))  : 1),
    leverWeightOf: id => (leverMap.has(id) ? Number(leverMap.get(id)) : 1)
  };
}

// Decorates a raw picker candidate with the scenario-applied weights,
// the weighted_score the sorter uses, and the Phase C effort + £/hr
// heuristics. Returns null when the candidate's lever has been zeroed
// by the active scenario (caller filters those out).
function enrichCandidate(c, tier, tierWeight, leverWeightOf, snapshotPropertyUrl) {
  const leverWeight = leverWeightOf(c.lever_id);
  if (leverWeight <= WEIGHT_ZERO_THRESHOLD) return null;
  const effLift = effectiveLiftForSort(c);
  const weightedScore = effLift * tierWeight * leverWeight;
  const eff = effortFor(c.lever_id);
  const liftPerHour = (eff.effort_hours && eff.effort_hours > 0)
    ? Math.round(weightedScore / eff.effort_hours)
    : null;
  return {
    ...c,
    property_url: snapshotPropertyUrl,
    tier_id: tier.id,
    tier_label: tier.label,
    status: 'not_started',
    applied_tier_weight: tierWeight,
    applied_lever_weight: leverWeight,
    weighted_score: weightedScore,
    effort_hours: eff.effort_hours,
    time_to_realise_days: eff.time_to_realise_days,
    effort_label: eff.label,
    lift_per_hour_gbp: liftPerHour
  };
}

function tierSnapshotSlice(snapshot, tierId, hub) {
  return {
    hubUrl: hub.hubUrl,
    schemaDetail: snapshot.schemaDetail,
    pages: snapshot.pagesByTier.get(tierId) || [],
    pagesByUrl: snapshot.pagesByUrl,
    keywords: snapshot.keywordsByTier.get(tierId) || [],
    allKeywords: snapshot.allKeywords || [],
    products: snapshot.productsByTier.get(tierId) || []
  };
}

function buildAllPriorities(snapshot, weights) {
  // First, collect every tier's candidates without sort_order. We then
  // sort ALL candidates by scenario-WEIGHTED GP lift so the top of the
  // priority queue reflects the active scenario's tier + lever
  // strategic weights, not just raw GP-per-month estimates.
  //
  // weights = { tier: Map<tier_id, weight>, lever: Map<lever_id, weight>,
  //             scenario_id, scenario_name } - or null for flat weighting.
  const { tierWeightOf, leverWeightOf } = makeWeightLookups(weights);
  const collected = [];
  for (const tier of COMMERCIAL_TIERS) {
    const hub = tierHub(tier.id);
    if (!hub) continue;
    const tierWeight = tierWeightOf(tier.id);
    if (tierWeight <= WEIGHT_ZERO_THRESHOLD) continue;
    const cands = buildPrioritiesForTier(tier.id, tierSnapshotSlice(snapshot, tier.id, hub));
    for (const c of cands) {
      const enriched = enrichCandidate(c, tier, tierWeight, leverWeightOf, snapshot.propertyUrl);
      if (enriched) collected.push(enriched);
    }
  }
  collected.sort((a, b) => {
    const aScore = Number(a.weighted_score) || 0;
    const bScore = Number(b.weighted_score) || 0;
    if (aScore !== bScore) return bScore - aScore;
    // Secondary tiebreaker: raw numeric profit lift (so genuinely-bigger
    // numeric actions beat baseline-lift qualitative ones when scores tie).
    const aProf = Number(a.estimated_lift_gbp_profit) || 0;
    const bProf = Number(b.estimated_lift_gbp_profit) || 0;
    if (aProf !== bProf) return bProf - aProf;
    return 0;
  });
  return collected.map((c, i) => ({ ...c, sort_order: (i + 1) * 10 }));
}

// Named export bundle used by other endpoints (e.g. the auto-optimise
// solver) so they can re-run the same picker with arbitrary weight
// combinations rather than having to hit this endpoint over HTTP.
// Kept at module scope - resolved via dynamic `import()` from siblings
// so the Vercel build still treesakes everything that's never used.
export const __INTERNAL = {
  buildSnapshot:                    (s, u) => buildSnapshot(s, u),
  buildAllPriorities:               (s, w) => buildAllPriorities(s, w),
  liveEnrichTopCandidates:          (c)    => liveEnrichTopCandidates(c),
  fetchActiveScenarioWeights:       (s, u) => fetchActiveScenarioWeights(s, u),
  EFFORT_BY_LEVER:                  EFFORT_BY_LEVER,
  BASELINE_LIFT_GBP_PROFIT_BY_LEVER: BASELINE_LIFT_GBP_PROFIT_BY_LEVER
};

// Fetches the active scenario's tier + lever weights for a property,
// or returns null if no active scenario exists or the engine tables
// are empty. The caller (handler) must tolerate null and fall back to
// flat 1.0 weighting so smart-priorities stays usable on a fresh
// install.
async function fetchActiveScenarioWeights(supabase, propertyUrl) {
  try {
    const { data: scenarioRows, error: sErr } = await supabase
      .from('revenue_funnel_scenarios')
      .select('id, name')
      .eq('property_url', propertyUrl)
      .eq('is_active', true)
      .limit(1);
    if (sErr) throw sErr;
    const scenario = (scenarioRows || [])[0];
    if (!scenario) return null;

    const [{ data: tierRows }, { data: leverRows }] = await Promise.all([
      supabase
        .from('revenue_funnel_tier_weights')
        .select('tier_id, strategic_weight')
        .eq('scenario_id', scenario.id),
      supabase
        .from('revenue_funnel_lever_weights')
        .select('lever_id, strategic_weight')
        .eq('scenario_id', scenario.id)
    ]);
    const tier  = new Map();
    const lever = new Map();
    for (const r of (tierRows  || [])) tier.set(r.tier_id,  Number(r.strategic_weight));
    for (const r of (leverRows || [])) lever.set(r.lever_id, Number(r.strategic_weight));
    return { scenario_id: scenario.id, scenario_name: scenario.name, tier, lever };
  } catch (e) {
    // If the scenario tables don't exist yet (fresh install) or any other
    // read error happens, fall back to flat weighting so the picker
    // continues to produce candidates instead of 500-ing.
    return null;
  }
}

// ----------------------------------------------------------------------
// Live-validation post-pass (Phase 2.0)
// ----------------------------------------------------------------------
// The top N candidates (those actually rendered in the "Do these 3
// things this week" card and the rest of the priority queue UI) get
// their pageState refreshed from a live fetch of the target URL. The
// description body is then regenerated using the live data so the
// card never recommends "add FAQPage schema" when FAQPage is already
// on the live page (the audit row may be hours out of date).
//
// Candidates BEYOND the top N keep their audit-derived description
// with a [data: last audit] tag so the user can see why those facts
// might be stale.
const LIVE_VALIDATE_TOP_N = 8;
const REBUILDERS = { ctr: buildCtrDescription, rank: buildRankDescription, aio: buildAioDescription };

async function liveEnrichTopCandidates(candidates) {
  const head = candidates.slice(0, LIVE_VALIDATE_TOP_N).filter(c => c._rebuild);
  if (!head.length) return candidates;
  const urls = head.map(c => Array.isArray(c.pages_affected) ? c.pages_affected[0] : null).filter(Boolean);
  const liveMap = await validateUrlsLive(urls);
  for (const c of head) {
    const url = Array.isArray(c.pages_affected) ? c.pages_affected[0] : null;
    if (!url) continue;
    const live = liveMap.get(url);
    const rebuilder = REBUILDERS[c._rebuild.type];
    if (!rebuilder) continue;
    if (live && live.ok) {
      c.description = rebuilder(c._rebuild.args, {
        title: live.title,
        metaDescription: live.metaDescription,
        h1: live.h1,
        schemaTypes: live.schemaTypes
      }, `[live · fetched ${shortIso(live.fetchedAt)}]`);
      c.live_data_source = 'live';
      c.live_fetched_at = live.fetchedAt;
    } else {
      c.live_data_source = 'audit_fallback';
      c.live_fetch_error = live && live.error;
    }
  }
  return candidates;
}

function shortIso(iso) {
  if (!iso) return '';
  // 2026-05-20T13:42:09.123Z -> 2026-05-20 13:42Z
  return String(iso).replace('T', ' ').slice(0, 16) + 'Z';
}

// Strip internal-only fields from a candidate before it goes over the
// wire. `_rebuild` carries the data the live-enrichment post-pass uses
// to regenerate the description; it's an implementation detail.
function sanitiseForResponse(c) {
  const out = { ...c };
  delete out._rebuild;
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
  // allKeywords is the un-tier-grouped keyword list. The page-enrichment
  // helper (topKeywordForPage) needs to find a keyword for a CTR-picked
  // page even when that page sits in a different tier than the keyword's
  // tier classification — e.g. the academy free-online-photography-course
  // hub ranks for "online photography course" which keyword-classifies as
  // 'courses' on URL prefix. Without the global pool, the enricher misses
  // the head term entirely and we're back to generic prose.
  return { propertyUrl, schemaDetail, pagesByUrl, pagesByTier, keywordsByTier, productsByTier, allKeywords: keywords };
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
    const [snapshot, weights] = await Promise.all([
      buildSnapshot(supabase, propertyUrl),
      fetchActiveScenarioWeights(supabase, propertyUrl)
    ]);
    const candidates = buildAllPriorities(snapshot, weights);
    // Live-validate the top N candidates so their descriptions cite
    // the current live page state, not a possibly-stale audit row.
    // See Docs/CHANGELOG.md 2026-05-20 v5 for why this is non-optional.
    await liveEnrichTopCandidates(candidates);

    // Convert the weights Maps into plain objects so the response is
    // JSON-serialisable. null when no active scenario exists - caller
    // can detect that case and not render "Boosted by scenario X" UI.
    const scenarioContext = weights ? {
      scenario_id: weights.scenario_id,
      scenario_name: weights.scenario_name,
      tier_weights: Object.fromEntries(weights.tier),
      lever_weights: Object.fromEntries(weights.lever)
    } : null;

    if (req.method === 'GET') {
      return send(res, 200, {
        property_url: propertyUrl,
        generated_at: new Date().toISOString(),
        candidate_count: candidates.length,
        active_scenario: scenarioContext,
        candidates: candidates.map(c => ({
          tier_id: c.tier_id, tier_label: c.tier_label, signature: c.signature,
          title: c.title, description: c.description, pages_affected: c.pages_affected,
          primary_kpi: c.primary_kpi, kpi_baseline_value: c.kpi_baseline_value,
          kpi_target_value: c.kpi_target_value, kpi_target_direction: c.kpi_target_direction,
          estimated_lift: c.estimated_lift,
          estimated_lift_gbp_revenue: c.estimated_lift_gbp_revenue ?? null,
          estimated_lift_gbp_profit: c.estimated_lift_gbp_profit ?? null,
          lever_id: c.lever_id ?? null,
          applied_tier_weight: c.applied_tier_weight ?? null,
          applied_lever_weight: c.applied_lever_weight ?? null,
          weighted_score: c.weighted_score ?? null,
          effort_hours: c.effort_hours ?? null,
          time_to_realise_days: c.time_to_realise_days ?? null,
          effort_label: c.effort_label ?? null,
          lift_per_hour_gbp: c.lift_per_hour_gbp ?? null,
          live_data_source: c.live_data_source ?? 'audit',
          live_fetched_at: c.live_fetched_at ?? null,
          live_fetch_error: c.live_fetch_error ?? null
        }))
      });
    }

    const cleanCandidates = candidates.map(sanitiseForResponse);
    let saved;
    if (mode === 'append') saved = await applyAppend(supabase, propertyUrl, cleanCandidates);
    else saved = await applyReplace(supabase, propertyUrl, cleanCandidates);

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
