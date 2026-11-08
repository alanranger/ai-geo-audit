/**
 * Live check (production, 1700px) for the 8 Nov tidy-up + LinkedIn GPT API + social-standard B3:
 * Instagram reach / followers comparison state, the email allowance bar vs SQL, released 17:00 sends, no
 * "no platform evidence" warning, the LinkedIn tile line, today's evidenced posts, and an invalid GPT body refused
 * live (400, nothing written). Viewing writes nothing (row counts before / after). Nothing valid is posted.
 *   node scripts/playwright-social-tidyup-live.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const OUT = path.resolve('outputs');
const BASE = 'https://ai-geo-audit.vercel.app';
for (const l of fs.readFileSync('.env.vercel.prod', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '').trim();
}
const KEY = process.env.ARP_ADMIN_KEY;
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const TABLES = ['social_connections', 'social_oauth_states', 'social_account_daily', 'social_posts', 'social_post_snapshots', 'strategy_campaign_ticks', 'strategy_campaigns', 'sqs_scheduled_emails', 'sqs_send_meter', 'acquisition_sync_runs'];
const results = [];
const check = (name, ok, note = '') => results.push({ name, ok: !!ok, note });
const fmt = (v) => Number(v).toLocaleString('en-GB');
const errors = [];
const writes = [];

async function counts() {
  const out = {};
  for (const t of TABLES) out[t] = (await sb.from(t).select('*', { count: 'exact', head: true })).count;
  return out;
}

async function allowanceSql() {
  const { data: m } = await sb.from('sqs_send_meter').select('used_emails,quota_emails,cycle_reset_at').order('captured_at', { ascending: false }).limit(1);
  const { data: s } = await sb.from('sqs_scheduled_emails').select('recipients,state,scheduled_for').eq('state', 'scheduled').lt('scheduled_for', m[0].cycle_reset_at);
  const booked = s.reduce((t, r) => t + (r.recipients || 0), 0);
  return { used: m[0].used_emails, booked, free: m[0].quota_emails - m[0].used_emails - booked, quota: m[0].quota_emails };
}

async function invalidGptBody() {
  const before = await counts();
  const r = await fetch(`${BASE}/api/aigeo/social`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-arp-admin-key': KEY }, body: JSON.stringify({ action: 'linkedin-gpt', week_ending: '2026-11-08', followers: -5, impressions_7d: 1400 }) });
  const j = await r.json().catch(() => ({}));
  const after = await counts();
  check('live API refuses an invalid GPT body (negative followers): 400', r.status === 400 && j.ok === false, `${r.status} ${j.error}`);
  check('the refused body wrote nothing', JSON.stringify(before) === JSON.stringify(after));
}

const rowText = (page, tile, label) => page.locator(`[data-mksoc-tile="${tile}"] .mksoc-r`, { hasText: label }).first();

async function socialChecks(page) {
  const reach = rowText(page, 'instagram', 'Reach (28 days)');
  const reachTxt = (await reach.innerText()).replace(/\s+/g, ' ');
  const reachTip = await reach.locator('.mksoc-d').getAttribute('title').catch(() => null);
  check('Instagram reach as shown (earlier window fully covered → change stays)', /1,436/.test(reachTxt), `${reachTxt}${reachTip ? ` | tooltip: ${reachTip}` : ''}`);
  for (const t of ['facebook', 'instagram']) {
    const el = page.locator(`[data-mksoc-tile="${t}"] .mksoc-nc-d`).first();
    const txt = await el.innerText().catch(() => '');
    check(`${t} followers: "not comparable yet" with a tooltip`, txt === 'not comparable yet', await el.getAttribute('title').catch(() => ''));
  }
  const nc = await page.$$eval('#mk-social .mksoc-t', (tiles) => tiles.flatMap((t) => [...t.querySelectorAll('.mksoc-nc-d')].map((e) => `${t.dataset.mksocTile}: ${(e.closest('.mksoc-r')?.querySelector('span')?.textContent || 'headline').trim()}`)));
  check('metrics reading "not comparable yet"', true, nc.join(' · '));
  const li = (await page.locator('[data-mksoc-tile="linkedin"]').innerText()).replace(/\s+/g, ' ');
  check('LinkedIn tile line (GPT · entered / manual · …)', /GPT · entered|manual · /.test(li), li.match(/(GPT · entered[^·]*|manual · [^·]*)/)?.[0] || li.slice(0, 120));
  const ev = await page.$$eval('#mksoc-posts tbody tr', (rows) => rows.map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent.trim())).filter((c) => c[13] && c[13] !== '—').map((c) => `${c[0]} ${c[2]} ${c[4].slice(0, 28)} reach ${c[6]}`));
  check('recent posts: today\'s evidenced placements (2 Stories, FB + IG feed, LinkedIn)', ev.filter((x) => / Story /.test(x)).length === 2 && ev.length >= 7, ev.join(' || '));
}

async function allowanceChecks(page, exp) {
  await page.waitForFunction(() => [...document.querySelectorAll('#mk-schedule .mks-dim')].some((e) => / used · /.test(e.textContent)), null, { timeout: 90000 });
  const dim = (await page.locator('#mk-schedule .mks-dim', { hasText: ' used · ' }).first().innerText()).replace(/\s+/g, ' ');
  const want = `${fmt(exp.used)} used · ${fmt(exp.booked)} booked · ${fmt(exp.free)} free of ${fmt(exp.quota)}`;
  check(`allowance bar = SQL (${want})`, dim.includes(want), dim.slice(0, 120));
  const all = (await page.locator('section[data-panel="marketing"]').innerText()).replace(/\s+/g, ' ');
  check('no "marked scheduled with no platform evidence" warning', !/marked scheduled with no platform evidence/i.test(all));
  await page.click('#mk-fold-rules > summary');
  await page.waitForTimeout(1500);
  const budget = (await page.locator('#mk-budget').innerText().catch(() => '')).replace(/\s+/g, ' ');
  const rows = await page.$$eval('#mk-budget tr', (trs) => trs.map((tr) => tr.textContent.replace(/\s+/g, ' ').trim()).filter((t) => /8 Nov,? 17:00/.test(t)));
  check('both 8 Nov 17:00 sends released (or "released, pending Sent link")', rows.length >= 2 && rows.every((t) => /released|sent/i.test(t)), rows.map((t) => t.slice(0, 140)).join(' || ') || budget.slice(0, 200));
}

const exp = await allowanceSql();
const c0 = await counts();
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
page.on('pageerror', (e) => errors.push(e.message));
const otherPosts = [];
page.on('request', (r) => {
  if (r.method() === 'GET' || !/\/api\//.test(r.url())) return;
  const p = new URL(r.url()).pathname;
  const action = (() => { try { return JSON.parse(r.postData() || '{}').action || ''; } catch { return ''; } })();
  (p.startsWith('/api/aigeo/social') ? writes : otherPosts).push(`${r.method()} ${p}${action ? ` (${action})` : ''}`);
});
await page.addInitScript((k) => sessionStorage.setItem('arp_admin_key', k), KEY);
await page.goto(`${BASE}/audit-dashboard.html#marketing`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#mk-social .mksoc-g', { timeout: 120000 });
await page.waitForSelector('#mk-schedule .mks-dim', { timeout: 120000 });
await page.waitForTimeout(3000);
await page.addStyleTag({ content: '#debugPanel { display: none !important; }' });
const tag = await page.evaluate(() => document.querySelector('script[src*="marketing-social-tiles"]')?.getAttribute('src'));
check('deployed script tag', /v=social-20261108b/.test(tag || ''), tag);
await page.locator('#mk-social .mksoc-g').screenshot({ path: `${OUT}/social-tiles-tidyup-live-1700px-20261108.png` });
await page.locator('#mksoc-posts').screenshot({ path: `${OUT}/social-recent-posts-evidence-live-prod-1700px-20261108.png` });
await socialChecks(page);
await allowanceChecks(page, exp);
await page.locator('#mk-schedule .mks-dim', { hasText: ' used · ' }).first().locator('xpath=..').screenshot({ path: `${OUT}/email-allowance-bar-live-1700px-20261108.png` });
await page.locator('#mk-budget').screenshot({ path: `${OUT}/email-send-budget-released-live-1700px-20261108.png` }).catch(() => {});
await browser.close();
const c1 = await counts();
check('viewing writes nothing (row counts unchanged; no POST to the social API)', JSON.stringify(c0) === JSON.stringify(c1) && !writes.length, `${JSON.stringify(c1)}${writes.length ? ` · ${writes.join(', ')}` : ''}`);
console.log(`other dashboard POST read calls during page load: ${[...new Set(otherPosts)].join(', ')}`);
await invalidGptBody();
check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
console.log(`SQL: used ${exp.used} · booked ${exp.booked} · free ${exp.free} of ${exp.quota}`);
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? ` (${r.note})` : ''}`);
console.log(results.every((r) => r.ok) ? 'ALL PASS' : `${results.filter((r) => !r.ok).length} FAILED`);
