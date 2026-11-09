/**
 * Scan stability guards (Alan, 9 Nov 2026):
 * - "suspect: matching" (held from the dial history and the CEO brief): more than MATCHING_FAILURE_SHARE of
 *   organic / local-pack results still unresolved google.com links.
 * - "volatile capture" (note only, not held): more than VOLATILE_FLIP_RATE of comparable keywords flipped
 *   between #1–3 and not found. Real weeks flip 15–24%.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  scanFlipGuard, matchingGuard, cohortCompare, buildScanStability, withStabilityGuard, stabilityDetail,
  SUSPECT_MATCHING, MATCHING_FAILURE_SHARE, VOLATILE_FLIP_RATE,
} from '../lib/keyword-ranking/scan-stability-guard.js';
import { assessBriefGate } from '../lib/ceo-weekly/brief-gate.js';
import { BRIEF_GATE } from '../lib/ceo-weekly/brief-gate-config.js';
import { slimRankingForPersist } from '../lib/ceo-weekly/monday-ranking-guards.js';

const row = (i, rank, extra = {}) => ({
  keyword: `kw ${i}`, location_name: 'United Kingdom', best_rank_group: rank,
  serp_features: { capture_status: rank == null ? 'complete_no_match' : 'complete_ranked' }, ...extra,
});
const scan = (n, rankOf) => Array.from({ length: n }, (_, i) => row(i, rankOf(i)));
const prior = scan(94, () => 1);
/** 100 rows, each with one organic owner; the first `google` of them still on an unresolved google.com link. */
const stackScan = (google, rankOf = () => 1) => Array.from({ length: 100 }, (_, i) => row(i, rankOf(i), {
  serp_surface_stack: [
    { type: 'organic', owners: [{ domain: i < google ? 'www.google.com' : 'www.example.co.uk' }] },
    { type: 'ai_overview', owners: ['www.google.com'] },
  ],
}));
const scoreStub = () => ({ surface: 1, top: 1, measured: 94 });

test('suspect: matching fires when the unresolved google.com share is above MATCHING_FAILURE_SHARE', () => {
  const limit = Math.round(MATCHING_FAILURE_SHARE * 100);
  const over = matchingGuard(stackScan(limit + 1));
  assert.equal(over.total, 100);
  assert.equal(over.google, limit + 1);
  assert.equal(over.suspect, true);
  assert.match(over.reason, new RegExp(`^suspect: matching — ${limit + 1} of 100 organic / local-pack results still unresolved google\\.com links`));
  const atLimit = matchingGuard(stackScan(limit));
  assert.equal(atLimit.suspect, false);
  assert.equal(atLimit.reason, null);
  assert.equal(matchingGuard(stackScan(0)).google, 0, 'AI-overview google.com sources are not counted');
});

test('a flip rate above VOLATILE_FLIP_RATE is a volatile note only; a real-week 16% gives no note', () => {
  const over = Math.floor(94 * VOLATILE_FLIP_RATE) + 1;
  const v = scanFlipGuard(prior, scan(94, (i) => (i < over ? null : 1)));
  assert.equal(v.compared, 94);
  assert.equal(v.flipped, over);
  assert.equal(v.volatile, true);
  assert.match(v.note, new RegExp(`^volatile capture — ${over} of 94 keywords flipped`));
  assert.equal('suspect' in v, false, 'flips never mark the scan suspect');
  const realWeek = scanFlipGuard(prior, scan(94, (i) => (i < 15 ? null : 1)));
  assert.equal(realWeek.share, 0.16);
  assert.equal(realWeek.volatile, false);
  assert.equal(realWeek.note, null);
});

test('only #1–3 ↔ not found counts as a flip; moves within the page do not', () => {
  const g = scanFlipGuard(prior, scan(94, (i) => (i < 30 ? 8 : 1)));
  assert.equal(g.flipped, 0);
  assert.equal(g.volatile, false);
  const up = scanFlipGuard(scan(94, () => null), scan(94, (i) => (i < 30 ? 2 : null)));
  assert.equal(up.flipped, 30);
  assert.equal(up.volatile, true);
});

test('failed captures and keywords missing from either scan are not compared', () => {
  const cur = scan(94, (i) => (i < 20 ? null : 1)).map((r, i) => (i < 15 ? { ...r, serp_features: { capture_status: 'error' } } : r));
  const g = scanFlipGuard(prior, [...cur, row(500, null)]);
  assert.equal(g.compared, 79);
  assert.equal(g.flipped, 5);
  assert.equal(g.volatile, false);
});

test('like-for-like cohort scores both scans on the keywords they share', () => {
  const score = (rows) => ({ surface: rows.length, top: rows.length * 2, measured: rows.length });
  const lfl = cohortCompare(scan(155, () => 1), scan(94, () => 1), score);
  assert.equal(lfl.keywords, 94);
  assert.deepEqual(lfl.prior, { surface_visibility_score: 94, top_of_page_score: 188, measured: 94 });
  const s = buildScanStability({ priorAuditDate: '2026-11-02', priorRows: prior, currentRows: scan(94, () => 1), scoreFn: score });
  assert.equal(s.cohort.keywords, 94);
  assert.equal(s.cohort.like_for_like.keywords, 94);
  assert.equal(buildScanStability({ currentRows: [], scoreFn: score }).cohort.like_for_like, null);
});

test('a suspect: matching scan is held like a failed one, with the reason stored on the audit row', () => {
  const stability = buildScanStability({ priorAuditDate: '2026-11-02', priorRows: stackScan(0), currentRows: stackScan(70), scoreFn: scoreStub });
  const held = withStabilityGuard({ incomplete: false, ranking_quality: 'complete', checks: [] }, stability);
  assert.equal(held.incomplete, true);
  assert.equal(held.ranking_quality, SUSPECT_MATCHING);
  assert.equal(held.checks.at(-1).id, 'scan_stability');
  assert.match(held.reason, /^suspect: matching — 70 of 100/);
  const ok = withStabilityGuard({ incomplete: false, ranking_quality: 'complete' }, buildScanStability({ priorRows: prior, currentRows: prior, scoreFn: () => ({}) }));
  assert.equal(ok.ranking_quality, 'complete');
});

test('a volatile capture is not held: note in warnings and checks, flip list capped on the audit row', () => {
  const stability = buildScanStability({ priorAuditDate: '2026-11-02', priorRows: stackScan(0), currentRows: stackScan(0, (i) => (i < 40 ? null : 1)), scoreFn: scoreStub });
  const out = withStabilityGuard({ incomplete: false, ranking_quality: 'complete', checks: [], warnings: [] }, stability);
  assert.equal(out.incomplete, false);
  assert.equal(out.ranking_quality, 'complete');
  assert.match(out.warnings.at(-1), /^volatile capture — 40 of 100 keywords flipped/);
  assert.deepEqual(out.checks.at(-1), { id: 'capture_volatility', ok: true, detail: out.warnings.at(-1), warn: true });
  assert.equal(stabilityDetail(out).stability.guard.flips.length, 25);
  const realWeek = buildScanStability({ priorRows: prior, currentRows: scan(94, (i) => (i < 15 ? null : 1)), scoreFn: scoreStub });
  const quiet = withStabilityGuard({ incomplete: false, ranking_quality: 'complete', checks: [], warnings: [] }, realWeek);
  assert.equal(quiet.ranking_quality, 'complete');
  assert.deepEqual(quiet.warnings, []);
  assert.deepEqual(quiet.checks, []);
});

const STEPS = BRIEF_GATE.requiredSteps.map((key) => ({ key, ok: true }));
const base = {
  previous: { surface_visibility_score: 33, top_of_page_score: 41, top10: 39, ranking_quality: 'complete' },
  rankingRows: [], shownFindings: [], latestFullRunStart: '2026-11-09T00:00:00Z', steps: STEPS,
};

test('CEO brief: a suspect scan holds with the guard reason instead of dial percentages', () => {
  const reason = 'suspect: matching — 70 of 100 organic / local-pack results still unresolved google.com links (70%; limit 20%)';
  const g = assessBriefGate({ ...base, current: { surface_visibility_score: 21, top_of_page_score: 26, top10: 36, ranking_quality: SUSPECT_MATCHING, ranking_quality_detail: { stability: { guard: { reason } } } } });
  assert.equal(g.held, true);
  assert.deepEqual(g.failures.map((f) => f.id), ['scan_stability']);
  assert.equal(g.failures[0].detail, reason);
  assert.equal(g.checks.some((c) => c.id.startsWith('dial_move_')), false);
});

test('CEO brief: week-on-week dial check uses the same-keyword cohort when stored', () => {
  const like = { keywords: 94, prior: { surface_visibility_score: 20, top_of_page_score: 25 }, current: { surface_visibility_score: 21, top_of_page_score: 26 } };
  const g = assessBriefGate({ ...base, current: { surface_visibility_score: 21, top_of_page_score: 26, top10: 36, ranking_quality: 'complete', ranking_quality_detail: { stability: { cohort: { like_for_like: like } } } } });
  const dial = g.checks.find((c) => c.id === 'dial_move_surface_visibility_score');
  assert.equal(dial.ok, true);
  assert.match(dial.detail, /20 → 21.*same 94 keywords/);
});

test('Monday persist keeps the Google AI Overview slot (Surface AIO ownership)', () => {
  const slot = { present: true, total_citations: 4, alan_citations_count: 1, alan_citations: [{ domain: 'www.alanranger.com' }], sample_citations: [], checked_at: 'x' };
  const slim = slimRankingForPersist({ serpRows: [{ keyword: 'k', ai_overview_citations: slot }], aiRows: [] });
  assert.equal(slim.serpRows[0].ai_overview_citations.alan_citations_count, 1);
});
