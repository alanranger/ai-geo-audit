# Task Update Paths - Visual Flow Diagram

## URL-Only Tasks (No Keyword)

```
┌─────────────────────────────────────────────────────────────────┐
│                    TASK CREATION                                │
│              submitTrackKeyword()                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │  window.moneyPagesMetrics.rows      │
        │  OR GSC page totals API             │
        └─────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │  Fetch latest audit from Supabase   │
        │  → ranking_ai_data.combinedRows     │
        └─────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │  computeAiMetricsForPageUrl()      │
        │  Fallback: Supabase API             │
        └─────────────────────────────────────┘
                              │
                              ▼
                    [Create Task + Baseline]
```

```
┌─────────────────────────────────────────────────────────────────┐
│              ADD MEASUREMENT (Drawer)                          │
│              addMeasurement() handler                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │  Fetch latest audit from Supabase   │
        └─────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │  GSC Page Totals API (28d)          │
        │  → clicks, impressions, CTR, pos    │
        └─────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │  Get combinedRows from:              │
        │  - RankingAiModule.state()           │
        │  - window.rankingAiData               │
        │  - localStorage                       │
        └─────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │  computeAiMetricsForPageUrl()       │
        │  → AI overview, AI citations        │
        └─────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │  Fallback: Supabase API              │
        │  (if computeAiMetricsForPageUrl fails)│
        └─────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │  Fallback: Ranking & AI for rank    │
        │  (if GSC position is null)          │
        └─────────────────────────────────────┘
                              │
                              ▼
                    [Create Measurement]
```

```
┌─────────────────────────────────────────────────────────────────┐
│              BULK UPDATE ALL TASKS                              │
│              bulkUpdateAllTasks()                              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │  Fetch latest audit from Supabase    │
        │  Update localStorage                 │
        │  Update window.moneyPagesMetrics     │
        └─────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │  For each task:                      │
        │  Search window.moneyPagesMetrics.rows│
        │  OR localStorage last_audit_results │
        └─────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │  computeAiMetricsForPageUrl()       │
        │  Fallback: Supabase API              │
        │  Fallback: Ranking & AI for rank    │
        └─────────────────────────────────────┘
                              │
                              ▼
                    [Create Measurement]
```

---

## Keyword-Based Tasks

```
┌─────────────────────────────────────────────────────────────────┐
│                    TASK CREATION                                │
│              submitTrackKeyword()                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │  Get rowData from combinedRows      │
        │  (keyword match)                     │
        └─────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │  Get queryTotal for keyword          │
        │  (from latest audit queryTotals)     │
        └─────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │  Extract from rowData:               │
        │  - rank (best_rank_group)            │
        │  - AI overview (has_ai_overview)     │
        │  - AI citations (ai_alan_citations)  │
        └─────────────────────────────────────┘
                              │
                              ▼
                    [Create Task + Baseline]
```

```
┌─────────────────────────────────────────────────────────────────┐
│              ADD MEASUREMENT (Drawer)                          │
│              addMeasurement() handler                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │  Fetch latest audit from Supabase    │
        └─────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │  Get combinedRows from:              │
        │  - RankingAiModule.state()           │
        │  - window.rankingAiData               │
        │  - localStorage                       │
        └─────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │  Find matchingRow by keyword         │
        │  (URL match optional)                │
        └─────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │  Get queryTotal for keyword           │
        │  (from latest audit queryTotals)     │
        └─────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │  Build metrics from:                  │
        │  - queryTotal (clicks, impressions, CTR)│
        │  - matchingRow (rank, AI data)       │
        └─────────────────────────────────────┘
                              │
                              ▼
                    [Create Measurement]
```

```
┌─────────────────────────────────────────────────────────────────┐
│              BULK UPDATE ALL TASKS                              │
│              bulkUpdateAllTasks()                               │
│                    ❌ BUG HERE ❌                                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │  Fetch latest audit from Supabase    │
        │  Get combinedRows                    │
        └─────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │  Find matchingRow by keyword         │
        │  (line 16898-16911)                  │
        └─────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │  ❌ BUG: Check Money Pages first     │
        │  (line 16914)                        │
        │  Sets currentMetrics from Money Pages│
        └─────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────┐
        │  ❌ BUG: Use matchingRow check      │
        │  (line 17339)                        │
        │  But currentMetrics already set!     │
        │  So matchingRow is IGNORED           │
        └─────────────────────────────────────┘
                              │
                              ▼
                    [Create Measurement]
                    ❌ WRONG DATA SOURCE ❌
```

---

## The Bug in Detail

### Current Flow (WRONG):
```
bulkUpdateAllTasks() for keyword task:
1. Find matchingRow in combinedRows ✅
2. Check Money Pages data (line 16914) ❌
   → Sets currentMetrics from Money Pages (page-level aggregated)
3. Try to use matchingRow (line 17339) ❌
   → But currentMetrics already set, so skipped
4. Result: Keyword task gets Money Pages data instead of keyword-specific data
```

### Correct Flow (SHOULD BE):
```
bulkUpdateAllTasks() for keyword task:
1. Find matchingRow in combinedRows ✅
2. Use matchingRow IMMEDIATELY ✅
   → Build currentMetrics from keyword-specific data
3. Skip Money Pages lookup ✅
   → Only for URL-only tasks
4. Result: Keyword task gets keyword-specific data
```

---

## Comparison: All Functions

| Function | URL Task Data Source | Keyword Task Data Source | Supabase Fallback (AI) | Ranking Fallback (Rank) |
|----------|---------------------|-------------------------|------------------------|------------------------|
| **submitTrackKeyword** | Money Pages / GSC API | combinedRows + queryTotals | ✅ | N/A |
| **addMeasurement** | GSC API → computeAiMetrics → Supabase | combinedRows + queryTotals | ✅ | ✅ |
| **rebaseline** | GSC API → computeAiMetrics | combinedRows + queryTotals | ❌ | ✅ |
| **updateTaskLatest** | GSC API → computeAiMetrics → Supabase | combinedRows + queryTotals | ✅ | N/A |
| **bulkRebaselineIncomplete** | GSC API → computeAiMetrics | combinedRows + queryTotals | ❌ | ✅ |
| **bulkUpdateAllTasks** | Money Pages → computeAiMetrics → Supabase | ❌ **BUG: Falls through to Money Pages** | ✅ | ✅ |

---

## Summary

### Issues Found:
1. **`bulkUpdateAllTasks` uses wrong data source for keyword tasks** - Uses Money Pages (page-level) instead of keyword-specific data
2. **`rebaseline` and `bulkRebaselineIncompleteBaselines` missing Supabase fallback** - Inconsistent with `addMeasurement`

### Fixes Needed:
1. Move `matchingRow` usage BEFORE Money Pages lookup in `bulkUpdateAllTasks`
2. Add Supabase fallback to `rebaseline` and `bulkRebaselineIncompleteBaselines`
3. Consider extracting shared logic into helper functions for consistency
