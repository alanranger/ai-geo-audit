/**
 * Headless Chrome as Googlebot smartphone. Vercel: @sparticuz/chromium + puppeteer-core
 * (same as lib/ceo-weekly/html-to-pdf.js). Local: Playwright Chromium.
 */
import { BLOCK_CLASS_RE, BLOCK_SELECTORS, GOOGLEBOT_SMARTPHONE_UA, INJECTED_UI_SELECTORS, THRESHOLDS } from './monitor-config.js';
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

/** Blocks this page rendered before (baseline) are injected late: wait for them by selector. */
export async function waitForExpectedBlocks(renderer, page, expectBlocks) {
  const classes = (Array.isArray(expectBlocks) ? expectBlocks : []).filter((b) => /^ar-[a-z0-9-]+$/.test(b));
  if (!classes.length) return;
  try {
    await renderer.waitFor(page, (list) => Array.isArray(list) && list.every((c) => document.querySelector(`.${c}`)),
      classes, THRESHOLDS.blockWaitMs);
  } catch { /* still missing after the wait: C1 reports it */ }
}

/**
 * Render one URL and return the raw measurement plus uncaught page errors.
 * Status / X-Robots-Tag come from the navigation response, so each page costs one site request.
 * @param {{ expectBlocks?: string[] }} [opts] block classes this page rendered last time (baseline)
 * @returns {Promise<{ ok: boolean, status: number|null, xRobots: string, error?: string, measure?: object, pageErrors: string[] }>}
 */
export async function renderAndMeasure(renderer, url, opts = {}) {
  const page = await renderer.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => {
    pageErrors.push(`${err?.message || err}${err?.stack ? ` | ${String(err.stack).slice(0, 400)}` : ''}`);
  });
  try {
    const resp = await page.goto(url, { waitUntil: 'load', timeout: THRESHOLDS.navTimeoutMs });
    const status = resp ? resp.status() : null;
    const xRobots = resp ? headerOf(resp, 'x-robots-tag') : '';
    let rawHtml = '';
    try { if (resp && status === 200) rawHtml = await resp.text(); } catch { rawHtml = ''; }
    if (status === 429 || (status != null && status >= 400)) return { ok: true, status, xRobots, measure: null, pageErrors };
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
    await waitForSchemaSettle(page);
    await waitForExpectedBlocks(renderer, page, opts.expectBlocks);
    const cfg = {
      injected: INJECTED_UI_SELECTORS,
      blocks: BLOCK_SELECTORS,
      blockClassRe: BLOCK_CLASS_RE
    };
    let measure = await page.evaluate(measureRenderedPage, cfg);
    const blogPost = /\/blog-on-photography\//i.test(String(url || ''));
    const hasPosting = (measure?.ldTexts || []).some((t) => /BlogPosting/i.test(String(t || '')));
    if (blogPost && !hasPosting) {
      await sleep(3000);
      measure = await page.evaluate(measureRenderedPage, cfg);
    }
    if (measure) measure.rawHtml = rawHtml;
    return { ok: true, status, xRobots, measure, pageErrors };
  } catch (e) {
    return { ok: false, status: null, xRobots: '', error: String(e?.message || e).slice(0, 300), pageErrors };
  } finally {
    try { await page.close(); } catch { /* ignore */ }
  }
}
