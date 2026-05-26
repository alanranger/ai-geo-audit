// Unified revenue model for CTR / rank cards (2026-05-26 phase K-3).
//
// User defect: two revenue engines on one dashboard. AIO cards ran
// the probabilistic stack (volume \u00d7 P(win) \u00d7 click capture \u00d7 AOV
// \u00d7 conversion rate \u00d7 GP%) with a full assumption stack. CTR / rank
// cards ran a legacy AOV_PER_CLICK constant that baked TRUE_AOV \u00d7
// 1% conversion into a single round number per tier \u2014 happened to
// be roughly right for courses (\u00a32 = \u00a3200 \u00d7 1%) but wrong by
// ~10x for academy (\u00a30.8 vs the real two-step funnel \u00a30.084),
// and the conversion-rate step was completely invisible so the
// \u00a339/mo headline had no auditable derivation.
//
// Fix: liftRangeForOnPageMove() runs the same TRUE_AOV \u00d7 convRate
// \u00d7 GP% pipeline as liftRange(), returns the same assumption-stack
// shape, and is now used by ctrPriorityForTier + rankPriorityForTier.
// These tests pin:
//   1. courses tier headline unchanged (legacy 2.0 = 200 \u00d7 0.01),
//   2. academy tier headline drops ~10x (two-step funnel kicks in),
//   3. assumption stack carries a visible conversion-rate row with
//      assumed=true flag (so the dashboard ASSUMED badge propagates),
//   4. academy stack carries the trial-funnel rows.

import test from 'node:test';
import assert from 'node:assert/strict';
import { liftRangeForOnPageMove } from '../lib/revenue-funnel-aio-model.js';

const ACADEMY_TRIAL_FUNNEL = {
  signupRate: 0.027,
  paidRate: 0.043,
  effectiveAov: 73,
  priceBlend: { full: 79, discount: 59, fullShare: 0.7, discountShare: 0.3 },
  signupRateMeasured: false,
  paidRateMeasured: false,
  priceBlendMeasured: false
};

test('courses tier: rank-lift revenue identical to legacy (2.0 \u00d7 GP%)', () => {
  const r = liftRangeForOnPageMove({
    incrementalClicks: 100,
    aov: 200,
    conversionRate: 0.01,
    gpPct: 90,
    conversionRateMeasured: false
  });
  assert.equal(r.revenue.expected, 200);
  assert.equal(r.profit.expected, 180);
  assert.equal(r.model, 'single_step_booking');
});

test('academy tier: per-click GP drops to \u00a30.084 \u00d7 100 = \u00a38 (not \u00a380)', () => {
  const r = liftRangeForOnPageMove({
    incrementalClicks: 100,
    aov: 73,
    conversionRate: 1,
    gpPct: 99,
    trialFunnel: ACADEMY_TRIAL_FUNNEL,
    conversionRateMeasured: false
  });
  assert.equal(r.profit.expected, 8);
  assert.equal(r.model, 'two_step_trial_funnel');
});

test('single-step stack: visible booking-conversion row with assumed=true', () => {
  const r = liftRangeForOnPageMove({
    incrementalClicks: 100,
    aov: 200,
    conversionRate: 0.01,
    gpPct: 90,
    conversionRateMeasured: false
  });
  const labels = r.assumption_stack.map(row => row.label);
  assert.ok(labels.includes('Tier AOV (avg booking)'), `expected Tier AOV row, got ${labels.join(' | ')}`);
  assert.ok(labels.includes('Booking conversion rate'), `expected conversion-rate row, got ${labels.join(' | ')}`);
  assert.ok(labels.includes('Revenue per click'), `expected derived per-click row, got ${labels.join(' | ')}`);
  assert.ok(labels.includes('Tier GP%'), `expected GP% row, got ${labels.join(' | ')}`);
  const convRow = r.assumption_stack.find(row => row.label === 'Booking conversion rate');
  assert.equal(convRow.assumed, true);
  assert.equal(r.conv_flag.assumed, true);
});

test('single-step stack: conversion row NOT flagged when conversionRateMeasured=true', () => {
  const r = liftRangeForOnPageMove({
    incrementalClicks: 100,
    aov: 200,
    conversionRate: 0.01,
    gpPct: 90,
    conversionRateMeasured: true
  });
  const convRow = r.assumption_stack.find(row => row.label === 'Booking conversion rate');
  assert.equal(convRow.assumed, false);
  assert.equal(r.conv_flag.assumed, false);
});

test('two-step stack: trial signup + paid + effective AOV rows present, all assumed', () => {
  const r = liftRangeForOnPageMove({
    incrementalClicks: 100,
    aov: 73,
    conversionRate: 1,
    gpPct: 99,
    trialFunnel: ACADEMY_TRIAL_FUNNEL,
    conversionRateMeasured: false
  });
  const labels = r.assumption_stack.map(row => row.label);
  assert.ok(labels.includes('Trial signup rate'));
  assert.ok(labels.includes('Trial-to-paid rate'));
  assert.ok(labels.some(l => l.startsWith('Effective AOV')));
  assert.ok(labels.includes('Revenue per click'));
  assert.ok(labels.includes('Tier GP%'));
  for (const labelName of ['Trial signup rate', 'Trial-to-paid rate']) {
    const row = r.assumption_stack.find(x => x.label === labelName);
    assert.equal(row.assumed, true, `${labelName} should be flagged assumed`);
  }
});

test('on-page move stack omits AIO-specific rows (pWin, capture, organic-click join)', () => {
  const r = liftRangeForOnPageMove({
    incrementalClicks: 100,
    aov: 200,
    conversionRate: 0.01,
    gpPct: 90,
    conversionRateMeasured: false
  });
  const labels = r.assumption_stack.map(row => row.label);
  assert.ok(!labels.some(l => /P\(win/i.test(l)),                 'pWin row must not appear on on-page lift cards');
  assert.ok(!labels.some(l => /Click capture rate/i.test(l)),     'capture-rate row must not appear');
  assert.ok(!labels.some(l => /organic-click conversion join/i.test(l)), 'AIO-click \u2194 organic-click join must not appear');
  const volumeRow = r.assumption_stack[0];
  assert.match(volumeRow.label, /Incremental clicks/);
});

test('seasonality scales headline but unscaled preserved', () => {
  const r = liftRangeForOnPageMove({
    incrementalClicks: 100,
    aov: 200,
    conversionRate: 0.01,
    gpPct: 90,
    seasonalityFactor: 0.5,
    conversionRateMeasured: false
  });
  assert.equal(r.revenue.expected, 100);
  assert.equal(r.revenue.expected_unscaled, 200);
  const seasRow = r.assumption_stack.find(row => row.label === 'Seasonality factor');
  assert.ok(seasRow);
  assert.equal(seasRow.value, 0.5);
});
