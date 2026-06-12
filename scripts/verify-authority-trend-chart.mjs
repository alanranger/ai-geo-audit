/**
 * Verify Authority scorecard vs trend chart on live dashboard.
 * Run: node scripts/verify-authority-trend-chart.mjs
 */
import { chromium } from 'playwright';

const URL = 'https://ai-geo-audit.vercel.app/audit-dashboard.html';
const PROPERTY = 'https://www.alanranger.com/';
const MIN_VERSION = '66d7b81';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const apiHistory = [];
page.on('response', async (res) => {
  const u = res.url();
  if (u.includes('get-audit-history') || u.includes('get-latest-audit')) {
    try {
      const json = await res.json();
      apiHistory.push({ url: u.replace('https://ai-geo-audit.vercel.app', ''), status: res.status(), json });
    } catch {
      /* ignore */
    }
  }
});

console.log('Loading live dashboard (no localStorage seed — real audit path)...');
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 180000 });

await page.waitForFunction(
  () => !document.getElementById('loading')?.classList.contains('show'),
  { timeout: 180000 }
).catch(() => null);

await page.waitForFunction(
  () => typeof window.trendChart !== 'undefined' && window.trendChart !== null,
  { timeout: 180000 }
).catch(() => null);

const version = await page.evaluate(() =>
  document.body.innerText.match(/Version:\s*([a-f0-9]+)/)?.[1] || 'unknown'
);

const results = await page.evaluate(() => {
  const cardScore = document.querySelector('.pillar-card .pillar-score')?.textContent?.trim();
  const authorityCard = [...document.querySelectorAll('.pillar-card')].find((c) =>
    c.textContent.includes('E-A-T')
  );
  const cardAuth = authorityCard?.querySelector('.pillar-score')?.textContent?.trim();

  let trendLastAuthority = null;
  let trendLastDate = null;
  const chart = window.trendChart;
  if (chart?.data?.labels?.length && chart.data.datasets) {
    const authIdx = chart.data.datasets.findIndex((d) => /authority/i.test(d.label || ''));
    const labels = chart.data.labels;
    const lastIdx = labels.length - 1;
    trendLastDate = labels[lastIdx];
    if (authIdx >= 0) {
      trendLastAuthority = chart.data.datasets[authIdx].data[lastIdx];
    }
  }

  const latestScores = window.latestAuditScores?.authority;
  const liveTotal =
    latestScores?.bySegment?.all?.total ??
    latestScores?.score ??
    window.latestAuditScores?.authorityComponents
      ? null
      : null;

  return {
    cardAuth,
    cardScore,
    trendLastAuthority,
    trendLastDate,
    liveAuthorityScore: typeof latestScores === 'object' ? latestScores?.score : latestScores,
    liveBySegmentTotal: latestScores?.bySegment?.all?.total,
    trendDatasetCount: chart?.data?.datasets?.length ?? 0,
  };
});

console.log('\n=== Authority trend chart verification ===');
console.log('Deployed version:', version, version >= MIN_VERSION.slice(0, 7) ? '(OK)' : `(expected >= ${MIN_VERSION})`);
console.log('Authority pillar card:', results.cardAuth);
console.log('Trend chart last date:', results.trendLastDate);
console.log('Trend chart last Authority:', results.trendLastAuthority);
console.log('window.latestAuditScores authority:', results.liveAuthorityScore, 'bySegment.all:', results.liveBySegmentTotal);

const cardNum = Number(results.cardAuth);
const trendNum = Number(results.trendLastAuthority);
const ok =
  Number.isFinite(cardNum) &&
  Number.isFinite(trendNum) &&
  Math.abs(cardNum - trendNum) <= 2;

console.log('\nParity check (card vs trend last point, ±2):', ok ? 'PASS' : 'FAIL');
if (!ok) {
  console.log(`  card=${cardNum} trend=${trendNum} delta=${Math.abs(cardNum - trendNum)}`);
}

const hist = apiHistory.find((h) => h.url.includes('get-audit-history'));
if (hist?.json?.data) {
  const mayJun = hist.json.data.filter((r) => {
    const d = String(r.date).split('T')[0];
    return d >= '2026-05-25' && d <= '2026-06-12';
  });
  console.log('\nAPI history May 25–Jun 12:');
  for (const r of mayJun) {
    const d = String(r.date).split('T')[0];
    console.log(`  ${d} authority=${r.authorityScore} rank=${r.authorityRankingScore} seg=${r.authorityBySegment?.all?.total}`);
  }
}

await browser.close();
process.exit(ok ? 0 : 1);
