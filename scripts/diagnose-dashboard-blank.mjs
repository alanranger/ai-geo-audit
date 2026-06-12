import { chromium } from 'playwright';

const URL = 'https://ai-geo-audit.vercel.app/audit-dashboard.html';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push('console: ' + msg.text());
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForTimeout(65000);

const state = await page.evaluate(() => ({
  version: document.body.innerText.match(/Version:\s*([a-f0-9]+)/)?.[1],
  loadingShow: document.getElementById('loading')?.classList.contains('show'),
  loadingDisplay: document.getElementById('loading') ? getComputedStyle(document.getElementById('loading')).display : null,
  dashboardEl: !!document.getElementById('dashboard'),
  dashboardDisplay: document.getElementById('dashboard')?.style.display,
  dashboardTextLen: document.getElementById('dashboard')?.innerText?.length || 0,
  activePanel: document.querySelector('.aigeo-panel.is-active')?.getAttribute('data-panel'),
  activeNav: document.querySelector('.aigeo-nav-item.is-active')?.getAttribute('data-panel'),
  panelDashboardLen: document.querySelector('[data-panel="dashboard"]')?.innerText?.length || 0,
  panelOverviewLen: document.querySelector('[data-panel="overview"]')?.innerText?.length || 0,
  displayRunning: window.__displayDashboardRunning,
  trendChart: !!window.trendChart,
  lastDebug: (window.debugLogEntries || []).slice(-8).map((e) => e.message),
}));

console.log(JSON.stringify(state, null, 2));
console.log('\nPage errors:', errors.slice(0, 15));

await browser.close();
