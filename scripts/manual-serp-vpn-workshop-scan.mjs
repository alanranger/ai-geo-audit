/**
 * Manual SERP scan via local Chromium (uses system VPN IP).
 * Outputs JSON + screenshots for Alan's 13 workshop terms.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const OUT = String.raw`C:\Users\alan\Google Drive\Claude shared resources\Cursor Outputs for Claude`;
const KEYWORDS = [
  'landscape photography course',
  'landscape photography courses',
  'landscape photography workshop',
  'landscape photography workshops',
  'landscape photography workshops uk',
  'landscape workshops',
  'photo workshops',
  'photography holidays uk',
  'photography workshop',
  'photography workshops',
  'photography workshops near me',
  'photography workshops uk',
  'uk photography workshops',
];

function slug(q) {
  return q.replace(/\s+/g, '-').replace(/[^a-z0-9-]/gi, '').toLowerCase();
}

async function extractAlan(page, offset = 0) {
  return page.evaluate((off) => {
    const ranked = [];
    let pos = 0;
    for (const b of document.querySelectorAll('#rso .g, #rso .MjjYud')) {
      const h3 = b.querySelector('h3');
      const a = b.querySelector('a[href^="http"]');
      if (!h3 || !a) continue;
      if (h3.innerText.trim() === 'Map') continue;
      pos += 1;
      const href = a.href.split('?')[0].split('#')[0];
      if (href.includes('alanranger.com')) {
        ranked.push({
          pos: pos + off,
          url: href,
          path: href.replace(/^https?:\/\/[^/]+/, ''),
          title: h3.innerText.slice(0, 100),
        });
      }
    }
    const footer = (document.querySelector('[role=contentinfo]')?.innerText || '').replace(/\s+/g, ' ');
    const locMatch = footer.match(/United Kingdom\s+(.+?)\s*-\s*/);
    return {
      ranked,
      organicCount: pos,
      loc: locMatch ? locMatch[1].trim() : footer.slice(0, 160),
      aio: document.body.innerText.includes('AI Overview'),
      captcha: /unusual traffic|recaptcha|I'm not a robot/i.test(document.body.innerText),
    };
  }, offset);
}

async function findAlan(page, q) {
  const url = `https://www.google.co.uk/search?q=${encodeURIComponent(q)}&hl=en&gl=uk&pws=0&num=20`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  let r = await extractAlan(page, 0);
  if (r.captcha) return { q, error: 'captcha', ...r };
  let pages = 1;
  if (!r.ranked.length) {
    const u2 = `https://www.google.co.uk/search?q=${encodeURIComponent(q)}&hl=en&gl=uk&pws=0&num=20&start=10`;
    await page.goto(u2, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1200);
    const r2 = await extractAlan(page, 10);
    if (r2.captcha) return { q, error: 'captcha', ...r2 };
    r = { ...r2, loc: r2.loc || r.loc, aio: r.aio || r2.aio };
    pages = 2;
  }
  if (!r.ranked.length) {
    const u3 = `https://www.google.co.uk/search?q=${encodeURIComponent(q)}&hl=en&gl=uk&pws=0&num=20&start=20`;
    await page.goto(u3, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1200);
    const r3 = await extractAlan(page, 20);
    if (r3.captcha) return { q, error: 'captcha', ...r3 };
    r = { ...r3, loc: r3.loc || r.loc, aio: r.aio || r3.aio };
    pages = 3;
  }
  const shot = path.join(OUT, `MANUAL-VPN-MCR-${slug(q)}-2026-07-17.png`);
  // re-open best page for screenshot (first alan hit page)
  const best = r.ranked[0];
  const start = best ? Math.floor((best.pos - 1) / 10) * 10 : 0;
  const shotUrl = `https://www.google.co.uk/search?q=${encodeURIComponent(q)}&hl=en&gl=uk&pws=0&num=20&start=${start}`;
  await page.goto(shotUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: shot, fullPage: false });
  return {
    q,
    loc: r.loc,
    aio: r.aio,
    pagesChecked: pages,
    alan: r.ranked[0] || null,
    allAlan: r.ranked,
    screenshot: path.basename(shot),
  };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: 'en-GB',
  geolocation: undefined,
  viewport: { width: 1280, height: 900 },
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
});
const page = await context.newPage();

const results = [];
for (const q of KEYWORDS) {
  console.log('SCAN', q);
  try {
    const row = await findAlan(page, q);
    console.log(JSON.stringify(row));
    results.push(row);
    await page.waitForTimeout(2000);
  } catch (e) {
    console.error('FAIL', q, e.message);
    results.push({ q, error: e.message });
  }
}

const outJson = path.join(OUT, 'MANUAL-VPN-MCR-workshop-scan-2026-07-17.json');
fs.writeFileSync(outJson, JSON.stringify({ scannedAt: new Date().toISOString(), results }, null, 2));
console.log('WROTE', outJson);
await browser.close();
