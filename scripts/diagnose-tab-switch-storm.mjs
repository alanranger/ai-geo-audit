import { chromium } from 'playwright';

const BASE = 'https://ai-geo-audit.vercel.app/audit-dashboard.html';
const TRACK = /get-latest-audit|get-audit-history|06-site-urls|site-urls\.csv|money-pages|portfolio-segment|dataforseo|keyword-target|backlink/i;

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

let phase = 'load';
const byEndpoint = {};
const events = [];
function endpointName(u) {
  const m = u.match(/\/api\/[^?]*/) || u.match(/[^/]+\.csv/) || [u.slice(0, 40)];
  return m[0];
}
page.on('request', (req) => {
  const u = req.url();
  if (!TRACK.test(u)) return;
  const name = endpointName(u);
  byEndpoint[name] = byEndpoint[name] || {};
  byEndpoint[name][phase] = (byEndpoint[name][phase] || 0) + 1;
  events.push({ phase, t: Date.now(), name });
});

const t0 = Date.now();
await page.goto(BASE, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(15000);
console.log(`\n=== INITIAL LOAD: ${Date.now() - t0}ms, tracked reqs: ${events.length} ===`);

// Discover nav tabs
const tabs = await page.$$eval('button.aigeo-nav-item[data-panel]', (els) =>
  els.map((e) => ({ panel: e.getAttribute('data-panel'), label: (e.getAttribute('title') || '').split(' - ')[0] }))
);
console.log(`Found ${tabs.length} nav tabs:`, tabs.map((t) => t.panel).join(', '));

for (const tab of tabs) {
  phase = tab.panel;
  const before = events.length;
  const ts = Date.now();
  try {
    await page.click(`button.aigeo-nav-item[data-panel="${tab.panel}"]`, { timeout: 5000 });
  } catch (e) {
    console.log(`  ! click failed for ${tab.panel}: ${e.message}`);
    continue;
  }
  // Wait for network to quiet (or 12s max)
  await page.waitForTimeout(8000);
  const reqs = events.length - before;
  console.log(`TAB ${tab.panel.padEnd(20)} switch+settle ${String(Date.now() - ts).padStart(6)}ms  tracked reqs: ${reqs}`);
}

// Per-endpoint summary
console.log('\n=== PER-ENDPOINT REQUEST COUNTS (phase => count) ===');
for (const [name, phases] of Object.entries(byEndpoint)) {
  const total = Object.values(phases).reduce((a, b) => a + b, 0);
  console.log(`${String(total).padStart(4)}x  ${name}`);
  const top = Object.entries(phases).sort((a, b) => b[1] - a[1]).slice(0, 6);
  console.log('         ', top.map(([p, c]) => `${p}:${c}`).join('  '));
}

// Check Money Pages URL
phase = 'money-check';
try {
  await page.click('button.aigeo-nav-item[data-panel="money-pages"]', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(6000);
  const found = await page.evaluate(() => {
    const rows = window.moneyPagesMetrics?.rows || [];
    const cov = rows.find((r) => /property-photographer-coventry/i.test(r.url || r.page || ''));
    const renderedRows = document.querySelectorAll('#moneyPagesTable tbody tr, .money-pages-table tbody tr, table tbody tr').length;
    return {
      hasCoventryDom: /property-photographer-coventry/i.test(document.body.innerHTML),
      hasCoventryData: !!cov,
      coventryRow: cov ? { url: cov.url, category: cov.category, source: cov._source, impressions: cov.impressions, clicks: cov.clicks } : null,
      moneyRowCount: rows.length,
      renderedRows
    };
  });
  console.log('\n=== MONEY PAGES CHECK ===');
  console.log('coventry in DOM:', found.hasCoventryDom, '| in rows data:', found.hasCoventryData);
  console.log('coventry row:', JSON.stringify(found.coventryRow));
  console.log('moneyPagesMetrics.rows:', found.moneyRowCount, '| rendered <tr>:', found.renderedRows);
} catch (e) {
  console.log('Money pages check error:', e.message);
}

await browser.close();
