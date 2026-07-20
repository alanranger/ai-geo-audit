import { chromium } from 'playwright';

const BASE = 'https://ai-geo-audit.vercel.app/audit-dashboard.html';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const hits = [];
page.on('request', (req) => {
  const u = req.url();
  if (/get-latest-audit|get-audit-history|06-site-urls|site-urls\.csv|schema-tools-six.*06-site-urls|mergeCanonical/i.test(u)) {
    hits.push({ t: Date.now(), method: req.method(), url: u });
  }
});

const t0 = Date.now();
await page.goto(BASE, { waitUntil: 'load', timeout: 120000 });
await page.waitForTimeout(20000);

console.log('Load ms:', Date.now() - t0);
console.log('Tracked requests:', hits.length);
hits.forEach((h, i) => console.log(`${i + 1}. ${h.url.slice(0, 160)}`));

await browser.close();
