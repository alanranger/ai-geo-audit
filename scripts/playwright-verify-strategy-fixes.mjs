/**
 * Verify Strategy tick feedback + plans wording + returning targets.
 * node scripts/playwright-verify-strategy-fixes.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const BASE = 'https://ai-geo-audit.vercel.app';
const OUT = resolve('C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude');
mkdirSync(OUT, { recursive: true });

async function waitJs(maxMs = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const r = await fetch(`${BASE}/lib/strategy-tab.js?v=st-20261007c`, { method: 'HEAD' });
      if (r.ok) {
        const body = await fetch(`${BASE}/lib/strategy-tab.js?v=st-20261007c`);
        const txt = await body.text();
        if (txt.includes('st-saved') && txt.includes('£23k')) return;
      }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 8000));
  }
  throw new Error('strategy-tab.js with fixes not deployed');
}

await waitJs();
const sum = await (await fetch(`${BASE}/api/aigeo/strategy-summary?propertyUrl=${encodeURIComponent('https://www.alanranger.com')}`)).json();
if (!sum.ok) throw new Error(sum.error || 'summary failed');
if (!sum.plans_connected) throw new Error('expected plans_connected=true');
if (sum.plan_clients?.empty_reason !== 'Plans tab connected · 0 plans yet') {
  throw new Error('bad empty_reason: ' + sum.plan_clients?.empty_reason);
}
if (Number(sum.kpis?.find((k) => k.id === 9)?.target) !== 23000) throw new Error('KPI9 target not 23000');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/audit-dashboard.html?v=stfix-${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.click('.aigeo-nav-item[data-panel="strategy"]');
await page.waitForSelector('#strategy-root .qcard', { timeout: 90000 });

const openTick = page.locator('.qcard li:not(.st-done) .st-tick').first();
await openTick.waitFor({ timeout: 15000 });
const id = await openTick.getAttribute('data-id');
await openTick.click();
await page.waitForSelector(`li[data-id="${id}"] .st-saved`, { timeout: 8000 });
await page.waitForSelector(`li[data-id="${id}"].st-done`, { timeout: 8000 });
const progress = await page.locator('.qcard.is-current .st-progress').first().innerText();
if (!/\d+ of \d+ done/.test(progress)) throw new Error('bad progress: ' + progress);

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.aigeo-nav-item[data-panel="strategy"]', { timeout: 60000 });
await page.click('.aigeo-nav-item[data-panel="strategy"]');
await page.waitForSelector('#strategy-root .qcard', { timeout: 90000 });
await page.waitForSelector(`#strategy-root li[data-id="${id}"].st-done`, { timeout: 30000 });

await page.route('**/api/aigeo/strategy-actions', async (route) => {
  if (route.request().method() === 'PATCH') {
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'forced' }) });
  } else await route.continue();
});
const failTick = page.locator('.qcard li:not(.st-done) .st-tick').first();
const failId = await failTick.getAttribute('data-id');
const wasOn = await failTick.evaluate((el) => el.classList.contains('on'));
await failTick.click();
await page.waitForSelector(`li[data-id="${failId}"] .st-err`, { timeout: 8000 });
const still = await page.locator(`li[data-id="${failId}"] .st-tick`).evaluate((el) => el.classList.contains('on'));
if (still !== wasOn) throw new Error('failed save did not revert tick');
await page.unroute('**/api/aigeo/strategy-actions');

// restore successful tick to prior state (untick the one we ticked)
await fetch(`${BASE}/api/aigeo/strategy-actions`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: Number(id), propertyUrl: 'https://www.alanranger.com', is_ticked: false })
});

await page.screenshot({ path: resolve(OUT, 'LIVE-STRATEGY-TICK-FEEDBACK-SCREENSHOT-LATEST.png') });
writeFileSync(resolve(OUT, 'LIVE-STRATEGY-FIXES-VERIFY-LATEST.json'), JSON.stringify({
  verified_at: new Date().toISOString(),
  progress,
  tick_id: id,
  plans_empty: sum.plan_clients.empty_reason,
  kpi9_target: sum.kpis.find((k) => k.id === 9).target,
  returning_dec: sum.scorecard.returning.dec_target,
  returning_sep: sum.scorecard.returning.target
}, null, 2));
await browser.close();
console.log('ok');
