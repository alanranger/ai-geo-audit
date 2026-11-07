/**
 * Full-page screenshot of LIVE Strategy tab v5 — does NOT toggle ticks.
 * node scripts/playwright-verify-strategy-v5.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

const OUT = resolve('C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude');
mkdirSync(OUT, { recursive: true });
const url = 'https://ai-geo-audit.vercel.app/audit-dashboard.html?cb=' + Date.now() + '#strategy';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#strategy-root', { timeout: 60000 });
// Wait for LIVE v5 pill or diary table
await page.waitForFunction(() => {
  const root = document.getElementById('strategy-root');
  return root && /LIVE v5|Strategy pillars|Next 12 weeks/i.test(root.innerText || '');
}, { timeout: 120000 });
await page.waitForTimeout(2500);

const text = await page.locator('#strategy-root').innerText();
const checklist = {
  '1 Strategy pillars': /Strategy pillars/i.test(text),
  '2 Quarter cards': /Quarter cards|Q1|This quarter/i.test(text),
  '3 Headline strip': /Headline strip|GP \/ month \(T3\)/i.test(text),
  '4 GP by month chart': /GP by month vs survival/i.test(text),
  '5 Roadmap milestones': /Roadmap milestones/i.test(text),
  'E Diary': /Next 12 weeks/i.test(text),
  'F Push + Action': /Where to push|Action needed/i.test(text),
  '8 Plan clients': /Plan clients/i.test(text),
  '9 Conversion': /plan conversion/i.test(text),
  'A Beginners by source': /Beginners by source/i.test(text),
  'B Plans & workshops': /workshops signals|Residential avg/i.test(text),
  'D KPI scorecard': /KPI scorecard/i.test(text),
  'C All 11 KPIs': /All 11 KPIs/i.test(text),
  'G Trends': /Trends/i.test(text),
  'Batsford AM/PM note': /AM \d+\/6 · PM \d+\/6/.test(text),
  'LIVE v5': /LIVE v5/.test(text)
};

const batsLines = text.split(/\n/).filter((l) => /Batsford/i.test(l) || /AM \d+\/6/.test(l)).slice(0, 20);
const png = resolve(OUT, 'LIVE-STRATEGY-TAB-V5-FULLPAGE.png');
await page.locator('#strategy-root').screenshot({ path: png });
// Also full page
await page.screenshot({
  path: resolve(OUT, 'LIVE-STRATEGY-TAB-V5-VIEWPORT.png'),
  fullPage: false
});
await page.screenshot({
  path: resolve(OUT, 'LIVE-STRATEGY-TAB-V5-FULLPAGE-browser.png'),
  fullPage: true
});

writeFileSync(resolve(OUT, 'VERIFY-strategy-v5-live-checklist.json'), JSON.stringify({
  url, checklist, batsLines, png
}, null, 2));
console.log(JSON.stringify({ url, checklist, batsLines, png }, null, 2));
await browser.close();
