#!/usr/bin/env node
/**
 * Read-only browser check (Claude QUESTION 2026-11-05 trad-seo-and-header-still-show-480): the live dashboard with a
 * stale 480-URL browser state (saved manual list + the saved 480-URL rules run) must show the newest audit in the
 * header and leave URLs that are no longer in 06 out of every Traditional SEO count.
 *   node scripts/check-dashboard-stale-cache.mjs [--base https://ai-geo-audit.vercel.app] [--shot out.png]
 * Nothing is clicked except the Traditional SEO tab; no audit or rules run starts.
 */
import { chromium } from 'playwright';

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const BASE = arg('base', 'https://ai-geo-audit.vercel.app');
const PROP = 'https://www.alanranger.com';
const fail = [];
const check = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); if (!ok) fail.push(msg); };

const json = async (path) => (await fetch(`${BASE}${path}`, { cache: 'no-store' })).json();
const status = await json(`/api/aigeo/revenue-sync-status?propertyUrl=${encodeURIComponent(PROP)}&_=${Date.now()}`);
const latest = status.sources?.schema_audit;
const evalCache = await json(`/api/aigeo/traditional-seo-evaluation-cache?propertyUrl=${encodeURIComponent(PROP)}`);
const staleRows = evalCache.evaluationRows || [];
const staleUrls = [...new Set(staleRows.map((r) => r.url))];
const six = (await (await fetch(`https://raw.githubusercontent.com/alanranger/alan-shared-resources/main/csv/06-site-urls.csv?_=${Date.now()}`)).text())
  .split(/\r?\n/).filter((l) => /^https?:\/\//.test(l)).length;
console.log(`database: newest audit ${latest?.last_synced_at} · ${latest?.schema_total_pages} pages; saved rules run ${staleUrls.length} URLs; 06 has ${six}`);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
await page.addInitScript(({ urls, rows, at }) => {
  localStorage.setItem('manual_url_list', JSON.stringify(urls));
  try {
    localStorage.setItem('gaio_traditional_seo_evaluation_v1', JSON.stringify({ v: 1, propertyUrl: 'https://www.alanranger.com', propertyKey: 'alanranger.com', lastEvaluationAt: at, evaluationRows: rows }));
  } catch (e) { /* quota: the server copy is the same stale run */ }
}, { urls: staleUrls, rows: staleRows, at: evalCache.lastEvaluationAt });
await page.goto(`${BASE}/audit-dashboard.html`, { waitUntil: 'domcontentloaded', timeout: 120000 });

const hhmm = new Date(latest.last_synced_at).toISOString().slice(11, 16);
await page.waitForFunction((t) => (document.getElementById('revSyncSchema')?.textContent || '').includes(t), hhmm, { timeout: 90000 }).catch(() => {});
const header = await page.locator('#revSyncSchema').textContent();
check(header.includes(hhmm) && header.includes(`${latest.schema_total_pages} pages`), `header "Schema audit: ${header.trim()}" shows ${hhmm} and ${latest.schema_total_pages} pages`);

await page.locator('.aigeo-nav-item[data-panel="traditional-seo"]').first().click();
await page.waitForFunction(() => /no longer in 06|rules last run/.test(document.getElementById('traditional-seo-last-run')?.textContent || ''), null, { timeout: 180000 }).catch(() => {});
await page.waitForFunction(() => /\d+\/\d+ URLs have/.test(document.getElementById('traditional-seo-internal-links-meta')?.textContent || ''), null, { timeout: 300000 }).catch(() => {});
const lastRun = (await page.locator('#traditional-seo-last-run').textContent()).trim();
const allCount = Number((await page.locator('#traditional-seo-drilldown-tiles [data-status="all"] .traditional-seo-drill-count').textContent()).trim());
const coverage = (await page.locator('#traditional-seo-internal-links-meta').textContent()).trim();
const score = (await page.locator('#traditional-seo-score-value').textContent()).trim();
check(/rules last run .* on \d+ URLs; \d+ no longer in 06 are not counted/.test(lastRun), `"Last audit run: ${lastRun}" says which rules run and what is not counted`);
check(allCount > 0 && allCount <= six + 1 && allCount !== staleUrls.length, `ALL URLS tile ${allCount} (06 has ${six}; the stale run had ${staleUrls.length})`);
const covTotal = Number((coverage.match(/\d+\/(\d+) URLs/) || [])[1]);
check(covTotal > 0 && covTotal <= six + 1, `internal link coverage "${coverage}" counts at most the ${six} URLs in 06`);
console.log(`SEO Health Score now: ${score}`);
const shot = arg('shot');
if (shot) await page.locator('section[data-panel="traditional-seo"]').screenshot({ path: shot }).catch(() => page.screenshot({ path: shot }));
const stored = await page.evaluate(() => localStorage.getItem('manual_url_list') !== null);
check(stored, 'the saved browser list was left in place (read-only on storage)');
await browser.close();
process.exit(fail.length ? 1 : 0);
