/**
 * Persist-only recompute of money_pages_metrics + money_page_priority_data
 * using classification v2 (utility excluded; headline = commercial landing).
 *
 * Usage:
 *   node scripts/recompute-money-pages-v2-for-audit.mjs --date=2026-07-18
 *   node scripts/recompute-money-pages-v2-for-audit.mjs --date=2026-07-18 --apply
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import {
  computeMoneyPagesMetrics,
  buildMoneyPageMetrics,
  buildMoneyPagesSummary,
  buildMoneySegmentSummary
} from '../lib/audit/moneyPages.js';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const apply = process.argv.includes('--apply');
const auditDate = process.argv.find((a) => a.startsWith('--date='))?.split('=')[1] || '2026-07-18';
const propertyUrl = process.argv.find((a) => a.startsWith('--property='))?.split('=')[1]
  || 'https://www.alanranger.com';

const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

function parseJson(v) {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

function pct(clicks, total) {
  if (!total) return '—';
  return `${((clicks / total) * 100).toFixed(1)}% (${clicks}/${total})`;
}

async function main() {
  const { data: audit, error } = await sb
    .from('audit_results')
    .select('id, audit_date, property_url, money_pages_metrics, money_page_priority_data, money_segment_metrics, money_pages_summary, gsc_clicks, gsc_impressions')
    .eq('property_url', propertyUrl)
    .eq('audit_date', auditDate)
    .maybeSingle();

  if (error) throw error;
  if (!audit) {
    console.error(`No audit_results row for ${propertyUrl} on ${auditDate}`);
    process.exit(1);
  }

  const priorityData = parseJson(audit.money_page_priority_data) || [];
  const oldMetrics = parseJson(audit.money_pages_metrics) || {};
  if (!priorityData.length) {
    console.error('money_page_priority_data empty — cannot recompute');
    process.exit(1);
  }

  const topPages = priorityData.map((p) => ({
    page: p.url,
    url: p.url,
    clicks: p.clicks || 0,
    impressions: p.impressions || 0,
    ctr: p.ctr || 0,
    position: p.avgPosition || 0,
    avgPosition: p.avgPosition || 0,
    title: p.title || p.url
  }));

  const siteAgg = {
    totalClicks: oldMetrics.overview?.siteTotalClicks ?? audit.gsc_clicks ?? 0,
    totalImpressions: oldMetrics.overview?.siteTotalImpressions ?? audit.gsc_impressions ?? 0,
    avgCtr: oldMetrics.overview?.siteCtr ?? 0,
    avgPosition: oldMetrics.overview?.siteAvgPosition ?? null
  };

  const newMetrics = computeMoneyPagesMetrics(topPages, null, siteAgg, null, null);
  const newPriority = buildMoneyPageMetrics(topPages, null);
  const newSegment = buildMoneySegmentSummary(newPriority, {});
  const newSummary = buildMoneyPagesSummary(newMetrics, {
    siteTotalClicks: siteAgg.totalClicks,
    siteTotalImpressions: siteAgg.totalImpressions
  });

  const oldOv = oldMetrics.overview || {};
  const newOv = newMetrics.overview || {};

  const roleCounts = newPriority.reduce((a, p) => {
    const r = p.moneyRole || 'unknown';
    a[r] = (a[r] || 0) + 1;
    return a;
  }, {});

  const subCounts = (newMetrics.rows || []).reduce((a, r) => {
    const s = r.subSegment || 'LANDING';
    a[s] = (a[s] || 0) + 1;
    return a;
  }, {});

  console.log('=== Money pages v2 recompute (dry-run unless --apply) ===');
  console.log({ auditDate, propertyUrl, apply });
  console.log('Source rows (priority data):', priorityData.length);
  console.log('Tab rows after v2 filter:', newMetrics.rows?.length || 0);
  console.log('Priority rows after v2 filter:', newPriority.length);
  console.log('Role counts:', roleCounts);
  console.log('Sub-segment counts:', subCounts);
  console.log('\nHeadline (commercial only):');
  console.log('  OLD share:', pct(oldOv.moneyClicks, oldOv.siteTotalClicks));
  console.log('  NEW share:', pct(newOv.moneyClicks, newOv.siteTotalClicks));
  console.log('  OLD avg pos:', oldOv.moneyAvgPosition);
  console.log('  NEW avg pos:', newOv.moneyAvgPosition);
  console.log('  OLD coverage:', oldOv.moneyCoverageCount);
  console.log('  NEW coverage:', newOv.moneyCoverageCount);
  console.log('\nSegment metrics allMoney:', newSegment.allMoney);

  if (!apply) {
    console.log('\nDry run — pass --apply to persist.');
    return;
  }

  const { error: upErr } = await sb
    .from('audit_results')
    .update({
      money_pages_metrics: newMetrics,
      money_page_priority_data: newPriority,
      money_segment_metrics: newSegment,
      money_pages_summary: newSummary
    })
    .eq('id', audit.id);

  if (upErr) throw upErr;
  console.log('\n✓ Persisted v2 money metrics for', auditDate);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
