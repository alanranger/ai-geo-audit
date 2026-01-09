# Dashboard Delta Data Availability Breakdown

**Analysis Date:** 2026-01-09  
**Current Audit:** 2026-01-09  
**Previous Audit (28-day rolling):** 2025-12-12

## Summary

This document breaks down which dashboard tiles are missing delta data from the 2025-12-12 audit and identifies the earliest audit date where each data type becomes available.

---

## ✅ Tiles WITH Delta Data (Working Correctly)

### 1. **AI Health (GAIO)**
- **Status:** ✅ Working
- **Dec 12 Data:** Available
- **Fields:** `visibility_score`, `authority_score`, `content_schema_score`, `local_entity_score`, `service_area_score`
- **Delta:** -2 (80 vs 82)

### 2. **AI Summary Likelihood**
- **Status:** ✅ Working
- **Dec 12 Data:** Available
- **Fields:** `ai_summary_score`
- **Delta:** -3 (74 vs 77)

### 3. **Audit Scan**
- **Status:** ✅ Working
- **Dec 12 Data:** Available
- **Fields:** `gsc_clicks`, `gsc_impressions`, `gsc_avg_position`, `gsc_ctr`
- **Deltas:**
  - Clicks: -1,659 (4,990 vs 6,649)
  - Impressions: -91,644 (1,286,198 vs 1,377,842)
  - Avg Position: -1.9 (12.4 vs 10.49) - **Note: Position got worse (higher = worse), so red is correct**
  - CTR: -0.1pp (0.4% vs 0.48%)

### 4. **URL Money Pages**
- **Status:** ✅ Working
- **Dec 12 Data:** Available
- **Fields:** `money_pages_metrics` (JSONB)
- **Deltas:**
  - Money clicks: +174 (292 vs 118)
  - Money CTR: -0.8pp (0.8% vs 1.6%)
  - Money avg pos: -5.6 (19.0 vs 24.6) - **Note: Position improved (lower = better), should be green**
  - Uplift remaining: -558 (+628 vs +1,186)

### 5. **Uplift Remaining**
- **Status:** ✅ Working
- **Dec 12 Data:** Available (calculated from Money Pages metrics)
- **Delta:** -558 (+628 vs +1,186)

### 6. **Optimisation**
- **Status:** ✅ Working (partial)
- **Dec 12 Data:** N/A (uses live task data, not historical audit data)
- **Note:** This tile uses optimization tasks loaded in browser session, not audit history

---

## ❌ Tiles MISSING Delta Data (Showing "-N/A")

### 1. **Keyword Ranking and AI**
- **Status:** ❌ Missing data
- **Dec 12 Data:** `ranking_ai_data` field exists but is **empty/null** (no `combinedRows`)
- **Earliest Audit with Data:** **2025-12-11** (one day before Dec 12)
- **Fields Missing:**
  - `ranking_ai_data.combinedRows` (empty array on Dec 12)
- **Impact:** Cannot calculate:
  - Top 3 share delta
  - Top 10 share delta
  - AI citations delta
  - Money share delta (for this tile)

**Why:** The Dec 12 audit was likely a partial audit or the Ranking & AI scan wasn't run that day.

---

### 2. **Domain Strength**
- **Status:** ❌ Missing data
- **Dec 12 Data:** No domain strength snapshot exists
- **Earliest Snapshot Date:** **2025-12-14** (2 days after Dec 12)
- **Fields Missing:**
  - `domain_strength_snapshots` table has no record for Dec 12
- **Impact:** Cannot calculate:
  - Your score delta
  - Gap to top delta
  - # stronger domains delta
  - Rank vs set delta

**Why:** Domain strength snapshots are created separately from audits (via "Run snapshot" button). The first snapshot was created on Dec 14.

---

### 3. **AI Citations (Money Share)**
- **Status:** ❌ Missing data
- **Dec 12 Data:** `aiSummaryComponents` is **not stored** in database
- **Earliest Audit with Data:** **N/A** (computed field, not stored)
- **Fields Missing:**
  - `ai_summary_components` (computed/derived field, never stored in `audit_results`)
- **Impact:** Cannot calculate Money Share delta

**Why:** `aiSummaryComponents` is a computed field derived from `ranking_ai_data.combinedRows`. Since Dec 12 has no ranking data, this cannot be computed. Even if it could be computed, it's not stored in the database for historical comparison.

**Note:** This tile shows the current value (34/67 = 51%) but cannot show a delta because:
1. Dec 12 has no `ranking_ai_data.combinedRows`
2. Even if it did, `aiSummaryComponents` is not stored in the database

---

### 4. **EEAT**
- **Status:** ❌ Missing data
- **Dec 12 Data:** `eeatScore` is **not stored** in database
- **Earliest Audit with Data:** **N/A** (computed field, not stored)
- **Fields Missing:**
  - `eeat_score` (computed/derived field, never stored in `audit_results`)
  - `eeat_confidence`
  - `eeat_subscores`
- **Impact:** Cannot calculate EEAT score delta

**Why:** EEAT scores are computed fields, not stored in the `audit_results` table. They would need to be computed from the Dec 12 audit data, but the computation logic may not be available or the source data may be missing.

---

## Data Availability Timeline

| Data Type | Dec 12 Status | Earliest Available | Notes |
|-----------|---------------|-------------------|-------|
| GSC Metrics (clicks, impressions, position, CTR) | ✅ Available | 2025-12-12 | Always available |
| GAIO Scores | ✅ Available | 2025-12-12 | Always available |
| AI Summary Score | ✅ Available | 2025-12-12 | Always available |
| Money Pages Metrics | ✅ Available | 2025-12-12 | Available |
| Ranking AI Data (combinedRows) | ❌ Empty | **2025-12-11** | Missing on Dec 12 |
| Domain Strength Snapshots | ❌ None | **2025-12-14** | First snapshot 2 days later |
| AI Summary Components | ❌ Not stored | N/A | Computed field, never stored |
| EEAT Score | ❌ Not stored | N/A | Computed field, never stored |

---

## Recommendations

### Short-term (Quick Fixes)
1. **Money Pages avg pos delta color:** Fix the color logic - when position improves (19.0 < 24.6), delta should be green, not red
2. **Use Dec 11 audit for Ranking tile:** If Dec 12 has no ranking data, fall back to Dec 11 (which has data) for a 29-day comparison instead of showing "-N/A"

### Long-term (Data Storage)
1. **Store computed fields:** Consider storing `aiSummaryComponents` and `eeatScore` in the `audit_results` table so historical deltas can be calculated
2. **Domain Strength:** Ensure domain strength snapshots are created more regularly, or store the score in `audit_results` table
3. **Ranking Data:** Ensure Ranking & AI scan is always run as part of the audit process to avoid missing data

---

## Current Status Summary

- **Working Deltas:** 6 tiles (GAIO, AI Summary, Audit Scan, Money Pages, Uplift, Optimisation)
- **Missing Deltas:** 4 tiles (Keyword Ranking, Domain Strength, AI Citations, EEAT)
- **Total Tiles:** 10

**Fix Priority:**
1. High: Money Pages avg pos color (should be green when improving)
2. Medium: Use Dec 11 for Ranking tile if Dec 12 missing
3. Low: Store computed fields for future historical comparisons
