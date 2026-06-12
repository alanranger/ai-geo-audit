/**
 * Verify Authority trend chart with realistic localStorage seed (works when Supabase is down).
 * Run: node scripts/verify-authority-trend-seeded.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const URL = 'https://ai-geo-audit.vercel.app/audit-dashboard.html';
const __dirname = dirname(fileURLToPath(import.meta.url));

function buildTimeseries(start, days) {
  const out = [];
  const d0 = new Date(start);
  for (let i = 0; i < days; i++) {
    const d = new Date(d0);
    d.setDate(d0.getDate() + i);
    out.push({
      date: d.toISOString().split('T')[0],
      clicks: 10,
      impressions: 100,
      ctr: 10,
      position: 8,
    });
  }
  return out;
}

const timeseries = buildTimeseries('2026-05-12', 31); // through 2026-06-11
const lastDate = timeseries[timeseries.length - 1].date;

const audit = {
  propertyUrl: 'https://www.alanranger.com/',
  timestamp: `${lastDate}T12:00:00.000Z`,
  scores: {
    visibility: 80,
    localEntity: 100,
    serviceArea: 100,
    contentSchema: 100,
    authority: {
      score: 52,
      bySegment: {
        all: { total: 52, behaviour: 7, ranking: 72, backlinks: 87, reviews: 86 },
        nonEducation: { total: 52, behaviour: 7, ranking: 72, backlinks: 87, reviews: 86 },
        money: { total: 52, behaviour: 7, ranking: 72, backlinks: 87, reviews: 86 },
      },
    },
    authorityComponents: { behaviour: 7, ranking: 72, backlinks: 87, reviews: 86 },
  },
  searchData: {
    propertyUrl: 'https://www.alanranger.com/',
    timeseries,
    queryPages: [{ query: 'photography workshop', page: 'https://www.alanranger.com/', clicks: 1, impressions: 10, ctr: 10, position: 5 }],
    topQueries: [{ query: 'photography workshop', clicks: 1, impressions: 10, ctr: 10, position: 5 }],
  },
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.addInitScript(({ auditPayload, property }) => {
  localStorage.setItem('gsc_property_url', property);
  localStorage.setItem('last_audit_results', JSON.stringify(auditPayload));
}, { auditPayload: audit, property: audit.propertyUrl });

const page = await context.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });
await page.waitForFunction(() => !document.getElementById('loading')?.classList.contains('show'), { timeout: 180000 }).catch(() => null);
await page.waitForFunction(() => window.trendChart?.data?.datasets?.length > 0, { timeout: 180000 }).catch(() => null);

const version = await page.evaluate(() => document.body.innerText.match(/Version:\s*([a-f0-9]+)/)?.[1] || 'unknown');

const result = await page.evaluate(() => {
  const card = [...document.querySelectorAll('.pillar-card')].find((c) => c.textContent.includes('E-A-T'));
  const cardScore = Number(card?.querySelector('.pillar-score')?.textContent?.trim());
  const chart = window.trendChart;
  const authIdx = chart?.data?.datasets?.findIndex((d) => /authority/i.test(d.label || '')) ?? -1;
  const lastIdx = (chart?.data?.labels?.length ?? 1) - 1;
  const trendLast = authIdx >= 0 ? chart.data.datasets[authIdx].data[lastIdx] : null;
  const lastLabel = chart?.data?.labels?.[lastIdx];
  return { cardScore, trendLast, lastLabel };
});

console.log('\n=== Seeded Authority trend verification ===');
console.log('Deployed version:', version);
console.log('Last chart label:', result.lastLabel);
console.log('Authority card:', result.cardScore);
console.log('Trend last Authority:', result.trendLast);

const ok =
  Number.isFinite(result.cardScore) &&
  Number.isFinite(Number(result.trendLast)) &&
  Math.abs(result.cardScore - Number(result.trendLast)) <= 2;

console.log('Parity (±2):', ok ? 'PASS' : 'FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
