/**
 * Run config integrity check + persist to Supabase.
 */
import { createClient } from '@supabase/supabase-js';
import { normalizePagePath, runAllChecks, normKw } from './checks.mjs';
import { getGithubFileText } from '../github-put-file.mjs';
import { CSV09_REPO_PATH } from '../commit-09-csv.mjs';
import { enrichFindings } from './enrichFindings.mjs';
import { loadRuntimeLockedByKeyword, fetchSupabaseLockedOverride } from '../keyword-ranking/locked-config-persist.js';

const PROPERTY = 'https://www.alanranger.com';

function getClient() {
  const url = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) throw new Error('missing_supabase_env');
  return createClient(url, key, { auth: { persistSession: false } });
}

async function fetchOverrides(sb, propertyUrl) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from('traditional_seo_target_keyword_overrides')
      .select('page_url, target_keyword, target_class, notes')
      .eq('property_url', propertyUrl)
      .order('page_url')
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return rows;
}

async function fetchPagesMasterFull(sb, propertyUrl) {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from('pages_master')
      .select('url, path, tier, money_role, target_keyword, target_class, notes')
      .eq('property_url', propertyUrl)
      .order('path')
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  return rows;
}

async function fetchKeywordRankings(sb, propertyUrl) {
  const { filterTrackedRows } = await import('../keyword-ranking/tracked-set-v3.js');
  const { data, error } = await sb
    .from('keyword_rankings')
    .select('keyword, best_url, audit_date, search_volume')
    .eq('property_url', propertyUrl)
    .order('audit_date', { ascending: false })
    .limit(5000);
  if (error) throw error;
  const latestDate = data?.[0]?.audit_date;
  if (!latestDate) return [];
  return filterTrackedRows((data || []).filter((r) => r.audit_date === latestDate));
}

async function fetchGscPageMetrics28d(sb, propertyUrl) {
  const siteUrl = String(propertyUrl || PROPERTY).includes('alanranger.com')
    ? PROPERTY
    : String(propertyUrl || PROPERTY).trim() || PROPERTY;
  const { data: latest, error: latestErr } = await sb
    .from('gsc_page_metrics_28d')
    .select('date_end')
    .eq('site_url', siteUrl)
    .order('date_end', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestErr || !latest?.date_end) return new Map();
  const { data, error } = await sb
    .from('gsc_page_metrics_28d')
    .select('page_url, clicks_28d, impressions_28d')
    .eq('site_url', siteUrl)
    .eq('date_end', latest.date_end);
  if (error) return new Map();
  const map = new Map();
  for (const row of data || []) {
    map.set(normalizePagePath(row.page_url), {
      clicks_28d: Number(row.clicks_28d) || 0,
      impressions_28d: Number(row.impressions_28d) || 0
    });
  }
  return map;
}

function buildEnrichContext(ctx) {
  const pagesMap = new Map();
  for (const p of ctx.pages || []) {
    pagesMap.set(normalizePagePath(p.path || p.url), p);
  }
  const volumeByKw = new Map();
  for (const r of ctx.keywordRows || []) {
    const nk = normKw(r.keyword);
    if (!nk || volumeByKw.has(nk)) continue;
    const vol = Number(r.search_volume);
    volumeByKw.set(nk, Number.isFinite(vol) ? vol : null);
  }
  return {
    pagesMap,
    volumeByKw,
    gscByPath: ctx.gscByPath || new Map()
  };
}

async function fetchLatestMoneyRows(sb, propertyUrl) {
  const { data, error } = await sb
    .from('audit_results')
    .select('audit_date, scores')
    .eq('property_url', propertyUrl)
    .order('audit_date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.scores) return [];
  const rows = data.scores?.moneyPagesMetrics?.rows;
  return Array.isArray(rows) ? rows : [];
}

export async function buildIntegrityContext(options = {}) {
  const sb = options.supabase || getClient();
  const propertyUrl = String(options.propertyUrl || PROPERTY).trim() || PROPERTY;
  const [pages, overrides, keywordRows, moneyRows, gscByPath] = await Promise.all([
    fetchPagesMasterFull(sb, propertyUrl),
    fetchOverrides(sb, propertyUrl),
    fetchKeywordRankings(sb, propertyUrl),
    fetchLatestMoneyRows(sb, propertyUrl),
    fetchGscPageMetrics28d(sb, propertyUrl)
  ]);
  const overridesByPath = new Map();
  for (const o of overrides) {
    overridesByPath.set(normalizePagePath(o.page_url), o);
  }
  let lockedByKw = null;
  let orphans = [];
  try {
    const runtime = await loadRuntimeLockedByKeyword({ propertyUrl });
    lockedByKw = new Map();
    for (const r of Object.values(runtime.byKeyword || {})) {
      const kw = String(r?.keyword || '').trim();
      if (!kw) continue;
      lockedByKw.set(normKw(kw), {
        keyword: kw,
        target_page: normalizePagePath(r.target_page),
        class: r.keyword_class || ''
      });
    }
    const override = await fetchSupabaseLockedOverride(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      propertyUrl
    );
    orphans = Array.isArray(override?.orphans) ? override.orphans : [];
  } catch (_e) { /* bundled JSON via runAllChecks */ }
  return {
    sb, propertyUrl, pages, overrides, overridesByPath, keywordRows, moneyRows, gscByPath,
    lockedByKw, orphans
  };
}

export async function runIntegrityCheck(options = {}) {
  const ctx = await buildIntegrityContext(options);
  if (options.csv09Disk != null) ctx.csv09Disk = options.csv09Disk;
  else {
    const fromGh = await getGithubFileText({
      owner: 'alanranger', repo: 'ai-geo-audit', path: CSV09_REPO_PATH
    }).catch(() => null);
    if (fromGh != null) ctx.csv09Disk = fromGh;
  }
  const result = runAllChecks(ctx);
  result.findings = enrichFindings(result.findings, buildEnrichContext(ctx));
  // Align Action text with recorded decision_type + page-audit (no more stale Decision needed).
  const { applyWorkStateToFindings } = await import('./applyWorkStateToFindings.mjs');
  result.findings = await applyWorkStateToFindings(result.findings, ctx.sb, ctx.propertyUrl);
  const row = {
    property_url: ctx.propertyUrl,
    run_at: new Date().toISOString(),
    run_source: String(options.runSource || 'manual'),
    status: 'ok',
    chip_rag: result.chipRag,
    finding_count: result.stats.findingCount,
    structural_count: result.stats.structuralCount,
    findings: result.findings,
    stats: result.stats
  };
  let saved = null;
  if (options.persist !== false) {
    const { data, error } = await ctx.sb
      .from('config_integrity_runs')
      .insert(row)
      .select('*')
      .single();
    if (error) throw new Error(`config_integrity_runs insert failed: ${error.message}`);
    saved = data;
  }
  return { ...result, latestRun: saved || row, propertyUrl: ctx.propertyUrl };
}

export async function fetchLatestIntegrityRun(options = {}) {
  const sb = options.supabase || getClient();
  const propertyUrl = String(options.propertyUrl || PROPERTY).trim() || PROPERTY;
  const { data, error } = await sb
    .from('config_integrity_runs')
    .select('*')
    .eq('property_url', propertyUrl)
    .order('run_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export { PROPERTY, getClient };
