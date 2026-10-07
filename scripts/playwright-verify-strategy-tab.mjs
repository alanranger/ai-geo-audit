/**
 * Live verify Strategy & KPIs tab (Phase D).
 * node scripts/playwright-verify-strategy-tab.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const BASE = 'https://ai-geo-audit.vercel.app';
const OUT = resolve('C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude');
mkdirSync(OUT, { recursive: true });

async function waitForApi(maxMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const r = await fetch(`${BASE}/api/aigeo/strategy-summary?propertyUrl=${encodeURIComponent('https://www.alanranger.com')}`);
      if (r.ok) {
        const j = await r.json();
        if (j.ok && Array.isArray(j.kpis) && j.kpis.length === 11) return j;
      }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 8000));
  }
  throw new Error('strategy-summary API not ready in time');
}

const summary = await waitForApi();
console.log(JSON.stringify({
  api_ok: true,
  actions: (summary.actions || []).length,
  kpis: summary.kpis.length,
  gp_t3: summary.gp_t3
}, null, 2));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/audit-dashboard.html?v=st-${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('.aigeo-nav-item[data-panel="strategy"]', { timeout: 60000 });
await page.click('.aigeo-nav-item[data-panel="strategy"]');
await page.waitForSelector('#strategy-root .rt-section, #strategy-root .rt-error', { timeout: 90000 });
const err = await page.$('#strategy-root .rt-error');
if (err) throw new Error(await err.innerText());

await page.waitForSelector('#st-kpis tbody tr', { timeout: 30000 });
const kpiCount = await page.$$eval('#st-kpis tbody tr', (rows) => rows.length);
if (kpiCount !== 11) throw new Error(`Expected 11 KPIs, got ${kpiCount}`);

const tick = page.locator('.st-tick').first();
const id = await tick.getAttribute('data-id');
const wasOn = await tick.evaluate((el) => el.classList.contains('on'));
await tick.click();
await page.waitForTimeout(1500);
await page.waitForSelector('#strategy-root .rt-section', { timeout: 30000 });

const afterPatch = await fetch(`${BASE}/api/aigeo/strategy-actions?propertyUrl=${encodeURIComponent('https://www.alanranger.com')}`);
const actionsJson = await afterPatch.json();
const row = (actionsJson.actions || []).find((a) => String(a.id) === String(id));
if (!row) throw new Error('ticked action not found in API');
if (Boolean(row.is_ticked) === wasOn) throw new Error('tick did not persist in Supabase');

// restore
await fetch(`${BASE}/api/aigeo/strategy-actions`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ id: Number(id), propertyUrl: 'https://www.alanranger.com', is_ticked: wasOn })
});

await page.screenshot({
  path: resolve(OUT, 'LIVE-STRATEGY-TAB-SCREENSHOT-LATEST.png'),
  fullPage: false
});
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(400);
await page.screenshot({
  path: resolve(OUT, 'LIVE-STRATEGY-TAB-KPIS-SCREENSHOT-LATEST.png'),
  fullPage: false
});

writeFileSync(resolve(OUT, 'LIVE-STRATEGY-VERIFY-LATEST.json'), JSON.stringify({
  verified_at: new Date().toISOString(),
  commit_hint: 'e8e5299',
  kpi_count: kpiCount,
  tick_id: id,
  tick_was: wasOn,
  tick_became: row.is_ticked,
  gp_t3: summary.gp_t3,
  plans_empty: summary.plan_clients?.empty_reason || null,
  kpi_reasons: summary.kpis.filter((k) => k.actual == null || k.reason).map((k) => ({
    id: k.id, status: k.status, reason: k.reason || 'null actual'
  }))
}, null, 2));

await browser.close();
console.log('playwright ok');
