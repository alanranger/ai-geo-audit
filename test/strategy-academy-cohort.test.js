/**
 * Q2 Academy cohort linked to academy_trial_history (counts only) and no bare "Target not set" / "Needs review".
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TRIAL_SOURCE, cohortLines, trialCohort } from '../lib/strategy-academy-cohort.mjs';
import { assemblePlan } from '../lib/strategy-initiatives.mjs';

const rows = [
  { start: '2026-11-05', converted: null }, { start: '2026-09-01', converted: '2026-09-20' },
  { start: '2026-07-01', converted: '2026-07-10' }, { start: '2026-06-01', converted: null }, { start: '2026-05-20', converted: null },
  { start: '2026-04-01', converted: '2026-04-02' }
];

test('90-day cohort: last 90 days (open) and the last complete 90 days, counts only', () => {
  const c = trialCohort(rows, '2026-11-09');
  assert.deepEqual(c.recent, { from: '2026-08-12', to: '2026-11-09', started: 2, converted: 1, rate: 50 });
  assert.deepEqual(c.complete, { from: '2026-05-14', to: '2026-08-11', started: 3, converted: 1, rate: 33.3 });
  const lines = cohortLines({ source: TRIAL_SOURCE, via: 'Academy Supabase (read-only)', cohort: c });
  assert.match(lines[0].value, /^3 trials started 14 May–11 Aug · 1 converted \(33\.3%\)$/);
  assert.match(lines[0].sub, /academy_trial_history/);
  assert.match(cohortLines({ error: 'timeout' })[0].value, /unavailable: timeout/);
});

const ini = (k, extra = {}) => ({ initiative_key: k, kind: 'initiative', title: k, quarter_keys: ['q1'], owner: 'GPT', review_date: '2026-11-16', status_rule: { type: 'not_set' }, focus: {}, ...extra });
function plan(academyCohort) {
  return assemblePlan({
    today: '2026-11-09', txns: [], gpRates: [], master: {}, diary: [], actions: [], insights: null, roadmap: [], roadmapNow: {}, pnm: {}, courseLastNights: [], assets: [], links: [], campaignRows: [],
    campaign: { weeks: [{ week: '2026-11-09', steps: [] }], campaigns: [] }, academyCohort,
    initiatives: [
      ini('near', { status_rule: { type: 'not_set', proposal: { owner: 'Claude', due: '2026-11-11', basis: 'per Claude question 2026-11-09 (g) item 4' } } }),
      ini('q2-academy', { owner: 'Claude', measure: 'academy', status_label: 'Planned', next_action: 'Define the 90-day trial cohort', next_action_date: '2026-12-14', focus: { data_source: TRIAL_SOURCE, cohort_days: 90 } }),
      ini('prog-learning-relationships', { kind: 'programme' }), ini('housekeeping', { kind: 'housekeeping', status_rule: { type: 'none' } })
    ],
    quarters: [{ quarter_key: 'q1', label: 'Q1', start_date: '2026-10-01', end_date: '2026-12-31', initiative_keys: ['near', 'q2-academy'], programme_key: 'prog-learning-relationships', housekeeping_key: 'housekeeping' }]
  });
}

test('no target: "Target: Claude proposal due Wed 11 Nov" on the chip and the target line, with owner and basis', () => {
  const p = plan(null);
  const n = p.initiatives.near;
  assert.equal(n.status.label, 'Target: Claude proposal due Wed 11 Nov');
  assert.equal(n.revenue.proposal_line, 'Target: Claude proposal due Wed 11 Nov');
  assert.deepEqual([n.unknown_target.owner, n.unknown_target.due, n.unknown_target.basis], ['Claude', '2026-11-11', 'per Claude question 2026-11-09 (g) item 4']);
  assert.ok(Object.values(p.initiatives).every((i) => !/^(Target not set|Needs review)$/.test(i.status?.label || '')));
});

test('Q2 Academy cohort is linked to academy_trial_history: measure lines + next action labelled with the data source', () => {
  const a = plan({ source: TRIAL_SOURCE, via: 'copy stored by the last customer rebuild', cohort: trialCohort(rows, '2026-11-09') }).initiatives['q2-academy'];
  assert.equal(a.measure.data_source, TRIAL_SOURCE);
  assert.match(a.measure.lines[0].label, /90-day trial cohort/);
  assert.equal(a.next.source, 'manual');
  assert.equal(a.next.data_source, TRIAL_SOURCE);
});

test('Strategy header: the plan document link is gone (never the homepage)', () => {
  const src = fs.readFileSync(new URL('../lib/strategy-tab.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /href="https:\/\/www\.alanranger\.com"[^>]*>plan document/);
});
