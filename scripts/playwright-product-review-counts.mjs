/**
 * Read review count + rating from RENDERED live product pages (after the hosted product loader runs).
 * Paced 16 s between pages to stay clear of Squarespace 429.
 * Usage: node scripts/playwright-product-review-counts.mjs [url ...]
 */
import { chromium } from 'playwright';

const DEFAULT_PAGES = [
  'https://www.alanranger.com/photography-services-near-me/beginners-portrait-photography-course',
  'https://www.alanranger.com/photo-workshops-uk/yorkshire-dales-photography-workshops',
  'https://www.alanranger.com/photography-services-near-me/four-private-photography-classes',
  'https://www.alanranger.com/photography-services-near-me/lightroom-courses-for-beginners-coventry',
  'https://www.alanranger.com/photo-workshops-uk/landscape-photography-workshops-anglesey',
  'https://www.alanranger.com/photo-workshops-uk/garden-photography-workshop'
];

async function readPage(page, url) {
  await page.goto(`${url}?cb=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  return page.evaluate(() => {
    const out = { title: document.title, aggregate: [], reviewNodes: 0 };
    for (const s of document.querySelectorAll('script[type="application/ld+json"]')) {
      let j;
      try { j = JSON.parse(s.textContent || ''); } catch { continue; }
      for (const n of (j['@graph'] || [j])) {
        if (n && n.aggregateRating) out.aggregate.push(`${n.aggregateRating.reviewCount}@${n.aggregateRating.ratingValue}`);
        if (n && n.review) out.reviewNodes += [n.review].flat().length;
      }
    }
    return out;
  });
}

const pages = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_PAGES;
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
const rows = [];
try {
  for (let i = 0; i < pages.length; i += 1) {
    if (i) await page.waitForTimeout(16000);
    const r = await readPage(page, pages[i]);
    rows.push({ url: pages[i], ...r });
    console.log(`${pages[i].replace('https://www.alanranger.com', '')} | ${r.title.slice(0, 45)} | aggregate=${r.aggregate.join(',') || '-'} | review nodes=${r.reviewNodes}`);
  }
} finally {
  await browser.close();
}
console.log(JSON.stringify(rows));
