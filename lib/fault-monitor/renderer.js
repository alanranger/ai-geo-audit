/**
 * Headless Chrome as Googlebot smartphone. Vercel: @sparticuz/chromium + puppeteer-core
 * (same as lib/ceo-weekly/html-to-pdf.js). Local: Playwright Chromium.
 */
import { ACADEMY_PATH, BLOCK_CLASS_RE, BLOCK_SELECTORS, GOOGLEBOT_SMARTPHONE_UA, INJECTED_UI_SELECTORS, THRESHOLDS } from './monitor-config.js';
import { measureRenderedPage } from './measure-page.js';

const VIEWPORT = { width: 412, height: 915 };

function onVercel() {
  return !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_VERSION);
}

async function launchSparticuz() {
  const chromium = (await import('@sparticuz/chromium')).default;
  const puppeteer = await import('puppeteer-core');
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: VIEWPORT,
    executablePath: await chromium.executablePath(),
    headless: true
  });
  return {
    async newPage() {
      const page = await browser.newPage();
      await page.setUserAgent(GOOGLEBOT_SMARTPHONE_UA);
      return page;
    },
    // puppeteer: waitForFunction(fn, options, ...args)
    waitFor: (page, fn, arg, timeout) => page.waitForFunction(fn, { timeout }, arg),
    close: () => browser.close()
  };
}

async function launchPlaywright() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, channel: 'chrome' })
    .catch(() => chromium.launch({ headless: true }));
  const context = await browser.newContext({ userAgent: GOOGLEBOT_SMARTPHONE_UA, viewport: VIEWPORT, isMobile: true });
  return {
    newPage: () => context.newPage(),
    // playwright: waitForFunction(fn, arg, options)
    waitFor: (page, fn, arg, timeout) => page.waitForFunction(fn, arg, { timeout }),
    close: () => browser.close()
  };
}

export async function launchRenderer() {
  if (onVercel()) return launchSparticuz();
  try {
    return await launchPlaywright();
  } catch (e) {
    console.warn('[fault-monitor] Playwright unavailable, trying Sparticuz:', e?.message || e);
    return launchSparticuz();
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function headerOf(resp, name) {
  try {
    const h = resp.headers();
    return h?.[name] || '';
  } catch {
    return '';
  }
}

/** Wait until the hosted loaders have finished injecting schema (FAQ drop flag, or JSON-LD stable). */
async function waitForSchemaSettle(page) {
  const deadline = Date.now() + THRESHOLDS.schemaSettleCapMs;
  let last = '';
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    const snap = await page.evaluate(() => {
      const ld = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
      return { drop: !!window.__AR_FAQ_DROP, sig: `${ld.length}:${ld.reduce((a, s) => a + (s.textContent || '').length, 0)}` };
    }).catch(() => ({ drop: false, sig: '' }));
    if (snap.drop) return;
    if (snap.sig !== last) { last = snap.sig; stableSince = Date.now(); }
    if (Date.now() - stableSince >= THRESHOLDS.schemaStableMs) return;
    await sleep(300);
  }
}

/**
 * A page that shows a FAQ section but has no FAQPage yet: the loader's _faq.json fetch can land after the JSON-LD
 * has been still for schemaStableMs. Wait for the loader's own FAQ flag (set even when it drops every question) or a
 * FAQPage, so A4 judges the finished page. Returns true when the page should be measured again.
 */
export async function waitForLateFaq(renderer, page, measure) {
  const vis = measure?.faqVisibility;
  if (!vis || vis.total > 0 || !(measure.faqSectionCount >= 3)) return false;
  try {
    await renderer.waitFor(page, () => !!window.__AR_FAQ_DROP
      || Array.from(document.querySelectorAll('script[type="application/ld+json"]')).some((s) => /FAQPage/.test(s.textContent || '')),
    undefined, THRESHOLDS.faqLateWaitMs);
    return true;
  } catch {
    return false;
  }
}

/** Blocks this page rendered before (baseline) are injected late: wait for them by selector. */
export async function waitForExpectedBlocks(renderer, page, expectBlocks) {
  const classes = (Array.isArray(expectBlocks) ? expectBlocks : []).filter((b) => /^ar-[a-z0-9-]+$/.test(b));
  if (!classes.length) return;
  try {
    await renderer.waitFor(page, (list) => Array.isArray(list) && list.every((c) => document.querySelector(`.${c}`)),
      classes, THRESHOLDS.blockWaitMs);
  } catch { /* still missing after the wait: C1 reports it */ }
}

export function missingBaselineBlocks(measure, expectBlocks) {
  const now = new Set(measure?.blockClasses || []);
  return (Array.isArray(expectBlocks) ? expectBlocks : []).filter((b) => /^ar-[a-z0-9-]+$/.test(b) && !now.has(b));
}

/**
 * Script-injected content can land after the first measure on a slow render (lazy sections, Vercel Chrome):
 * wait for what is still missing, bounded, so the checks judge the finished page. Each returns true to re-measure.
 */
export async function waitForLateBlocks(renderer, page, measure, ctx) {
  const missing = missingBaselineBlocks(measure, ctx.expectBlocks);
  if (!missing.length && !(measure?.unfilledLoaders || []).length) return false;
  try {
    await renderer.waitFor(page, (list) => list.every((c) => document.querySelector(`.${c}`))
      && Array.from(document.querySelectorAll('[data-wm-plugin="load"]'))
        .every((el) => (el.textContent || '').trim() || el.querySelector('img')),
    missing, THRESHOLDS.blockLateWaitMs);
  } catch { /* still missing after the wait: C1 reports it */ }
  return true;
}

const hasLd = (re) => (measure) => (measure?.ldTexts || []).some((t) => re.test(String(t || '')));
const hasBlogPosting = hasLd(/BlogPosting/i);
const hasCourse = hasLd(/"Course"/);

export async function waitForLateBlogPosting(renderer, page, measure, ctx) {
  if (!/\/blog-on-photography\//i.test(String(ctx.url || '')) || hasBlogPosting(measure)) return false;
  try {
    await renderer.waitFor(page, () => Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
      .some((s) => /BlogPosting/i.test(s.textContent || '')), undefined, THRESHOLDS.lateContentWaitMs);
  } catch { /* still missing: A1 reports it */ }
  return true;
}

export async function waitForLateAcademy(renderer, page, measure, ctx) {
  let path = '';
  try { path = new URL(String(ctx.url || '')).pathname.replace(/\/+$/, ''); } catch { return false; }
  if (path !== ACADEMY_PATH || (hasCourse(measure) && measure?.reviewStripText)) return false;
  try {
    await renderer.waitFor(page, () => !!document.querySelector('.ar-rev-wrap')
      && Array.from(document.querySelectorAll('script[type="application/ld+json"]')).some((s) => /"Course"/.test(s.textContent || '')),
    undefined, THRESHOLDS.lateContentWaitMs);
  } catch { /* still missing: A5 reports it */ }
  return true;
}

const LATE_WAITS = [
  waitForLateBlogPosting,
  (renderer, page, measure) => waitForLateFaq(renderer, page, measure),
  waitForLateBlocks,
  waitForLateAcademy
];

/**
 * Render one URL and return the raw measurement plus uncaught page errors.
 * Status / X-Robots-Tag come from the navigation response, so each page costs one site request.
 * @param {{ expectBlocks?: string[] }} [opts] block classes this page rendered last time (baseline)
 * @returns {Promise<{ ok: boolean, status: number|null, xRobots: string, error?: string, measure?: object, pageErrors: string[] }>}
 */
async function navigate(page, url) {
  const resp = await page.goto(url, { waitUntil: 'load', timeout: THRESHOLDS.navTimeoutMs });
  const status = resp ? resp.status() : null;
  let rawHtml = '';
  try { if (resp && status === 200) rawHtml = await resp.text(); } catch { rawHtml = ''; }
  return { status, xRobots: resp ? headerOf(resp, 'x-robots-tag') : '', rawHtml };
}

/** Lazy Squarespace blocks filled and (when a hosted loader is on the page) its first schema injected, then a floor wait. */
async function waitForLoaders(renderer, page) {
  const waitStart = Date.now();
  try {
    await renderer.waitFor(page, () => {
      const els = document.querySelectorAll('[data-wm-plugin="load"]');
      const wmOk = !els.length || Array.from(els).every((el) => (el.textContent || '').trim() || el.querySelector('img'));
      const loader = document.querySelector('script[src*="schema.alanranger.com/loaders"]');
      if (!loader) return wmOk;
      const injected = document.querySelectorAll('script[id^="arp-schema-"], script[id^="arp-blog"]');
      return wmOk && injected.length > 0;
    }, undefined, THRESHOLDS.renderCapMs);
  } catch { /* cap */ }
  const used = Date.now() - waitStart;
  if (used < THRESHOLDS.renderWaitMs) await sleep(THRESHOLDS.renderWaitMs - used);
}

const MEASURE_CFG = { injected: INJECTED_UI_SELECTORS, blocks: BLOCK_SELECTORS, blockClassRe: BLOCK_CLASS_RE };

/** Measure once the page has settled; wait and measure again for any script-injected content still missing. */
async function measureSettled(renderer, page, url, opts) {
  await waitForSchemaSettle(page);
  await waitForExpectedBlocks(renderer, page, opts.expectBlocks);
  const ctx = { url, expectBlocks: opts.expectBlocks };
  let measure = await page.evaluate(measureRenderedPage, MEASURE_CFG);
  for (const late of LATE_WAITS) {
    if (await late(renderer, page, measure, ctx)) measure = await page.evaluate(measureRenderedPage, MEASURE_CFG);
  }
  return measure;
}

export async function renderAndMeasure(renderer, url, opts = {}) {
  const page = await renderer.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => {
    pageErrors.push(`${err?.message || err}${err?.stack ? ` | ${String(err.stack).slice(0, 400)}` : ''}`);
  });
  try {
    const { status, xRobots, rawHtml } = await navigate(page, url);
    if (status === 429 || (status != null && status >= 400)) return { ok: true, status, xRobots, measure: null, pageErrors };
    await waitForLoaders(renderer, page);
    const measure = await measureSettled(renderer, page, url, opts);
    if (measure) measure.rawHtml = rawHtml;
    return { ok: true, status, xRobots, measure, pageErrors };
  } catch (e) {
    return { ok: false, status: null, xRobots: '', error: String(e?.message || e).slice(0, 300), pageErrors };
  } finally {
    try { await page.close(); } catch { /* ignore */ }
  }
}
