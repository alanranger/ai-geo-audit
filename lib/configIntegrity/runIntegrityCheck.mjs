/**
 * Run config integrity check + persist to Supabase.
 */
import { createClient } from '@supabase/supabase-js';
import { normalizePagePath, runAllChecks } from './checks.mjs';

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
  const { data, error } = await sb
    .from('keyword_rankings')
    .select('keyword, best_url, audit_date')
    .eq('property_url', propertyUrl)
    .order('audit_date', { ascending: false })
    .limit(5000);
  if (error) throw error;
  const latestDate = data?.[0]?.audit_date;
  if (!latestDate) return [];
  return (data || []).filter((r) => r.audit_date === latestDate);
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
  const [pages, overrides, keywordRows, moneyRows] = await Promise.all([
    fetchPagesMasterFull(sb, propertyUrl),
    fetchOverrides(sb, propertyUrl),
    fetchKeywordRankings(sb, propertyUrl),
    fetchLatestMoneyRows(sb, propertyUrl)
  ]);
  const overridesByPath = new Map();
  for (const o of overrides) {
    overridesByPath.set(normalizePagePath(o.page_url), o);
  }
  return { sb, propertyUrl, pages, overrides, overridesByPath, keywordRows, moneyRows };
}

export async function runIntegrityCheck(options = {}) {
  const ctx = await buildIntegrityContext(options);
  const result = runAllChecks(ctx);
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
