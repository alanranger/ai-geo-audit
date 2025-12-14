/**
 * These tests lock the Domain Strength scoring formula (v1) so we don't
 * accidentally change the weighting / normalization in future edits.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { computeDomainStrengthScore } from "../api/domain-strength/score.js";

test("zero metrics → score 0, Very weak", () => {
  const res = computeDomainStrengthScore(
    { etv: 0, keywordsTotal: 0, top3: 0, top10: 0 },
    { etvCap: 1000000, kwCap: 100000 }
  );

  assert.equal(res.score, 0);
  assert.equal(res.band, "Very weak");
});

test("moderate site → score between 0 and 100, band not Very weak", () => {
  const res = computeDomainStrengthScore(
    { etv: 20000, keywordsTotal: 2000, top3: 50, top10: 200 },
    { etvCap: 1000000, kwCap: 100000 }
  );

  assert.ok(res.score > 0);
  assert.ok(res.score < 100);
  assert.ok(["Weak", "Moderate", "Strong", "Very strong"].includes(res.band));
});

test("values at caps + high top10 share → Very strong band", () => {
  const res = computeDomainStrengthScore(
    { etv: 1000000, keywordsTotal: 100000, top3: 2000, top10: 90000 },
    { etvCap: 1000000, kwCap: 100000 }
  );

  assert.ok(res.score >= 80);
  assert.ok(res.score <= 100);
  assert.equal(res.band, "Very strong");
});

test("log scaling sanity: higher etv increases score, but not linearly", () => {
  const low = computeDomainStrengthScore(
    { etv: 1000, keywordsTotal: 1000, top3: 10, top10: 100 },
    { etvCap: 1000000, kwCap: 100000 }
  );

  const high = computeDomainStrengthScore(
    { etv: 2000, keywordsTotal: 1000, top3: 10, top10: 100 },
    { etvCap: 1000000, kwCap: 100000 }
  );

  assert.ok(high.score > low.score);
  assert.ok(high.V > low.V);
  assert.ok(high.V - low.V < 1); // ensures normalization stays bounded
});


