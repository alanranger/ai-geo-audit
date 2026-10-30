/**
 * Playwright: Traditional SEO system health is grouped by cause.
 *   node scripts/verify-trad-seo-health-panel.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = process.argv[2] || join(
  'C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude',
  'SCREEN-2026-10-30-system-health-after.png'
);
const URL = process.env.DASHBOARD_URL
  || 'https://ai-geo-audit.vercel.app/audit-dashboard.html#traditional-seo';

mkdirSync(dirname(OUT), { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.getByText('System health', { exact: false }).first().waitFor({ timeout: 45000 }).catch(() => {});
await page.locator('#traditional-seo-system-health').scrollIntoViewIfNeeded().catch(() => {});
await page.waitForTimeout(1500);
const health = await page.evaluate(() => {
  const el = document.getElementById('traditional-seo-system-health');
  if (!el || el.style.display === 'none') return { visible: false, rows: 0, titles: [], perUrlMissing: 0 };
  const titles = [...el.querySelectorAll('tbody tr td:first-child')].map((td) => td.innerText.trim());
  return {
    visible: true,
    rows: titles.length,
    titles: titles.slice(0, 12),
    perUrlMissing: titles.filter((t) => /^No page_entities row/i.test(t)).length,
    groupedDead: titles.some((t) => /no longer exist \(404\)/i.test(t)),
    export09: titles.some((t) => /09-url-target-keywords/i.test(t))
      || [...el.querySelectorAll('tbody tr td:nth-child(2)')].some((td) => /Export 09 keywords/i.test(td.innerText))
  };
});
await page.locator('#traditional-seo-system-health').screenshot({ path: OUT }).catch(async () => {
  await page.screenshot({ path: OUT });
});
await browser.close();
console.log(JSON.stringify({ out: OUT, health }, null, 2));
if (health.perUrlMissing > 2) {
  console.error('Health panel still lists per-URL missing page_entities rows');
  process.exit(2);
}
