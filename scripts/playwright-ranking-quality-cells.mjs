#!/usr/bin/env node
/**
 * Ranking tab: no row may show "legacy quality unavailable" when its keyword_rankings row has a capture_status.
 * Opens the dashboard, clicks the Ranking nav item only (never "Run ranking & AI check" — no DataForSEO calls),
 * then checks every loaded row's quality kind and every rendered "Last checked" cell on each page.
 *
 *   node scripts/playwright-ranking-quality-cells.mjs [--url=https://ai-geo-audit.vercel.app/audit-dashboard.html]
 * Exit 0 = pass, 1 = fail.
 */
import { chromium } from 'playwright';

const arg = (name, dflt) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=') || dflt;
const URL = arg('url', 'https://ai-geo-audit.vercel.app/audit-dashboard.html');
const LEGACY = /legacy quality unavailable/;

/** Every row on one page ("all" rows per page), so no row is missed by paging. */
async function cellTexts(page, expected) {
  await page.selectOption('#ranking-rows-per-page', 'all');
  await page.waitForFunction((n) => document.querySelectorAll('.kw-last-checked-time').length >= n, expected, { timeout: 30000 }).catch(() => {});
  return page.locator('.kw-last-checked-time').allTextContents();
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.addInitScript(() => localStorage.removeItem('rankingAiData'));
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.locator('button.aigeo-nav-item[data-panel="ranking"]').click();
  await page.waitForFunction(() => Array.isArray(window.rankingAiData) && window.rankingAiData.length > 0
    && document.querySelectorAll('.kw-last-checked-time').length > 0, null, { timeout: 90000 });
  const rows = await page.evaluate(() => window.rankingAiData.map((r) => ({
    keyword: r.keyword, status: r.serp_features?.capture_status || null,
  })));
  const texts = await cellTexts(page, rows.length);
  const legacyCells = texts.filter((t) => LEGACY.test(t));
  const noStatus = rows.filter((r) => !r.status);
  console.log(JSON.stringify({ url: URL, rows: rows.length, rows_without_capture_status: noStatus.length,
    cells_checked: texts.length, legacy_cells: legacyCells.length, sample: texts.slice(0, 3) }, null, 2));
  const ok = rows.length > 0 && noStatus.length === 0 && legacyCells.length === 0 && texts.length === rows.length;
  console.log(ok ? 'PASS' : 'FAIL');
  process.exitCode = ok ? 0 : 1;
} finally {
  await browser.close();
}
