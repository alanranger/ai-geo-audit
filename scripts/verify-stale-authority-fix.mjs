/**
 * Verify stale localStorage authority (45) is corrected on live dashboard.
 * Run after deploy: node scripts/verify-stale-authority-fix.mjs
 */
import { chromium } from 'playwright';

const URL = process.env.DASHBOARD_URL || 'https://ai-geo-audit.vercel.app/audit-dashboard.html';
const MIN_AUTH = Number(process.env.MIN_AUTHORITY || 50);

const staleAudit = {
  propertyUrl: 'https://www.alanranger.com/',
  timestamp: '2026-06-12T16:43:00.000Z',
  scores: {
    visibility: 79,
    authority: {
      score: 45,
      bySegment: { all: { total: 45, behaviour: 5, ranking: 42, backlinks: 87, reviews: 86 } },
    },
    authorityComponents: { behaviour: 5, ranking: 42, backlinks: 87, reviews: 86 },
    localEntity: 100,
    serviceArea: 100,
    contentSchema: 100,
    brandOverlay: { score: 0 },
  },
  searchData: {
    propertyUrl: 'https://www.alanranger.com/',
    totalClicks: 5000,
    totalImpressions: 500000,
    averagePosition: 8.5,
    ctr: 1.0,
    timeseries: Array.from({ length: 30 }, (_, i) => {
      const d = new Date('2026-05-13');
      d.setDate(d.getDate() + i);
      return { date: d.toISOString().split('T')[0], clicks: 10, impressions: 100, ctr: 0.1, position: 8 };
    }),
    queryPages: [{ query: 'x', page: 'https://www.alanranger.com/', clicks: 1, impressions: 10, ctr: 0.1, position: 5 }],
  },
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
await ctx.addInitScript((a) => {
  localStorage.setItem('gsc_property_url', a.propertyUrl);
  localStorage.setItem('last_audit_results', JSON.stringify(a));
}, staleAudit);
const page = await ctx.newPage();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(
  () => !document.getElementById('loading')?.classList.contains('show'),
  { timeout: 180000 }
);
await page.waitForTimeout(45000);

const info = await page.evaluate(() => {
  const gaioEl = [...document.querySelectorAll('div')].find((el) =>
    el.textContent?.includes('GAIO Score Breakdown') && el.textContent?.includes('Authority')
  );
  const gaioAuth = gaioEl?.textContent?.match(/Authority:\s*(\d+)/)?.[1];
  const pillar = [...document.querySelectorAll('.pillar-card')].find((c) => c.textContent.includes('E-A-T'));
  const c = window.trendChart;
  const ai = c?.data?.datasets?.findIndex((d) => d.label === 'Authority');
  const raw = c?.data?.datasets?.[ai]?.rawData || c?.data?.datasets?.[ai]?.data || [];
  const labels = c?.data?.labels || [];
  const last = [];
  for (let i = labels.length - 1; i >= 0 && last.length < 3; i--) {
    if (labels[i] && raw[i] != null) last.unshift({ d: labels[i], v: raw[i] });
  }
  return {
    version: document.body.innerText.match(/Version:\s*([a-f0-9]+)/)?.[1],
    gaioAuth: gaioAuth ? Number(gaioAuth) : null,
    pillar: Number(pillar?.querySelector('.pillar-score')?.textContent?.trim()),
    latest: window.latestAuditScores?.authority?.bySegment?.all?.total ?? window.latestAuditScores?.authority?.score,
    lastTrend: last,
    chartReady: typeof Chart !== 'undefined' && c instanceof Chart,
  };
});

console.log(JSON.stringify(info, null, 2));

const ok =
  info.chartReady &&
  info.gaioAuth >= MIN_AUTH &&
  info.pillar >= MIN_AUTH &&
  Number(info.latest) >= MIN_AUTH &&
  info.lastTrend.every((p) => p.v >= MIN_AUTH);

await browser.close();
if (!ok) {
  console.error(`FAIL: expected authority >= ${MIN_AUTH} everywhere (GAIO, pillar, latest, trend tail)`);
  process.exit(1);
}
console.log(`PASS: stale authority 45 corrected (all >= ${MIN_AUTH})`);
