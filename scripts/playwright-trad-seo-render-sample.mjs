/**
 * Production Playwright: Traditional SEO render BUILD sample.
 * Does NOT click full ① (480 URLs). Uses localStorage.trad_seo_sample_urls (~10).
 * node scripts/playwright-trad-seo-render-sample.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const OUT = resolve('C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude');
mkdirSync(OUT, { recursive: true });

const BASE = process.env.AIGEO_BASE_URL || 'https://ai-geo-audit.vercel.app';
const SAMPLE = [
  'https://www.alanranger.com/photography-courses',
  'https://www.alanranger.com/free-online-photography-course',
  'https://www.alanranger.com/blog-on-photography/uk-bluebell-photography-guide',
  'https://www.alanranger.com/blog-on-photography/how-to-find-your-photography-style',
  'https://www.alanranger.com/photographic-workshops-near-me',
  'https://www.alanranger.com/photo-workshops-uk',
  'https://www.alanranger.com/photography-courses-coventry',
  'https://www.alanranger.com/about-alan-ranger',
  'https://www.alanranger.com/contact-me',
  'https://www.alanranger.com/'
];
const REAUDIT = SAMPLE.slice(0, 3);
const FORCE_429 = SAMPLE[8];
const MARKER = 'traditional-seo-system-health';

function png(name) {
  return resolve(OUT, name);
}

const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1500, height: 980 } });
const report = { url: '', ok: false, steps: [], siteFetchesOnScore: [] };

async function waitForBuild() {
  const deadline = Date.now() + 8 * 60 * 1000;
  while (Date.now() < deadline) {
    const url = `${BASE}/audit-dashboard.html?cb=${Date.now()}#traditional-seo`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    const has = await page.locator(`#${MARKER}`).count();
    const notChecked = await page.locator('#traditional-seo-filter-status option[value="not_checked"]').count();
    if (has && notChecked) {
      report.url = url;
      return true;
    }
    await page.waitForTimeout(15000);
  }
  return false;
}

try {
  if (!(await waitForBuild())) throw new Error('production dashboard does not yet have the 30 Oct render BUILD marker');
  report.steps.push('build marker present');

  await page.evaluate(({ sample, force }) => {
    localStorage.setItem('trad_seo_sample_urls', JSON.stringify(sample));
    localStorage.setItem('trad_seo_force_not_checked', JSON.stringify([force]));
  }, { sample: SAMPLE, force: FORCE_429 });

  const nav = page.locator('.aigeo-nav-item[data-panel="traditional-seo"]');
  if (await nav.count()) await nav.click();
  await page.waitForSelector('#traditional-seo-run-full-audit-btn', { timeout: 60000 });
  report.steps.push('traditional SEO tab open');

  const silentVisible = await page.locator('.aigeo-nav-item[data-panel="silent-faults"]').evaluate((el) => {
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden';
  }).catch(() => false);
  report.silentFaultsNavHidden = !silentVisible;

  for (const url of REAUDIT) {
    const deep = `${BASE}/audit-dashboard.html?seoPage=${encodeURIComponent(url)}&reaudit=1&cb=${Date.now()}#traditional-seo`;
    await page.goto(deep, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.evaluate(({ sample, force }) => {
      localStorage.setItem('trad_seo_sample_urls', JSON.stringify(sample));
      localStorage.setItem('trad_seo_force_not_checked', JSON.stringify([force]));
    }, { sample: SAMPLE, force: FORCE_429 });
    await page.waitForSelector('#traditional-seo-page-modal-reaudit', { state: 'visible', timeout: 90000 });
    await page.waitForFunction(() => {
      const b = document.getElementById('traditional-seo-page-modal-reaudit');
      return b && !b.disabled && /Re-audit page/i.test(b.textContent || '');
    }, { timeout: 180000 });
    report.steps.push(`reaudit ${url}`);
  }
  const tabUrl = `${BASE}/audit-dashboard.html?cb=${Date.now()}#traditional-seo`;
  await page.goto(tabUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.evaluate(({ sample, force }) => {
    localStorage.setItem('trad_seo_sample_urls', JSON.stringify(sample));
    localStorage.setItem('trad_seo_force_not_checked', JSON.stringify([force]));
  }, { sample: SAMPLE, force: FORCE_429 });
  await page.locator('.aigeo-nav-item[data-panel="traditional-seo"]').click().catch(() => {});
  await page.waitForSelector('#traditional-seo-run-full-audit-btn', { timeout: 60000 });
  await page.screenshot({ path: png('SCREEN-2026-10-30-trad-seo-reaudit-modal.png'), fullPage: false });

  const cols = await page.locator('#traditional-seo-results-table thead th').allTextContents();
  report.columns = cols.map((t) => t.replace(/\s+/g, ' ').trim());
  report.hasCheckedOn = report.columns.some((c) => /Checked on/i.test(c));
  report.hasScore = report.columns.some((c) => /^Score/i.test(c));
  report.hasBypassOrKw = report.columns.some((c) => /Target kw|Kw vol|Clicks/i.test(c));

  await page.locator('#traditional-seo-run-full-audit-btn').click();
  report.steps.push('clicked ① sample');
  await page.waitForFunction(() => {
    const b = document.getElementById('traditional-seo-render-banner');
    return b && /pages/i.test(b.textContent || '');
  }, { timeout: 120000 }).catch(() => null);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#traditional-seo-run-full-audit-btn', { timeout: 60000 });
  report.steps.push('reloaded during/after ①');

  const sampleJson = JSON.stringify(SAMPLE);
  const forceJson = JSON.stringify([FORCE_429]);
  await page.evaluate(({ sampleJson: s, forceJson: f }) => {
    localStorage.setItem('trad_seo_sample_urls', s);
    localStorage.setItem('trad_seo_force_not_checked', f);
  }, { sampleJson, forceJson });
  await page.locator('.aigeo-nav-item[data-panel="traditional-seo"]').click().catch(() => {});

  await page.evaluate(async () => {
    if (typeof window.tradSeoRenderLoop !== 'function') return;
    const id = localStorage.getItem('trad_seo_render_run_id');
    await window.tradSeoRenderLoop(() => {}, id);
  }).catch(() => null);

  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    const banner = await page.locator('#traditional-seo-render-banner').innerText().catch(() => '');
    const btn = await page.locator('#traditional-seo-run-full-audit-btn').isDisabled().catch(() => false);
    if (/\/ ?10|10\/10|checked/i.test(banner) && !btn) break;
    const done = await page.evaluate(async () => {
      if (typeof window.tradSeoRenderLoad !== 'function') return false;
      const snap = await window.tradSeoRenderLoad({ health: true }).catch(() => null);
      return snap?.run?.status && snap.run.status !== 'running';
    });
    if (done) break;
    await page.waitForTimeout(8000);
  }
  report.steps.push('① sample finished or timed out');
  await page.screenshot({ path: png('SCREEN-2026-10-30-trad-seo-render-progress.png'), fullPage: false });

  const siteHits = [];
  page.on('request', (req) => {
    const u = req.url();
    if (/alanranger\.com/i.test(u) && !/ai-geo-audit/i.test(u)) siteHits.push(u);
  });
  await page.locator('#traditional-seo-run-audit-btn').click();
  await page.waitForTimeout(8000);
  report.siteFetchesOnScore = siteHits.slice(0, 20);
  report.zeroAlanrangerFetchesOnScore = siteHits.length === 0;
  report.steps.push(`② clicked, alanranger.com fetches=${siteHits.length}`);

  await page.locator('#traditional-seo-filter-status').selectOption('not_checked');
  await page.waitForTimeout(800);
  const bodyText = await page.locator('#traditional-seo-results-body').innerText().catch(() => '');
  report.notCheckedFilterHasRows = /not checked|contact-me/i.test(bodyText);
  report.steps.push('Not checked filter');
  await page.screenshot({ path: png('SCREEN-2026-10-30-trad-seo-not-checked.png'), fullPage: false });

  const healthText = await page.locator('#traditional-seo-system-health').innerText().catch(() => '');
  const healthDisplay = await page.locator('#traditional-seo-system-health').evaluate((el) => getComputedStyle(el).display).catch(() => 'none');
  report.healthProblemsOnly = healthDisplay === 'none' || /System health/i.test(healthText);
  await page.screenshot({ path: png('SCREEN-2026-10-30-trad-seo-results.png'), fullPage: false });

  report.ok = report.hasCheckedOn && report.silentFaultsNavHidden && report.zeroAlanrangerFetchesOnScore !== false;
} catch (err) {
  report.error = String(err?.message || err);
  await page.screenshot({ path: png('SCREEN-2026-10-30-trad-seo-error.png'), fullPage: true }).catch(() => {});
} finally {
  writeFileSync(resolve(OUT, 'VERIFY-2026-10-30-trad-seo-render.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}
