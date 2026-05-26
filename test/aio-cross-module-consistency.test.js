// Cross-module consistency test (Step 5 of the 2026-05-26 data-layer
// reconciliation). Anchors the funnel's AIO card on the SAME keyword
// row the Keyword Scorecard would display for a URL, and asserts the
// rank / volume / citation_state fields agree.
//
// The original defect this test guards against: the funnel was
// reporting "ranks #2 but isn't cited" for the Coventry courses page
// while the Keyword Scorecard for the same URL reported the page as
// CITED 2/10. Both reads were from `keyword_rankings`. The funnel
// had simply picked a different row from the table than the Scorecard
// did, then composed narrative facts across multiple rows.
//
// This test feeds a synthetic snapshot mirroring the real production
// rows for /photography-courses-coventry (see report in chat
// 2026-05-26: provenance map Q6) and asserts the funnel's anchor
// fields agree with what `pickKeywordForPage` returns from the same
// snapshot — which is what the Keyword Scorecard does.

import test from 'node:test';
import assert from 'node:assert/strict';
import { __INTERNAL } from '../api/aigeo/revenue-funnel-smart-priorities.js';
import { pickKeywordForPage } from '../lib/revenue-funnel-serp-copy.js';

const COVENTRY_URL = 'https://www.alanranger.com/photography-courses-coventry';

// Mirror of the real keyword_rankings rows for the Coventry URL as of
// audit_date 2026-05-26 (see chat provenance report Q6 for the SQL).
function buildCoventryKeywordSnapshot() {
  const base = { segment: 'money', has_ai_overview: true };
  return [
    { ...base, keyword: 'photography courses',         search_volume: 6600, best_rank_group: 23, ai_alan_citations_count: 0, ai_total_citations: 14, best_url: COVENTRY_URL },
    { ...base, keyword: 'photography course near me',  search_volume: 2400, best_rank_group: 1,  ai_alan_citations_count: 1, ai_total_citations: 35, best_url: COVENTRY_URL },
    { ...base, keyword: 'photography lessons near me', search_volume: 2400, best_rank_group: 1,  ai_alan_citations_count: 1, ai_total_citations: 38, best_url: COVENTRY_URL },
    { ...base, keyword: 'photography classes near me', search_volume: 2400, best_rank_group: 1,  ai_alan_citations_count: 1, ai_total_citations: 40, best_url: COVENTRY_URL },
    { ...base, keyword: 'photography courses near me', search_volume: 2400, best_rank_group: 2,  ai_alan_citations_count: 1, ai_total_citations: 34, best_url: COVENTRY_URL },
    { ...base, keyword: 'photography workshops near me', search_volume: 260, best_rank_group: 3, ai_alan_citations_count: 1, ai_total_citations: 30, best_url: COVENTRY_URL },
    { ...base, keyword: 'photography courses coventry', search_volume: 70,  best_rank_group: 2,  ai_alan_citations_count: 2, ai_total_citations: 10, best_url: COVENTRY_URL },
    { ...base, keyword: 'beginners photography class near me', search_volume: 30, best_rank_group: 2, ai_alan_citations_count: 1, ai_total_citations: 48, best_url: COVENTRY_URL },
    { ...base, keyword: 'photography lessons coventry', search_volume: 10, best_rank_group: 1, ai_alan_citations_count: 4, ai_total_citations: 13, best_url: COVENTRY_URL },
    { ...base, keyword: 'photography classes coventry', search_volume: 10, best_rank_group: 1, ai_alan_citations_count: 3, ai_total_citations: 14, best_url: COVENTRY_URL },
    { ...base, keyword: 'beginners photography courses coventry', search_volume: null, best_rank_group: 1, ai_alan_citations_count: 2, ai_total_citations: 11, best_url: COVENTRY_URL },
    { ...base, keyword: 'camera courses coventry',        search_volume: null, best_rank_group: 1, ai_alan_citations_count: 2, ai_total_citations: 11, best_url: COVENTRY_URL },
    { ...base, keyword: 'lightroom courses coventry',     search_volume: null, best_rank_group: 1, ai_alan_citations_count: 2, ai_total_citations: 11, best_url: COVENTRY_URL }
  ];
}

function emptySchemaDetail() {
  return new Map([[COVENTRY_URL, { schemaTypes: new Set(['FAQPage', 'LocalBusiness']), title: null, h1: null }]]);
}

function ctxFor(keywords, overrides = null) {
  return {
    schemaDetail: emptySchemaDetail(),
    keywords,
    allKeywords: keywords,
    targetKeywordOverrides: overrides
  };
}

test('aio funnel anchor agrees with the Keyword Scorecard (slug-aligned pick)', () => {
  const keywords = buildCoventryKeywordSnapshot();
  const ctx = ctxFor(keywords);
  const candidate = __INTERNAL.aioCitationPriority('courses', keywords, ctx);
  assert.ok(candidate, 'aioCitationPriority should return a candidate for the Coventry page');

  const scorecardAnchor = pickKeywordForPage(COVENTRY_URL, keywords);
  assert.ok(scorecardAnchor, 'pickKeywordForPage should return the Scorecard anchor for this URL');

  assert.equal(candidate.aio_anchor_keyword, scorecardAnchor.keyword, 'funnel anchor keyword must match Scorecard anchor keyword');
  assert.equal(candidate.aio_anchor_rank, scorecardAnchor.best_rank_group, 'funnel anchor rank must match Scorecard anchor rank');
  assert.equal(candidate.aio_anchor_volume, Number(scorecardAnchor.search_volume) || 0, 'funnel anchor volume must match Scorecard anchor volume');

  const expectedCited = (Number(scorecardAnchor.ai_alan_citations_count) || 0) > 0;
  assert.equal(candidate.aio_anchor_citation_state.cited, expectedCited, 'funnel anchor cited flag must match Scorecard alan_citations > 0');
  assert.equal(candidate.aio_anchor_citation_state.alan, Number(scorecardAnchor.ai_alan_citations_count) || 0, 'funnel anchor alan-citations must match Scorecard value');
  assert.equal(candidate.aio_anchor_citation_state.total, Number(scorecardAnchor.ai_total_citations) || 0, 'funnel anchor total-citations must match Scorecard value');
});

test('aio funnel surfaces ALL AIO levers on the URL (capture + grow)', () => {
  const keywords = buildCoventryKeywordSnapshot();
  const candidate = __INTERNAL.aioCitationPriority('courses', keywords, ctxFor(keywords));
  const levers = candidate.aio_levers;
  assert.ok(Array.isArray(levers), 'aio_levers must be an array');
  assert.equal(levers.length, keywords.length, 'every AIO-eligible keyword on the URL must appear as a lever');

  // Picker used to drop cited keywords entirely. Guard against the
  // regression by asserting both capture-slot and grow-share levers
  // are present.
  const captureCount = levers.filter(l => l.lever_type === 'capture_slot').length;
  const growCount = levers.filter(l => l.lever_type === 'grow_share').length;
  assert.ok(captureCount > 0, 'at least one capture_slot lever must be present');
  assert.ok(growCount > 0, 'at least one grow_share lever must be present');
});

test('aio funnel headline GP comes from the top lever (NOT the anchor when they differ)', () => {
  const keywords = buildCoventryKeywordSnapshot();
  const candidate = __INTERNAL.aioCitationPriority('courses', keywords, ctxFor(keywords));
  const levers = [...candidate.aio_levers].sort((a, b) => b.expected_gp_mo - a.expected_gp_mo);
  const top = levers[0];
  assert.equal(candidate.aio_top_lever_keyword, top.keyword, 'aio_top_lever_keyword must be the highest-GP lever keyword');
  assert.equal(candidate.estimated_lift_gbp_profit, top.expected_gp_mo, 'card headline GP must equal the top lever GP');
});

test('aio funnel narrative description references ONLY the anchor row (no cross-row mixing)', () => {
  const keywords = buildCoventryKeywordSnapshot();
  const candidate = __INTERNAL.aioCitationPriority('courses', keywords, ctxFor(keywords));
  const desc = String(candidate.description || '');
  assert.match(desc, new RegExp(`"${candidate.aio_anchor_keyword.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}"`), 'description must quote the anchor keyword');
  // Anchor rank/volume must appear; we don't want the description to
  // also reference the ORIGINAL national-head-term rank (#23 in the
  // Coventry case) — the contradictory sentence the user flagged.
  if (candidate.aio_anchor_rank != null) {
    assert.match(desc, new RegExp(`#${candidate.aio_anchor_rank}\\b`), 'description must reference the anchor rank');
  }
  // Pre-refactor narrative read "you currently rank #X but aren't
  // cited" — sometimes for the wrong row. Now we never say
  // "aren't cited" when the anchor is in fact cited.
  if (candidate.aio_anchor_citation_state && candidate.aio_anchor_citation_state.cited) {
    assert.doesNotMatch(desc, /aren['\u2019]?t cited/i, 'must not claim uncited when anchor row IS cited');
    assert.match(desc, /already cited/i, 'must surface the already-cited state when anchor is cited');
  }
});

test('aio funnel honours an assigned-keyword override when row exists in keyword_rankings for this URL', () => {
  const keywords = buildCoventryKeywordSnapshot();
  const overrides = new Map([[COVENTRY_URL, 'photography courses coventry']]);
  const candidate = __INTERNAL.aioCitationPriority('courses', keywords, ctxFor(keywords, overrides));
  assert.equal(candidate.aio_used_override, true, 'override must be applied when keyword exists in keyword_rankings for the URL');
  assert.equal(candidate.aio_anchor_keyword.toLowerCase(), 'photography courses coventry');
  assert.equal(candidate.aio_assigned_keyword, 'photography courses coventry');
});

test('aio funnel surfaces a visible note when assigned keyword is NOT in keyword_rankings for the URL', () => {
  const keywords = buildCoventryKeywordSnapshot();
  const overrides = new Map([[COVENTRY_URL, 'photography courses warwick']]); // not in snapshot
  const candidate = __INTERNAL.aioCitationPriority('courses', keywords, ctxFor(keywords, overrides));
  assert.equal(candidate.aio_used_override, false, 'override must NOT be applied when keyword is missing for the URL');
  assert.ok(candidate.aio_override_status, 'override_status must be present');
  assert.equal(candidate.aio_override_status.applied, false);
  assert.equal(candidate.aio_override_status.reason, 'override_keyword_not_in_keyword_rankings_for_url');
  assert.match(candidate.aio_override_status_note || '', /photography courses warwick/i, 'note must name the assigned keyword');
  assert.match(candidate.aio_override_status_note || '', /slug-anchored/i, 'note must explain the fallback');
});

test('aio funnel flags data inconsistency at runtime (Step 6 fail-visible)', () => {
  const keywords = buildCoventryKeywordSnapshot();
  // Inject an impossible row: cited flag implied (alan > 0) but total = 0
  keywords.push({
    keyword: 'broken row',
    search_volume: 100,
    best_rank_group: 1,
    has_ai_overview: true,
    ai_alan_citations_count: 5,
    ai_total_citations: 0,
    best_url: COVENTRY_URL,
    segment: 'money'
  });
  // Force the anchor onto the broken row via override so the runtime
  // consistency check trips on it (the assertion runs against the
  // anchor lever, not every lever on the URL).
  const overrides = new Map([[COVENTRY_URL, 'broken row']]);
  const candidate = __INTERNAL.aioCitationPriority('courses', keywords, ctxFor(keywords, overrides));
  assert.equal(candidate.aio_data_inconsistent, true, 'runtime check must trip on impossible citation_state');
  assert.ok(Array.isArray(candidate.aio_data_inconsistent_reasons), 'reasons must be an array');
  assert.ok(candidate.aio_data_inconsistent_reasons.includes('alan_citations_greater_than_total'), 'reasons must include the specific trigger');
});

test('aio funnel never crashes when the URL has zero AIO-eligible keywords', () => {
  const candidate = __INTERNAL.aioCitationPriority('courses', [], ctxFor([]));
  assert.equal(candidate, null, 'aioCitationPriority returns null when there are no eligible keywords');
});
