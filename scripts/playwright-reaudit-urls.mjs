/**
 * Production proof: click the dashboard "Re-audit page" button for each URL (deep link
 * ?seoPage=…&reaudit=1), paced, then screenshot the per-rule Pass/Warn/Fail panel.
 * Usage: node scripts/playwright-reaudit-urls.mjs <expected-commit-prefix> <urls-file>
 */
import fs from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.AIGEO_BASE_URL || 'https://ai-geo-audit.vercel.app';
const OUT = 'C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude';
const [commitPrefix, urlsFile] = process.argv.slice(2);
const urls = fs.readFileSync(urlsFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const GAP_MS = 20000;

async function waitForBuild(page) {
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await page.goto(`${BASE}/audit-dashboard.html?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(4000);
    const v = await page.locator('#gitVersion').innerText().catch(() => '');
    if (v && v.startsWith(commitPrefix)) return v;
    await page.waitForTimeout(20000);
  }
  throw new Error(`deployed version never reached ${commitPrefix}`);
}

async function reaudit(page, url) {
  const deep = `${BASE}/audit-dashboard.html?seoPage=${encodeURIComponent(url)}&reaudit=1&cb=${Date.now()}#traditional-seo`;
  await page.goto(deep, { waitUntil: 'domcontentloaded', timeout: 120000 });
  const btn = '#traditional-seo-page-modal-reaudit';
  await page.waitForSelector(btn, { state: 'visible', timeout: 120000 });
  await page.waitForFunction((s) => /Re-auditing/i.test(document.querySelector(s)?.textContent || ''), btn, { timeout: 120000 });
  await page.waitForFunction((s) => {
    const b = document.querySelector(s);
    return !!(b && !b.disabled && /Re-audit page/i.test(b.textContent || ''));
  }, btn, { timeout: 300000 });
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.setDefaultTimeout(180000);
const log = { version: '', done: [], failed: [] };
try {
  log.version = await waitForBuild(page);
  console.log(`build ${log.version}`);
  for (let i = 0; i < urls.length; i += 1) {
    if (i) await page.waitForTimeout(GAP_MS);
    try {
      await reaudit(page, urls[i]);
      log.done.push(urls[i]);
      console.log(`re-audited ${i + 1}/${urls.length} ${urls[i]}`);
    } catch (e) {
      log.failed.push({ url: urls[i], error: String(e?.message || e).slice(0, 160) });
      console.log(`FAILED ${urls[i]}: ${e?.message || e}`);
    }
  }
  await page.goto(`${BASE}/audit-dashboard.html?cb=${Date.now()}#traditional-seo`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.locator('.aigeo-nav-item[data-panel="traditional-seo"]').click().catch(() => {});
  await page.waitForSelector('#traditional-seo-rule-summary-toggle', { timeout: 180000 });
  await page.waitForTimeout(8000);
  await page.locator('#traditional-seo-rule-summary-toggle').click();
  await page.waitForTimeout(1500);
  const panel = page.locator('#traditional-seo-rule-summary-wrap');
  await panel.scrollIntoViewIfNeeded();
  await panel.screenshot({ path: resolve(OUT, 'SCREEN-2026-10-31-trad-seo-pass-warn-fail-after-reaudit.png') });
  log.summaryText = (await panel.innerText().catch(() => '')).slice(0, 4000);
} finally {
  fs.writeFileSync(resolve(OUT, 'VERIFY-2026-10-31-reaudit-30-urls.json'), JSON.stringify(log, null, 2));
  await browser.close();
}
console.log(JSON.stringify({ done: log.done.length, failed: log.failed }, null, 2));
