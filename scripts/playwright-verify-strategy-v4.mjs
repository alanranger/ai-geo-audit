/**
 * Live verify Strategy v4 after deploy.
 * node scripts/playwright-verify-strategy-v4.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

for (const name of ['.env.vercel.prod', '.env.local']) {
  try {
    for (const line of readFileSync(name, 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m) continue;
      let val = m[2];
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
      if (!process.env[m[1]] || (name === '.env.vercel.prod' && val.startsWith('sb_'))) process.env[m[1]] = val;
    }
  } catch { /* optional */ }
}

const OUT = resolve('C:/Users/alan/Google Drive/Claude shared resources/Cursor Outputs for Claude');
mkdirSync(OUT, { recursive: true });
const LIVE = 'https://ai-geo-audit.vercel.app/audit-dashboard.html?v=stv4#' + 'strategy';
const PROP = 'https://www.alanranger.com';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(LIVE, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForSelector('#strategy-root h2', { timeout: 120000 });
await page.waitForTimeout(2500);

// RAG filter
await page.selectOption('#st-rag', 'red');
await page.waitForTimeout(400);
const redVisible = await page.locator('#st-diary tbody tr:visible').count();
await page.selectOption('#st-rag', 'all');

// Open event link
const link = page.locator('#st-diary tbody tr a').first();
const href = await link.getAttribute('href');
const [popup] = await Promise.all([
  page.waitForEvent('popup', { timeout: 8000 }).catch(() => null),
  link.click({ modifiers: ['Control'] }).catch(() => link.click())
]);
if (popup) await popup.close().catch(() => {});

// Tick / untick one action
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: beforeRows } = await sb.from('strategy_quarter_actions').select('id, is_ticked').eq('property_url', PROP);
const tick = page.locator('.st-tick').first();
const id = Number(await tick.getAttribute('data-id'));
const before = beforeRows.find((r) => Number(r.id) === id)?.is_ticked;
await tick.click();
await page.waitForTimeout(1200);
const { data: afterRows } = await sb.from('strategy_quarter_actions').select('id, is_ticked').eq('property_url', PROP);
const after = afterRows.find((r) => Number(r.id) === id)?.is_ticked;
const othersUnchanged = beforeRows.every((b) => {
  if (Number(b.id) === id) return true;
  const a = afterRows.find((x) => Number(x.id) === b.id);
  return a && a.is_ticked === b.is_ticked;
});
// revert
if (after !== before) {
  await tick.click();
  await page.waitForTimeout(1000);
}

await page.screenshot({ path: resolve(OUT, 'LIVE-STRATEGY-V4-TAB-SCREENSHOT-LATEST.png'), fullPage: true });

const summary = await (await fetch(`https://ai-geo-audit.vercel.app/api/aigeo/strategy-summary?propertyUrl=${encodeURIComponent(PROP)}`)).json();
const { count: snapCount } = await sb.from('strategy_event_snapshots').select('*', { count: 'exact', head: true }).eq('snapshot_date', new Date().toISOString().slice(0, 10));

writeFileSync(resolve(OUT, 'LIVE-STRATEGY-V4-VERIFY-LATEST.json'), JSON.stringify({
  redVisible,
  eventLink: href,
  tick: { id, before, after, othersUnchanged, toggled: before !== after },
  layout: summary.layout,
  diary_n: summary.diary?.length,
  snapCount,
  paste: (summary.diary || []).filter((e) => ['2026-10-10', '2026-10-17', '2026-10-23', '2026-11-20', '2026-11-13', '2026-12-29'].includes(e.date))
    .map((e) => ({ date: e.date, title: e.title, price: e.price, cap: e.cap, booked: e.booked, left: e.left, rag: e.rag, status: e.status, mismatch: e.mismatch })),
  kpis: summary.kpi_scorecard
}, null, 2));

await browser.close();
console.log(JSON.stringify({ ok: true, redVisible, href, tick: { id, before, after, othersUnchanged }, layout: summary.layout, snapCount }, null, 2));
