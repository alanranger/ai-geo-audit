import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assessRankingAcceptance,
  countPackFlagMismatches,
  hasPackEvidence,
  PACK_MISMATCH_MAX,
  MEASURABLE_MIN_PCT,
} from '../lib/keyword-ranking/ranking-acceptance-gate.js';

function moneyRow(overrides = {}) {
  return {
    keyword: overrides.keyword || 'photographer near me',
    keyword_class: 'local-money',
    search_volume: 100,
    best_rank_group: 5,
    local_pack_present_any: true,
    local_pack_position: 1,
    serp_surface_stack: [
      { type: 'local_pack', slot: 1, ours: true, our_position: 1 },
      { type: 'organic', slot: 2, ours: true, our_position: 5 },
    ],
    serp_features: { capture_status: 'complete_ranked', local_pack: true },
    ...overrides,
  };
}

test('pack mismatch constants', () => {
  assert.equal(PACK_MISMATCH_MAX, 0);
  assert.equal(MEASURABLE_MIN_PCT, 0.9);
});

test('hasPackEvidence / countPackFlagMismatches catch false flag with stack', () => {
  const bad = moneyRow({ local_pack_present_any: false });
  assert.equal(hasPackEvidence(bad), true);
  assert.equal(countPackFlagMismatches([bad]), 1);
  assert.equal(countPackFlagMismatches([moneyRow()]), 0);
});

test('acceptance fails on pack flag vs stack mismatch (2026-10-19 class)', () => {
  const rows = Array.from({ length: 20 }, (_, i) => moneyRow({
    keyword: `kw ${i}`,
    local_pack_present_any: i < 5 ? false : true,
  }));
  const a = assessRankingAcceptance(rows, {
    expectedTracked: 20,
    dialSource: 'keyword_rankings',
  });
  assert.equal(a.incomplete, true);
  assert.equal(a.pack_mismatches, 5);
  assert.match(a.reason, /pack_flag_vs_stack/);
  assert.equal(a.ranking_quality, 'incomplete');
});

test('acceptance passes clean pack + coverage', () => {
  const rows = Array.from({ length: 20 }, (_, i) => moneyRow({ keyword: `kw ${i}` }));
  const a = assessRankingAcceptance(rows, {
    expectedTracked: 20,
    dialSource: 'keyword_rankings',
    priorSurface: 40,
    priorLocalN: 18,
    priorNationalN: 0,
  });
  assert.equal(a.incomplete, false);
  assert.equal(a.pack_mismatches, 0);
  assert.equal(a.reason, null);
});

test('large Surface drop alone warns but does not fail when pack ok', () => {
  const rows = Array.from({ length: 20 }, (_, i) => moneyRow({
    keyword: `kw ${i}`,
    best_rank_group: null,
    local_pack_present_any: false,
    local_pack_position: null,
    serp_surface_stack: [{ type: 'organic', slot: 1, ours: false }],
    serp_features: { capture_status: 'complete_no_match', local_pack: false },
  }));
  const a = assessRankingAcceptance(rows, {
    expectedTracked: 20,
    dialSource: 'keyword_rankings',
    priorSurface: 46,
  });
  assert.equal(a.incomplete, false, a.reason);
  assert.ok(a.warnings.length >= 1);
  assert.match(a.warnings[0], /large drop/);
});

test('large Surface drop + pack mismatch fails', () => {
  const rows = Array.from({ length: 20 }, (_, i) => moneyRow({
    keyword: `kw ${i}`,
    local_pack_present_any: false,
    best_rank_group: null,
  }));
  const a = assessRankingAcceptance(rows, {
    expectedTracked: 20,
    dialSource: 'keyword_rankings',
    priorSurface: 46,
  });
  assert.equal(a.incomplete, true);
  assert.match(a.reason, /pack_flag_vs_stack|surface_drop_integrity/);
});

test('measurable coverage fails when most rows empty', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({
    keyword: `kw ${i}`,
    keyword_class: 'local-money',
    search_volume: 10,
    serp_surface_stack: null,
    serp_features: { capture_status: 'empty' },
    error: 'empty',
  }));
  const a = assessRankingAcceptance(rows, {
    expectedTracked: 20,
    dialSource: 'keyword_rankings',
  });
  assert.equal(a.incomplete, true);
  assert.match(a.reason, /measurable_coverage|completeness/);
});

test('dial_from_db fails when scored from slim combined_rows only', () => {
  const rows = Array.from({ length: 20 }, (_, i) => moneyRow({ keyword: `kw ${i}` }));
  const a = assessRankingAcceptance(rows, {
    expectedTracked: 20,
    dialSource: 'combined_rows',
  });
  assert.equal(a.incomplete, true);
  assert.match(a.reason, /dial_from_db/);
});
