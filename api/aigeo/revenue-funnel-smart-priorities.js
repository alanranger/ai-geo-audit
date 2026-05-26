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
import { loadBlendedSeasonality, factorFromBlend } from '../../lib/revenue-funnel-seasonality-blend.js';
import { academyTierHealth } from '../../lib/revenue-funnel-academy-economics.js';
import { readLatestGa4Metrics } from './ga4-data.js';
import {
  applyFunnelConversionBias,
  buildConversionGapCandidate,
  conversionHealthFromMetrics
} from '../../lib/revenue-funnel-conversion-bias.js';
import {
  applyKeywordGuardrails,
  safeTitleLead,
  intentClassForUrl
} from '../../lib/revenue-funnel-keyword-guardrails.js';
import {
  pickKeywordForPage,
  buildSerpCopyAdvice,
  keywordMatchesUrlIntent
} from '../../lib/revenue-funnel-serp-copy.js';
import {
  classifyQueryIntent,
  classifyPageScope,
  pWinCitation,
  liftRange,
  shouldRerouteToLocal,
  findKeywordRowByText,
  EVIDENCE,
  TASK_TYPE
} from '../../lib/revenue-funnel-aio-model.js';
import { scanLiabilities, detectFluffyOpener } from '../../lib/revenue-funnel-page-liability.js';

// True average booking value per tier (matches AOV_BY_TIER in
// revenue-funnel-summary.js). Used to split the per-click revenue
// figure into TRUE AOV + booking conversion rate inside the AIO model's
// assumption stack, so the user no longer sees "Tier AOV £2" for a
// page selling £150–£495 courses (defect 2, 2026-05-26).
const TRUE_AOV_BY_TIER = { workshops: 250, courses: 200, services: 100, hire: 200, academy: 79 };
const BOOKING_CONV_RATE_BY_TIER = { workshops: 0.01, courses: 0.01, services: 0.01, hire: 0.01, academy: 0.01 };
function trueAovForTier(tierId) {
  return TRUE_AOV_BY_TIER[tierId] || 150;
}
function bookingConvRateForTier(tierId) {
  return BOOKING_CONV_RATE_BY_TIER[tierId] || 0.01;
}

let activeBlendedSeasonality = null;

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

// Per-URL assigned keyword overrides from the Traditional SEO tab.
// 2026-05-26 defect fix: the AIO picker was rerouting to whatever
// local variant had the most search volume, ignoring the user's
// explicit assignment. Surface the override here so the picker can
// honour it before any heuristic reroute fires.
async function fetchTargetKeywordOverrides(supabase, propertyUrl) {
  try {
    const { data, error } = await supabase
      .from('traditional_seo_target_keyword_overrides')
      .select('page_url, target_keyword')
      .eq('property_url', propertyUrl);
    if (error) {
      if (/does not exist/i.test(String(error.message || ''))) return new Map();
      throw error;
    }
    const map = new Map();
    for (const row of (data || [])) {
      if (row && row.page_url && row.target_keyword) {
        map.set(String(row.page_url).trim(), String(row.target_keyword).trim());
      }
    }
    return map;
  } catch {
    return new Map();
  }
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
  const curated = pickKeywordForPage(cleanedUrl, keywords);
  if (curated) return curated;
  let best = null;
  let bestVol = -1;
  for (const k of keywords) {
    if (cleanUrl(k.best_url || '') !== cleanedUrl) continue;
    if (!keywordMatchesUrlIntent(k.keyword, cleanedUrl)) continue;
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
function diagnoseLowCtr({ ctrPct, avgPosition, title, meta, topKw, serpComplete }) {
  if (serpComplete) {
    return 'SERP title and meta are on target for this hub — monitor CTR in GSC; next gains are likely rank or rich results, not another title/meta rewrite.';
  }
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
function buildCtrDescription(args, pageState, sourceTag, opts) {
  const { cleanedUrl, top, posTxt, kwInfo } = args;
  const title = pageState && pageState.title;
  const meta = pageState && pageState.metaDescription;
  const schemaTypes = (pageState && pageState.schemaTypes) || [];
  const serpComplete = !!(opts && opts.serpComplete);
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
    topKw: kwInfo ? { keyword: kwInfo.keyword } : null,
    serpComplete
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

// 2026-05-26 defect-fix: the description is now intentionally lean.
// The full "do this, in order" plan lives in `recommended_actions[]`
// and renders below. The Why block should NOT duplicate or contradict
// that plan — it states the OPPORTUNITY + the EVIDENCE, then defers
// to the rendered task list. Prior copy ("Action: FAQPage already
// present — append… extend the existing FAQPage with 3-5 Q/A pairs…")
// was rendered before the plan list AND contradicted the post-fix
// REWRITE tasks. Removed here.
//
// FAQ schema deprecation note (HEURISTIC): Google has announced FAQ
// rich results are being removed from SERPs (rolling out 2026). The
// FAQPage JSON-LD itself is no longer a meaningful ranking lever; the
// value is in the rendered Q&A content (extractable for AIO/LLM
// answer-stitching). How much LLMs weight FAQPage vs plain prose is
// unproven, so we surface this in the Why block as HEURISTIC.
function buildAioDescription(args, pageState, sourceTag) {
  const { cleanedUrl, keyword, sv, rankInfo, assignedKeyword } = args;
  const schemaTypes = (pageState && pageState.schemaTypes) || [];
  const schemaLine = schemaTypes.length
    ? `Schema present: ${schemaTypes.slice(0, 8).join(', ')}.`
    : 'Schema present: none captured.';
  const overrideLine = assignedKeyword
    ? `Assigned target keyword (Traditional SEO): "${assignedKeyword}".`
    : '';
  const opportunity = `AI Overview exists for "${keyword}" (${sv.toLocaleString()}/mo) — you ${rankInfo} but aren't cited. Target page: ${cleanedUrl || '(no URL)'}.`;
  const faqNote = `FAQ rich results note: Google is removing FAQ rich results from SERPs in 2026 — FAQPage JSON-LD is no longer a meaningful SERP lever. The value is the rendered Q&A content (how heavily AIO/LLMs weight it is unproven — heuristic).`;
  const base = [opportunity, overrideLine, schemaLine, faqNote].filter(Boolean).join(' ');
  return sourceTag ? `${base} ${sourceTag}` : base;
}

// 2026-05-26: AIO scoring rewritten to use probabilistic P(win) model.
// See lib/revenue-funnel-aio-model.js for the full assumption stack.
// `pickAioTarget` selects the highest expected-GP keyword across the
// tier, applying local-page rerouting and the rank-aware P(win) curve.
//
// 2026-05-26 phase J fix: the picker now also honours the assigned
// keyword from `traditional_seo_target_keyword_overrides`. The Coventry
// courses page is a textbook case — it had an assigned keyword
// "Photography Courses Coventry" but the picker was substituting the
// higher-volume local variant "photography courses near me", which the
// user (correctly) flagged as ignoring his explicit assignment.
function pickAioTarget(tierId, tierKeywords, ctx) {
  const gpPct = estimatedGpPctForTier(tierId);
  const aov = trueAovForTier(tierId);
  const convRate = bookingConvRateForTier(tierId);
  const uncited = (tierKeywords || [])
    .filter(k => !isBlogUrl(k.best_url || ''))
    .filter(k => k.has_ai_overview && !(Number(k.ai_alan_citations_count) > 0));
  if (!uncited.length) return null;
  const scored = uncited.map(k => scoreAioCandidate(k, ctx, gpPct, aov, convRate));
  scored.sort((a, b) => b.range.profit.expected - a.range.profit.expected);
  return { gpPct, aov, convRate, top: scored[0] };
}

function scoreAioCandidate(kw, ctx, gpPct, aov, convRate) {
  const cleanedUrl = cleanUrl(kw.best_url || '');
  const pageScope = classifyPageScope(intentClassForUrl(cleanedUrl));
  const assignedKeyword = lookupAssignedKeyword(ctx.targetKeywordOverrides, cleanedUrl);
  const targetSelection = selectAioTargetKeyword({ kw, cleanedUrl, pageScope, ctx, assignedKeyword });
  const targetKw = targetSelection.target;
  const targetIntent = classifyQueryIntent(targetKw.keyword);
  const pwin = pWinCitation(targetKw.best_rank_group, targetIntent, pageScope, 'neutral');
  const range = liftRange({
    volume: Number(targetKw.search_volume) || 0,
    pWin: pwin.p, captureRate: 0.03, aov, conversionRate: convRate, gpPct
  });
  return {
    originalKw: kw,
    kw: targetKw,
    cleanedUrl,
    pageScope,
    queryIntent: targetIntent,
    pwin,
    range,
    reroute: targetSelection.reroute,
    assignedKeyword,
    selectionSource: targetSelection.source,
    overrideStatus: targetSelection.override_status
  };
}

// Resolve which keyword to model the AIO opportunity around. Priority:
//   1. The URL's assigned keyword (traditional_seo_target_keyword_overrides)
//      if that keyword has AIO data — never overridden by a heuristic.
//   2. If no override OR the override has no AIO data, run the existing
//      local-variant reroute heuristic (national head term on a local
//      page that ranks >20).
//   3. Otherwise the original keyword the picker fed us.
//
// 2026-05-26 defect A fix: when an assigned keyword EXISTS but has no
// AIO data in keyword_rankings, we MUST NOT silently fall back. The
// fallback target is still used (the user still gets actionable
// recommendations), but `override_status` carries the reason so the
// UI can surface a visible "Assigned KW 'X' has no AIO data — using
// fallback Y" note.
function selectAioTargetKeyword(opts) {
  const { kw, pageScope, ctx, assignedKeyword } = opts;
  const allKeywords = ctx.allKeywords || ctx.keywords || [];
  let overrideStatus = null;
  if (assignedKeyword) {
    const row = findKeywordRowByText(assignedKeyword, allKeywords);
    if (row && row.has_ai_overview) {
      return {
        target: row,
        source: 'override',
        reroute: { reroute: false, reason: 'override_present' },
        override_status: { applied: true }
      };
    }
    overrideStatus = row
      ? { applied: false, reason: 'override_keyword_no_aio_data' }
      : { applied: false, reason: 'override_keyword_not_in_data' };
  }
  const reroute = shouldRerouteToLocal({
    pageScope,
    queryIntent: classifyQueryIntent(kw.keyword),
    rank: kw.best_rank_group,
    keyword: kw.keyword,
    keywords: allKeywords
  });
  if (reroute.reroute) return { target: reroute.target, source: 'reroute_local', reroute, override_status: overrideStatus };
  return { target: kw, source: 'original', reroute, override_status: overrideStatus };
}

function buildAioRerouteNote(top) {
  if (top.selectionSource === 'override') {
    return `Using assigned keyword "${top.kw.keyword}" from the Traditional SEO target-keyword override.`;
  }
  const reroute = top.reroute;
  if (!reroute || !reroute.reroute) return null;
  return `Re-routed off national head term "${top.originalKw.keyword}" `
    + `(this URL ranks #${top.originalKw.best_rank_group} for it; P(win citation) is too low). `
    + `Local variant "${reroute.target.keyword}" is the higher-probability target on a local-business page.`;
}

// 2026-05-26 defect A: when the URL has an assigned KW but it can't
// be used (no AIO data / not in keyword_rankings), surface a visible
// note so the user knows the override is being honoured-as-best-can-be,
// NOT silently discarded.
function buildAioOverrideStatusNote(top) {
  const st = top && top.overrideStatus;
  if (!st || st.applied) return null;
  const fallback = top.kw && top.kw.keyword;
  if (st.reason === 'override_keyword_no_aio_data') {
    return `Assigned keyword "${top.assignedKeyword}" has no AI Overview data in the latest keyword sync — using fallback "${fallback}" for the model. Re-sync that keyword to use the assignment.`;
  }
  if (st.reason === 'override_keyword_not_in_data') {
    return `Assigned keyword "${top.assignedKeyword}" is not in the keyword_rankings dataset — using fallback "${fallback}". Add the keyword to the next sync to honour the override.`;
  }
  return null;
}

function aioCitationPriority(tierId, tierKeywords, ctx) {
  const picked = pickAioTarget(tierId, tierKeywords, ctx);
  if (!picked) return null;
  const { top } = picked;
  const { kw, cleanedUrl, pageScope, queryIntent, pwin, range, assignedKeyword, selectionSource } = top;
  const auditState = pageEnrichment(cleanedUrl, ctx.schemaDetail, ctx.keywords);
  const rankInfo = kw.best_rank_group != null ? `currently rank #${kw.best_rank_group}` : 'are not ranking yet';
  const builderArgs = {
    cleanedUrl, keyword: kw.keyword, sv: Number(kw.search_volume) || 0, rankInfo,
    pageScope, queryIntent, pWin: pwin.p, range,
    assignedKeyword, selectionSource
  };
  const rerouteNote = buildAioRerouteNote(top);
  const overrideStatusNote = buildAioOverrideStatusNote(top);
  return {
    signature: `aio|${kw.keyword}`,
    title: `Get cited in Google's AI Overview for "${kw.keyword}"`,
    description: buildAioDescription(builderArgs, { schemaTypes: auditState.schemaTypes }, '[data: last audit]'),
    pages_affected: cleanedUrl ? [cleanedUrl] : [],
    primary_kpi: 'aio_citations',
    kpi_baseline_value: 0, kpi_target_value: 1, kpi_target_direction: 'up',
    estimated_lift: `${(Number(kw.search_volume) || 0).toLocaleString()}/mo AIO query`
      + ` \u00b7 P(win) ${(pwin.p * 100).toFixed(0)}%`
      + ` \u00b7 expected ~£${range.profit.expected.toLocaleString()}/mo GP`
      + ` (range £${range.profit.low.toLocaleString()}\u2013£${range.profit.high.toLocaleString()})`,
    estimated_lift_gbp_revenue: range.revenue.expected,
    estimated_lift_gbp_profit: range.profit.expected,
    lift_range: range,
    aio_assumption_stack: range.assumption_stack,
    aio_pwin_stack: pwin.stack,
    aio_page_scope: pageScope,
    aio_query_intent: queryIntent,
    aio_reroute_note: rerouteNote,
    aio_rerouted: top.selectionSource === 'reroute_local',
    aio_used_override: top.selectionSource === 'override',
    aio_assigned_keyword: assignedKeyword || null,
    aio_override_status: top.overrideStatus || null,
    aio_override_status_note: overrideStatusNote,
    aio_aov_flag: range.aov_flag || null,
    aio_conv_flag: range.conv_flag || null,
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
  surfacing: 50,
  conversion: 180
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
  surfacing: { effort_hours: 2.0, time_to_realise_days: 21, label: 'Add to hub product grid + 250-400w product page + one blog backlink.' },
  conversion: { effort_hours: 2.0, time_to_realise_days: 21, label: 'Tighten enquiry → sale on money pages: form UX, offer clarity, checkout path.' }
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

// Quadratic weight sensitivity. Squaring both tier and lever weights
// inside the score formula means a 2.0 weight counts 4x (not 2x) and
// a 0.5 weight counts 0.25 (not 0.5). This makes the picker much
// more responsive to realistic strategic preferences (Easy/Balanced/
// Hard weights typically span 0.2 - 2.0) without hiding the obvious
// data-driven leaders. A 1.0 default stays at 1.0 so it remains the
// neutral pivot.
//
// Rationale: with linear weighting (effLift * tier * lever) the
// absolute-lift gap of ~5x between CTR/academy (~£275) and the next
// candidate dominates everything except deliberately extreme weights
// (>3.0 or <0.05). Squaring tightens the strategic distinction so a
// modest 1.5 vs 0.5 difference (a 3x linear ratio) becomes a 9x
// quadratic ratio - meaningful enough to re-rank candidates with
// similar absolute lifts.
function applyWeightShape(w) {
  const n = Number(w);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n * n;
}

// Decorates a raw picker candidate with the scenario-applied weights,
// the weighted_score the sorter uses, and the Phase C effort + £/hr
// heuristics. Returns null when the candidate's lever has been zeroed
// by the active scenario (caller filters those out).
function enrichCandidate(c, tier, tierWeight, leverWeightOf, snapshotPropertyUrl) {
  const leverWeight = leverWeightOf(c.lever_id);
  if (leverWeight <= WEIGHT_ZERO_THRESHOLD) return null;
  const effLift = effectiveLiftForSort(c);
  const shapedTier  = applyWeightShape(tierWeight);
  const shapedLever = applyWeightShape(leverWeight);
  const weightedScore = effLift * shapedTier * shapedLever;
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
    applied_tier_weight_shaped: shapedTier,
    applied_lever_weight_shaped: shapedLever,
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

// Penalty applied to weighted_score when a candidate URL is already in
// active monitoring for the matching KPI. The point isn't to hide the
// candidate - it's to let GENUINELY FRESH opportunities below it in
// the rank list bubble up to the Top 3.
//
// block (<30d):   0.10  - kill ranking, the user has just changed it
// downgrade:      0.45  - half-rank, give the existing change air
// stale (>90d):   0.65  - light penalty, still worth showing because
//                         it now needs a different angle and a fresh
//                         entry would still beat it unless the second-
//                         best candidate is roughly half its lift
const SUPPRESSION_SCORE_FACTOR = { block: 0.10, downgrade: 0.45, stale: 0.65 };

function applySuppressionPenaltyToCandidate(c, suppressionMap) {
  if (!suppressionMap || !suppressionMap.size) return c;
  const url = Array.isArray(c.pages_affected) ? c.pages_affected[0] : null;
  const supp = findSuppressionFor(suppressionMap, url, c.lever_id);
  const verdict = suppressionVerdict(supp);
  if (!verdict.suppress) return c;
  const factor = SUPPRESSION_SCORE_FACTOR[verdict.severity] || 1.0;
  c.weighted_score_raw = c.weighted_score;
  c.weighted_score = (Number(c.weighted_score) || 0) * factor;
  c.suppression_score_factor = factor;
  c.suppression_preview = {
    severity: verdict.severity,
    note: verdict.note,
    cycle_no: supp.cycle_no,
    objective: supp.objective_title,
    kpi: supp.primary_kpi,
    days_running: supp.days_running
  };
  return c;
}

function validationWeightsFor(key) {
  const flat = { academy: 1, courses: 1, workshops_nonres: 1, workshops_residential: 1, services: 1, hire: 1 };
  const tier = new Map(Object.entries(flat));
  const lever = new Map(Object.entries({ ctr: 1, schema: 1, aio: 1, rank: 1, surfacing: 1, conversion: 1 }));
  if (key === 'workshops_peak') {
    tier.set('workshops_nonres', 2.5);
    tier.set('workshops_residential', 2.5);
    tier.set('courses', 0.6);
    return { scenario_id: null, scenario_name: 'Validation: workshops peak', tier, lever };
  }
  if (key === 'services_opportunity') {
    tier.set('services', 2.4);
    tier.set('hire', 2.4);
    tier.set('courses', 0.7);
    return { scenario_id: null, scenario_name: 'Validation: services opportunity', tier, lever };
  }
  return null;
}

function academyReviewCandidate(health, propertyUrl) {
  if (!health || !health.suppress_academy_picker) return null;
  const m0 = (health.months && health.months[0]) || {};
  const m1 = (health.months && health.months[1]) || {};
  return {
    tier_id: 'academy',
    tier_label: 'Academy',
    lever_id: 'conversion',
    signature: 'academy-tier-review',
    title: 'REVIEW: keep Academy live?',
    description: `Academy net GP was negative for the last two closed months (e.g. ${m0.period_start || '?'}: £${m0.net_gp_gbp || 0} after £${health.monthly_fixed_cost_gbp}/mo costs). Trailing signups ~${m0.signups_est || 0}/mo vs minimum ${health.min_paid_signups_per_month}. Decide whether to freeze marketing, cut costs, or retire the tier.`,
    pages_affected: ['https://www.alanranger.com/free-online-photography-course'],
    primary_kpi: 'paid_signups',
    estimated_lift_gbp_revenue: 0,
    estimated_lift_gbp_profit: 0,
    weighted_score: 99999,
    property_url: propertyUrl,
    status: 'not_started',
    academy_economics: health
  };
}

async function fetchRollingRevenueSnap(supabase, propertyUrl) {
  const { data, error } = await supabase
    .from('revenue_snapshots')
    .select('period_start, period_end, transactions, revenue_amount')
    .eq('property_url', propertyUrl)
    .order('period_end', { ascending: false })
    .limit(12);
  if (error) throw error;
  const rows = data || [];
  if (!rows.length) return null;
  const today = new Date().toISOString().slice(0, 10);
  const closed = rows.filter((r) => r.period_end <= today);
  const pick = (closed.length ? closed : rows)[0];
  return pick;
}

function buildAllPriorities(snapshot, weights, suppressionMap, pickerOpts) {
  // First, collect every tier's candidates without sort_order. We then
  // sort ALL candidates by scenario-WEIGHTED GP lift so the top of the
  // priority queue reflects the active scenario's tier + lever
  // strategic weights, not just raw GP-per-month estimates.
  //
  // weights = { tier: Map<tier_id, weight>, lever: Map<lever_id, weight>,
  //             scenario_id, scenario_name } - or null for flat weighting.
  const { tierWeightOf, leverWeightOf } = makeWeightLookups(weights);
  const academyHealth = pickerOpts && pickerOpts.academyHealth;
  const academyPenalty = academyHealth && academyHealth.suppress_academy_picker ? 0.08 : 1;
  const collected = [];
  const review = academyReviewCandidate(academyHealth, snapshot.propertyUrl);
  if (review) collected.push(review);
  const gap = buildConversionGapCandidate(pickerOpts && pickerOpts.conversionHealth, snapshot.propertyUrl);
  if (gap) collected.push(gap);
  for (const tier of COMMERCIAL_TIERS) {
    const hub = tierHub(tier.id);
    if (!hub) continue;
    let tierWeight = tierWeightOf(tier.id);
    if (tier.id === 'academy') tierWeight *= academyPenalty;
    if (tierWeight <= WEIGHT_ZERO_THRESHOLD) continue;
    const cands = buildPrioritiesForTier(tier.id, tierSnapshotSlice(snapshot, tier.id, hub));
    for (const c of cands) {
      const enriched = enrichCandidate(c, tier, tierWeight, leverWeightOf, snapshot.propertyUrl);
      if (enriched) {
        if (tier.id === 'academy' && academyPenalty < 1) {
          enriched.academy_economics = { badge: academyHealth.badge, under_minimum: academyHealth.under_minimum_signups };
        }
        applySuppressionPenaltyToCandidate(enriched, suppressionMap);
        collected.push(enriched);
      }
    }
  }
  return applyKeywordGuardrails(collected, snapshot);
}

// Named export bundle used by other endpoints (e.g. the auto-optimise
// solver) so they can re-run the same picker with arbitrary weight
// combinations rather than having to hit this endpoint over HTTP.
// Kept at module scope - resolved via dynamic `import()` from siblings
// so the Vercel build still treesakes everything that's never used.
// MONTH_NAMES + SEASONALITY_BY_TIER are declared further down so they
// can't be referenced as bare bindings up here (temporal dead zone).
// We expose them via getter functions so callers (the seasonality
// endpoint + auto-optimise) can read the values at call-time when the
// module has finished evaluating.
export const __INTERNAL = {
  buildSnapshot:                    (s, u)       => buildSnapshot(s, u),
  buildAllPriorities:               (s, w, sm, po) => buildAllPriorities(s, w, sm, po),
  applyKeywordGuardrails,
  liveEnrichTopCandidates:          (c, ctx)     => liveEnrichTopCandidates(c, ctx),
  fetchActiveScenarioWeights:       (s, u)       => fetchActiveScenarioWeights(s, u),
  fetchActiveOptimisationCycles:    (s)          => fetchActiveOptimisationCycles(s),
  buildSuppressionMap:              (rows)       => buildSuppressionMap(rows),
  currentMonthIndex:                (d)          => currentMonthIndex(d),
  seasonalityFor:                   (tier, m)    => seasonalityFor(tier, m),
  seasonalityBandFor:               (tier, m)    => seasonalityBandFor(tier, m),
  seasonalityLabel:                 (band)       => seasonalityLabel(band),
  get MONTH_NAMES()                              { return MONTH_NAMES; },
  get SEASONALITY_BY_TIER()                      { return SEASONALITY_BY_TIER; },
  setBlendedSeasonality:            (b) => { activeBlendedSeasonality = b; },
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

function liveStateFor(c, liveMap) {
  const url = Array.isArray(c.pages_affected) ? c.pages_affected[0] : null;
  return url ? liveMap.get(url) : null;
}

function applyLiveDescription(c, live) {
  if (!c._rebuild) return;
  const rebuilder = REBUILDERS[c._rebuild.type];
  if (rebuilder && live && live.ok) {
    c.description = rebuilder(c._rebuild.args, {
      title: live.title, metaDescription: live.metaDescription, h1: live.h1, schemaTypes: live.schemaTypes
    }, `[live · fetched ${shortIso(live.fetchedAt)}]`);
    c.live_data_source = 'live';
    c.live_fetched_at = live.fetchedAt;
    return;
  }
  c.live_data_source = 'audit_fallback';
  c.live_fetch_error = live && live.error;
}

function enrichOneCandidate(c, liveMap, suppressionMap, monthIdx) {
  const live = liveStateFor(c, liveMap);
  applyLiveDescription(c, live);
  const liveForActions = (live && live.ok) ? live : null;
  let actions = buildRecommendedActions(c, liveForActions);
  // Suppression: if this URL has an active monitoring cycle for the
  // matching KPI, downgrade or block the on-page actions.
  const url = Array.isArray(c.pages_affected) ? c.pages_affected[0] : null;
  const supp = findSuppressionFor(suppressionMap, url, c.lever_id);
  const verdict = suppressionVerdict(supp);
  if (verdict.suppress) {
    c.suppression = {
      severity: verdict.severity,
      note: verdict.note,
      cycle_no: supp.cycle_no,
      objective: supp.objective_title,
      kpi: supp.primary_kpi,
      days_running: supp.days_running
    };
    actions = applySuppressionToActions(actions, verdict);
  }
  c.recommended_actions = actions;
  if (c.lever_id === 'ctr' || (Array.isArray(c.merged_levers) && c.merged_levers.includes('ctr'))) {
    const url = Array.isArray(c.pages_affected) ? c.pages_affected[0] : '';
    const kw = (c._rebuild && c._rebuild.args && c._rebuild.args.kwInfo && c._rebuild.args.kwInfo.keyword)
      || c.primary_query || null;
    const serp = buildSerpCopyAdvice({
      pageUrl: url,
      rankingKw: kw,
      rank: c._rebuild && c._rebuild.args && c._rebuild.args.kwInfo && c._rebuild.args.kwInfo.rank,
      searchVolume: c._rebuild && c._rebuild.args && c._rebuild.args.kwInfo && c._rebuild.args.kwInfo.searchVolume,
      title: live && live.title,
      meta: live && live.metaDescription,
      h1: live && live.h1
    });
    if (serp.titleExample) c.title_example = serp.titleExample;
    if (serp.metaExample) c.meta_example = serp.metaExample;
    if (serp.metaExampleLength != null) c.meta_example_length = serp.metaExampleLength;
    if (serp.h1Recommendation) c.h1_recommendation = serp.h1Recommendation;
    if (serp.note) c.serp_advice_note = serp.note;
    if (serp.lead) c.safe_title_lead = serp.lead;
    if (serp.isHub) c.serp_is_hub = true;
    if (serp.serpComplete) {
      c.serp_complete = true;
      c.recommended_actions = [{
        step: 1,
        effort_hours: 0,
        confidence: 'high',
        tag: 'done',
        headline: 'SERP copy already matches',
        detail: 'Live title and meta match the recommended hub copy. This URL drops out of Top 3 until GSC shows a new lever (CTR move, rank, or AIO).'
      }];
      if (c._rebuild && c._rebuild.type === 'ctr') {
        const tag = c.live_fetched_at ? `[live · fetched ${shortIso(c.live_fetched_at)}]` : null;
        const ps = live && live.ok
          ? { title: live.title, metaDescription: live.metaDescription, schemaTypes: live.schemaTypes }
          : { title: null, metaDescription: null, schemaTypes: [] };
        c.description = buildCtrDescription(c._rebuild.args, ps, tag, { serpComplete: true });
      }
    }
  }
  // Seasonality scaling: applied LAST so suppression decisions are
  // made on raw lift (we don't want December gap-month to mask a
  // genuine on-page issue).
  applySeasonalityToCandidate(c, monthIdx);
}

async function liveEnrichTopCandidates(candidates, ctx) {
  const head = candidates.slice(0, LIVE_VALIDATE_TOP_N);
  const urls = head.map(c => Array.isArray(c.pages_affected) ? c.pages_affected[0] : null).filter(Boolean);
  const liveMap = urls.length ? await validateUrlsLive(urls) : new Map();
  const suppressionMap = (ctx && ctx.suppressionMap) || new Map();
  const monthIdx = (ctx && ctx.monthIdx != null) ? ctx.monthIdx : currentMonthIndex();
  for (const c of head) enrichOneCandidate(c, liveMap, suppressionMap, monthIdx);
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
// Optimisation-tracking suppression (2026-05-20 phase H+)
// ----------------------------------------------------------------------
// Alan correctly flagged that the picker was repeating recommendations
// for URLs that are ALREADY in active monitoring cycles. e.g. the
// "Free Online Photography Course" page has had a CTR>=2.5% cycle
// running since 2026-01-11 - so dropping a fresh "rewrite the title"
// card on it every week is exactly the "generic crap" he meant.
//
// This layer fetches the active monitoring cycles from
// optimisation_task_cycles + optimisation_tasks and exposes per-URL
// per-KPI metadata so the action builders can downgrade or annotate
// candidates whose work is already in flight.

const KPI_TO_LEVERS = {
  'ctr_28d':       ['ctr'],
  'ctr':           ['ctr'],
  'clicks':        ['ctr', 'rank'],
  'rank':          ['rank'],
  'rank_position': ['rank'],
  'ai_citations':  ['aio'],
  'aio':           ['aio']
};

const SUPPRESSION_WINDOW_DAYS = 30;   // < this since start = full suppression
const SUPPRESSION_STALE_DAYS  = 90;   // > this since start = "stalled, try a different angle"

// Active optimisation cycle statuses - these are the only legal values
// of the `optim_task_status` enum, do NOT add others or the query
// returns an enum-cast error and the whole suppression layer silently
// drops to zero (which is what happened the first time we shipped
// this).
const ACTIVE_CYCLE_STATUSES = ['monitoring', 'planned'];

async function fetchActiveOptimisationCycles(supabase) {
  try {
    const { data, error } = await supabase
      .from('optimisation_task_cycles')
      .select('task_id, cycle_no, status, primary_kpi, objective_title, start_date, end_date')
      .in('status', ACTIVE_CYCLE_STATUSES);
    if (error) {
      // Don't swallow silently - log so a future broken enum value
      // shows up in Vercel logs instead of just zero suppression.
      console.warn('[smart-priorities] fetchActiveOptimisationCycles cycles error:', error.message);
      return [];
    }
    if (!Array.isArray(data) || data.length === 0) return [];
    const taskIds = Array.from(new Set(data.map(r => r.task_id).filter(Boolean)));
    if (!taskIds.length) return [];
    const { data: tasks, error: taskErr } = await supabase
      .from('optimisation_tasks')
      .select('id, target_url_clean, task_type, title, keyword_text')
      .in('id', taskIds);
    if (taskErr) {
      console.warn('[smart-priorities] fetchActiveOptimisationCycles tasks error:', taskErr.message);
      return [];
    }
    const byTaskId = new Map();
    for (const t of (tasks || [])) byTaskId.set(t.id, t);
    return data
      .map(cycle => ({ cycle, task: byTaskId.get(cycle.task_id) }))
      .filter(x => x.task && x.task.target_url_clean && !x.task.target_url_clean.startsWith('/test-'));
  } catch (e) {
    console.warn('[smart-priorities] fetchActiveOptimisationCycles threw:', e && e.message);
    return [];
  }
}

function normaliseTrackingUrl(raw) {
  if (!raw) return '';
  let s = String(raw).trim();
  s = s.replace(/^https?:\/\//, '');
  if (s.startsWith('www.')) s = s.slice(4);
  return '/' + s.split('/').slice(1).join('/').replace(/\/$/, '');
}

// Map URL (cleaned to /path form) -> array of active cycle metadata.
// Cards in the picker can look up by their pages_affected[0] and decide
// whether to suppress/downgrade based on which KPIs are already in
// monitoring.
function buildSuppressionMap(rawCycles) {
  const map = new Map();
  const now = Date.now();
  for (const { cycle, task } of rawCycles) {
    const url = normaliseTrackingUrl(task.target_url_clean);
    if (!url) continue;
    const startTs = cycle.start_date ? new Date(cycle.start_date).getTime() : null;
    const daysRunning = startTs ? Math.round((now - startTs) / 86400000) : null;
    const entry = {
      cycle_no: cycle.cycle_no,
      status: cycle.status,
      primary_kpi: cycle.primary_kpi,
      objective_title: cycle.objective_title,
      task_type: task.task_type,
      days_running: daysRunning
    };
    if (!map.has(url)) map.set(url, []);
    map.get(url).push(entry);
  }
  return map;
}

function findSuppressionFor(suppressionMap, candidateUrl, leverId) {
  if (!suppressionMap || !candidateUrl) return null;
  const key = normaliseTrackingUrl(candidateUrl);
  const entries = suppressionMap.get(key);
  if (!entries || !entries.length) return null;
  for (const e of entries) {
    const levers = KPI_TO_LEVERS[e.primary_kpi] || [];
    if (levers.includes(leverId)) return e;
  }
  return null;
}

function suppressionVerdict(entry) {
  if (!entry) return { suppress: false };
  const d = entry.days_running;
  if (d == null) return { suppress: false };
  if (d < SUPPRESSION_WINDOW_DAYS) {
    return {
      suppress: true,
      severity: 'block',
      note: `Already in monitoring (cycle ${entry.cycle_no}, "${entry.objective_title || entry.primary_kpi}" started ${d}d ago). Give the previous change at least ${SUPPRESSION_WINDOW_DAYS}d before rewriting again — re-touching too soon makes the data unreadable.`
    };
  }
  if (d <= SUPPRESSION_STALE_DAYS) {
    return {
      suppress: true,
      severity: 'downgrade',
      note: `In monitoring (cycle ${entry.cycle_no}, "${entry.objective_title || entry.primary_kpi}" running ${d}d). Previous change is still earning attribution — only re-rewrite if the SERP title shown for this URL is clearly mismatched.`
    };
  }
  return {
    suppress: true,
    severity: 'stale',
    note: `In monitoring ${d}d with no closure — the previous title/meta change hasn't moved this KPI. Try a DIFFERENT angle this time (different head term, different meta hook) rather than another tweak of the same idea.`
  };
}

function applySuppressionToActions(actions, verdict) {
  if (!actions || !actions.length || !verdict || !verdict.suppress) return actions;
  if (verdict.severity === 'block') return [];
  return actions.map(a => {
    if (a.tag === 'title' || a.tag === 'meta' || a.tag === 'on-page' || a.tag === 'content') {
      return { ...a, confidence: 'low', suppressed: true, suppression_note: verdict.note };
    }
    return a;
  });
}

// ----------------------------------------------------------------------
// Seasonality (2026-05-20 phase H+)
// ----------------------------------------------------------------------
// Alan's activity calendar (from his own words):
//   Courses:         60% in Jan-May + Sep-Nov, lighter Jun-Aug + Dec
//   Workshops (NR):  80% in Apr-May + Sep-Nov (bluebells + autumn)
//   Workshops (Res): same shape as non-res, slightly broader shoulders
//   1-2-1 / Services: constant year-round - OPPORTUNITY for slow months
//   Hire / Commercial: sporadic year-round - OPPORTUNITY
//   Academy:         slight winter boost (people indoors)
//   Mentoring (RPS): year-round (zoom, weatherproof)
//
// This map multiplies the estimated_lift_gbp_* numbers per tier per
// month so the projected lift reflects the realistic cash-in-the-door
// shape rather than a flat annualised average. The model also feeds a
// per-tier "this month is X" pill so cards can say "push CTR on
// workshops NOW because Apr-May is your peak" vs "defer to next peak".

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const SEASONALITY_BY_TIER = {
  courses:              [1.30, 1.30, 1.40, 1.30, 1.10, 0.60, 0.40, 0.40, 1.40, 1.40, 1.40, 0.50],
  workshops_nonres:     [0.30, 0.30, 0.70, 1.60, 1.60, 1.10, 0.60, 0.50, 1.50, 1.60, 1.40, 0.30],
  workshops_residential:[0.30, 0.40, 0.70, 1.60, 1.60, 1.10, 0.60, 0.60, 1.50, 1.60, 1.40, 0.30],
  services:             [1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00],
  hire:                 [1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00],
  academy:              [1.15, 1.15, 1.05, 0.95, 0.90, 0.85, 0.85, 0.90, 1.00, 1.05, 1.15, 1.20]
};

function currentMonthIndex(now) {
  const d = (now instanceof Date) ? now : new Date();
  return d.getUTCMonth();
}

function seasonalityFor(tierId, monthIdx) {
  const i = Math.max(0, Math.min(11, Number(monthIdx) || 0));
  if (activeBlendedSeasonality && activeBlendedSeasonality.byTier) {
    return factorFromBlend(activeBlendedSeasonality.byTier, tierId, i);
  }
  const arr = SEASONALITY_BY_TIER[tierId];
  if (!Array.isArray(arr)) return 1.0;
  return arr[i];
}

function seasonalityBandFor(tierId, monthIdx) {
  const f = seasonalityFor(tierId, monthIdx);
  if (f >= 1.3)  return 'peak';
  if (f >= 1.05) return 'shoulder';
  if (f <= 0.5)  return 'gap';
  if (f <= 0.85) return 'low';
  return 'steady';
}

function seasonalityLabel(band) {
  if (band === 'peak')     return 'PEAK month';
  if (band === 'shoulder') return 'Above-average month';
  if (band === 'gap')      return 'GAP month';
  if (band === 'low')      return 'Below-average month';
  return 'Steady month';
}

function applySeasonalityToCandidate(c, monthIdx) {
  const f = seasonalityFor(c.tier_id, monthIdx);
  c.seasonality_factor = Number(f.toFixed(2));
  c.seasonality_band   = seasonalityBandFor(c.tier_id, monthIdx);
  if (typeof c.estimated_lift_gbp_revenue === 'number') {
    c.estimated_lift_gbp_revenue_unscaled = c.estimated_lift_gbp_revenue;
    c.estimated_lift_gbp_revenue = Math.round(c.estimated_lift_gbp_revenue * f);
  }
  if (typeof c.estimated_lift_gbp_profit === 'number') {
    c.estimated_lift_gbp_profit_unscaled = c.estimated_lift_gbp_profit;
    c.estimated_lift_gbp_profit = Math.round(c.estimated_lift_gbp_profit * f);
  }
  // 2026-05-26 defect 3 fix: keep lift_range on the SAME basis as the
  // headline. Without this the headline was seasonally-adjusted while
  // the assumption-stack range was not — the user saw "+£40/mo" up top
  // and "expected £68/mo" in the box, which look like they disagree.
  if (c.lift_range && f !== 1) {
    c.lift_range = scaleLiftRange(c.lift_range, f);
  }
  return c;
}

function scaleLiftRange(range, f) {
  const scaleBlock = (block) => block && ({
    low:               Math.round((block.low || 0) * f),
    expected:          Math.round((block.expected || 0) * f),
    high:              Math.round((block.high || 0) * f),
    expected_unscaled: block.expected_unscaled != null ? block.expected_unscaled : block.expected
  });
  const stack = Array.isArray(range.assumption_stack) ? range.assumption_stack.slice() : [];
  if (!stack.find(row => row && row.label === 'Seasonality factor')) {
    stack.push({ label: 'Seasonality factor', value: f, unit: 'mult' });
  }
  return {
    ...range,
    basis: 'seasonally_adjusted',
    seasonality_factor: f,
    revenue: scaleBlock(range.revenue),
    profit: scaleBlock(range.profit),
    assumption_stack: stack
  };
}

// ----------------------------------------------------------------------
// Per-candidate, page-aware action plans (2026-05-20 phase H)
// ----------------------------------------------------------------------
// The old `effort_label` was a single hardcoded line per lever — every
// CTR card got "Rewrite title + meta description" regardless of whether
// the title was already optimised. The user (correctly) called it
// generic. These builders inspect the LIVE page state and emit only
// the actions the page actually needs, prioritised + confidence-tagged.
// Each builder returns at most ~4 items so the card stays scannable.

function buildCtrActions(c, live) {
  const args   = (c._rebuild && c._rebuild.args) || {};
  const kwInfo = args.kwInfo || {};
  const kw     = kwInfo.keyword;
  const rank   = kwInfo.rank;
  const title  = live && live.title;
  const meta   = live && live.metaDescription;
  const schema = (live && live.schemaTypes) || [];
  const pageUrl = Array.isArray(c.pages_affected) ? c.pages_affected[0] : '';
  const serp = buildSerpCopyAdvice({
    pageUrl,
    rankingKw: kw,
    rank,
    searchVolume: kwInfo.searchVolume,
    title,
    meta,
    h1: live && live.h1
  });
  if (serp.blocked) return [];
  if (serp.serpComplete) return [];
  const actions = serp.actions.map((a) => ({
    effort_hours: a.tag === 'meta' ? 0.25 : 0.5,
    confidence: a.confidence,
    tag: a.tag,
    headline: a.headline,
    detail: a.detail
  }));
  if (!schema.includes('FAQPage') && kw) {
    actions.push({
      effort_hours: 1.5, confidence: 'medium', tag: 'faq',
      headline: `Add 5 FAQ entries answering the PAA box for "${kw}"`,
      detail: `Pull the live People-Also-Ask cluster for "${kw}" and answer each one in 50–80 words on this page. Wrap in FAQPage JSON-LD. Wins both the FAQ rich result AND a likely AI Overview citation in one pass.`
    });
  }
  if (actions.length === 0) {
    actions.push({
      effort_hours: 1, confidence: 'low', tag: 'links',
      headline: 'Audit internal links into this page',
      detail: `Title, meta and schema look healthy from this view. Next move is off-page signal: from your tier hub and your top-traffic blog posts, add 2–3 contextual links pointing at this URL with long-tail anchor variants of "${kw || 'the head term'}".`
    });
  }
  return actions.map((a, i) => ({ step: i + 1, ...a }));
}

function rankCheapestAction(keyword, hasKwInTitle, hasKwInH1, pageUrl) {
  if (hasKwInTitle && hasKwInH1) return null;
  const safe = safeTitleLead(pageUrl, keyword);
  const head = safe.lead || keyword;
  const titleNote = hasKwInTitle ? 'already contains' : 'is MISSING';
  const h1Note    = hasKwInH1    ? 'already contains' : 'is MISSING';
  const guardNote = safe.note ? ` ${safe.note}` : '';
  return {
    effort_hours: 0.5, confidence: 'high', tag: 'on-page',
    headline: `Put "${head}" in BOTH the page title AND the H1`,
    detail: `Current title ${titleNote} the head term. Current H1 ${h1Note} the head term. For top-3 ranking Google needs the head term in both on this URL only — not on other tier pages.${guardNote}`
  };
}

function buildRankActions(c, live) {
  const args        = (c._rebuild && c._rebuild.args) || {};
  const keyword     = args.keyword;
  const targetRank  = Number(c.kpi_target_value) || 0;
  const title  = live && live.title;
  const h1     = live && live.h1;
  const schema = (live && live.schemaTypes) || [];
  const hasKwInTitle = !!(title && keyword && title.toLowerCase().includes(String(keyword).toLowerCase()));
  const hasKwInH1    = !!(h1    && keyword && h1.toLowerCase().includes(String(keyword).toLowerCase()));
  const actions = [];
  const pageUrl = Array.isArray(c.pages_affected) ? c.pages_affected[0] : '';
  const cheap = rankCheapestAction(keyword, hasKwInTitle, hasKwInH1, pageUrl);
  if (cheap) actions.push(cheap);
  if (hasKwInTitle && hasKwInH1) {
    actions.push({
      effort_hours: 3, confidence: 'medium', tag: 'content',
      headline: `Add 400–600 words of depth + 1 comparison table targeting "${keyword}"`,
      detail: `Head term is already in title + H1, so on-page basics are done — next blocker for top-${targetRank} is depth and topical coverage. Add a comparison section ("our [product] vs alternatives"), a customer-outcome paragraph with real numbers, and a 6–8 item FAQ pulled from the live PAA box for "${keyword}".`
    });
  }
  if (!schema.includes('FAQPage')) {
    actions.push({
      effort_hours: 1, confidence: 'medium', tag: 'schema',
      headline: 'Add FAQPage JSON-LD with 5 PAA-aligned Q/A pairs',
      detail: `Page is missing FAQPage schema. FAQ rich results lift CTR at this rank AND seed the AI Overview crawler. Pull questions verbatim from the People-Also-Ask box.`
    });
  }
  actions.push({
    effort_hours: 1, confidence: 'medium', tag: 'links',
    headline: `Build 3 internal links pointing at this URL`,
    detail: `From the tier hub + your top-traffic blog posts, add 3 contextual links with anchor-text variants of "${keyword}". Internal-link signal at the same anchor is one of the highest-leverage rank-pushes you can do without external work.`
  });
  return actions.map((a, i) => ({ step: i + 1, ...a }));
}

// 2026-05-26 phase J: AIO action builder rebuilt to emit the three
// task types (REMEDIATE / REWRITE / ADD) instead of always appending
// new content, and to tag every action with an evidence-confidence
// level (HIGH / MEDIUM / HEURISTIC) so the UI never presents a thin
// belief as fact. Each helper returns at most a small handful of
// actions and is well inside the 15-complexity limit.
function buildRemediateActionsFromLiabilities(liabilities) {
  const out = [];
  const stats = (liabilities.unsourced_stats || []).slice(0, 3);
  if (stats.length) {
    const snippet = stats[0].snippet.slice(0, 120);
    const dupNote = stats.some(s => s.count >= 2) ? ' (one of these is repeated 2+ times on the page).' : '.';
    out.push({
      effort_hours: 0.5, confidence: EVIDENCE.HIGH, tag: 'remediate', task_type: TASK_TYPE.REMEDIATE,
      headline: `Remove or cite ${stats.length} unsourced statistical claim${stats.length === 1 ? '' : 's'}`,
      detail: `Unsourced numeric claim detected on this page${dupNote} `
        + `Example: "${snippet}". `
        + `Either delete the claim or add a (Source: ONS / .gov / .ac.uk) citation inline. `
        + `LLMs increasingly discount answers that cite uncited stats.`
    });
  }
  const weak = (liabilities.weak_citations || []).slice(0, 2);
  if (weak.length) {
    const dom = weak.map(w => w.domain).join(', ');
    out.push({
      effort_hours: 0.25, confidence: EVIDENCE.HIGH, tag: 'remediate', task_type: TASK_TYPE.REMEDIATE,
      headline: `Replace ${weak.length} low-authority outbound citation${weak.length === 1 ? '' : 's'}`,
      detail: `Outbound link${weak.length === 1 ? '' : 's'} to ${dom} treated as a citation. `
        + `Swap for a recognised source: Royal Photographic Society, .gov.uk, ONS, BBC, Nature, or a peer university. `
        + `Weak citation domains hurt trust on both human and LLM reads.`
    });
  }
  return out;
}

function buildOpenerAction(c, keyword, pageScope, fluffy) {
  const isLocal = pageScope === 'local';
  const localBits = isLocal ? ' (levels, format, price-from, location, who it suits)' : '';
  if (fluffy.isFluffy) {
    return {
      effort_hours: 1.0, confidence: EVIDENCE.HIGH, tag: 'rewrite', task_type: TASK_TYPE.REWRITE,
      headline: `Rewrite the opening section into a factual 60–90 word answer to "${keyword}"`,
      detail: `Current opener reads as rhetorical/marketing copy (signals: ${fluffy.signals.join(', ')}). `
        + `Replace with one paragraph that directly answers "${keyword}" in 60–90 words${localBits}. `
        + `Place it under the H1. Serves AI Overview extraction AND human conversion in one block.`
    };
  }
  return {
    effort_hours: 1.0, confidence: EVIDENCE.HIGH, tag: 'add', task_type: TASK_TYPE.ADD,
    headline: `Add a 60–90 word direct-answer block immediately under the H1`,
    detail: `Write one paragraph that directly answers "${keyword}" in 60–90 words${localBits}. `
      + `Place it right under the H1 — Google's AIO crawler prefers the first extractable answer.`
  };
}

function genericFaqWordCount(htmlSnippet) {
  if (!htmlSnippet) return 0;
  const GENERIC = /(is photography (difficult|hard) to learn|how (do|to) i (start|begin)|what is photography|what camera should i (buy|get))/gi;
  const matches = String(htmlSnippet).match(GENERIC);
  return matches ? matches.length : 0;
}

function buildFaqAction(keyword, pageScope, hasFaq, htmlSnippet) {
  const isLocal = pageScope === 'local';
  const localSlot = isLocal
    ? `the local commercial intent ("${keyword}" - cost, beginner pathway, 1-2-1 vs group, in-person vs online)`
    : `the page's actual commercial intent for "${keyword}"`;
  const genericCount = genericFaqWordCount(htmlSnippet);
  // FAQPage schema is no longer a meaningful SERP ranking lever (rich
  // results being removed). The CONTENT is still useful for AIO/LLM
  // extraction — value is in the rendered Q&A, not the markup. So we
  // tag the schema work as HEURISTIC and frame it as content work.
  //
  // 2026-05-26 defect 6 fix: when task_type is REWRITE the verb MUST
  // be replace/rewrite. Previously the "Extend FAQs with 3…" copy
  // shipped under a REWRITE pill, which the user (rightly) called out
  // as a mismatch — extend/add is ADD semantics, replace/rewrite is
  // REWRITE semantics.
  if (hasFaq && genericCount >= 2) {
    return {
      effort_hours: 1.5, confidence: EVIDENCE.MEDIUM, tag: 'rewrite', task_type: TASK_TYPE.REWRITE,
      headline: `Replace the existing generic FAQs with 3–5 questions about ${localSlot}`,
      detail: `Page already has FAQs but they read as generic photography questions ("Is photography difficult to learn?" etc.) `
        + `with no commercial or local intent. Rewrite (don't append to) the existing block: replace 3-5 questions with the ones a real prospect asks `
        + `(cost, beginner pathway, 1-2-1 options${isLocal ? ', online vs in-person, Coventry travel/parking' : ''}). `
        + `Quality gate: each Q must align to a query the page can actually win.`
    };
  }
  if (hasFaq) {
    return {
      effort_hours: 1.0, confidence: EVIDENCE.MEDIUM, tag: 'rewrite', task_type: TASK_TYPE.REWRITE,
      headline: `Rewrite 3 of the existing FAQs around ${localSlot}`,
      detail: `Existing FAQs are not pulling their weight for "${keyword}". Replace 3 of them with question/answer pairs that match real PAA queries AND are specific to this page's offering. `
        + `Skip generic "what is photography" rewrites — they don't move conversion or AIO extraction.`
    };
  }
  return {
    effort_hours: 1.5, confidence: EVIDENCE.MEDIUM, tag: 'add', task_type: TASK_TYPE.ADD,
    headline: `Add 5 commercial-intent FAQs about ${localSlot}`,
    detail: `No FAQ block on the page. Write 5 question/answer pairs sourced from the live People-Also-Ask box for "${keyword}", `
      + `each specific to this page's offering. The value is in the rendered Q&A content (extractable for AIO/LLMs); `
      + `FAQPage JSON-LD markup is no longer a meaningful SERP ranking lever.`
  };
}

function buildCitationAction(keyword) {
  return {
    effort_hours: 0.5, confidence: EVIDENCE.HEURISTIC, tag: 'trust', task_type: TASK_TYPE.ADD,
    headline: `Cite 1 authoritative source in the answer block (may help)`,
    detail: `It is believed (heuristic, not proven) that AIO favours pages citing recognised sources. `
      + `In the direct-answer block for "${keyword}", link out once to Royal Photographic Society, `
      + `a .gov.uk / .ac.uk source, or another recognised authority. `
      + `Skip low-authority blogs/aggregators — they hurt trust on both human and LLM reads.`
  };
}

// 2026-05-26 defect 1 fix: detectors no longer silently return
// "nothing found" on empty input — they log a warning and return an
// `audit_status: 'incomplete'` marker. When that happens we surface a
// scan-incomplete warning on the candidate so the UI can flag it and
// the user knows the absence of REMEDIATE tasks means "could not
// check", not "page is clean".
function buildAioIncompleteWarning(reasons, url) {
  const reasonText = reasons && reasons.length ? reasons.join(', ') : 'page body unavailable';
  return {
    effort_hours: 0, confidence: EVIDENCE.HIGH, tag: 'audit', task_type: TASK_TYPE.REMEDIATE,
    headline: `Page-body scan INCOMPLETE — could not extract body text from ${url || 'this page'}`,
    detail: `Liability detectors (fluffy opener, unsourced stats, weak citations, duplicate claims) `
      + `had no body text to inspect (${reasonText}). Re-run after verifying the page renders the body server-side, `
      + `or treat this card's task list as a starting point only — REMEDIATE issues may exist that we haven't surfaced.`
  };
}

function buildAioActions(c, live) {
  const args      = (c._rebuild && c._rebuild.args) || {};
  const keyword   = args.keyword;
  const pageScope = c.aio_page_scope || args.pageScope || 'national';
  const url       = Array.isArray(c.pages_affected) ? c.pages_affected[0] : '';
  const schema    = (live && live.schemaTypes) || [];
  const hasFaq    = schema.includes('FAQPage');
  const bodyText  = (live && live.bodyText) || '';
  const htmlSnip  = (live && live.bodyHtmlSnippet) || '';
  // 2026-05-26 defect 1 observability: log the live feed sizes at
  // detector entry so future "no liability emitted on live page"
  // failures are diagnosable without redeploying instrumentation.
  // eslint-disable-next-line no-console
  console.log(`[aio-actions] ${url} bodyText.len=${bodyText.length} htmlSnip.len=${htmlSnip.length} bodyText.first120=${JSON.stringify(bodyText.slice(0, 120))}`);
  const fluffy    = detectFluffyOpener(bodyText);
  const liabilities = scanLiabilities(htmlSnip, bodyText);
  const actions = [];
  if (liabilities.audit_status === 'incomplete') {
    actions.push(buildAioIncompleteWarning(liabilities.audit_reasons, url));
  }
  actions.push(...buildRemediateActionsFromLiabilities(liabilities));
  actions.push(buildOpenerAction(c, keyword, pageScope, fluffy));
  actions.push(buildFaqAction(keyword, pageScope, hasFaq, htmlSnip));
  actions.push(buildCitationAction(keyword));
  c.page_liabilities = liabilities;
  c.opener_audit = fluffy;
  c.aio_audit_status = liabilities.audit_status;
  c.aio_audit_reasons = liabilities.audit_reasons || [];
  const numbered = actions.map((a, i) => ({ step: i + 1, ...a }));
  // 2026-05-26 defect 7 fix: total effort must be computed from the
  // task array, never hardcoded. Overrides the lever EFFORT_BY_LEVER
  // estimate the upstream `attachEffortAndRealisation` set.
  const totalEffort = numbered.reduce((sum, a) => sum + (Number(a.effort_hours) || 0), 0);
  c.effort_hours = Number(totalEffort.toFixed(2));
  return numbered;
}

function buildSchemaActions(c) {
  return [{
    step: 1, effort_hours: 1, confidence: 'high', tag: 'schema',
    headline: c.title || 'Add the missing schema block',
    detail: c.description || 'Schema gap detected on the tier hub. Add the missing JSON-LD to <head>.'
  }];
}

function buildRecommendedActions(c, live) {
  if (c.lever_id === 'ctr')    return buildCtrActions(c, live);
  if (c.lever_id === 'rank')   return buildRankActions(c, live);
  if (c.lever_id === 'aio')    return buildAioActions(c, live);
  if (c.lever_id === 'schema') return buildSchemaActions(c);
  return [];
}

// ----------------------------------------------------------------------
// Data assembly
// ----------------------------------------------------------------------
async function buildSnapshot(supabase, propertyUrl) {
  const [schemaDetail, pages, keywords, products, targetKeywordOverrides] = await Promise.all([
    fetchSchemaDetail(supabase, propertyUrl),
    fetchPageMetrics(supabase, propertyUrl),
    fetchKeywordRankings(supabase, propertyUrl),
    fetchProducts(supabase),
    fetchTargetKeywordOverrides(supabase, propertyUrl)
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
  return {
    propertyUrl,
    schemaDetail,
    pagesByUrl,
    pagesByTier,
    keywordsByTier,
    productsByTier,
    allKeywords: keywords,
    targetKeywordOverrides
  };
}

// Look up the assigned-keyword override for a URL (normalises trailing
// slash + bare-path forms so we don't miss matches when the GSC row
// uses a slightly different canonical form than the override row).
function lookupAssignedKeyword(overrides, url) {
  if (!overrides || !url) return null;
  const tries = new Set();
  const raw = String(url).trim();
  tries.add(raw);
  tries.add(raw.replace(/\/$/, ''));
  tries.add(raw.replace(/^https?:\/\/[^/]+/, ''));
  tries.add(raw.replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, ''));
  for (const candidate of tries) {
    if (overrides.has(candidate)) return overrides.get(candidate);
  }
  return null;
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
    const validationKey = String(req.query?.validationScenario || body.validationScenario || '').trim();
    const [snapshot, weightsRaw, optimCycles, blended, academyHealth, ga4Snap, revenueSnap] = await Promise.all([
      buildSnapshot(supabase, propertyUrl),
      fetchActiveScenarioWeights(supabase, propertyUrl),
      fetchActiveOptimisationCycles(supabase),
      loadBlendedSeasonality(supabase, propertyUrl),
      academyTierHealth(supabase, propertyUrl),
      readLatestGa4Metrics(supabase, propertyUrl),
      fetchRollingRevenueSnap(supabase, propertyUrl)
    ]);
    activeBlendedSeasonality = blended;
    const conversionHealth = conversionHealthFromMetrics(ga4Snap, revenueSnap);
    let weights = validationWeightsFor(validationKey) || weightsRaw;
    weights = applyFunnelConversionBias(weights, conversionHealth);
    const suppressionMap = buildSuppressionMap(optimCycles);
    const monthIdx = currentMonthIndex();
    const candidates = buildAllPriorities(snapshot, weights, suppressionMap, { academyHealth, conversionHealth });
    // Live-validate the top N candidates so their descriptions cite
    // the current live page state, not a possibly-stale audit row.
    // The same pass now also: (a) builds per-page recommended_actions[]
    // (b) suppresses/downgrades actions whose URLs are already in
    // active monitoring cycles, (c) scales projected lift by the
    // current month's per-tier seasonality factor.
    await liveEnrichTopCandidates(candidates, { suppressionMap, monthIdx });

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
        seasonality_calibration: blended.calibration_note,
        academy_economics: academyHealth,
        funnel_conversion: conversionHealth,
        funnel_conversion_bias: !!(weights && weights.funnel_conversion_bias),
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
          applied_tier_weight_shaped: c.applied_tier_weight_shaped ?? null,
          applied_lever_weight_shaped: c.applied_lever_weight_shaped ?? null,
          weighted_score: c.weighted_score ?? null,
          effort_hours: c.effort_hours ?? null,
          time_to_realise_days: c.time_to_realise_days ?? null,
          effort_label: c.effort_label ?? null,
          recommended_actions: c.recommended_actions ?? null,
          suppression: c.suppression ?? null,
          seasonality_factor: c.seasonality_factor ?? null,
          seasonality_band: c.seasonality_band ?? null,
          estimated_lift_gbp_revenue_unscaled: c.estimated_lift_gbp_revenue_unscaled ?? null,
          estimated_lift_gbp_profit_unscaled: c.estimated_lift_gbp_profit_unscaled ?? null,
          lift_per_hour_gbp: c.lift_per_hour_gbp ?? null,
          live_data_source: c.live_data_source ?? 'audit',
          live_fetched_at: c.live_fetched_at ?? null,
          live_fetch_error: c.live_fetch_error ?? null,
          academy_economics: c.academy_economics ?? null,
          primary_query: c.primary_query ?? null,
          page_intent: c.page_intent ?? null,
          keyword_owner_url: c.keyword_owner_url ?? null,
          safe_title_lead: c.safe_title_lead ?? null,
          guardrail_notes: c.guardrail_notes ?? null,
          guardrail_severity: c.guardrail_severity ?? null,
          guardrail_blocked_top3: !!c.guardrail_blocked_top3,
          merged_levers: c.merged_levers ?? null,
          title_example: c.title_example ?? null,
          meta_example: c.meta_example ?? null,
          meta_example_length: c.meta_example_length ?? null,
          h1_recommendation: c.h1_recommendation ?? null,
          serp_advice_note: c.serp_advice_note ?? null,
          serp_is_hub: !!c.serp_is_hub,
          serp_complete: !!c.serp_complete,
          lift_range: c.lift_range ?? null,
          aio_assumption_stack: c.aio_assumption_stack ?? null,
          aio_pwin_stack: c.aio_pwin_stack ?? null,
          aio_page_scope: c.aio_page_scope ?? null,
          aio_query_intent: c.aio_query_intent ?? null,
          aio_reroute_note: c.aio_reroute_note ?? null,
          aio_rerouted: !!c.aio_rerouted,
          aio_used_override: !!c.aio_used_override,
          aio_assigned_keyword: c.aio_assigned_keyword ?? null,
          aio_override_status: c.aio_override_status ?? null,
          aio_override_status_note: c.aio_override_status_note ?? null,
          aio_aov_flag: c.aio_aov_flag ?? null,
          aio_conv_flag: c.aio_conv_flag ?? null,
          aio_audit_status: c.aio_audit_status ?? null,
          aio_audit_reasons: c.aio_audit_reasons ?? null,
          page_liabilities: c.page_liabilities ?? null,
          opener_audit: c.opener_audit ?? null
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
