import { chromium } from 'playwright';

const BASE = 'https://ai-geo-audit.vercel.app/audit-dashboard.html';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const logs = [];
page.on('console', (msg) => {
  const t = msg.text();
  if (/money pages|csv merge|canonical|merged|coventry|site urls|unable to load|fallback|primary/i.test(t)) logs.push(t.slice(0, 220));
});

await page.goto(BASE, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(12000);
// Go to money tab to trigger render
await page.click('button.aigeo-nav-item[data-panel="money"]', { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(10000);

console.log('\n=== RELEVANT CONSOLE LOGS ===');
logs.forEach((l) => console.log('•', l));

const probe = await page.evaluate(async () => {
  const out = {};
  const rows = window.moneyPagesMetrics?.rows || [];
  out.rowCount = rows.length;
  out.hasCoventry = rows.some((r) => /property-photographer-coventry/i.test(r.url || r.page || ''));
  // Can the browser fetch the fallback CSV and find coventry?
  try {
    const r = await fetch('https://raw.githubusercontent.com/alanranger/alan-shared-resources/main/csv/06-site-urls.csv?cb=' + Date.now(), { cache: 'no-store' });
    const txt = await r.text();
    out.fallbackOk = r.ok;
    out.fallbackHasCoventry = /property-photographer-coventry/i.test(txt);
  } catch (e) {
    out.fallbackErr = e.message;
  }
  // Is classifyPageSegment reachable + what does it say? (functions are not on window; test indirectly)
  out.sampleUrls = rows.slice(0, 3).map((r) => r.url);
  out.sources = rows.reduce((acc, r) => { acc[r._source || 'audit'] = (acc[r._source || 'audit'] || 0) + 1; return acc; }, {});
  out.hasMergeFn = typeof window.mergeCanonicalCsvIntoMoneyPagesMetrics === 'function';
  // Directly invoke the merge to observe behaviour
  if (out.hasMergeFn && window.moneyPagesMetrics?.rows) {
    const before = window.moneyPagesMetrics.rows.length;
    try {
      const merged = await window.mergeCanonicalCsvIntoMoneyPagesMetrics(window.moneyPagesMetrics);
      out.mergeBefore = before;
      out.mergeAfter = merged.rows.length;
      out.mergeHasCoventry = merged.rows.some((r) => /property-photographer-coventry/i.test(r.url || ''));
    } catch (e) {
      out.mergeErr = e.message;
    }
  }
  return out;
});

console.log('\n=== PROBE ===');
console.log(JSON.stringify(probe, null, 2));

await browser.close();
