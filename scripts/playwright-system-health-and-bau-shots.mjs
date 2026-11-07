/**
 * Screenshots for Claude handoff: System health + BAU page + tool buttons.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = 'C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude';
mkdirSync(out, { recursive: true });

const shots = [
  {
    name: 'SCREEN-2026-10-31-system-health-panel.png',
    url: 'https://ai-geo-audit.vercel.app/audit-dashboard.html?cb=' + Date.now() + '#traditional-seo',
    wait: async (page) => {
      await page.waitForTimeout(8000);
      const el = page.locator('#traditional-seo-system-health');
      if (await el.count()) await el.scrollIntoViewIfNeeded().catch(() => {});
    }
  },
  {
    name: 'SCREEN-2026-10-31-bau-workflow-page.png',
    url: 'https://apps-dashboard-lilac.vercel.app/bau-workflow.html',
    wait: async (page) => { await page.waitForTimeout(2000); }
  },
  {
    name: 'SCREEN-2026-10-31-schema-tools-tabs.png',
    url: 'https://schema-tools-six.vercel.app/',
    wait: async (page) => { await page.waitForTimeout(3000); }
  },
  {
    name: 'SCREEN-2026-10-31-ingest-bulk-simple.png',
    url: 'https://alan-chat-proxy.vercel.app/bulk-simple.html',
    wait: async (page) => { await page.waitForTimeout(3000); }
  }
];

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
try {
  for (const s of shots) {
    await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await s.wait(page);
    await page.screenshot({ path: `${out}/${s.name}`, fullPage: true });
    console.log('wrote', s.name);
  }
} finally {
  await browser.close();
}
