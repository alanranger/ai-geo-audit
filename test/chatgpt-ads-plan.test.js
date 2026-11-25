import test from 'node:test';
import assert from 'node:assert/strict';
import { adsBriefLine } from '../lib/acquisition/chatgpt-ads-sync.js';
import { adsCardModel, displayState, figuresText } from '../lib/acquisition/chatgpt-ads-card.js';

const GIFT = {
  id: 'cmpn_4d7a58c3b7708192b3402d805deb2e85',
  name: 'UK-wide — Photography services & destination workshops — DRAFT',
  status: 'active',
  start_time: 1795510800,
  end_time: 1795910340,
  budget: { daily_spend_limit_micros: 15000000 },
  targeting: { locations: { include: [{ type: 'country', country_code: 'GB', name: 'United Kingdom' }] } }
};
const GROUP = {
  id: 'adgrp_4faa1b24f58c8192b0c2334a5a090ccd',
  campaign_id: GIFT.id,
  name: 'Gift vouchers',
  status: 'active',
  bidding_config: { max_bid_micros: 1000000, strategy: 'fixed_bid' }
};
const NOW = new Date('2026-11-25T12:00:00Z');
const AFTER = new Date('2026-11-29T00:00:00Z');

test('status comes from the provider field, and the end time ends the flight', () => {
  assert.equal(displayState(GIFT, NOW), 'active');
  assert.equal(displayState({ ...GIFT, name: 'anything DRAFT' }, NOW), 'active');
  assert.equal(displayState(GIFT, AFTER), 'ended');
  assert.equal(displayState({}, NOW), 'unavailable');
});

test('a sync payload keeps its synced_at, and spend is pounds', () => {
  const view = adsCardModel({
    campaigns: [GIFT], groups: [GROUP], synced_at: '2026-11-25T12:19:56Z',
    report: { data: [{ impressions: 2537, clicks: 20, spend: 17.15, conversions: 0 }] }, now: NOW
  });
  assert.equal(view.synced_at, '2026-11-25T12:19:56Z');
  assert.equal(view.figures.includes('2,537') || view.figures.includes('2537'), true);
  assert.equal(view.figures.includes('£17.15'), true);
});

test('an empty ads report is unavailable, not zero', () => {
  const text = figuresText({ data: [] }, null);
  assert.equal(text.includes('unavailable'), true);
  assert.equal(text.includes('0'), false);
  assert.equal(text.includes('never'), true);
});

test('the active campaign is listed from its fields and the old ones stay historical', () => {
  const view = adsCardModel({
    campaigns: [
      { id: 'cmpn_5dfb74726ce481a289954d70a1b11b11', name: 'UK Gifts and Academy', status: 'paused' },
      GIFT
    ],
    groups: [GROUP],
    syncedAt: '2026-11-25T11:00:00Z',
    report: { data: [] },
    now: NOW
  });
  assert.equal(view.heading, 'active');
  assert.equal(view.current.length, 1);
  assert.equal(view.current[0].title, 'Gift vouchers');
  assert.equal(view.current[0].state, 'active');
  assert.equal(view.current[0].place, 'UK only');
  assert.equal(view.current[0].budget, '£15');
  assert.equal(view.current[0].bid, '£1');
  assert.equal(view.current[0].groups.includes('adgrp_4faa1b24f58c8192b0c2334a5a090ccd'), true);
  assert.equal(view.historical[0].state, 'paused');
  assert.equal(view.historical[0].note.includes('£400'), true);
  assert.equal(view.historical_note.includes('£546 paid'), true);
});

test('no synced campaigns does not default to paused', () => {
  const view = adsCardModel({ statusError: 'OPENAI_ADS_SDK_KEY is not set' });
  assert.equal(view.heading, 'unavailable');
  assert.equal(view.current.length, 0);
  assert.equal(view.historical.length, 2);
  assert.equal(view.historical[0].note.includes('Not a live read'), true);
  assert.equal(JSON.stringify(view).includes('PAUSED since'), false);
});

test('the Monday brief flags a failed sync and a day of empty reporting', () => {
  assert.equal(adsBriefLine(null).state, 'warn');
  assert.equal(adsBriefLine({
    synced_at: '2026-11-25T08:30:00Z',
    status_error: null,
    campaigns: [GIFT],
    report_empty_since: '2026-11-25T11:00:00Z'
  }, NOW).state, 'ok');
  assert.equal(adsBriefLine({
    synced_at: '2026-11-25T08:30:00Z',
    status_error: null,
    campaigns: [GIFT],
    report_empty_since: '2026-11-24T08:00:00Z'
  }, NOW).text.includes('empty for more than 24 hours'), true);
});
