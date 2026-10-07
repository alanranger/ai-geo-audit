/**
 * Screenshot Strategy tab after data fixes.
 * node scripts/playwright-verify-strategy-data.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const BASE = 'https://ai-geo-audit.vercel.app';
const OUT = resolve('C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude');
mkdirSync(OUT, { recursive: true });

async function waitReady(maxMs = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    try {
      const j = await (await fetch(`${BASE}/api/aigeo/strategy-summary?propertyUrl=${encodeURIComponent('https://www.alanranger.com')}`)).json();
      if (j.ok && (j.upcoming_events || []).length >= 5 && j.workshop_signals?.residential_avg != null) {
        return j;
      }
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 8000));
  }
  throw new Error('strategy-summary data not ready');
}

const summary = await waitReady();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
await page.goto(`${BASE}/audit-dashboard.html?v=stdata-${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.click('.aigeo-nav-item[data-panel="strategy"]');
await page.waitForSelector('#strategy-root #st-upcoming, #strategy-root .rt-section', { timeout: 90000 });
await page.waitForTimeout(1500);
// scroll to upcoming / KPI area
const upcoming = page.locator('#st-upcoming').first();
if (await upcoming.count()) await upcoming.scrollIntoViewIfNeeded().catch(() => {});
else await page.getByText('Upcoming events fill', { exact: false }).first().scrollIntoViewIfNeeded().catch(() => {});
await page.screenshot({ path: resolve(OUT, 'LIVE-STRATEGY-DATA-FIXES-SCREENSHOT-LATEST.png'), fullPage: false });
await page.locator('#st-kpis').scrollIntoViewIfNeeded().catch(() => {});
await page.screenshot({ path: resolve(OUT, 'LIVE-STRATEGY-DATA-FIXES-KPIS-SCREENSHOT-LATEST.png'), fullPage: false });
writeFileSync(resolve(OUT, 'LIVE-STRATEGY-DATA-FIXES-SUMMARY-LATEST.json'), JSON.stringify({
  verified_at: new Date().toISOString(),
  upcoming_events: summary.upcoming_events,
  workshop_signals: summary.workshop_signals,
  beginners_next_8w: summary.headline?.beginners_next_8w,
  beginners_fill_pct: summary.headline?.beginners_fill_pct,
  roadmap_now: summary.roadmap_now,
  kpi10: summary.kpis?.find((k) => k.id === 10)
}, null, 2));
await browser.close();
console.log(JSON.stringify({
  upcoming: summary.upcoming_events.length,
  residential_avg: summary.workshop_signals.residential_avg,
  next8: summary.headline.beginners_next_8w,
  fill: summary.headline.beginners_fill_pct,
  non_jlr: summary.roadmap_now.beginners_non_jlr
}, null, 2));
