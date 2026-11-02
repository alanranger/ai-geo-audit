/**
 * Pre-send sense-check (batch 8 task 8). Replays the real 2 Nov figures: the broken morning run (scores 16/23,
 * top-10 15, 1,174 of 2,023 owner slots on google.com, 55 stale reds) must hold; the corrected run (33/41,
 * top-10 39, 5 of 1,871 on google.com, no stale findings) must pass. Previous week = 26 Oct (29/35, top-10 41).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { assessBriefGate } from '../lib/ceo-weekly/brief-gate.js';
import { BRIEF_GATE } from '../lib/ceo-weekly/brief-gate-config.js';
import { finalOutcome } from '../api/cron/ceo-weekly-full-refresh.js';
import { isHaltRequested } from '../lib/ceo-weekly/monday-ranking-guards.js';

const rowsWithOwners = (google, total) => {
  const owners = Array.from({ length: total }, (_, i) => ({ domain: i < google ? 'google.com' : `site${i}.co.uk`, position: 1, ours: false }));
  return [{ serp_surface_stack: [{ type: 'organic', owners }] }];
};
const STEPS = BRIEF_GATE.requiredSteps.map((key) => ({ key, ok: true }));
const RUN_START = '2026-11-02T09:30:03Z';
const stale = Array.from({ length: 55 }, (_, i) => ({ check_id: i < 35 ? 'A2' : 'A3', severity: 'red', last_checked: '2026-10-30T21:32:44Z' }));
const previous = { surface_visibility_score: 29, top_of_page_score: 35, top10: 41, ranking_quality: 'complete' };

const broken = {
  current: { surface_visibility_score: 16, top_of_page_score: 23, top10: 15, ranking_quality: 'complete' },
  previous, rankingRows: rowsWithOwners(1174, 2023), shownFindings: stale, latestFullRunStart: RUN_START, steps: STEPS,
};
const corrected = {
  current: { surface_visibility_score: 33, top_of_page_score: 41, top10: 39, ranking_quality: 'complete' },
  previous, rankingRows: rowsWithOwners(5, 1871),
  shownFindings: [{ check_id: 'D5', severity: 'amber', last_checked: '2026-11-02T11:43:50Z' }], latestFullRunStart: RUN_START, steps: STEPS,
};

test('broken 2 Nov morning data is held, for every reason that applied', () => {
  const g = assessBriefGate(broken);
  assert.equal(g.held, true);
  assert.deepEqual(g.failures.map((f) => f.id).sort(), ['dial_move_surface_visibility_score', 'dial_move_top_of_page_score', 'findings_current', 'owner_domain_google', 'top10_drop'].sort());
});

test('corrected 2 Nov data passes', () => {
  const g = assessBriefGate(corrected);
  assert.equal(g.held, false, JSON.stringify(g.failures));
});

test('incomplete ranking and a brief source that did not refresh each hold on their own', () => {
  assert.deepEqual(assessBriefGate({ ...corrected, current: { ...corrected.current, ranking_quality: 'incomplete' } }).failures.map((f) => f.id), ['ranking_quality_complete']);
  const noGa4 = STEPS.map((s) => (s.key === 'ga4_sync' ? { ...s, ok: false } : s));
  const g = assessBriefGate({ ...corrected, steps: noGa4 });
  assert.deepEqual(g.failures.map((f) => f.id), ['sources_refreshed']);
  assert.match(g.failures[0].detail, /ga4_sync/);
});

test('thresholds come from config', () => {
  assert.equal(assessBriefGate(broken, { ...BRIEF_GATE, maxDialMoveShare: 0.9, maxTop10DropShare: 0.9, maxGoogleOwnerShare: 0.9 }).failures.map((f) => f.id).join(), 'findings_current');
});

test('a held brief is a terminal state for the Monday refresh (no re-send loop)', () => {
  assert.equal(finalOutcome({ failed_keys: [], email_held: true }).state, 'held');
  assert.equal(finalOutcome({ failed_keys: [], email_sent: true }).state, 'done');
  assert.equal(isHaltRequested({ state: 'held' }, { email_held: true }), true);
  assert.equal(isHaltRequested({ state: 'running' }, { email_held: false }), false);
});
