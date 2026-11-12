/**
 * Marketing overview tiles 6c "what we're promoting, by service" + 6d "Service × channel coverage"
 * (QUESTION-2026-11-12 service-mix-tiles, Alan 00:08): the by-channel tile's own items (Sched + Waiting; drafts in the
 * hover; sent never), each tagged with a service tier from stored data (own link → product, campaign categories /
 * events, featured links, initiative target), % of target from the Survival Cockpit tier targets, flags from stored
 * thresholds; tile A items per tier = tile B row totals; clicks filter the schedule to exactly those items.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { assemblePlan } from '../lib/strategy-initiatives.mjs';
import { buildServiceMix, productIndex, resolveLink, rowOfCategory, rowOfNumber, tagOf, targetsOf, thresholdsOf, giftTargetOf, pathOf, SERVICE_ROWS } from '../lib/marketing/service-mix.mjs';

const TODAY = '2026-11-10';
const SITE = 'https://www.alanranger.com';
const step = (key, day, channel, title, extra = {}) => ({ key, day, scheduled_day: day, channel, step: title, featured: [], covers: [], brief: '', state: { status: 'pending' }, ...extra });
const send = (key, stage, day, extra = {}) => ({ campaign_key: key, kind: 'theme', title: key, stage, planned_send_on: day, window_start: day, reserved_sends: null, actual_sends: null, sent_on: null, stage_history: [], ...extra });
const st = (code, extra = {}) => ({ code, label: code, icon: '', tone: 'grey', ...extra });
const feat = (url) => [{ name: 'x', date: null, title: 'x', url }];
const EMAIL_STEP = 'step|2026-11-09|Squarespace email|2026-11-12';
const GBP_STEP = 'step|gbp|2026-11-20|/photographic-workshops-near-me/norfolk-event';

const campaignRows = [
  send('theme|gift', 'scheduled', '2026-11-19'), send('theme|cats', 'scheduled', '2026-11-26', { categories: [1] }),
  send('theme|plain', 'scheduled', '2026-12-03'), send('theme|sent', 'sent', '2026-11-10', { sent_on: '2026-11-10' })
];
function plan() {
  const campaign = {
    weeks: [
      { week: '2026-11-09', steps: [
        step('gpt-fb-1', '2026-11-13', 'Facebook + Instagram', 'Norfolk post', { manual: true }),
        step(EMAIL_STEP, '2026-11-12', 'Squarespace email', 'Weekly email', { is_email: true, featured: [{ name: 'Norfolk', date: '2026-11-20', title: 'Norfolk', url: `${SITE}/event-a` }, { name: 'Course', date: null, title: 'Course', url: `${SITE}/photography-services-near-me/beginners-photography-course` }] }),
        step(GBP_STEP, '2026-11-13', 'Google Business', 'GBP Norfolk', { gbp: 'exception', optional: true, state: { status: 'done' } })
      ] },
      { week: '2026-11-16', steps: [
        step('gpt-li-1', '2026-11-18', 'LinkedIn', 'Plan post', { manual: true, featured: feat(`${SITE}/photography-lessons-online-121`) }),
        step('gpt-fb-yt', '2026-11-20', 'Facebook + Instagram', 'Watch this', { manual: true })
      ] },
      { week: '2026-11-23', steps: [
        step('gpt-li-2', '2026-11-25', 'LinkedIn', 'Woodland post', { manual: true }),
        step('gpt-fb-draft', '2026-11-27', 'Facebook + Instagram', 'Gift draft', { manual: true, featured: feat(`${SITE}/photography-gift-vouchers`) })
      ] }
    ],
    carried: { future: [], late: [], older: [] }, campaigns: []
  };
  const statusIndex = Object.fromEntries([['gpt-fb-1', 'scheduled'], ['gpt-li-1', 'scheduled'], ['gpt-li-2', 'scheduled'], ['gpt-fb-yt', 'scheduled'], [EMAIL_STEP, 'scheduled'], ['send|theme|gift', 'scheduled'], ['send|theme|cats', 'scheduled'], ['send|theme|plain', 'scheduled']].map(([k, c]) => [k, st(c)]));
  const links = [{ ref_type: 'campaign', ref_key: 'theme|gift', initiative_key: 'gifts', role: 'primary' }];
  return { campaign, qp: assemblePlan({ today: TODAY, campaign, campaignRows, statusIndex, links, initiatives: [], quarters: [], actions: [], assets: [], txns: [], diary: [] }) };
}
const pl = (key, placement, day, link, extra = {}) => ({ step_key: key, placement, planned_at: `${day}T18:30:00Z`, status: st('scheduled'), approved: true, link_url: link, ...extra });
const board = {
  placements: [
    pl('gpt-fb-1', 'facebook_feed', '2026-11-13', `${SITE}/photo-workshops-uk/norfolk`), pl('gpt-fb-1', 'instagram_feed', '2026-11-13', `${SITE}/photo-workshops-uk/norfolk`),
    pl('gpt-li-1', 'linkedin_feed', '2026-11-18', `${SITE}/photography-payment-plan`),
    pl('gpt-fb-yt', 'facebook_feed', '2026-11-20', 'https://youtube.com/shorts/abc'), pl('gpt-fb-yt', 'instagram_feed', '2026-11-20', 'https://youtube.com/shorts/abc'),
    pl('gpt-li-2', 'linkedin_feed', '2026-11-25', `${SITE}/photo-workshops-uk/woodland/`)
  ],
  content: [{ asset_key: 'video|short|a', title: 'A Short', format: 'short_video', url: 'https://youtube.com/shorts/a', release_at: '2026-11-24T18:00:00Z', status: st('scheduled') }]
};
const canonical = [
  { product_url: `${SITE}/photo-workshops-uk/norfolk`, service_page_url: `${SITE}/photography-workshops`, category: 'workshop (residential)' },
  { product_url: `${SITE}/photo-workshops-uk/woodland`, service_page_url: `${SITE}/landscape-photography-workshops`, category: 'workshop (1-day)' },
  { product_url: `${SITE}/photography-services-near-me/beginners-photography-course`, service_page_url: `${SITE}/photography-courses-coventry`, category: 'course' },
  { product_url: `${SITE}/photography-services-near-me/annual-pick-n-mix-subscription`, service_page_url: `${SITE}/photography-payment-plan`, category: 'subscription/payment-plan' },
  { product_url: null, service_page_url: `${SITE}/photography-lessons-online-121`, category: '1-2-1' },
  { product_url: `${SITE}/photography-services-near-me/photography-gift-vouchers`, service_page_url: `${SITE}/photography-gift-vouchers`, category: 'gift voucher' },
  { product_url: `${SITE}/old-retired`, service_page_url: null, category: 'print', is_retired: true }
];
const gifts = { initiative_key: 'gifts', title: 'Gifts & Christmas revenue', target: { lines: [{ key: 'vouchers', category: 8 }, { key: 'gift_121' }], total: 2100, window: { start: '2026-11-01', end: '2026-12-31' } } };
const refs = () => ({
  ...productIndex(canonical),
  event: new Map([['/photographic-workshops-near-me/norfolk-event', '/photo-workshops-uk/norfolk'], ['/event-a', '/photo-workshops-uk/norfolk']]),
  campaigns: new Map(campaignRows.map((r) => [r.campaign_key, r])), initiatives: new Map([['gifts', gifts]])
});
/** A Targets-master shape with these Booking Sheet monthly category targets (all months the same). */
function masterOf(cats) {
  const per_tier = Object.entries(cats).map(([o, v]) => ({ category_order: Number(o), revenue_monthly: Array(12).fill(v), gp_monthly: Array(12).fill(v / 2) }));
  return { as_of: TODAY, this_month: { month: 11, survival: 1, stretch2: 2 }, money: { survival_annual: 12, stretch2_annual: 24, bills_line: 1 }, revenue_equivalent: { survival_annual: 24, survival_monthly: Array(12).fill(2) }, seasonal: { survival: Array(12).fill(1) }, gp_rates: {}, ytd: { survival: 0 }, funnel_targets: {}, sources: {}, per_tier };
}
const CATS = { 1: 600, 2: 1700, 3: 850, 6: 80, 7: 800, 10: 100, 11: 500, 12: 250 };
function summary(extra = {}) {
  const { campaign, qp } = plan();
  const service_mix = buildServiceMix({ mix: qp.purpose_mix, board, campaign, master: masterOf(CATS), refs: refs(), campaignTargets: extra.campaignTargets || null });
  return { quarter_plan: qp, campaign, service_mix };
}
function load() {
  const win = { calls: [] };
  const ctx = vm.createContext({ window: win, document: { getElementById: () => null, querySelector: () => null }, Intl, Date, Number, String, Map, Set, JSON, Math, Promise, Array, Object, RegExp, console, setTimeout });
  for (const f of ['../lib/marketing-channels-tile.js', '../lib/marketing-service-mix.js', '../lib/marketing-overview-tiles.js']) vm.runInContext(fs.readFileSync(new URL(f, import.meta.url), 'utf8'), ctx);
  win.mkScheduleFilterRefs = (r, label) => win.calls.push({ refs: [...r].sort(), label });
  return win;
}
const plain = (x) => JSON.parse(JSON.stringify(x));

test('links resolve through the product page, the event → product link, else a unique service page; other sites never', () => {
  const r = refs();
  assert.equal(pathOf(`${SITE}/Photo-Workshops-UK/Norfolk/?x=1`), '/photo-workshops-uk/norfolk');
  assert.equal(pathOf('https://youtube.com/shorts/abc'), null);
  assert.deepEqual(resolveLink(`${SITE}/photo-workshops-uk/woodland/`, r).row, 'workshops_nonres');
  assert.deepEqual(resolveLink(`${SITE}/photographic-workshops-near-me/norfolk-event`, r).row, 'workshops_residential');
  assert.equal(resolveLink(`${SITE}/photography-payment-plan`, r).row, 'pnm_academy');
  assert.equal(resolveLink(`${SITE}/old-retired`, r), null, 'retired products are not used');
  assert.equal(resolveLink('https://youtube.com/shorts/abc', r), null);
  assert.deepEqual([rowOfCategory('mentoring'), rowOfCategory('print'), rowOfCategory('commission'), rowOfCategory('academy'), rowOfCategory('adjustment')], ['services', 'prints', 'hire', 'pnm_academy', null]);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(rowOfNumber), ['courses', 'workshops_nonres', 'workshops_residential', 'pnm_academy', 'pnm_academy', 'services', 'services', 'gift_vouchers', 'gift_vouchers', 'prints', 'hire', 'pnm_academy']);
});

test('tags: own link first; then campaign categories, events, featured links, initiative target; several modules count once (primary), the rest secondary; nothing → Not service-specific with the reason', () => {
  const s = summary();
  const t = s.service_mix.tags;
  assert.equal(t['gpt-fb-1'].row, 'workshops_residential');
  assert.deepEqual([t['gpt-li-1'].row, t['gpt-li-1'].secondary.map((x) => x.row)], ['pnm_academy', ['services']], 'placement link wins; the featured 1-2-1 link is secondary');
  assert.deepEqual([t[EMAIL_STEP].row, t[EMAIL_STEP].secondary.map((x) => x.row)], ['workshops_residential', ['courses']], 'lead module = primary, second module secondary');
  assert.match(t['send|theme|gift'].via, /initiative "Gifts & Christmas revenue" target \(Booking Sheet 8\)/);
  assert.equal(t['send|theme|gift'].row, 'gift_vouchers');
  assert.equal(t['send|theme|cats'].row, 'courses', 'stored campaign categories');
  assert.deepEqual([t['send|theme|plain'].row, t['gpt-fb-yt'].row, t['video|short|a'].row], ['none', 'none', 'none']);
  assert.match(t['send|theme|plain'].via, /no link to a product or service page, no campaign categories or event/);
  assert.equal(t[GBP_STEP].row, 'workshops_residential', 'Google Business post page → event → product');
  assert.equal(tagOf({ key: 'x', own_links: [], links: [] }, refs()).row, 'none');
});

test('targets = Survival Cockpit tier targets; gift target from the gifts initiative; thresholds stored, else 0.5× / 1.5×', () => {
  const t = targetsOf(masterOf(CATS));
  assert.deepEqual(Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v.monthly])), { courses: 600, workshops_nonres: 1700, workshops_residential: 850, services: 880, hire: 600, pnm_academy: 250 });
  assert.equal(t.hire.categories.join('+'), '10+11', 'prints & royalties sit inside the cockpit\'s Hire / Commercial target');
  assert.deepEqual(plain(giftTargetOf([gifts])), { title: 'Gifts & Christmas revenue', total: 2100, from: '2026-11-01', to: '2026-12-31' });
  assert.deepEqual([thresholdsOf(null).under, thresholdsOf(null).over], [0.5, 1.5]);
  assert.match(thresholdsOf(null).source, /default/);
  const stored = thresholdsOf({ service_mix: { under_share_ratio: 0.6, over_share_ratio: 2 } }, '2026-11-12');
  assert.deepEqual([stored.under, stored.over], [0.6, 2]);
  assert.match(stored.source, /stored setting \(business_targets\.campaign_targets\.service_mix, 2026-11-12\)/);
  assert.deepEqual(SERVICE_ROWS.map((r) => r.key), ['workshops_residential', 'workshops_nonres', 'courses', 'gift_vouchers', 'pnm_academy', 'services', 'hire', 'prints', 'none']);
});

test('tile model: the by-channel tile\'s items (Sched + Waiting; drafts apart; sent never); total = the by-channel total; % of target sums to 100; flags', () => {
  const win = load();
  const s = summary();
  const ch = plain(win.mkChannels.build(s, board, TODAY));
  const byChannelTotal = ch.rows.reduce((t, r) => t + r.sched + r.waiting, 0);
  const m = plain(win.mkServiceMix.build(s, board, TODAY));
  assert.equal(m.total, byChannelTotal);
  assert.equal(m.rows.reduce((t, r) => t + r.n, 0), byChannelTotal, 'every counted item is in exactly one tier row');
  const row = (k) => m.rows.find((r) => r.key === k);
  assert.deepEqual(row('workshops_residential').by, { email: 1, facebook: 1, instagram: 1, instagram_story: 0, linkedin: 0, gbp: 1, youtube: 0 });
  assert.deepEqual([row('none').n, row('gift_vouchers').n, row('gift_vouchers').drafts.length], [4, 1, 2], 'YouTube-only post (FB + IG), the untagged email and the Short; gift draft FB + IG in the hover only');
  assert.ok(!m.rows.some((r) => r.items.some((i) => i.ref === 'send|theme|sent')), 'sent emails never counted');
  const targeted = m.rows.filter((r) => r.target_pct != null);
  assert.equal(targeted.length, 6);
  assert.equal(targeted.reduce((t, r) => t + r.target_pct, 0), 100);
  assert.ok(Math.abs(targeted.reduce((t, r) => t + r.target_share, 0) - 1) < 1e-9);
  assert.deepEqual(Object.fromEntries(m.rows.map((r) => [r.key, r.flag])), { workshops_residential: 'over', workshops_nonres: 'under', courses: 'ok', gift_vouchers: null, pnm_academy: 'over', services: 'gap', hire: 'gap', prints: 'gap', none: null });
  assert.deepEqual([win.mkServiceMix.pctOf([1, 1, 1]), win.mkServiceMix.pctOf([0, 0])].map(plain), [[34, 33, 33], [0, 0]]);
});

test('stored thresholds change the flags (no hand-maintained lists)', () => {
  const m = plain(load().mkServiceMix.build(summary({ campaignTargets: { service_mix: { under_share_ratio: 0.2, over_share_ratio: 4 } } }), board, TODAY));
  assert.deepEqual([m.rows.find((r) => r.key === 'workshops_nonres').flag, m.rows.find((r) => r.key === 'workshops_residential').flag], ['ok', 'ok']);
});

test('tile HTML: A rows = B row totals; amber 0 cells; gift "—*" with the Nov–Dec target; hovers list items, drafts and the reason; no tags → Not service-specific', () => {
  const win = load();
  const html = win.mkServiceMixTilesHtml(summary(), board, TODAY);
  const a = Object.fromEntries([...html.matchAll(/data-mksv-row="([a-z_]+)" title="[^"]*"><td[^>]*>.*?<\/td><td class="left">.*?<\/td><td class="[^"]*">(\d+)<\/td>/g)].map((x) => [x[1], Number(x[2])]));
  const b = {};
  for (const x of html.matchAll(/data-mksv-cell="([a-z_]+):([a-z_]+)" title="[^"]*">(\d+)</g)) b[x[1]] = (b[x[1]] || 0) + Number(x[3]);
  assert.equal(Object.keys(a).length, 9);
  for (const k of Object.keys(b)) assert.equal(b[k], a[k], `${k}: tile A items = tile B row total`);
  assert.deepEqual(Object.keys(b), SERVICE_ROWS.filter((r) => r.key !== 'none').map((r) => r.key), 'tile B: the eight tiers');
  assert.match(html, /<td class="z" data-mksv-open="cell:services:email"/);
  assert.match(html, /<td class="mksv-m" title="Gift vouchers are not in the monthly tier targets: they carry the separate £2\.1k Sun 1 Nov → Thu 31 Dec target \(&quot;Gifts &amp; Christmas revenue&quot;\)\.">—\*<\/td>/);
  const tipOf = (k) => html.match(new RegExp(`data-mksv-row="${k}" title="([^"]*)"`))[1];
  assert.match(tipOf('gift_vouchers'), /Drafts \(not counted\): 2/);
  assert.match(tipOf('workshops_residential'), /also: Courses \(secondary, not counted\)/);
  assert.match(tipOf('none'), /why: no link to a product or service page/);
  assert.match(tipOf('none'), /To fix: give the post a product link, store the campaign's Booking Sheet categories|To fix: give the post a product link, store the campaign&#39;s Booking Sheet categories/);
  assert.match(html, /<span class="mksv-flag under" data-mksv-flag="under">under-promoted<\/span>/);
  assert.match(html, />Next 12 weeks: what we're promoting, by service<|>Next 12 weeks: what we&#39;re promoting, by service</);
  assert.match(html, />Service × channel coverage</);
});

test('clicks: a row or a cell filters the schedule to exactly those items', () => {
  const win = load();
  win.mkServiceMixTilesHtml(summary(), board, TODAY);
  assert.equal(win.mkServiceMixOpen('row:workshops_residential'), true);
  assert.equal(win.mkServiceMixOpen('cell:workshops_residential:facebook'), true);
  assert.equal(win.mkServiceMixOpen('row:nope'), false);
  assert.deepEqual(plain(win.calls), [
    { refs: [GBP_STEP, 'gpt-fb-1', EMAIL_STEP].sort(), label: 'Workshops (Residential)' },
    { refs: ['gpt-fb-1'], label: 'Workshops (Residential) · FB' }
  ]);
});

test('placement: the row under row 1 (6c wide, 6d), existing tiles unchanged and in order; layout at each width; loading until the board arrives', () => {
  const win = load();
  const s = { ...summary(), actions: [], campaign: { ...summary().campaign, campaigns: [], step_status: {} } };
  const d = { meter: { state: 'never_read' }, identity: {}, runs: {}, tiles: { cleanup: { frozen: [] } }, engagement: {} };
  const html = win.mkOverviewTiles.gridHtml({ d, s, health: { state: 'loading' }, board });
  const titles = [...html.matchAll(/<div class="mko-title"[^>]*>([^<]+)</g)].map((x) => x[1].trim());
  assert.deepEqual(titles, ['Next 12 weeks: content mix', 'Next 12 weeks: by channel', 'Email capacity', 'Eligible audience', 'Next 12 weeks: what we&#39;re promoting, by service', 'Service × channel coverage', 'Data &amp; alignment health', 'Needs Alan'].map((t) => t.replace('&#39;', "'")));
  assert.match(html, /@container mko \(min-width: 65rem\) \{[^}]*\}[^@]*\.mko \.mko-grid\.c5 > \.mksv-a \{ grid-column: span 3; \} \.mko \.mko-grid\.c5 > \.mksv-b \{ grid-column: span 2; \}/);
  assert.match(html, /\.mko \.mko-grid\.c5\.c5 \{ grid-auto-flow: row dense; \} \.mko \.mko-grid\.c5 > \.mksv \{ grid-column: span 3; \}/, 'medium: 6c and 6d take full rows; tile 10 stays after 9');
  const loading = win.mkOverviewTiles.gridHtml({ d, s, health: { state: 'loading' }, board: undefined });
  assert.match(loading, /id="mk-service-a"><div class="mko-num">6c<\/div><div class="mko-title">Next 12 weeks: what we're promoting, by service<\/div><div class="mko-head"><span class="mko-loading">Loading…<\/span>/);
  assert.match(win.mkServiceMixTilesHtml({ service_mix: { error: 'boom' } }, board, TODAY), /<span class="mko-loading">boom<\/span>/);
});
