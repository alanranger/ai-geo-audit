// Assigned-keyword primacy guardrail (2026-05-26 user defect).
//
// User reported: "for online photography course that i rank 2 for
// you are telling me to change seo title and description from course
// to lessons, surely thats not right if i rank #2 for the keyword
// assigned to that page; likewise beginners photography classes you
// say Lift 'beginners photography courses' from rank 14 to top 7
// when that isnt the keyword either".
//
// Engine had no awareness of the URL's ASSIGNED keyword when picking
// which keyword a rank-lift / CTR card should target. The picker
// grabbed the highest-search-volume sibling and recommended on-page
// rewrites toward that sibling instead, even when:
//   (a) the page already ranks top 5 for its assigned keyword (so
//       rewriting for a sibling would jeopardise the existing rank),
//       OR
//   (b) the assigned keyword itself is in keyword_rankings and would
//       be a better target than the sibling the picker chose.
//
// These tests pin the three branches of the guardrail (suppress on
// top 5, re-anchor on >5 if tracked, soft-note if not tracked) so
// the bug can't regress.

import test from 'node:test';
import assert from 'node:assert/strict';
import { __INTERNAL } from '../api/aigeo/revenue-funnel-smart-priorities.js';

const { applyAssignedKeywordPrimacyGuardrail, findKeywordRowForUrl } = __INTERNAL;

const URL_ACADEMY = 'https://www.alanranger.com/free-online-photography-course';
const URL_BEGINNERS = 'https://www.alanranger.com/beginners-photography-classes';
const URL_WORKSHOPS = 'https://www.alanranger.com/photography-workshops';

function buildSnapshot() {
  return {
    allKeywords: [
      // Academy URL — assigned = "Online Photography Course" rank #2.
      // Sibling "photography lessons online" exists at rank #8 (1000/mo).
      { keyword: 'online photography course',  search_volume: 320,  best_rank_group: 2,  best_url: URL_ACADEMY },
      { keyword: 'photography lessons online', search_volume: 1000, best_rank_group: 8,  best_url: URL_ACADEMY },
      // Beginners URL — assigned = "beginners photography classes" rank #13.
      // Sibling "beginners photography courses" picked instead at #14.
      { keyword: 'beginners photography classes', search_volume: 90,  best_rank_group: 13, best_url: URL_BEGINNERS },
      { keyword: 'beginners photography courses', search_volume: 110, best_rank_group: 14, best_url: URL_BEGINNERS },
      // Workshops URL — assigned = "photography workshops" rank #14
      // (sibling already aligned to assigned in this case).
      { keyword: 'photography workshops', search_volume: 2900, best_rank_group: 14, best_url: URL_WORKSHOPS }
    ]
  };
}

function rankCandidate(url, primaryQuery, assignedKw, assignedRank) {
  return {
    signature: `rank|${primaryQuery}|${url}`,
    title: `Lift "${primaryQuery}" from rank N`,
    description: `placeholder describing ${primaryQuery}`,
    pages_affected: [url],
    primary_kpi: 'rank_position',
    primary_query: primaryQuery,
    lever_id: 'rank',
    merged_levers: null,
    estimated_lift_gbp_revenue: 91,
    estimated_lift_gbp_profit: 90,
    assigned_keyword: assignedKw,
    assigned_keyword_rank: assignedRank,
    _rebuild: { type: 'rank', args: { keyword: primaryQuery, rank: 14, sv: 110, cleanedUrl: url } }
  };
}

function mergedCtrRankCandidate(url, primaryQuery, assignedKw, assignedRank) {
  return {
    signature: `merged|${url}|${primaryQuery}`,
    title: `One plan for ${url}: "${primaryQuery}" (CTR + rank)`,
    description: `placeholder describing ${primaryQuery}`,
    pages_affected: [url],
    primary_kpi: 'ctr_28d_pct',
    primary_query: primaryQuery,
    lever_id: null,
    merged_levers: ['ctr', 'rank'],
    estimated_lift_gbp_revenue: 252,
    estimated_lift_gbp_profit: 249,
    assigned_keyword: assignedKw,
    assigned_keyword_rank: assignedRank,
    _rebuild: { type: 'rank', args: { keyword: primaryQuery, rank: 8, sv: 1000, cleanedUrl: url } },
    _rebuild_secondary: { type: 'ctr', args: { cleanedUrl: url, kwInfo: { keyword: primaryQuery, rank: 8, searchVolume: 1000 } } }
  };
}

test('top-5 rank on assigned keyword \u2192 suppress rewrite card for a sibling', () => {
  const snap = buildSnapshot();
  const c = mergedCtrRankCandidate(URL_ACADEMY, 'photography lessons online', 'Online Photography Course', 2);
  applyAssignedKeywordPrimacyGuardrail([c], snap);
  assert.equal(c.guardrail_severity, 'hard');
  assert.equal(c.guardrail_blocked_top3, true);
  assert.equal(c.estimated_lift_gbp_profit, 0);
  assert.equal(c.estimated_lift_gbp_revenue, 0);
  assert.match(String(c.estimated_lift), /already #2/i);
  const note = (c.guardrail_notes || []).join(' | ');
  assert.match(note, /SUPPRESSED/);
  assert.match(note, /already ranks #2/);
  assert.match(note, /Online Photography Course/);
});

test('assigned keyword tracked but ranking >5 \u2192 re-anchor card to assigned keyword', () => {
  const snap = buildSnapshot();
  const c = rankCandidate(URL_BEGINNERS, 'beginners photography courses', 'beginners photography classes', 13);
  applyAssignedKeywordPrimacyGuardrail([c], snap);
  assert.notEqual(c.guardrail_severity, 'hard');
  assert.notEqual(c.guardrail_blocked_top3, true);
  assert.equal(c.primary_query, 'beginners photography classes');
  assert.match(c.title, /beginners photography classes/);
  assert.match(c.title, /rank 13/);
  assert.equal(c._rebuild.args.keyword, 'beginners photography classes');
  assert.equal(c._rebuild.args.rank, 13);
  const note = (c.guardrail_notes || []).join(' | ');
  assert.match(note, /Re-anchored/);
  assert.match(note, /beginners photography courses/);
  assert.match(note, /beginners photography classes/);
});

test('candidate keyword already equals assigned keyword \u2192 no change', () => {
  const snap = buildSnapshot();
  const c = rankCandidate(URL_WORKSHOPS, 'photography workshops', 'photography workshops', 14);
  applyAssignedKeywordPrimacyGuardrail([c], snap);
  assert.equal(c.guardrail_severity, undefined);
  assert.equal(c.guardrail_blocked_top3, undefined);
  assert.equal(c.primary_query, 'photography workshops');
  assert.equal(c.guardrail_notes, undefined);
});

test('candidate with no assigned_keyword \u2192 no change', () => {
  const snap = buildSnapshot();
  const c = rankCandidate(URL_ACADEMY, 'photography lessons online', null, null);
  applyAssignedKeywordPrimacyGuardrail([c], snap);
  assert.equal(c.guardrail_severity, undefined);
  assert.equal(c.guardrail_blocked_top3, undefined);
  assert.equal(c.primary_query, 'photography lessons online');
});

test('assigned keyword not in keyword_rankings \u2192 soft note, no suppress, no re-anchor', () => {
  const snap = buildSnapshot();
  const c = rankCandidate(URL_ACADEMY, 'photography lessons online', 'untracked head term', null);
  applyAssignedKeywordPrimacyGuardrail([c], snap);
  assert.notEqual(c.guardrail_severity, 'hard');
  assert.notEqual(c.guardrail_blocked_top3, true);
  assert.equal(c.primary_query, 'photography lessons online');
  const note = (c.guardrail_notes || []).join(' | ');
  assert.match(note, /not currently tracked/);
  assert.match(note, /untracked head term/);
});

test('AIO-only candidate is untouched by the non-AIO guardrail', () => {
  const snap = buildSnapshot();
  const c = {
    signature: `aio|${URL_ACADEMY}`,
    pages_affected: [URL_ACADEMY],
    primary_query: 'photography lessons online',
    lever_id: 'aio',
    merged_levers: null,
    assigned_keyword: 'Online Photography Course',
    assigned_keyword_rank: 2,
    estimated_lift_gbp_profit: 50
  };
  applyAssignedKeywordPrimacyGuardrail([c], snap);
  assert.equal(c.guardrail_severity, undefined);
  assert.equal(c.guardrail_blocked_top3, undefined);
  assert.equal(c.estimated_lift_gbp_profit, 50);
});

test('findKeywordRowForUrl matches by slug + case-insensitive keyword', () => {
  const snap = buildSnapshot();
  // www / no-www / trailing slash / casing all normalised by urlSlugKey.
  const row1 = findKeywordRowForUrl(snap.allKeywords, 'https://alanranger.com/free-online-photography-course/', 'Online Photography Course');
  assert.ok(row1, 'expected lookup to find the row regardless of www / trailing-slash / casing');
  assert.equal(row1.best_rank_group, 2);
  const missing = findKeywordRowForUrl(snap.allKeywords, URL_ACADEMY, 'no-such-keyword');
  assert.equal(missing, null);
});
