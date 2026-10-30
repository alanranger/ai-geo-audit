/**
 * Production Playwright: not-checked + hidden-status policy BUILD.
 * Does NOT click ①. Uses existing 10-sample snapshots + ② rescore.
 * node scripts/playwright-trad-seo-not-checked-policy.mjs
 * AFTER_RETIRE=1 node scripts/playwright-trad-seo-not-checked-policy.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const OUT = resolve('C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude');
mkdirSync(OUT, { recursive: true });

const BASE = process.env.AIGEO_BASE_URL || 'https://ai-geo-audit.vercel.app';
const AFTER = process.env.AFTER_RETIRE === '1';
const WORKSHOPS = 'https://www.alanranger.com/photo-workshops-uk';
const MARKER = 'traditional-seo-system-health';

function png(name) {
  return resolve(OUT, name);
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
page.setDefaultTimeout(180000);
const report = { url: '', afterRetire: AFTER, ok: false, steps: [] };

async function waitForBuild() {
  const deadline = Date.now() + 8 * 60 * 1000;
  while (Date.now() < deadline) {
    const url = `${BASE}/audit-dashboard.html?cb=${Date.now()}#traditional-seo`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const has = await page.locator(`#${MARKER}`).count();
    const chip = await page.evaluate(() => {
      const src = document.documentElement.innerHTML;
      return src.includes('traditionalSeoUrlHasCurrentRunRender')
        && src.includes('Policy says hidden but the page is visible');
    });
    if (has && chip) {
      report.url = url;
      return true;
    }
    await page.waitForTimeout(15000);
  }
  return false;
}

async function reauditWorkshops() {
  const deep = `${BASE}/audit-dashboard.html?seoPage=${encodeURIComponent(WORKSHOPS)}&reaudit=1&cb=${Date.now()}#traditional-seo`;
  await page.goto(deep, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#traditional-seo-page-modal-reaudit', { state: 'visible', timeout: 90000 });
  await page.waitForFunction(() => /Re-auditing/i.test(document.getElementById('traditional-seo-page-modal-reaudit')?.textContent || ''), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const b = document.getElementById('traditional-seo-page-modal-reaudit');
    return !!(b && !b.disabled && /Re-audit page/i.test(b.textContent || ''));
  }, null, { timeout: 180000 });
  const hidden = await page.evaluate(() => {
    const tr = document.querySelector('#traditional-seo-page-modal-body tr[data-rule-key="hidden_tag_matches_lists"]');
    return tr ? String(tr.textContent || '').replace(/\s+/g, ' ').trim() : '';
  });
  const note = await page.evaluate(() => {
    const pack = window.TRADITIONAL_SEO_STATE?.renderFindings;
    if (!(pack instanceof Map)) return '';
    for (const [k, v] of pack.entries()) {
      if (String(k).includes('photo-workshops-uk') && v?.hidden_tag_matches_lists) {
        return `${v.hidden_tag_matches_lists.status || ''} ${v.hidden_tag_matches_lists.note || ''}`.trim();
      }
    }
    return '';
  });
  return { hidden, note };
}

try {
  if (!(await waitForBuild())) throw new Error('production dashboard does not yet have the not-checked BUILD');
  report.steps.push('build marker present');

  if (!AFTER) {
    await page.locator('.aigeo-nav-item[data-panel="traditional-seo"]').click().catch(() => {});
    await page.waitForSelector('#traditional-seo-run-audit-btn', { timeout: 60000 });
    await page.locator('#traditional-seo-run-audit-btn').click();
    report.steps.push('clicked ②');
    await page.waitForFunction(() => {
      const el = document.getElementById('traditional-seo-url-health');
      return !!(el && /Page URLs:/i.test(el.textContent || '') && /Not checked/i.test(el.textContent || ''));
    }, null, { timeout: 180000 });
    report.steps.push('② finished');
    report.urlHealth = await page.locator('#traditional-seo-url-health').innerText();
    report.pwf = await page.locator('#traditional-seo-pwf').innerText();
    const cols = await page.locator('#traditional-seo-results-table thead th').allTextContents();
    report.columns = cols.map((t) => t.replace(/\s+/g, ' ').trim());
    report.hasCheckedOn = report.columns.some((c) => /Checked on/i.test(c));
    await page.locator('#traditional-seo-pwf').screenshot({ path: png('SCREEN-2026-10-30-trad-seo-pwf-after-not-checked.png') });
    await page.locator('#traditional-seo-url-health').screenshot({ path: png('SCREEN-2026-10-30-trad-seo-url-health-not-checked.png') });
    await page.selectOption('#traditional-seo-filter-status', 'not_checked').catch(() => {});
    await page.waitForTimeout(800);
    await page.screenshot({ path: png('SCREEN-2026-10-30-trad-seo-by-url-not-checked.png'), fullPage: false });
    const warnCount = Number((report.urlHealth.match(/warn[^0-9]*(\d+)/i) || [])[1] || 0);
    const notChecked = Number((report.urlHealth.match(/Not checked[^0-9]*(\d+)/i) || [])[1] || 0);
    report.warnCount = warnCount;
    report.notCheckedCount = notChecked;
    report.noMassWarns = warnCount < 80 && notChecked > 300;
  }

  const re = await reauditWorkshops();
  report.workshopsHiddenRow = re.hidden;
  report.workshopsFinding = re.note;
  report.steps.push(`reaudit ${WORKSHOPS}`);
  const shot = AFTER
    ? 'SCREEN-2026-10-30-trad-seo-workshops-uk-after-retire.png'
    : 'SCREEN-2026-10-30-trad-seo-workshops-uk-before-retire.png';
  await page.screenshot({ path: png(shot), fullPage: false });
  if (AFTER) {
    report.passIndexable = /Indexable/i.test(`${re.note} ${re.hidden}`) && !/Policy says hidden/i.test(`${re.note} ${re.hidden}`);
  } else {
    report.mismatchNote = /Policy says hidden, page is visible/i.test(`${re.note} ${re.hidden}`);
  }
  report.ok = AFTER ? !!report.passIndexable : !!(report.noMassWarns && report.mismatchNote);
} catch (err) {
  report.error = String(err && err.message ? err.message : err);
} finally {
  const name = AFTER
    ? 'REPORT-2026-10-30-trad-seo-not-checked-after-retire.json'
    : 'REPORT-2026-10-30-trad-seo-not-checked-before-retire.json';
  writeFileSync(resolve(OUT, name), JSON.stringify(report, null, 2));
  await browser.close();
}

if (!report.ok) process.exit(1);
