/**
 * Live check: checklist posts get robots noindex after DOMContentLoaded;
 * a normal post does not. Pace 15s between URLs to avoid Squarespace 429.
 */
import { chromium } from 'playwright';

const GAP_MS = 16000;
const pages = [
  { url: 'https://www.alanranger.com/blog-on-photography/camera-white-balance-settings', expectNoindex: true },
  { url: 'https://www.alanranger.com/blog-on-photography/aperture-field-checklist', expectNoindex: true },
  { url: 'https://www.alanranger.com/blog-on-photography/landscape-photography-guide', expectNoindex: true },
  { url: 'https://www.alanranger.com/blog-on-photography/what-is-iso-in-photography', expectNoindex: false }
];

async function check(page, item) {
  await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.readyState !== 'loading', { timeout: 15000 });
  await page.waitForTimeout(800);
  const info = await page.evaluate(() => {
    const robots = [...document.querySelectorAll('meta[name="robots"]')].map((m) => m.getAttribute('content') || '');
    const article = document.querySelector('article');
    return {
      title: document.title,
      robots,
      checklist: !!(article && /category-1-page-field-checklists/.test(article.className || '')),
      noindex: robots.some((c) => /noindex/i.test(c))
    };
  });
  const ok = item.expectNoindex ? info.noindex : !info.noindex;
  return { ...item, ...info, ok };
}

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
const rows = [];
try {
  for (let i = 0; i < pages.length; i += 1) {
    if (i) await page.waitForTimeout(GAP_MS);
    const row = await check(page, pages[i]);
    rows.push(row);
    console.log(JSON.stringify(row));
    if (row.title === '429 Too Many Requests') {
      console.error('HTTP 429 — stop');
      process.exit(2);
    }
  }
} finally {
  await browser.close();
}
if (rows.some((r) => !r.ok)) {
  console.error('FAIL');
  process.exit(1);
}
console.log('PASS');
