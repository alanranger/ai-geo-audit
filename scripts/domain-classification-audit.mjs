/**
 * Classification audit for consistent money-keyword rivals (domain_type_source=fallback).
 *
 * Usage:
 *   node scripts/domain-classification-audit.mjs              # dry-run report
 *   node scripts/domain-classification-audit.mjs --apply      # auto-apply HIGH conf
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { censusConsistentRivals, normDomain } from '../lib/competitor-analysis/rivals.js';
import { auditClassifyDomain, AUDIT_SOURCE } from '../lib/domainAuditClassifier.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = 'alanranger.com';
const PROTECTED_SOURCES = new Set(['manual']);

for (const envFile of ['.env.local', '.env']) {
  const p = join(ROOT, envFile);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (m && !process.env[m[1].trim()]) {
      process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

function loadLockedKeywords() {
  const paths = [
    join(ROOT, 'keyword-tracking-class-LOCKED.json'),
    join(ROOT, 'lib/keyword-ranking/keyword-tracking-class-LOCKED.json'),
  ];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return Object.entries(parsed.by_keyword || {}).map(([kw, cfg]) => ({
      keyword: kw,
      keyword_class: cfg.keyword_class || 'national-money',
    }));
  }
  throw new Error('Could not load locked keyword config');
}

async function loadRankingRows(sb, propertyUrl, auditDate, kwConfig) {
  const kws = kwConfig.map((k) => k.keyword);
  const { data, error } = await sb
    .from('keyword_rankings')
    .select('keyword, keyword_class, serp_surface_stack')
    .eq('property_url', propertyUrl)
    .eq('audit_date', auditDate)
    .in('keyword', kws);
  if (error) throw error;
  const classByKw = new Map(kwConfig.map((k) => [k.keyword.toLowerCase(), k.keyword_class]));
  return (data || []).map((r) => ({
    ...r,
    keyword_class: r.keyword_class || classByKw.get(String(r.keyword).toLowerCase()) || 'national-money',
  }));
}

async function fetchDomainMeta(sb, domains) {
  const out = {};
  const batch = 80;
  for (let i = 0; i < domains.length; i += batch) {
    const slice = domains.slice(i, i + batch);
    const { data } = await sb
      .from('domain_strength_domains')
      .select('domain, domain_type, domain_type_source, domain_type_reason, is_competitor')
      .in('domain', slice);
    for (const row of data || []) out[row.domain] = row;
  }
  return out;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');

  const propertyUrl = process.env.CRON_PROPERTY_URL || 'https://www.alanranger.com';
  const auditDate = process.argv.find((a) => a.startsWith('--audit-date='))?.slice(13) || '2026-07-14';
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const kwConfig = loadLockedKeywords();
  const rows = await loadRankingRows(sb, propertyUrl, auditDate, kwConfig);
  const consistent = censusConsistentRivals(rows, SELF, 2);
  const domains = consistent.map((r) => r.domain);
  const meta = await fetchDomainMeta(sb, domains);

  const report = {
    auditDate,
    consistentRivalCount: consistent.length,
    autoApplied: {},
    queued: [],
    skipped: [],
    manualProtected: [],
    ambiguous: [],
  };

  for (const rec of consistent) {
    const existing = meta[rec.domain] || {};
    if (PROTECTED_SOURCES.has(existing.domain_type_source)) {
      report.manualProtected.push({ domain: rec.domain, source: existing.domain_type_source });
      continue;
    }
    if (existing.domain_type_source && existing.domain_type_source !== 'fallback') {
      report.skipped.push({
        domain: rec.domain,
        reason: `non-fallback source: ${existing.domain_type_source}`,
      });
      continue;
    }

    const cls = auditClassifyDomain(rec.domain);
    const entry = {
      domain: rec.domain,
      moneyKwCount: rec.moneyKwCount,
      proposed_type: cls.domain_type,
      confidence: cls.confidence,
      reason: cls.reason,
      action: cls.action,
      propose_is_competitor: cls.propose_is_competitor || false,
    };

    if (cls.action === 'auto_apply' && apply) {
      const { error } = await sb.from('domain_strength_domains').upsert({
        domain: rec.domain,
        label: existing.label || rec.domain,
        domain_type: cls.domain_type,
        domain_type_source: AUDIT_SOURCE,
        domain_type_confidence: cls.confidence === 'HIGH' ? 95 : 60,
        domain_type_reason: cls.reason,
        segment: cls.domain_type,
        is_competitor: existing.is_competitor === true,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'domain' });
      if (error) throw error;
      report.autoApplied[cls.domain_type] = (report.autoApplied[cls.domain_type] || 0) + 1;
    } else if (cls.action === 'auto_apply') {
      report.autoApplied[cls.domain_type] = (report.autoApplied[cls.domain_type] || 0) + 1;
    } else if (cls.action === 'queue_competitor' || cls.action === 'queue_review') {
      report.queued.push(entry);
      if (cls.confidence === 'LOW') report.ambiguous.push(rec.domain);
    }
  }

  const outPath = join(ROOT, 'scripts', 'domain-classification-audit-report.json');
  writeFileSync(outPath, JSON.stringify({ ...report, queuedFull: report.queued }, null, 2));
  console.log(JSON.stringify({
    ...report,
    queuedPreview: report.queued.slice(0, 25),
    queuedTotal: report.queued.length,
    applyMode: apply,
    reportFile: outPath,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
