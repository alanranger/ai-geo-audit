/**
 * Production: ① starts a new ~479-URL run, then Stop / Cancel.
 * Clean storage — no sample localStorage. Do NOT let the run finish.
 * node scripts/playwright-trad-seo-full-start-cancel.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const OUT = resolve('C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude');
mkdirSync(OUT, { recursive: true });
const BASE = process.env.AIGEO_BASE_URL || 'https://ai-geo-audit.vercel.app';

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(180000);
const report = { ok: false, steps: [] };

async function waitForBuild() {
  const deadline = Date.now() + 8 * 60 * 1000;
  while (Date.now() < deadline) {
    const url = `${BASE}/audit-dashboard.html?cb=${Date.now()}#traditional-seo`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const has = await page.evaluate(() => typeof window.tradSeoRenderCancel === 'function');
    if (has) {
      report.url = url;
      return true;
    }
    await page.waitForTimeout(15000);
  }
  return false;
}

try {
  if (!(await waitForBuild())) throw new Error('production dashboard does not yet have the full-start BUILD');
  report.steps.push('build present');
  await page.evaluate(() => {
    localStorage.removeItem('trad_seo_sample_urls');
    localStorage.removeItem('trad_seo_force_not_checked');
    localStorage.removeItem('trad_seo_render_run_id');
  });
  await page.locator('.aigeo-nav-item[data-panel="traditional-seo"]').click().catch(() => {});
  await page.waitForSelector('#traditional-seo-run-full-audit-btn', { timeout: 60000 });
  await page.locator('#traditional-seo-run-full-audit-btn').click();
  report.steps.push('clicked ①');
  await page.waitForFunction(() => {
    const t = document.getElementById('traditional-seo-eval-progress-subtitle')?.textContent || '';
    return /rendering\s+\d+\s+\/\s+4\d{2}\s+pages/i.test(t);
  }, null, { timeout: 180000 });
  report.subtitle = await page.locator('#traditional-seo-eval-progress-subtitle').innerText();
  const planned = Number((report.subtitle.match(/\/\s*(\d+)/) || [])[1] || 0);
  report.pagesPlanned = planned;
  const snap = await page.evaluate(async () => {
    const body = await fetch('/api/aigeo/traditional-seo-render').then((r) => r.json()).catch(() => ({}));
    return body.run || null;
  });
  report.run = snap;
  await page.screenshot({
    path: resolve(OUT, 'SCREEN-2026-10-30-trad-seo-full-start-progress.png'),
    fullPage: false
  });
  await page.locator('#traditional-seo-eval-progress-cancel').click();
  report.steps.push('clicked Stop');
  await page.waitForTimeout(8000);
  const after = await page.evaluate(async () => {
    const id = localStorage.getItem('trad_seo_render_run_id');
    const body = await fetch('/api/aigeo/traditional-seo-render').then((r) => r.json()).catch(() => ({}));
    return { localId: id, run: body.run || null };
  });
  report.after = after;
  report.runId = snap?.run_id || after.run?.run_id || null;
  report.cancelled = String(after.run?.status || '').toLowerCase() === 'cancelled'
    || String(after.run?.status || '').toLowerCase() !== 'running';
  report.ok = planned >= 400 && planned < 600 && !!report.runId;
} catch (err) {
  report.error = String(err && err.message ? err.message : err);
} finally {
  writeFileSync(resolve(OUT, 'REPORT-2026-10-30-trad-seo-full-start-cancel.json'), JSON.stringify(report, null, 2));
  await browser.close();
}

if (!report.ok) process.exit(1);
