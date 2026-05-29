/**
 * Export live dashboard snapshot → Google Drive sync folder for Claude (no Drive API).
 *
 * User phrases: "export to google", "export for claude" → run:
 *   npm run export:claude
 *
 * Direct:
 *   node scripts/snapshot-dashboard-to-drive.mjs
 *   node scripts/snapshot-dashboard-to-drive.mjs --tab=all
 *   node scripts/snapshot-dashboard-to-drive.mjs --filename=custom.html
 *
 * Output folder (Drive Desktop syncs to cloud):
 *   C:/Users/alan/Google Drive/Claude shared resources
 *
 * Writes timestamped file + LIVE-DASHBOARD-SNAPSHOT-{tab}-LATEST.html
 *
 * First-time setup: npm install && npx playwright install chromium
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = 'https://ai-geo-audit.vercel.app/audit-dashboard.html';
const OUT_DIR = 'C:/Users/alan/Google Drive/Claude shared resources';
const IDLE_MS = 2000;
const RT_SCOPE = 'section[data-panel="revenue-truth"]';

function parseArgs(argv) {
  let tab = 'revenue-truth';
  let filename = null;
  for (const arg of argv) {
    if (arg.startsWith('--tab=')) tab = arg.slice(6).trim() || tab;
    if (arg.startsWith('--filename=')) filename = arg.slice(11).trim() || null;
  }
  return { tab, filename };
}

function isoStamp() {
  return new Date().toISOString().slice(0, 19).replace(/:/g, '-');
}

function outPath(tab, filenameOverride) {
  const name = filenameOverride || `LIVE-DASHBOARD-SNAPSHOT-${tab}-${isoStamp()}.html`;
  return path.resolve(OUT_DIR, name);
}

function latestPath(tab) {
  return path.resolve(OUT_DIR, `LIVE-DASHBOARD-SNAPSHOT-${tab}-LATEST.html`);
}

function writeSnapshot(tab, html, filenameOverride) {
  const fp = outPath(tab, filenameOverride);
  fs.writeFileSync(fp, html, 'utf8');
  fs.writeFileSync(latestPath(tab), html, 'utf8');
  return fp;
}

async function gotoTab(page, tab) {
  const url = `${BASE}#${tab}`;
  await page.goto(url, { waitUntil: 'load', timeout: 180000 });
  await page.waitForTimeout(IDLE_MS);
}

async function inlineStylesheets(page) {
  const hrefs = await page.$$eval('link[rel="stylesheet"]', (links) =>
    links.map((l) => l.href).filter(Boolean)
  );
  for (const href of hrefs) {
    try {
      const res = await page.request.get(href);
      if (!res.ok()) continue;
      const css = await res.text();
      await page.evaluate(({ href: h, css: text }) => {
        const link = [...document.querySelectorAll('link[rel="stylesheet"]')].find((l) => l.href === h);
        if (!link) return;
        const style = document.createElement('style');
        style.setAttribute('data-inlined-from', h);
        style.textContent = text;
        link.replaceWith(style);
      }, { href, css });
    } catch (_) { /* skip unreachable stylesheet */ }
  }
}

async function waitForRevenueTruth(page) {
  await page.waitForSelector(RT_SCOPE, { timeout: 180000 });
  await page.waitForFunction(() => {
    const exec = document.getElementById('rt-exec-body');
    const diag = document.getElementById('rt-diag-tier-list');
    if (!exec || !diag) return false;
    if (/Loading diagnosis/i.test(diag.textContent || '')) return false;
    return (exec.textContent || '').trim().length > 30;
  }, { timeout: 180000 });
}

async function expandAllTierHeads(page, scopeSel) {
  await page.evaluate(async (sel) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let pass = 0; pass < 3; pass += 1) {
      const collapsed = [...document.querySelectorAll(`${sel} .rt-diag-tier-row.is-collapsed .rt-diag-tier-head[data-tier-head]`)];
      if (!collapsed.length) break;
      for (const head of collapsed) {
        head.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await sleep(900);
      }
    }
  }, scopeSel);
  await page.waitForFunction((sel) => {
    const rows = document.querySelectorAll(`${sel} .rt-diag-tier-row`);
    if (!rows.length) return true;
    const collapsed = document.querySelectorAll(`${sel} .rt-diag-tier-row.is-collapsed`);
    return collapsed.length === 0;
  }, scopeSel, { timeout: 120000 }).catch(() => {});
}

async function expandScope(page, scopeSel) {
  await page.evaluate((sel) => {
    document.querySelectorAll(`${sel} details`).forEach((d) => d.setAttribute('open', ''));
    const exec = document.getElementById('rt-exec-summary');
    if (exec) exec.style.display = '';
  }, scopeSel);

  await expandAllTierHeads(page, scopeSel);

  const truncated = page.locator(`${scopeSel} .rt-finding-text.is-truncated`);
  for (let i = 0, n = await truncated.count(); i < n; i++) {
    await truncated.nth(i).click({ timeout: 2000 }).catch(() => {});
  }

  for (const re of [/show more/i, /expand/i, /drill down/i]) {
    const btns = page.getByRole('button', { name: re });
    for (let i = 0, n = await btns.count(); i < n; i++) {
      await btns.nth(i).click({ timeout: 1500 }).catch(() => {});
    }
  }

  const drillBtns = page.locator(`${scopeSel} .rt-diag-drill-btn:not([disabled])`);
  for (let i = 0, n = await drillBtns.count(); i < n; i++) {
    await drillBtns.nth(i).click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(800);
  }

  await page.evaluate((sel) => {
    document.querySelectorAll(`${sel} .rt-pulse-action-item`).forEach((d) => d.setAttribute('open', ''));
    document.querySelectorAll(`${sel} details.rt-forecast-method`).forEach((d) => d.setAttribute('open', ''));
  }, scopeSel);
  await page.waitForTimeout(IDLE_MS);
}

async function expandAllPanels(page) {
  await page.evaluate(() => {
    document.querySelectorAll('details').forEach((d) => d.setAttribute('open', ''));
  });
  await expandScope(page, RT_SCOPE);
}

async function buildStandaloneHtml(page) {
  await inlineStylesheets(page);
  return page.evaluate(() => {
    document.querySelectorAll('canvas').forEach((canvas) => {
      try {
        const img = document.createElement('img');
        img.src = canvas.toDataURL('image/png');
        img.width = canvas.width;
        img.height = canvas.height;
        img.className = canvas.className;
        img.style.cssText = canvas.style.cssText;
        canvas.replaceWith(img);
      } catch (_) { /* tainted canvas */ }
    });

    document.querySelectorAll('script').forEach((s) => s.remove());
    document.querySelectorAll('link[rel="preload"], link[rel="modulepreload"]').forEach((l) => l.remove());

    const banner = document.createElement('div');
    banner.id = 'snapshot-banner';
    banner.style.cssText = 'background:#451a03;color:#fde68a;padding:0.5rem 1rem;font:600 0.8rem system-ui;border-bottom:1px solid #92400e';
    banner.textContent = `Static snapshot captured ${new Date().toISOString()} — scripts removed; open offline from Google Drive.`;
    document.body.prepend(banner);

    return '<!DOCTYPE html>\n' + document.documentElement.outerHTML;
  });
}

async function listNavTabs(page) {
  return page.evaluate(() => [...document.querySelectorAll('.aigeo-nav-item[data-panel]')]
    .map((el) => el.getAttribute('data-panel'))
    .filter(Boolean));
}

async function captureTab(page, tab) {
  await gotoTab(page, tab);
  if (tab === 'revenue-truth') await waitForRevenueTruth(page);
  else await page.waitForTimeout(3000);
  if (tab === 'revenue-truth') await expandScope(page, RT_SCOPE);
  else await page.evaluate(() => document.querySelectorAll('details').forEach((d) => d.setAttribute('open', '')));
  await page.waitForTimeout(IDLE_MS);
  return buildStandaloneHtml(page);
}

async function main() {
  const { tab, filename } = parseArgs(process.argv.slice(2));
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  const page = await context.newPage();

  const written = [];
  try {
    if (tab === 'all') {
      await gotoTab(page, 'revenue-truth');
      const tabs = await listNavTabs(page);
      for (const t of tabs) {
        const html = await captureTab(page, t);
        const fp = writeSnapshot(t, html, null);
        written.push(fp);
        console.log('Wrote', fp);
        console.log('Latest alias:', latestPath(t));
      }
    } else {
      const html = await captureTab(page, tab);
      const fp = writeSnapshot(tab, html, filename);
      written.push(fp);
      console.log('Wrote', fp);
      console.log('Latest alias:', latestPath(tab));
    }
  } finally {
    await browser.close();
  }

  for (const fp of written) console.log('Absolute path:', path.resolve(fp));
}

main().catch((err) => {
  console.error('[snapshot-dashboard-to-drive]', err);
  process.exit(1);
});
