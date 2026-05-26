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

const COVENTRY_URL = 'https://www.alanranger.com/photography-courses-coventry';
// 2026-05-26: override map is now keyed by bare slug (path only,
// lowercased, no trailing slash) on the API side via urlSlugKey()
// in fetchTargetKeywordOverrides. Test fixtures use the same key
// form so the picker honours overrides regardless of www / no-www /
// trailing-slash / tracking-suffix differences between the override
// row and the candidate URL.
const COVENTRY_SLUG = '/photography-courses-coventry';
// Slug-anchor for the Coventry URL. The funnel MUST pick this keyword
// (not the higher-volume national head term) so the user can match the
// card's anchor against the URL's slug at a glance. This is what
// Amendment 1 of the 2026-05-26 phase K instruction means by
// "consistency anchor".
const COVENTRY_SLUG_ANCHOR = 'photography courses coventry';

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

test('aio funnel anchor is the slug-aligned keyword for the URL (NOT the highest-volume national term)', () => {
  const keywords = buildCoventryKeywordSnapshot();
  const ctx = ctxFor(keywords);
  const candidate = __INTERNAL.aioCitationPriority('courses', keywords, ctx);
  assert.ok(candidate, 'aioCitationPriority should return a candidate for the Coventry page');
  assert.equal(candidate.aio_anchor_keyword, COVENTRY_SLUG_ANCHOR, 'anchor must be the slug-aligned keyword, not the highest-volume national term');

  const slugRow = keywords.find(k => k.keyword === COVENTRY_SLUG_ANCHOR);
  assert.ok(slugRow, 'fixture sanity check: slug-aligned keyword exists');
  assert.equal(candidate.aio_anchor_rank, slugRow.best_rank_group, 'funnel anchor rank must equal the slug row rank');
  assert.equal(candidate.aio_anchor_volume, Number(slugRow.search_volume) || 0, 'funnel anchor volume must equal the slug row volume');

  const expectedCited = (Number(slugRow.ai_alan_citations_count) || 0) > 0;
  assert.equal(candidate.aio_anchor_citation_state.cited, expectedCited, 'funnel anchor cited flag must reflect the slug row alan_citations');
  assert.equal(candidate.aio_anchor_citation_state.alan, Number(slugRow.ai_alan_citations_count) || 0, 'funnel anchor alan-citations must equal the slug row value');
  assert.equal(candidate.aio_anchor_citation_state.total, Number(slugRow.ai_total_citations) || 0, 'funnel anchor total-citations must equal the slug row value');
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
  const overrides = new Map([[COVENTRY_SLUG, 'photography courses coventry']]);
  const candidate = __INTERNAL.aioCitationPriority('courses', keywords, ctxFor(keywords, overrides));
  assert.equal(candidate.aio_used_override, true, 'override must be applied when keyword exists in keyword_rankings for the URL');
  assert.equal(candidate.aio_anchor_keyword.toLowerCase(), 'photography courses coventry');
  assert.equal(candidate.aio_assigned_keyword, 'photography courses coventry');
});

test('aio funnel surfaces a visible note when assigned keyword is NOT in keyword_rankings for the URL', () => {
  const keywords = buildCoventryKeywordSnapshot();
  const overrides = new Map([[COVENTRY_SLUG, 'photography courses warwick']]); // not in snapshot
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
  const overrides = new Map([[COVENTRY_SLUG, 'broken row']]);
  const candidate = __INTERNAL.aioCitationPriority('courses', keywords, ctxFor(keywords, overrides));
  assert.equal(candidate.aio_data_inconsistent, true, 'runtime check must trip on impossible citation_state');
  assert.ok(Array.isArray(candidate.aio_data_inconsistent_reasons), 'reasons must be an array');
  assert.ok(candidate.aio_data_inconsistent_reasons.includes('alan_citations_greater_than_total'), 'reasons must include the specific trigger');
});

test('aio funnel never crashes when the URL has zero AIO-eligible keywords', () => {
  const candidate = __INTERNAL.aioCitationPriority('courses', [], ctxFor([]));
  assert.equal(candidate, null, 'aioCitationPriority returns null when there are no eligible keywords');
});

// ----------------------------------------------------------------------
// Tool-wide consistency (2026-05-26 phase K-3): pill keyword === plan
// target keyword on every card type, every URL. The previous round of
// fixes wired the assigned-keyword obedience into AIO cards only;
// CTR/rank cards kept choosing their own sibling and contradicting
// the URL pill. The non-AIO primacy guardrail
// (applyAssignedKeywordPrimacyGuardrail) now enforces:
//   - if assigned KW ranks top 5  -> SUPPRESS the card (no rewrite)
//   - if assigned KW tracked >5   -> RE-ANCHOR card to assigned KW
//   - if assigned KW not tracked  -> soft note (pill kw still pinned)
// Below we assert all three paths on synthetic rank / CTR / merged
// candidates so a future picker change can't silently regress.
// ----------------------------------------------------------------------

const ACADEMY_URL = 'https://www.alanranger.com/free-online-photography-course';
const BEGINNERS_URL = 'https://www.alanranger.com/beginners-photography-classes';

function consistencySnapshot() {
  return {
    allKeywords: [
      { keyword: 'online photography course',     search_volume: 320,  best_rank_group: 2,  best_url: ACADEMY_URL },
      { keyword: 'photography lessons online',    search_volume: 1000, best_rank_group: 8,  best_url: ACADEMY_URL },
      { keyword: 'beginners photography classes', search_volume: 90,   best_rank_group: 13, best_url: BEGINNERS_URL },
      { keyword: 'beginners photography courses', search_volume: 110,  best_rank_group: 14, best_url: BEGINNERS_URL }
    ]
  };
}

function makeRankCandidate(url, primaryQuery, assignedKw, assignedRank) {
  return {
    tier_id: assignedKw && /online|academy/i.test(assignedKw) ? 'academy' : 'courses',
    pages_affected: [url],
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

function applyAndCollect(candidates, snap) {
  __INTERNAL.applyAssignedKeywordPrimacyGuardrail(candidates, snap);
  return candidates;
}

test('cross-card: top-5 assigned KW \u2192 sibling-target card is suppressed (pill kw NEVER differs from a Top-3 plan kw)', () => {
  const snap = consistencySnapshot();
  const c = makeRankCandidate(ACADEMY_URL, 'photography lessons online', 'Online Photography Course', 2);
  applyAndCollect([c], snap);
  assert.equal(c.guardrail_blocked_top3, true);
  assert.equal(c.estimated_lift_gbp_profit, 0);
});

test('cross-card: tracked >5 assigned KW \u2192 card re-anchored, pill kw matches plan kw, lift recomputed from assigned KW row', () => {
  const snap = consistencySnapshot();
  const c = makeRankCandidate(BEGINNERS_URL, 'beginners photography courses', 'beginners photography classes', 13);
  applyAndCollect([c], snap);
  assert.notEqual(c.guardrail_blocked_top3, true);
  assert.equal(c.primary_query.toLowerCase(), c.assigned_keyword.toLowerCase());
  // Lift must now be derived from the assigned KW's volume (sv=90) +
  // rank (#13), not the sibling's sv=110, rank=#14. Asserting it is
  // present + numeric is enough; the precise number is pinned by the
  // on-page-lift unit tests.
  assert.equal(typeof c.estimated_lift_gbp_profit, 'number');
  assert.ok(Array.isArray(c.revenue_assumption_stack), 're-anchored card must carry a unified assumption stack');
  const labels = c.revenue_assumption_stack.map(r => r.label);
  assert.ok(labels.includes('Booking conversion rate'), 'stack must surface the booking-conversion row');
});

test('cross-card: every non-suppressed Top-3-eligible candidate has primary_query === assigned_keyword OR no assigned_keyword', () => {
  const snap = consistencySnapshot();
  const cards = [
    makeRankCandidate(ACADEMY_URL,   'photography lessons online',   'Online Photography Course', 2),
    makeRankCandidate(BEGINNERS_URL, 'beginners photography courses','beginners photography classes', 13)
  ];
  applyAndCollect(cards, snap);
  for (const c of cards) {
    if (c.guardrail_blocked_top3) continue;
    if (!c.assigned_keyword) continue;
    assert.equal(
      String(c.primary_query || '').trim().toLowerCase(),
      String(c.assigned_keyword).trim().toLowerCase(),
      `card for ${c.pages_affected[0]} shows pill "${c.assigned_keyword}" but plan targets "${c.primary_query}"`
    );
  }
});

test('cross-card: re-anchored card carries a visible booking-conversion-rate row with assumed=true', () => {
  const snap = consistencySnapshot();
  const c = makeRankCandidate(BEGINNERS_URL, 'beginners photography courses', 'beginners photography classes', 13);
  applyAndCollect([c], snap);
  const conv = c.revenue_assumption_stack.find(r => r.label === 'Booking conversion rate');
  assert.ok(conv, 'booking-conversion row must exist on re-anchored card');
  assert.equal(conv.assumed, true, 'until measured rate lands, every card must keep the ASSUMED flag');
});
