import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { adsCardModel } from '../../lib/acquisition/chatgpt-ads-card.js';

// Synthetic offline fixtures only: no Ads, analytics or database requests.
const gift = 'cmpn_4d7a58c3b7708192b3402d805deb2e85';
const academy = 'academy-test';
const campaigns = [
  { id: gift, name: 'Gift vouchers', status: 'active', budget: { daily_spend_limit_micros: 15000000 }, start_time: 1795510800, end_time: 1795910340 },
  { id: academy, name: 'Academy test', status: 'paused', budget: { lifetime_spend_limit_micros: 50000000 }, start_time: 1795681200, end_time: 1795767600 }
];
const groups = campaigns.map(c => ({ id: `${c.id}-group`, campaign_id: c.id, name: c.name, status: 'active', bidding_config: { billing_event_type: 'click', target_strategy: 'target_cpc', target_micros: 1500000 } }));
const report = { totals: [{ campaign_id: gift, spend: 44.27, clicks: 51 }, { campaign_id: academy, spend: 12, clicks: 8 }],
  days: [{ campaign_id: academy, date: '2026-11-26', spend: 12, clicks: 8, impressions: 100, conversions: 0 }] };
const data = adsCardModel({ campaigns, groups, report, now: new Date('2026-11-26T09:00:00Z') });
const script = await fs.readFile(new URL('../../lib/chatgpt-ads-plan.js', import.meta.url), 'utf8');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setContent('<div id="mk-chatgpt-ads"></div><div id="st-chatgpt-ads"></div>');
  await page.evaluate(d => { window.fetch = async () => ({ json: async () => d }); }, data);
  await page.addScriptTag({ content: script });
  await page.evaluate(async () => {
    await window.mkMountChatgptAds(document.querySelector('#mk-chatgpt-ads'));
    await window.mkMountChatgptAds(document.querySelector('#st-chatgpt-ads'));
  });
  const host = page.locator('#mk-chatgpt-ads');
  assert.match(await host.innerText(), /£15\/day · Target CPC £1\.50 \(average\)/);
  assert.match(await host.innerText(), /Clicks vs 115/);
  await host.locator('[data-ads-campaign]').selectOption(academy);
  const text = await host.innerText();
  assert.match(text, /£50 total campaign cap · Target CPC £1\.50 \(average\)/);
  assert.match(text, /paused/);
  assert.match(text, /£38\.00/);
  assert.doesNotMatch(text, /£50\/day|Clicks vs 115|Left to £100|105 net/);
  await host.locator('[data-ads-from]').fill('2026-11-27');
  await host.locator('[data-ads-from]').dispatchEvent('change');
  assert.match(await host.innerText(), /£38\.00/); // Whole-flight cap unaffected by date filter.
  assert.match(await page.locator('#st-chatgpt-ads').innerText(), /£15\/day · Target CPC £1\.50 \(average\)/);
  assert.deepEqual(errors, []);
  console.log('PASS: Marketing and Strategy labels, paused lifetime campaign, scoped limits and date-filter-safe remaining cap.');
} finally { await browser.close(); }
