# Keyword vs URL Task Logic Comparison

**⚠️ NOTE**: For the most current status of fixes and ongoing issues, see **`HANDOVER.md`** (created 2026-01-07).

## Summary

This document compares the logic used for keyword-based tasks vs URL-only tasks across all optimization task operations.

## 2026-02-01 Clarification (Plain English)

### Why metrics can look "conflicting"
- **URL tasks** use **page-level totals** (all queries for the page).
- **Keyword tasks** use **query-level totals** (one keyword only).
- When you compare a URL metric to a keyword metric, they can look contradictory because they are **different slices of GSC**.

### Source of truth by task type
- **URL task** (no keyword): page totals are the correct source of truth.
- **Keyword task** (has keyword): query totals are the correct source of truth.

### Optimisation task measurements (baseline/latest)
- Baseline and latest values are **snapshots captured at the time of “Add Measurement” or “Rebaseline.”**
- They are **not recalculated later** from the database.
- A URL task baseline and latest will both use **page totals**, so they are **internally consistent** even if they differ from keyword metrics.

### Authority/Behaviour scores
- These should remain **query-based** because users search by keywords, not by page URL.
- Switching Authority/Behaviour to page totals would change the meaning of those scores.

### Decision note
- If the goal is to avoid conflicting metrics across the UI, **leave the current split in place**:
  - URL tasks → page totals
  - Keyword tasks → query totals
  - Authority/Behaviour → query-based
  - Money Pages table → page totals

---

## Operations Analyzed

1. **Add Measurement** (Individual task)
2. **Update Task Latest** (Individual task)
3. **Rebaseline** (Individual task)
4. **Bulk Update All Tasks**
5. **Start New Cycle** (Initial baseline creation - server-side)

---

## Logic Comparison

### Add Measurement (Lines 13715-14300)

**For Keyword Tasks** (`hasKeyword === true`):
- ✅ Fetches latest audit from Supabase (gets `ranking_ai_data`)
- ✅ Loads Ranking & AI data into localStorage and window.rankingAiData
- ✅ Tries `RankingAiModule.state().combinedRows` (URL matching **OPTIONAL** - Fix 1)
- ✅ Falls back to `window.rankingAiData` (URL matching **OPTIONAL** - Fix 1)
- ✅ Falls back to `localStorage.rankingAiData`
- ✅ Falls back to `queryTotals` from localStorage/Supabase (keyword matching)
- ✅ Falls back to `queryPages` from localStorage/Supabase

**For URL-Only Tasks** (`hasKeyword === false`):
- ✅ Fetches from GSC Page Totals API
- ✅ Falls back to Money Pages data
- ✅ Falls back to queryTotals/queryPages (URL matching)

**Status**: ✅ **FIXED** - Uses correct logic for keyword tasks

---

### Update Task Latest (Lines 15478-16000)

**For Keyword Tasks** (`hasKeyword === true`):
- ✅ Uses same logic as "Add Measurement" (URL matching **OPTIONAL** - Fix 1)
- ✅ Tries `RankingAiModule.state().combinedRows`
- ✅ Falls back to `window.rankingAiData`
- ✅ Falls back to `localStorage.rankingAiData`

**For URL-Only Tasks** (`hasKeyword === false`):
- ✅ Uses same logic as "Add Measurement"

**Status**: ✅ **FIXED** - Uses same logic as Add Measurement

---

### Rebaseline (Lines 14524-14616)

**For Keyword Tasks** (`hasKeyword === true`):
- ✅ **NOW FIXED**: Fetches latest audit from Supabase (gets `ranking_ai_data`)
- ✅ **NOW FIXED**: Loads Ranking & AI data
- ✅ **NOW FIXED**: Tries `RankingAiModule.state().combinedRows` (URL matching **OPTIONAL**)
- ✅ **NOW FIXED**: Falls back to `window.rankingAiData` (URL matching **OPTIONAL**)
- ✅ **NOW FIXED**: Falls back to `localStorage.rankingAiData`
- ❌ **OLD BEHAVIOR**: Used to fall back to `task.baseline_metrics` (old baseline) - **FIXED**

**For URL-Only Tasks** (`hasKeyword === false`):
- ✅ Fetches from GSC Page Totals API (unchanged)
- ✅ Falls back to `task.baseline_metrics` if needed

**Status**: ✅ **FIXED** - Now uses same logic as Add Measurement for keyword tasks

---

### Bulk Update All Tasks (Lines 14498-15382)

**For Keyword Tasks** (`hasKeyword === true`):
- ✅ Fetches latest audit from Supabase first
- ✅ Loads Ranking & AI data from latest audit
- ✅ Tries `combinedRows` from RankingAiModule (line 15037-15048)
  - ✅ **ALREADY CORRECT**: Allows keyword match without URL requirement (line 15047)
  - ✅ URL matching is optional if no URL in task
- ✅ Falls back to Money Pages data (for URL-only tasks)
- ✅ Falls back to `queryTotals` from localStorage/Supabase
- ✅ Falls back to `queryPages` from Supabase

**For URL-Only Tasks** (`hasKeyword === false`):
- ✅ Uses Money Pages data
- ✅ Falls back to `queryTotals`/`queryPages` (URL matching)

**Status**: ✅ **ALREADY CORRECT** - Has better logic than Add Measurement had before Fix 1

---

### Start New Cycle (Lines 7343-7477)

**Baseline Creation**:
- Calls server-side API: `/api/optimisation/task/${taskId}/cycle`
- Server creates baseline from:
  - Latest audit data, OR
  - Previous latest measurement
- **Note**: Server-side logic - needs to be checked separately

**Status**: ⚠️ **NEEDS VERIFICATION** - Server-side logic may need same fix

---

## Key Differences (Before Fixes)

### Before Fix 1:
- **Add Measurement**: Required URL match for keyword tasks ❌
- **Rebaseline**: Used old baseline metrics for keyword tasks ❌
- **Bulk Update**: Already had correct logic (URL optional) ✅

### After Fix 1:
- **Add Measurement**: URL matching optional for keyword tasks ✅
- **Update Task Latest**: URL matching optional for keyword tasks ✅
- **Rebaseline**: Now uses same logic as Add Measurement ✅
- **Bulk Update**: Already had correct logic (unchanged) ✅

---

## Data Source Priority (After Fixes)

### For Keyword Tasks:
1. **Ranking & AI data** (from Supabase `ranking_ai_data.combinedRows`)
   - Match by keyword (URL optional)
   - Contains: `best_rank_group`, `has_ai_overview`, `ai_alan_citations_count`
2. **queryTotals** (from Supabase `query_totals`)
   - Match by keyword
   - Contains: `clicks`, `impressions`, `position`, `ctr` (NO ranking/AI data)
3. **queryPages** (from Supabase)
   - Match by keyword + URL
   - Contains: Query+page level data

### For URL-Only Tasks:
1. **GSC Page Totals API** (direct fetch)
   - Match by URL
   - Contains: `clicks`, `impressions`, `ctr`, `position`
2. **Money Pages data** (from audit)
   - Match by URL
   - Contains: Aggregated page metrics
3. **queryTotals** (aggregated by URL)
   - Match by URL
   - Contains: Aggregated query metrics for that URL

---

## Consistency Status

| Operation | Keyword Task Logic | URL Task Logic | Status |
|-----------|-------------------|----------------|--------|
| Add Measurement | ✅ Fixed (URL optional) | ✅ Correct | ✅ Consistent |
| Update Task Latest | ✅ Fixed (URL optional) | ✅ Correct | ✅ Consistent |
| Rebaseline | ✅ Fixed (URL optional) | ✅ Correct | ✅ Consistent |
| Bulk Update | ✅ Already correct | ✅ Correct | ✅ Consistent |
| Start New Cycle | ⚠️ Server-side | ⚠️ Server-side | ⚠️ Needs check |

---

## Recommendations

1. ✅ **Add Measurement** - Fixed
2. ✅ **Update Task Latest** - Fixed
3. ✅ **Rebaseline** - Fixed
4. ✅ **Bulk Update** - Already correct
5. ⚠️ **Start New Cycle** - Check server-side API to ensure it uses same logic

---

## Testing Checklist

After fixes:

- [ ] Keyword task: Add Measurement → Should get rank and AI data
- [ ] Keyword task: Rebaseline → Should get rank and AI data (not old baseline)
- [ ] Keyword task: Update Task Latest → Should get rank and AI data
- [ ] Keyword task: Bulk Update → Should get rank and AI data
- [ ] URL task: All operations → Should continue working (unchanged)
- [ ] Start New Cycle: Check if baseline uses correct logic (server-side)

---

## Files Modified

- `audit-dashboard.html`:
  - Line ~13797-13820: Add Measurement - RankingAiModule check (Fix 1)
  - Line ~13847-13870: Add Measurement - window.rankingAiData check (Fix 1)
  - Line ~14538-14579: Rebaseline - Added keyword task logic (Fix 2)
  - Line ~15530-15553: Update Task Latest - combinedRows check (Fix 1)
  - Line ~15037-15048: Bulk Update - Already correct (no change needed)

---

## Next Steps

1. ✅ Fix Add Measurement (Done)
2. ✅ Fix Rebaseline (Done)
3. ⚠️ Verify Start New Cycle server-side logic
4. ⚠️ Test all operations with keyword and URL tasks
