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
    close: () => browser.close()
  };
}

async function launchPlaywright() {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true })
    .catch(() => chromium.launch({ headless: true, channel: 'chrome' }));
  const context = await browser.newContext({ userAgent: GOOGLEBOT_SMARTPHONE_UA, viewport: VIEWPORT, isMobile: true });
  return {
    newPage: () => context.newPage(),
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

/**
 * Render one URL and return the raw measurement plus uncaught page errors.
 * Status / X-Robots-Tag come from the navigation response, so each page costs one site request.
 * @returns {Promise<{ ok: boolean, status: number|null, xRobots: string, error?: string, measure?: object, pageErrors: string[] }>}
 */
export async function renderAndMeasure(renderer, url) {
  const page = await renderer.newPage();
  const pageErrors = [];
  page.on('pageerror', (err) => {
    pageErrors.push(`${err?.message || err}${err?.stack ? ` | ${String(err.stack).slice(0, 400)}` : ''}`);
  });
  try {
    const resp = await page.goto(url, { waitUntil: 'load', timeout: THRESHOLDS.navTimeoutMs });
    const status = resp ? resp.status() : null;
    const xRobots = resp ? headerOf(resp, 'x-robots-tag') : '';
    if (status === 429 || (status != null && status >= 400)) return { ok: true, status, xRobots, measure: null, pageErrors };
    await sleep(THRESHOLDS.renderWaitMs);
    const measure = await page.evaluate(measureRenderedPage, {
      injected: INJECTED_UI_SELECTORS,
      blocks: BLOCK_SELECTORS,
      blockClassRe: BLOCK_CLASS_RE
    });
    return { ok: true, status, xRobots, measure, pageErrors };
  } catch (e) {
    return { ok: false, status: null, xRobots: '', error: String(e?.message || e).slice(0, 300), pageErrors };
  } finally {
    try { await page.close(); } catch { /* ignore */ }
  }
}
