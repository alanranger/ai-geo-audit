/**
 * Production Playwright: no_duplicate_schema shared @id BUILD.
 * Does NOT click ①. Re-audits four URLs.
 * node scripts/playwright-trad-seo-duplicate-id.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const OUT = resolve('C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude');
mkdirSync(OUT, { recursive: true });

const BASE = process.env.AIGEO_BASE_URL || 'https://ai-geo-audit.vercel.app';
const MARKER = 'traditionalSeoUrlHasCurrentRunRender';
const PAGES = [
  { url: 'https://www.alanranger.com/', expect: 'pass', label: 'home' },
  { url: 'https://www.alanranger.com/about-alan-ranger', expect: 'pass', label: 'about' },
  { url: 'https://www.alanranger.com/photography-courses-coventry', expect: 'pass', label: 'courses-coventry' },
  { url: 'https://www.alanranger.com/blog-on-photography/uk-bluebell-photography-guide', expect: 'fail', label: 'bluebell' }
];

function png(name) {
  return resolve(OUT, name);
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
page.setDefaultTimeout(180000);
const report = { ok: false, steps: [], results: [] };

async function waitForBuild() {
  const deadline = Date.now() + 8 * 60 * 1000;
  while (Date.now() < deadline) {
    const url = `${BASE}/audit-dashboard.html?cb=${Date.now()}#traditional-seo`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const has = await page.evaluate((marker) => {
      const scripts = Array.from(document.scripts).map((s) => s.textContent || '').join('\n');
      return scripts.includes(marker)
        && scripts.includes('The same @id with the same type in several blocks is correct');
    }, MARKER);
    if (has) {
      report.url = url;
      return true;
    }
    await page.waitForTimeout(15000);
  }
  return false;
}

function findingFor(pageUrl) {
  return page.evaluate((target) => {
    const pack = window.TRADITIONAL_SEO_STATE?.renderFindings;
    const row = document.querySelector('#traditional-seo-page-modal-body tr[data-rule-key="no_duplicate_schema"]');
    const rowText = row ? String(row.textContent || '').replace(/\s+/g, ' ').trim() : '';
    const want = String(target || '').replace(/\/+$/, '').toLowerCase();
    let stored = '';
    if (pack instanceof Map) {
      for (const [k, v] of pack.entries()) {
        const key = String(k || '').replace(/\/+$/, '').toLowerCase();
        if (key === want && v?.no_duplicate_schema) {
          stored = `${v.no_duplicate_schema.status || ''} ${v.no_duplicate_schema.note || ''}`.trim();
          break;
        }
      }
    }
    const pill = row?.querySelector('[data-status]')?.getAttribute('data-status') || '';
    return { rowText, stored, pill };
  }, pageUrl);
}

async function reaudit(target) {
  const deep = `${BASE}/audit-dashboard.html?seoPage=${encodeURIComponent(target)}&reaudit=1&cb=${Date.now()}#traditional-seo`;
  await page.goto(deep, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#traditional-seo-page-modal-reaudit', { state: 'visible', timeout: 90000 });
  await page.waitForFunction(() => /Re-auditing/i.test(document.getElementById('traditional-seo-page-modal-reaudit')?.textContent || ''), null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const b = document.getElementById('traditional-seo-page-modal-reaudit');
    return !!(b && !b.disabled && /Re-audit page/i.test(b.textContent || ''));
  }, null, { timeout: 180000 });
  return findingFor(target);
}

try {
  if (!(await waitForBuild())) throw new Error('production dashboard does not yet have the duplicate-id BUILD');
  report.steps.push('build present');
  for (const item of PAGES) {
    const hit = await reaudit(item.url);
    const ok = item.expect === hit.pill;
    report.results.push({
      url: item.url,
      expect: item.expect,
      pill: hit.pill,
      stored: hit.stored,
      rowText: hit.rowText,
      ok
    });
    report.steps.push(`reaudit ${item.label}`);
    if (item.label === 'home') {
      await page.evaluate(() => {
        document.querySelectorAll('[id*="debug"], .debug-log').forEach((el) => { el.style.display = 'none'; });
      });
      await page.screenshot({ path: png('SCREEN-2026-10-30-trad-seo-duplicate-id-home-pass.png'), fullPage: false });
    }
  }
  report.ok = report.results.every((r) => r.ok);
} catch (err) {
  report.error = String(err && err.message ? err.message : err);
} finally {
  writeFileSync(resolve(OUT, 'REPORT-2026-10-30-trad-seo-duplicate-id.json'), JSON.stringify(report, null, 2));
  await browser.close();
}

if (!report.ok) process.exit(1);
