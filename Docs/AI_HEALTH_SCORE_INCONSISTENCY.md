# AI Health Scorecard: Authority/Visibility Inconsistency

**Date**: 2026-01-24  
**Status**: INVESTIGATED  
**Owner**: Alan / Next chat

---

## Summary
Authority values are inconsistent within the **AI Health (Overview)** module and between the **Overview** and **Dashboard** modules. Some components show **50** while the Score Trends line shows **53** for the same date (2026-01-23).

This is not a display-only bug. The UI is recomputing Authority on the client using incomplete inputs even when the API provides the correct Authority score and components.

---

## Observed Mismatch
**Same module (Overview / AI Health Scorecard):**
- Pillar cards, radar, GAIO breakdown, spider web show: **Authority 50**
- Score Trends line chart shows: **Authority 53**

**Same date**: 2026-01-23 (GSC delayed date)

---

## Root Cause (Client Recompute With Missing Inputs)
The API returns valid Authority data, but the frontend recomputes it anyway and overwrites it with a lower value.

**What we verified**
- `get-audit-history` for 2026-01-23 returns **authorityScore: 53**.
- `get-latest-audit` returns `scores.authority.score: 53` and `authorityComponents: {behaviour, ranking, backlinks, reviews}`.

**Why the recompute happens**
- `get-latest-audit` reconstructs `scores.authority` without the exact nested fields the UI expects (`behaviourScoresSegmented`, `rankingScoresSegmented`).
- The `missingAuthority` check in `audit-dashboard.html` still evaluates true when `searchData.queryPages` exists.
- This triggers `calculatePillarScores` on the client with `backlinkMetrics` and `siteReviews` missing, which forces:
  - `computeBacklinkScore` -> `0`
  - `computeReviewScore` -> `50`
- The recomputed Authority becomes **50**, which overwrites the correct **53** for the pillar card, radar, GAIO breakdown, and spider web.

---

## Where the Mismatch Is Introduced
- Pillar cards / radar / GAIO breakdown: use the **recomputed** Authority (50).
- Score Trends chart: uses **history timeseries Authority** (53).

---

## Impact
- Users see conflicting Authority values for the same date.
- Scorecard narrative and trend analysis are unreliable.

---

## Solid, Reliable Fix (Recommended)
**Stop the client-side recompute when a valid Authority score is already supplied.**

Do one of the following (either is sufficient, Option A is the simplest):

**Option A — Frontend guard (recommended)**
- In `audit-dashboard.html`, treat `scores.authority.score` or `authorityComponents` as authoritative.
- Update the `missingAuthority` check to **not** recompute if:
  - `scores.authority.score` is a finite number, or
  - `authorityComponents` exists with valid `backlinks` and `reviews`.

**Option B — Backend shape fix**
- In `get-latest-audit.js`, add `scores.authority.behaviourScoresSegmented` and `scores.authority.rankingScoresSegmented` from stored values (if available).
- This prevents `missingAuthority` from firing, keeping the stored score intact.

---

## Required Fix (high level)
1) **Preserve** `scores.authority.score` from the API if present.
2) **Avoid recompute** unless all required inputs exist.
3) Ensure all components use the same Authority value for the same date.

---

## Handover Notes
- This issue is not caused by missing database storage; the API returns correct Authority data.
- The mismatch is caused by frontend recompute using incomplete inputs.
- Fixing the recompute guard removes the inconsistency without changing stored data.
