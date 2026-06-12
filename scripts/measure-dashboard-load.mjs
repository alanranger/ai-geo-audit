/**
 * Measure live dashboard load: HTML download, API calls, time-to-interactive signals.
 * Run: node scripts/measure-dashboard-load.mjs
 */
import { chromium } from 'playwright';

const URL = 'https://ai-geo-audit.vercel.app/audit-dashboard.html';
const PROPERTY = 'https://www.alanranger.com/';

const minimalAudit = {
  scores: {
    visibility: { score: 72 },
    authority: { score: 51, behaviourScoresSegmented: {}, rankingScoresSegmented: {} },
    localEntity: 80,
    serviceArea: 75,
    contentSchema: 65,
    brandOverlay: { score: 70 },
    moneyPagesMetrics: { rows: [{ url: 'https://www.alanranger.com/', clicks: 10, impressions: 100, ctr: 0.1, avgPosition: 5, title: 'Home' }] },
  },
  searchData: {
    propertyUrl: PROPERTY,
    queryTotals: [{ query: 'photography workshop', clicks: 1, impressions: 10, ctr: 0.1, position: 5 }],
    queryPages: [{ query: 'photography workshop', page: 'https://www.alanranger.com/', clicks: 1, impressions: 10, ctr: 0.1, position: 5 }],
    timeseries: Array.from({ length: 28 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (27 - i));
      return { date: d.toISOString().split('T')[0], clicks: 10, impressions: 100, ctr: 10, position: 8 };
    }),
  },
  snippetReadiness: 50,
  schemaAudit: null,
  localSignals: null,
  propertyUrl: PROPERTY,
  dateRange: 28,
  timestamp: new Date().toISOString(),
};

function fmtMs(ms) {
  return `${(ms / 1000).toFixed(2)}s`;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
await context.addInitScript((audit) => {
  localStorage.setItem('gsc_property_url', audit.propertyUrl);
  localStorage.setItem('last_audit_results', JSON.stringify(audit));
}, minimalAudit);

const page = await context.newPage();
const apiCalls = [];

page.on('response', async (res) => {
  const u = res.url();
  if (!u.includes('/api/')) return;
  const t0 = performance.now();
  let size = 0;
  try {
    const buf = await res.body();
    size = buf.length;
  } catch {
    /* ignore */
  }
  apiCalls.push({
    status: res.status(),
    ms: Math.round(performance.now() - t0),
    size,
    path: u.replace('https://ai-geo-audit.vercel.app', ''),
  });
});

const t0 = Date.now();
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
const domMs = Date.now() - t0;

const loadingHidden = await page.waitForFunction(
  () => !document.getElementById('loading')?.classList.contains('show'),
  { timeout: 120000 }
).then(() => Date.now() - t0).catch(() => null);

const dashboardVisible = await page.waitForFunction(
  () => {
    const d = document.getElementById('dashboard');
    return d && d.style.display !== 'none' && d.innerText.length > 200;
  },
  { timeout: 120000 }
).then(() => Date.now() - t0).catch(() => null);

const trendReady = await page.waitForFunction(
  () => typeof window.trendChart !== 'undefined' && window.trendChart !== null,
  { timeout: 120000 }
).then(() => Date.now() - t0).catch(() => null);

const version = await page.evaluate(() => document.body.innerText.match(/Version:\s*([a-f0-9]+)/)?.[1] || 'unknown');

console.log('\n=== Dashboard load measurement (cached localStorage audit) ===');
console.log('Deployed version pill:', version);
console.log('DOMContentLoaded:', fmtMs(domMs));
console.log('Loading spinner hidden:', loadingHidden != null ? fmtMs(loadingHidden) : 'TIMEOUT');
console.log('Dashboard visible (>200 chars):', dashboardVisible != null ? fmtMs(dashboardVisible) : 'TIMEOUT');
console.log('Trend chart created:', trendReady != null ? fmtMs(trendReady) : 'TIMEOUT');
console.log('\nAPI calls:', apiCalls.length);
for (const c of apiCalls.sort((a, b) => b.size - a.size).slice(0, 20)) {
  console.log(`  ${c.status} ${(c.size / 1024).toFixed(0)}KB ${c.path.slice(0, 100)}`);
}

await browser.close();
