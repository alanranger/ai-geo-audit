import { chromium } from 'playwright';

const out = 'C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude/SCREEN-2026-10-31-system-health-panel.png';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
try {
  await page.goto('https://ai-geo-audit.vercel.app/audit-dashboard.html?cb=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(3000);
  await page.locator('button.aigeo-nav-item[data-panel="traditional-seo"]').click();
  await page.waitForTimeout(8000);
  const health = page.locator('#traditional-seo-system-health');
  const visible = await health.isVisible().catch(() => false);
  const html = visible ? await health.innerHTML() : '';
  console.log(JSON.stringify({ visible, html: html.slice(0, 500) }));
  await page.locator('#traditional-seo-run-controls, #traditional-seo-system-health, [data-panel="traditional-seo"]').first().scrollIntoViewIfNeeded().catch(() => {});
  await page.screenshot({ path: out, fullPage: false });
} finally {
  await browser.close();
}
