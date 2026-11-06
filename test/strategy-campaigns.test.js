import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOverrides, buildCampaignRecords, eventKeyOf, sendsFromRecords, windowSales } from '../lib/strategy-campaigns.mjs';
import { buildMoments, campaignWeeks, DEFAULT_CAMPAIGN_RULES } from '../lib/strategy-moments.mjs';
import { overrideRow, stageRow } from '../api/aigeo/strategy-campaigns.js';

const TODAY = '2026-11-06';
const LT = { day: { announce_weeks: 6, main_push_weeks: 3, last_places_weeks: 1 } };
const EV = { date: '2026-11-28', title: 'Abstract and Macro', url: '/photographic-workshops-near-me/abstract-macro', kind: 'day', places_left: 4 };
const KEY = eventKeyOf(EV);

test('event key = date + page path, same for full URL and path', () => {
  assert.equal(KEY, '2026-11-28|/photographic-workshops-near-me/abstract-macro');
  assert.equal(eventKeyOf({ ...EV, url: 'https://www.alanranger.com/photographic-workshops-near-me/abstract-macro/' }), KEY);
});

test("don't promote drops every moment; the event stays in the event list", () => {
  const evs = applyOverrides([EV], { [KEY]: { promote_mode: 'dont_promote' } }, TODAY);
  assert.equal(evs.length, 1);
  assert.equal(buildMoments(evs, LT, TODAY).length, 0);
});

test('weekly adds one Weekly mention in each week without another moment, up to the event week', () => {
  const normal = buildMoments(applyOverrides([EV], {}, TODAY), LT, TODAY);
  const weekly = buildMoments(applyOverrides([EV], { [KEY]: { promote_mode: 'weekly' } }, TODAY), LT, TODAY);
  const weeks = new Set(weekly.map((m) => m.week));
  assert.ok(weekly.length > normal.length);
  assert.deepEqual([...weeks].sort(), ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']);
  assert.equal(weekly.filter((m) => m.moment === 'weekly').length, 4 - new Set(normal.map((m) => m.week)).size);
});

test('offer note shows until its end date, then disappears', () => {
  const o = { [KEY]: { promote_mode: 'normal', offer_note: '30% off', offer_code: 'LR30', offer_ends: '2026-11-08' } };
  assert.equal(applyOverrides([EV], o, TODAY)[0].offer.code, 'LR30');
  assert.equal(applyOverrides([EV], o, '2026-11-09')[0].offer, null);
  const steps = campaignWeeks(buildMoments(applyOverrides([EV], o, TODAY), LT, TODAY), TODAY, 4, DEFAULT_CAMPAIGN_RULES).flatMap((w) => w.steps);
  assert.ok(steps.some((s) => s.featured.some((f) => f.offer?.code === 'LR30')));
});

test('one weekly email record per week; sends counter counts only sent / measured emails', () => {
  const evs = applyOverrides([EV], {}, TODAY);
  const moments = buildMoments(evs, LT, TODAY);
  const weeks = campaignWeeks(moments, TODAY, 4, DEFAULT_CAMPAIGN_RULES);
  const rows = [{ campaign_key: 'email|2026-11-02', kind: 'weekly_email', title: 'x', stage: 'sent' }, { campaign_key: 'email|2026-11-09', kind: 'weekly_email', title: 'y', stage: 'approved' }];
  const recs = buildCampaignRecords({ weeks, moments, events: evs, leadTimes: LT, rows, txns: [], sheets: { courses: [], workshops: [], idxCourse: new Map(), idxWorkshop: new Map() }, ga4: [] });
  assert.equal(recs.filter((r) => r.kind === 'weekly_email').length, 4);
  assert.equal(recs.filter((r) => r.kind === 'event').length, 1);
  const s = sendsFromRecords(recs, TODAY, DEFAULT_CAMPAIGN_RULES);
  assert.equal(s.emails_sent, 1);
  assert.equal(s.sends, DEFAULT_CAMPAIGN_RULES.email.list_size);
});

test('window sales exclude JLR and redemptions', () => {
  const txns = [{ txn_date: '2026-11-06', amount: 100, category_order: 2 }, { txn_date: '2026-11-06', amount: 50, category_order: 9 }, { txn_date: '2026-11-06', amount: 70, category_order: 2, is_jlr: true }];
  assert.deepEqual(windowSales(txns, { start: '2026-11-01', end: '2026-11-07' }), { bookings: 1, revenue: 100 });
});

test('API validation: only the switch columns, known modes and stages', () => {
  const row = overrideRow({ event_key: KEY, promote_mode: 'weekly', offer_note: ' x ' }, 'p', 'now');
  assert.deepEqual(Object.keys(row).sort(), ['event_date', 'event_key', 'event_title', 'event_url', 'offer_code', 'offer_ends', 'offer_note', 'promote_mode', 'property_url', 'set_at', 'set_by', 'updated_at']);
  assert.equal(row.event_date, '2026-11-28');
  assert.throws(() => overrideRow({ event_key: KEY, promote_mode: 'spam' }, 'p', 'now'));
  assert.throws(() => stageRow({ campaign_key: 'email|w', kind: 'weekly_email', stage: 'posted' }, 'p', 'now'));
  assert.equal(stageRow({ campaign_key: 'email|w', kind: 'weekly_email', stage: 'blocked' }, 'p', 'now').stage, 'blocked');
});
