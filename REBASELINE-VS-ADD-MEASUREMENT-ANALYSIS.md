# Rebaseline vs Add Measurement Logic Analysis

## Problem

**User Report**: 
- "Add Measurement" correctly shows rank and correct impressions (187 imp, 0 clicks) for keyword task
- "Rebaseline" overwrites latest measurement and resorts to URL match numbers (3 clicks, 1,356 impressions) with no rank
- This suggests different logic is used for keyword vs URL tasks

## Current Logic Comparison

### Add Measurement (Lines 13715-14300)
**For Keyword Tasks** (`hasKeyword === true`):
1. ✅ Fetches latest audit from Supabase (gets `ranking_ai_data`)
2. ✅ Loads Ranking & AI data into localStorage and window.rankingAiData
3. ✅ Tries `RankingAiModule.state().combinedRows` (with optional URL matching)
4. ✅ Falls back to `window.rankingAiData` (with optional URL matching)
5. ✅ Falls back to `localStorage.rankingAiData`
6. ✅ Falls back to `queryTotals` from localStorage/Supabase
7. ✅ Falls back to `queryPages` from localStorage/Supabase
8. ✅ Uses keyword matching (URL optional)

**For URL-Only Tasks** (`hasKeyword === false`):
1. ✅ Fetches from GSC Page Totals API
2. ✅ Falls back to Money Pages data
3. ✅ Falls back to queryTotals/queryPages

**Result**: ✅ Works correctly for keyword tasks

---

### Rebaseline (Lines 14524-14616)
**For Keyword Tasks** (`hasKeyword === true`):
1. ❌ **SKIPS** all keyword-specific data fetching
2. ❌ **SKIPS** Ranking & AI data loading
3. ❌ **SKIPS** combinedRows matching
4. ❌ Falls back to `task.baseline_metrics` (old baseline data)
5. ❌ Uses old baseline which may have URL-based data

**For URL-Only Tasks** (`hasKeyword === false`):
1. ✅ Fetches from GSC Page Totals API
2. ✅ Falls back to `task.baseline_metrics`

**Result**: ❌ **BROKEN** for keyword tasks - uses old baseline instead of fetching fresh data

---

## Root Cause

**Rebaseline function** (line 14542-14579):
```javascript
// Prefer exact GSC page totals for URL-only tasks
if (!hasKeyword && taskUrlForPage) {
  // ... fetch GSC page totals ...
}

// Fallback to existing baseline metrics (still records a new baseline marker)
if (!currentMetrics) {
  const baselineMetrics = task.baseline_metrics;
  if (baselineMetrics && typeof baselineMetrics === 'object') {
    currentMetrics = { ...baselineMetrics, captured_at: new Date().toISOString() };
  }
}
```

**Problem**: 
- For keyword tasks, it skips the `if (!hasKeyword)` block
- Falls through to line 14582 which uses `task.baseline_metrics`
- This is the OLD baseline which may have been created with URL-based matching
- It never fetches fresh Ranking & AI data for keyword tasks

---

## Fix Required

**Rebaseline should use the SAME logic as "Add Measurement"** for keyword tasks:

1. For keyword tasks: Use same data fetching logic as "Add Measurement"
2. For URL-only tasks: Keep current GSC Page Totals API logic (works fine)
3. Only fall back to `task.baseline_metrics` if ALL data sources fail

---

## Files to Modify

- `audit-dashboard.html` line ~14524-14616 (rebaseline function)

---

## Implementation Plan

1. Extract the data fetching logic from "Add Measurement" into a reusable function
2. OR duplicate the keyword task logic in rebaseline (simpler, less refactoring)
3. Ensure rebaseline uses same data sources as "Add Measurement" for keyword tasks
4. Test both keyword and URL-only tasks

---

## Expected Behavior After Fix

**Keyword Task Rebaseline**:
- Should fetch latest Ranking & AI data from Supabase
- Should match by keyword (URL optional)
- Should get: rank #5, AI Overview: On, impressions: 187, clicks: 0
- Should NOT use old baseline metrics

**URL-Only Task Rebaseline**:
- Should continue using GSC Page Totals API (unchanged)
- Should work as before
