import { chromium } from 'playwright';

const URL = 'https://ai-geo-audit.vercel.app/audit-dashboard.html';
const audit = {
  propertyUrl: 'https://www.alanranger.com/',
  scores: {
    visibility: 80,
    authority: { score: 52, bySegment: { all: { total: 52, behaviour: 7, ranking: 72, backlinks: 87, reviews: 86 } } },
    localEntity: 100,
    serviceArea: 100,
    contentSchema: 100,
  },
  searchData: {
    propertyUrl: 'https://www.alanranger.com/',
    timeseries: Array.from({ length: 31 }, (_, i) => {
      const d = new Date('2026-05-12');
      d.setDate(d.getDate() + i);
      return { date: d.toISOString().split('T')[0], clicks: 10, impressions: 100, ctr: 10, position: 8 };
    }),
    queryPages: [{ query: 'x', page: 'https://www.alanranger.com/', clicks: 1, impressions: 10, ctr: 10, position: 5 }],
  },
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
await ctx.addInitScript((a) => {
  localStorage.setItem('gsc_property_url', a.propertyUrl);
  localStorage.setItem('last_audit_results', JSON.stringify(a));
}, audit);
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 150)); });
const t0 = Date.now();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => !document.getElementById('loading')?.classList.contains('show'), { timeout: 120000 });
await page.locator('.aigeo-nav-item[data-panel="overview"]').click();
const chartReady = await page.waitForFunction(
  () => {
    const c = window.trendChart;
    return typeof Chart !== 'undefined' && c instanceof Chart && c.data?.datasets?.some((d) => d.label === 'Authority');
  },
  { timeout: 180000 }
).then(() => true).catch(() => false);
const info = await page.evaluate(() => {
  const c = window.trendChart;
  const authIdx = c?.data?.datasets?.findIndex((d) => d.label === 'Authority') ?? -1;
  const raw = authIdx >= 0 ? (c.data.datasets[authIdx].rawData || c.data.datasets[authIdx].data) : null;
  const card = [...document.querySelectorAll('.pillar-card')].find((el) => el.textContent.includes('E-A-T'));
  return {
    version: document.body.innerText.match(/Version:\s*([a-f0-9]+)/)?.[1],
    chartReady: typeof Chart !== 'undefined' && c instanceof Chart,
    labelCount: c?.data?.labels?.length,
    authLast: raw ? raw[raw.length - 1] : null,
    cardScore: card?.querySelector('.pillar-score')?.textContent?.trim(),
    latest: window.latestAuditScores?.authority?.bySegment?.all?.total,
  };
});
console.log(JSON.stringify({ ...info, chartReadyWait: chartReady, elapsedMs: Date.now() - t0, errors: errors.slice(0, 5) }, null, 2));
await browser.close();
process.exit(chartReady && info.cardScore && Math.abs(Number(info.cardScore) - Number(info.authLast)) <= 2 ? 0 : 1);
