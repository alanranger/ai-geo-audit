// Academy two-step trial-funnel test (2026-05-26 phase K-2).
//
// Guards the corrected academy economics the user supplied after
// finding an arithmetic error in the assistant's first attempt:
//
//   trial signup rate   2.7% (16/588 GSC clicks, 28d)
//   trial-to-paid rate  4.3% (9/208 all-time)
//   effective AOV       £73  (70/30 blend of £79/£59)
//   academy GP%         99%  (digital subscription, no delivery cost)
//   => revenue/click    0.027 \u00d7 0.043 \u00d7 73       = £0.0847
//   => GP/click         0.027 \u00d7 0.043 \u00d7 73 \u00d7 0.99 = £0.0839
//
// The previous attempt mis-applied a 6.0% paid rate and reported
// £0.117/click. The headline GP figure on the academy card therefore
// scales linearly off the corrected per-click value; this test pins
// it so future model changes can't silently re-break the arithmetic.
//
// The test also asserts the assumption stack carries every row the
// user demanded (signup, paid, blended AOV, AIO-click \u2194 organic-click
// conversion join), every two-step input is ASSUMED-flagged until
// measured, and the lift model field reads `two_step_trial_funnel`
// (which the dashboard combined-headline ASSUMED badge keys off).

import test from 'node:test';
import assert from 'node:assert/strict';
import { __INTERNAL } from '../api/aigeo/revenue-funnel-smart-priorities.js';
import { liftRange } from '../lib/revenue-funnel-aio-model.js';

const ACADEMY_URL = 'https://www.alanranger.com/free-online-photography-course';

function buildAcademyKeywordSnapshot() {
  const base = { segment: 'money', has_ai_overview: true };
  return [
    { ...base, keyword: 'free online photography course',    search_volume: 880, best_rank_group: 5, ai_alan_citations_count: 0, ai_total_citations: 8,  best_url: ACADEMY_URL },
    { ...base, keyword: 'online photography course',         search_volume: 2400, best_rank_group: 2, ai_alan_citations_count: 0, ai_total_citations: 12, best_url: ACADEMY_URL },
    { ...base, keyword: 'photography academy online',        search_volume: 30,  best_rank_group: 1, ai_alan_citations_count: 1, ai_total_citations: 6,  best_url: ACADEMY_URL }
  ];
}

function emptySchemaDetail() {
  return new Map([[ACADEMY_URL, { schemaTypes: new Set(['Organization', 'WebPage']), title: null, h1: null }]]);
}

function ctxFor(keywords) {
  return {
    schemaDetail: emptySchemaDetail(),
    keywords,
    allKeywords: keywords,
    targetKeywordOverrides: null
  };
}

// Direct check of the liftRange arithmetic with the trial funnel
// inputs — independent of the picker, so any regression in the per-
// click maths shows up here even if the picker stops routing through
// the trial funnel.
test('liftRange with academy trial funnel yields £0.084/click rev (corrected per-user arithmetic)', () => {
  const range = liftRange({
    volume: 1000, pWin: 1, captureRate: 1,
    gpPct: 99,
    trialFunnel: {
      signupRate: 0.027,
      paidRate: 0.043,
      effectiveAov: 73,
      priceBlend: { full: 79, discount: 59, fullShare: 0.7, discountShare: 0.3 },
      signupRateMeasured: false,
      paidRateMeasured: false,
      priceBlendMeasured: false
    }
  });
  const expectedRevPerClick = 0.027 * 0.043 * 73;
  const expectedRev = Math.round(1000 * 1 * 1 * expectedRevPerClick);
  assert.equal(range.revenue.expected, expectedRev, 'revenue/click x 1000 clicks must equal 1000 \u00d7 0.027 \u00d7 0.043 \u00d7 73');
  const expectedGp = Math.round(1000 * 1 * 1 * expectedRevPerClick * 0.99);
  assert.equal(range.profit.expected, expectedGp, 'gp = rev \u00d7 0.99 (academy GP%)');
  assert.equal(range.model, 'two_step_trial_funnel', 'lift model must be tagged so dashboard ASSUMED badge can key off it');
});

test('academy card uses two-step trial funnel (not single-step £79 \u00d7 1% booking)', () => {
  const keywords = buildAcademyKeywordSnapshot();
  const candidate = __INTERNAL.aioCitationPriority('academy', keywords, ctxFor(keywords));
  assert.ok(candidate, 'aioCitationPriority should return a candidate for the academy page');
  assert.equal(candidate.aio_lift_model, 'two_step_trial_funnel', 'academy candidate must report the two-step model on the card');
});

test('academy assumption stack contains every row the user mandated, in order', () => {
  const keywords = buildAcademyKeywordSnapshot();
  const candidate = __INTERNAL.aioCitationPriority('academy', keywords, ctxFor(keywords));
  const stack = candidate.aio_assumption_stack;
  assert.ok(Array.isArray(stack), 'aio_assumption_stack must be an array');
  const labels = stack.map(r => String(r.label));
  // Volume row must carry the "(incremental)" qualifier so it's clear
  // it's modelled AIO uplift, not the page's existing organic volume.
  assert.ok(labels[0].includes('incremental'), 'first row must be AIO query volume tagged as incremental');
  // Two-step inputs must each appear as their own row.
  assert.ok(labels.some(l => /Trial signup rate/i.test(l)), 'stack must contain Trial signup rate row');
  assert.ok(labels.some(l => /Trial-to-paid rate/i.test(l)), 'stack must contain Trial-to-paid rate row');
  assert.ok(labels.some(l => /Effective AOV.*blend/i.test(l)), 'stack must contain Effective AOV (blended) row');
  // The organic\u2194AIO conversion join is the row the user demanded be
  // visible so the per-click value isn't silently multiplied by a
  // hypothetical-traffic multiplier.
  assert.ok(labels.some(l => /conversion join/i.test(l)), 'stack must contain explicit AIO-click \u2194 organic-click conversion join row');
  assert.ok(labels.some(l => /Revenue per click/i.test(l)), 'stack must contain derived Revenue per click row');
  assert.ok(labels.some(l => /Tier GP/i.test(l)), 'stack must contain Tier GP% row');
});

test('academy two-step inputs are flagged ASSUMED until measured', () => {
  const keywords = buildAcademyKeywordSnapshot();
  const candidate = __INTERNAL.aioCitationPriority('academy', keywords, ctxFor(keywords));
  const stack = candidate.aio_assumption_stack;
  const signup = stack.find(r => /Trial signup rate/i.test(r.label));
  const paid = stack.find(r => /Trial-to-paid rate/i.test(r.label));
  const aov = stack.find(r => /Effective AOV/i.test(r.label));
  const join = stack.find(r => /conversion join/i.test(r.label));
  assert.equal(signup.assumed, true, 'Trial signup rate must be ASSUMED-flagged');
  assert.equal(paid.assumed, true, 'Trial-to-paid rate must be ASSUMED-flagged');
  assert.equal(aov.assumed, true, 'Effective AOV must be ASSUMED-flagged (price split user-supplied, not in Stripe)');
  assert.equal(join.assumed, true, 'AIO-click \u2194 organic-click conversion join must be ASSUMED-flagged');
  assert.equal(candidate.aio_conv_flag.assumed, true, 'top-level conv_flag must aggregate to ASSUMED while any trial-funnel input is unmeasured');
});

test('academy stack uses the corrected 4.3% paid rate and £73 blended AOV (not 6.0% and £79)', () => {
  const keywords = buildAcademyKeywordSnapshot();
  const candidate = __INTERNAL.aioCitationPriority('academy', keywords, ctxFor(keywords));
  const stack = candidate.aio_assumption_stack;
  const paid = stack.find(r => /Trial-to-paid rate/i.test(r.label));
  const aov = stack.find(r => /Effective AOV/i.test(r.label));
  assert.equal(Number(paid.value), 0.043, 'paid rate must be the corrected all-time 9/208 = 4.3% \u2014 not the rejected 6.0% guess');
  assert.equal(Number(aov.value), 73, 'effective AOV must be the £73 blend \u2014 not the hardcoded £79');
});
