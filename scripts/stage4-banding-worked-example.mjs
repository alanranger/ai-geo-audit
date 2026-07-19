/**
 * Stage 4 acceptance: old vs new banding for named money pages.
 * Usage: node scripts/stage4-banding-worked-example.mjs
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { buildMoneyPageMetrics } from '../lib/audit/moneyPages.js';
import { lostClicksForPage, impactLevelFromLostClicks } from '../lib/audit/moneyImpactBands.js';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const TARGETS = [
  '/photography-workshops-near-me',
  '/photography-courses-coventry',
  '/landscape-photography-workshops'
];

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const auditDate = process.argv.find((a) => a.startsWith('--date='))?.split('=')[1] || '2026-07-18';

function parseJson(v) {
  if (!v) return null;
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return null; }
}

function pathOnly(url) {
  try {
    const u = new URL(String(url), 'https://www.alanranger.com');
    let p = (u.pathname || '/').toLowerCase();
    if (p.length > 1) p = p.replace(/\/+$/, '');
    return p || '/';
  } catch {
    return '/';
  }
}

function oldRelativeBand(pages, page) {
  let maxLost = 0;
  const lostMap = new Map();
  for (const p of pages) {
    const lost = lostClicksForPage(p);
    lostMap.set(p.url, lost);
    if (lost > maxLost) maxLost = lost;
  }
  const lost = lostMap.get(page.url) || 0;
  if (maxLost <= 0) return { band: 'LOW', lostClicks: lost };
  const high = 0.75 * maxLost;
  const med = 0.35 * maxLost;
  let band = 'LOW';
  if (lost >= high) band = 'HIGH';
  else if (lost >= med) band = 'MEDIUM';
  return { band, lostClicks: lost };
}

async function main() {
  const sb = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
  const { data: audit, error } = await sb
    .from('audit_results')
    .select('money_page_priority_data')
    .eq('property_url', 'https://www.alanranger.com')
    .eq('audit_date', auditDate)
    .maybeSingle();
  if (error) throw error;
  if (!audit) {
    console.error('No audit row');
    process.exit(1);
  }

  const priority = parseJson(audit.money_page_priority_data) || [];
  const topPages = priority.map((p) => ({
    page: p.url,
    url: p.url,
    clicks: p.clicks || 0,
    impressions: p.impressions || 0,
    ctr: p.ctr || 0,
    position: p.avgPosition || 0,
    title: p.title
  }));

  const commercial = topPages.filter((p) => {
    const row = priority.find((r) => r.url === p.url);
    return row?.includeInHeadline === true || row?.moneyRole === 'commercial';
  });

  const rebuilt = buildMoneyPageMetrics(topPages);
  const byPath = new Map(rebuilt.map((p) => [pathOnly(p.url), p]));

  const rows = TARGETS.map((slug) => {
    const p = byPath.get(slug);
    if (!p) return { slug, error: 'not in priority data' };
    const old = oldRelativeBand(commercial, p);
    const lost = lostClicksForPage(p);
    const newBand = impactLevelFromLostClicks(lost);
    return {
      slug,
      clicks: p.clicks,
      impressions: p.impressions,
      ctr: `${((p.ctr || 0) * 100).toFixed(2)}%`,
      avgPosition: p.avgPosition,
      lostClicks28d: Math.round(lost * 10) / 10,
      oldRelativeBand: old.band,
      newPinnedBand: newBand,
      priorityLevel: p.priorityLevel
    };
  });

  console.log(JSON.stringify({ auditDate, thresholds: { HIGH: 15, MEDIUM: 5 }, rows }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
