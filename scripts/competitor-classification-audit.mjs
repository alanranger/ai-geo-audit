/**
 * One-time + re-runnable classification audit for consistent money rivals.
 * - Auto-applies HIGH-conf types to fallback/null rows only (never manual).
 * - Upgrades MED photo-business sites off fallback → site + queue reason (no is_competitor).
 * - Writes queue JSON for Competitor Analysis review UI.
 *
 * Usage: node scripts/competitor-classification-audit.mjs [--apply]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  AUDIT_SOURCE,
  highTypeForDomain,
  medSiteSuggest,
} from '../lib/competitor-analysis/classification-rules.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const APPLY = process.argv.includes('--apply');
const OUT = join(ROOT, 'scripts/output/competitor-classification-queue-LATEST.json');

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

async function loadCensus(sb) {
  const { data: latest } = await sb.from('keyword_rankings').select('audit_date').order('audit_date', { ascending: false }).limit(1);
  const auditDate = latest?.[0]?.audit_date;
  if (!auditDate) throw new Error('No keyword_rankings');

  const { data: rows, error } = await sb
    .from('keyword_rankings')
    .select('keyword, keyword_class, serp_surface_stack')
    .eq('audit_date', auditDate)
    .in('keyword_class', ['local-money', 'national-money']);
  if (error) throw error;

  const byDomain = new Map();
  for (const row of rows || []) {
    const stack = Array.isArray(row.serp_surface_stack) ? row.serp_surface_stack : [];
    for (const el of stack) {
      if (el?.type !== 'organic' && el?.type !== 'local_pack') continue;
      for (const o of el.owners || []) {
        if (o?.ours) continue;
        let d = String(o.domain || '').toLowerCase().replace(/^www\./, '').split('/')[0];
        if (!d || !d.includes('.') || d.includes('alanranger')) continue;
        if (!byDomain.has(d)) {
          byDomain.set(d, { domain: d, keywords: new Set(), local: new Set(), pack: new Set() });
        }
        const rec = byDomain.get(d);
        rec.keywords.add(row.keyword);
        if (row.keyword_class === 'local-money') rec.local.add(row.keyword);
        if (el.type === 'local_pack') rec.pack.add(row.keyword);
      }
    }
  }

  return [...byDomain.values()]
    .map((r) => ({
      domain: r.domain,
      money_kw: r.keywords.size,
      local_money_kw: r.local.size,
      pack_kw: r.pack.size,
    }))
    .filter((r) => r.money_kw >= 2)
    .sort((a, b) => b.money_kw - a.money_kw);
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || key == null) throw new Error('Missing Supabase env');
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const census = await loadCensus(sb);
  const domains = census.map((c) => c.domain);
  const { data: metaRows } = await sb
    .from('domain_strength_domains')
    .select('domain, domain_type, domain_type_source, domain_type_reason, is_competitor')
    .in('domain', domains);
  const meta = new Map((metaRows || []).map((r) => [r.domain, r]));

  const applied = { platform: 0, directory: 0, vendor: 0, publisher: 0, institution: 0, government: 0, site_promoted: 0 };
  const queue = [];
  const ambiguous = [];
  const skippedManual = [];
  const changes = [];

  for (const c of census) {
    const existing = meta.get(c.domain);
    if (existing?.domain_type_source === 'manual') {
      skippedManual.push(c.domain);
      continue;
    }
    const source = existing?.domain_type_source || null;
    const canUpgrade = !existing || source === 'fallback' || source == null || source === 'auto';
    if (!canUpgrade) continue;

    const high = highTypeForDomain(c.domain);
    if (high) {
      const payload = {
        domain: c.domain,
        label: existing?.label || c.domain,
        domain_type: high.domain_type,
        domain_type_source: AUDIT_SOURCE,
        domain_type_confidence: high.confidence,
        domain_type_reason: high.reason,
        segment: high.domain_type,
        updated_at: new Date().toISOString(),
      };
      // Never clear is_competitor
      if (existing?.is_competitor === true) payload.is_competitor = true;
      if (APPLY) {
        const { error } = await sb.from('domain_strength_domains').upsert(payload, { onConflict: 'domain' });
        if (error) throw error;
      }
      applied[high.domain_type] = (applied[high.domain_type] || 0) + 1;
      changes.push({ domain: c.domain, action: 'high', ...high, money_kw: c.money_kw });
      continue;
    }

    const med = medSiteSuggest(c.domain, c.money_kw);
    if (med) {
      const payload = {
        domain: c.domain,
        label: existing?.label || c.domain,
        domain_type: 'site',
        domain_type_source: AUDIT_SOURCE,
        domain_type_confidence: med.confidence,
        domain_type_reason: med.reason,
        segment: 'site',
        updated_at: new Date().toISOString(),
      };
      if (existing?.is_competitor === true) payload.is_competitor = true;
      if (APPLY) {
        const { error } = await sb.from('domain_strength_domains').upsert(payload, { onConflict: 'domain' });
        if (error) throw error;
      }
      applied.site_promoted += 1;
      if (existing?.is_competitor !== true) {
        queue.push({
          domain: c.domain,
          money_kw: c.money_kw,
          local_money_kw: c.local_money_kw,
          pack_kw: c.pack_kw,
          proposed: 'set is_competitor=true',
          proposed_type: 'site',
          reason: med.reason,
          already_flagged: false,
        });
      }
      changes.push({ domain: c.domain, action: 'med-site', money_kw: c.money_kw });
      continue;
    }

    ambiguous.push({ domain: c.domain, money_kw: c.money_kw, reason: 'no-high-no-med-hint' });
  }

  mkdirSync(dirname(OUT), { recursive: true });
  const report = {
    audit_source: AUDIT_SOURCE,
    applied_mode: APPLY,
    consistent_rivals: census.length,
    auto_applied_counts: applied,
    queue_count: queue.length,
    queue,
    ambiguous: ambiguous.slice(0, 40),
    skipped_manual: skippedManual.slice(0, 20),
    change_sample: changes.slice(0, 40),
    generated_at: new Date().toISOString(),
  };
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  // Also serve from public for dashboard fetch
  writeFileSync(join(ROOT, 'public/competitor-classification-queue.json'), JSON.stringify({
    audit_source: AUDIT_SOURCE,
    queue,
    generated_at: report.generated_at,
  }, null, 2));
  console.log(JSON.stringify({
    applied_mode: APPLY,
    consistent_rivals: census.length,
    auto_applied_counts: applied,
    queue_count: queue.length,
    ambiguous_sample: ambiguous.length,
    out: OUT,
  }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
