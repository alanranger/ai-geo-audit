/**
 * Surface / Top dial scores for Ranking finalize + repair.
 * Always prefer full keyword_rankings rows (with serp_surface_stack) over
 * slimmed in-memory cron progress — Top of page is stack-based.
 */

import { createClient } from '@supabase/supabase-js';
import { computeSurfaceVisibilityRollup } from '../audit/surfaceScores.js';
import { computeTopOfPageRollup } from '../audit/topOfPage.js';
import {
  acceptanceDetailForAudit,
  assessRankingAcceptance,
} from './ranking-acceptance-gate.js';

export function scoreSurfaceAndTop(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return { surface: null, top: null, measured: 0 };
  const surface = Math.round(Number(computeSurfaceVisibilityRollup(list).overall) || 0);
  const top = Math.round(Number(computeTopOfPageRollup(list).overall) || 0);
  return { surface, top, measured: list.length };
}

/** Prior complete audit dials for acceptance class-count / Surface drop checks. */
export async function loadPriorCompleteDialBaseline({
  propertyUrl,
  beforeDate,
  supabaseUrl = process.env.SUPABASE_URL,
  supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY,
} = {}) {
  if (!supabaseUrl || !supabaseKey || !propertyUrl || !beforeDate) return null;
  const sb = createClient(supabaseUrl, supabaseKey);
  const { data, error } = await sb
    .from('audit_results')
    .select('audit_date, surface_visibility_score, ranking_quality_detail, ranking_incomplete')
    .eq('property_url', propertyUrl)
    .lt('audit_date', String(beforeDate).slice(0, 10))
    .or('ranking_incomplete.is.null,ranking_incomplete.eq.false')
    .order('audit_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const d = data.ranking_quality_detail || {};
  return {
    audit_date: data.audit_date,
    priorSurface: data.surface_visibility_score ?? null,
    priorLocalN: d.local_n ?? null,
    priorNationalN: d.national_n ?? null,
  };
}

/**
 * Load today's keyword_rankings for dial scoring (dashboard truth).
 */
export async function loadKeywordRowsForDialScores({
  propertyUrl,
  auditDate,
  supabaseUrl = process.env.SUPABASE_URL,
  supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
} = {}) {
  if (!supabaseUrl || !supabaseKey || !propertyUrl || !auditDate) return [];
  const sb = createClient(supabaseUrl, supabaseKey);
  const pageSize = 500;
  let from = 0;
  const out = [];
  while (true) {
    const { data, error } = await sb
      .from('keyword_rankings')
      .select('*')
      .eq('property_url', propertyUrl)
      .eq('audit_date', auditDate)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const chunk = data || [];
    out.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

/**
 * Write surface_visibility_score + top_of_page_score on audit_results.
 * Scoring uses keyword_rankings when available; falls back to combinedRows.
 */
export async function upsertRankingDialScores({
  propertyUrl,
  auditDate,
  summary = null,
  combinedRows = null,
  supabaseUrl = process.env.SUPABASE_URL,
  supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
} = {}) {
  if (!supabaseUrl || !supabaseKey) throw new Error('missing_supabase_env');
  const date = String(auditDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
  let scoreRows = [];
  try {
    scoreRows = await loadKeywordRowsForDialScores({
      propertyUrl,
      auditDate: date,
      supabaseUrl,
      supabaseKey
    });
  } catch (_e) {
    scoreRows = [];
  }
  if (!scoreRows.length && Array.isArray(combinedRows) && combinedRows.length) {
    scoreRows = combinedRows;
  }
  const scored = scoreSurfaceAndTop(scoreRows);
  const dialSource = scoreRows === combinedRows ? 'combined_rows' : 'keyword_rankings';
  let prior = null;
  try {
    prior = await loadPriorCompleteDialBaseline({
      propertyUrl,
      beforeDate: date,
      supabaseUrl,
      supabaseKey,
    });
  } catch (_e) {
    prior = null;
  }
  const assessment = assessRankingAcceptance(scoreRows, {
    expectedTracked: Array.isArray(combinedRows) && combinedRows.length
      ? combinedRows.length
      : scoreRows.length,
    priorSurface: prior?.priorSurface ?? null,
    priorLocalN: prior?.priorLocalN ?? null,
    priorNationalN: prior?.priorNationalN ?? null,
    dialSource,
  });
  const nowIso = new Date().toISOString();
  const row = {
    property_url: propertyUrl,
    audit_date: date,
    updated_at: nowIso,
    ranking_incomplete: assessment.incomplete === true,
    ranking_quality: assessment.ranking_quality,
    ranking_quality_detail: acceptanceDetailForAudit(assessment, nowIso),
  };
  if (summary != null || combinedRows != null) {
    row.ranking_ai_data = {
      summary: summary || null,
      combinedRows: Array.isArray(combinedRows) ? combinedRows : undefined,
      lastRunTimestamp: nowIso,
      dial_source: dialSource,
      acceptance: {
        incomplete: assessment.incomplete,
        reason: assessment.reason,
        warnings: assessment.warnings,
      },
    };
  }
  if (scored.surface != null) row.surface_visibility_score = scored.surface;
  if (scored.top != null) row.top_of_page_score = scored.top;

  const response = await fetch(`${supabaseUrl}/rest/v1/audit_results?on_conflict=property_url,audit_date`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify(row)
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`audit_results upsert failed: HTTP ${response.status} ${text.slice(0, 200)}`);
  }
  return { ...scored, acceptance: assessment };
}
