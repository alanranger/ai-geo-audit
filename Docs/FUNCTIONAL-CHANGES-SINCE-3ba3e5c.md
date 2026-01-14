# Functional Changes Since Last Working Commit (3ba3e5c)

This document lists all **functional** changes (excluding syntax fixes) that were made after commit `3ba3e5c` (the last known working version). These changes need to be carefully re-applied.

## Summary

**Total functional commits:** 6  
**Total syntax fix commits:** 9 (excluded from this list)

---

## 1. Extract Shared Helper Functions (517800e, 8c8b955, 8c1382a)

**Commits:**
- `517800e` - Refactor: Extract shared helper functions for task metrics to ensure consistency
- `8c8b955` - Complete refactor: All update functions now use shared helper functions
- `8c1382a` - Refactor: Extract shared helper functions and update all update paths

**What was done:**
- Created 3 shared helper functions:
  1. `fetchLatestAuditAndCombinedRows()` - unified data fetching
  2. `fetchMetricsForUrlTask()` - handles URL-only tasks (GSC API + Ranking & AI + Supabase fallback)
  3. `fetchMetricsForKeywordTask()` - handles keyword tasks (NEVER uses Money Pages)

- Updated all 6 update functions to use helpers:
  1. `bulkUpdateAllTasks()` - FIXED: keyword tasks now use keyword-specific data
  2. `addMeasurement()` - uses helpers (legacy fallback still present)
  3. `rebaseline()` - uses helpers
  4. `updateTaskLatest()` - uses helpers
  5. `bulkRebaselineIncompleteBaselines()` - uses helpers
  6. `submitTrackKeyword()` - (task creation - uses similar logic)

**Critical Fix:** Keyword tasks were incorrectly using Money Pages (page-level aggregated) data instead of keyword-specific data from combinedRows. This caused latest measurements to show same data as baseline.

**Files changed:** `audit-dashboard.html`

---

## 2. Clarify Helper Functions Fetch All Fields (a240c4a)

**Commit:** `a240c4a` - Clarify: Both helper functions fetch ALL fields from BOTH data sources

**What was done:**
- Updated comments to clarify that both task types need both data sources:
  - `fetchMetricsForUrlTask`: Gets GSC data (clicks/impressions/CTR/rank) from page totals API + AI data (rank fallback/AI overview/citations) from Ranking & AI
  - `fetchMetricsForKeywordTask`: Gets GSC data (clicks/impressions/CTR) from queryTotals + AI data (rank/AI overview/citations) from combinedRows

**Files changed:** `audit-dashboard.html`

---

## 3. Dashboard Tiles Date Consistency (fe3a806)

**Commit:** `fe3a806` - Fix: Dashboard tiles now show consistent dates from latest global run

**What was done:**
- All tiles (Audit Scan, Ranking & AI, Money Pages) now use the same timestamp from the latest global run
- This ensures all tiles show the same date as the header 'Last global run'
- Previously tiles were showing different dates from different localStorage keys (last_audit_results, rankingAiData)
- Now all tiles use `latestGlobalTimestamp` which comes from `getDashboardRuns()` - the same source as the header

**Files changed:** `audit-dashboard.html`

---

## 4. Task Creation Uses Helper Functions (78afaaf)

**Commit:** `78afaaf` - Fix: Task creation now uses shared helper functions for consistency

**What was done:**
- `submitTrackKeyword()` now uses `fetchMetricsForUrlTask`/`fetchMetricsForKeywordTask`
- This ensures task creation uses the same logic as all update functions
- Fallback to row data if helper functions fail (backward compatibility)
- All paths (creation, updates, rebaseline) now use identical logic

**Files changed:** `audit-dashboard.html`

---

## 5. Prompt After Run Audit Scan (3adfb24, 422f026)

**Commits:**
- `3adfb24` - Add prompt after Run Audit Scan to suggest task updates with GSC-only metrics clarification
- `422f026` - Add prompt after audit scan to update tasks with GSC data

**What was done:**
- Added prompt after 'Run Audit Scan' completion that suggests updating tasks
- Clarifies that only GSC metrics will be updated (clicks, impressions, CTR, rank from GSC)
- Explicitly states AI metrics (overview, citations, rank from Ranking & AI) will NOT be updated
- Prompts user to run 'Run Ranking & AI Scan' first for complete AI metrics
- Navigates to Optimisation tab and triggers bulk update if user confirms
- Ensures users understand data limitations when using individual audit scan vs global run

**Files changed:** `audit-dashboard.html`

---

## Syntax Fixes (Excluded - Do NOT re-apply)

These were all syntax errors introduced during the refactoring:

1. `1ad0cdd` - Fix syntax error: Remove extra closing brace
2. `f176be5` - Fix syntax error: Correct indentation in try-catch block
3. `9c00588` - Fix syntax error: Correct indentation inside async function
4. `e406d32` - Fix bulkUpdateAllTasks syntax: close URL-only branch braces
5. `892ece1` - Fix bulkUpdateAllTasks syntax: close measurement try/catch in callback
6. `2ce5849` - Remove duplicate closing html tag
7. `a3cbffb` - Fix unmatched brace in inline script (dashboard run helpers)
8. `44245c7` - Fix missing brace in bulk update fallback

---

## Recommended Approach

1. **Start with the helper functions** (commits 517800e, 8c8b955, 8c1382a) - This is the core refactoring
2. **Add the clarification** (a240c4a) - Just comments/documentation
3. **Fix dashboard dates** (fe3a806) - Simple fix
4. **Update task creation** (78afaaf) - Uses the helper functions
5. **Add the prompt** (3adfb24, 422f026) - UI enhancement

**Important:** When re-applying, be very careful with:
- Brace matching
- Indentation (especially inside async functions and callbacks)
- Closing all try/catch blocks properly
- Ensuring all Promise.all() callbacks are properly closed
