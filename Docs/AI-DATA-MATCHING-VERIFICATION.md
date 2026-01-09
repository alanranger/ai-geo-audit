# AI Data Matching Verification: Keyword Tasks vs URL Tasks

## Overview

This document verifies that AI data (AI Overview and AI Citations) is fetched consistently between keyword tasks and URL tasks, and explains when they should match.

---

## How Each Task Type Fetches AI Data

### Keyword Tasks

**Data Source**: `ranking_ai_data.combinedRows` from latest audit in Supabase

**Matching Logic**:
1. Fetches latest audit from Supabase to get `ranking_ai_data`
2. Loads `combinedRows` from multiple sources (RankingAiModule state, `window.rankingAiData`, localStorage)
3. **Matches by keyword** in `combinedRows` (URL matching is optional - preferred but not required)
4. Gets AI data from the **single matching row**:
   - `ai_overview`: `has_ai_overview` or `ai_overview_present_any` from that row
   - `ai_citations`: `ai_alan_citations_count` from that row

**Code Locations**:
- Task Creation: `audit-dashboard.html`, lines ~6682-6703
- Add Measurement: `audit-dashboard.html`, lines ~14523-14616
- Rebaseline: `audit-dashboard.html`, lines ~15285-15380

**Example**:
- Task keyword: `"photography courses"`
- Finds row in `combinedRows` where `keyword === "photography courses"`
- Gets: `ai_overview: true`, `ai_citations: 3` (from that specific keyword row)

---

### URL Tasks

**Data Source**: `ranking_ai_data.combinedRows` from latest audit in Supabase

**Matching Logic**:
1. Fetches latest audit from Supabase to get `ranking_ai_data`
2. Loads `combinedRows` from multiple sources (same as keyword tasks)
3. **Calls `computeAiMetricsForPageUrl(targetUrl, combinedRows)`** which:
   - Searches through ALL rows in `combinedRows`
   - Finds keywords where the target URL appears in their `ai_alan_citations` array
   - **Aggregates** AI data across all matching keywords:
     - `ai_overview`: `true` if **ANY** keyword citing the URL has overview
     - `ai_citations`: **SUM** of all citations from all keywords citing the URL

**Code Locations**:
- Task Creation: `audit-dashboard.html`, lines ~6721-6803
- Add Measurement: `audit-dashboard.html`, lines ~14211-14450
- Rebaseline: `audit-dashboard.html`, lines ~15465-15530
- Core Function: `audit-dashboard.html`, lines ~12741-12985 (`computeAiMetricsForPageUrl`)

**Example**:
- Task URL: `"www.alanranger.com/photography-courses-coventry"`
- Finds keywords in `combinedRows` where `ai_alan_citations` array contains this URL:
  - Keyword `"photography courses"` cites the URL (3 citations)
  - Keyword `"photography classes"` cites the URL (2 citations)
  - Keyword `"photography tuition"` cites the URL (1 citation)
- Aggregates: `ai_overview: true` (at least one has overview), `ai_citations: 6` (3+2+1)

---

## When Should They Match?

### Scenario 1: Keyword Task with URL = URL Task Target

**When**: A keyword task has both a keyword AND a URL, and a URL task targets the same URL.

**Expected Behavior**:
- **Keyword Task**: Gets AI data from the specific keyword row
- **URL Task**: Aggregates AI data from ALL keywords citing the URL
- **Match**: They should match **IF** the keyword task's keyword is the ONLY keyword citing the URL
- **Partial Match**: If multiple keywords cite the URL:
  - URL task's `ai_citations` should be **>=** keyword task's `ai_citations`
  - URL task's `ai_overview` might be `true` even if keyword task's is `false` (if another keyword has overview)

**Example**:
- Keyword Task: `keyword="photography courses"`, `url="www.alanranger.com/photography-courses-coventry"`
- URL Task: `url="www.alanranger.com/photography-courses-coventry"`
- If ONLY `"photography courses"` cites this URL:
  - ✅ Both should show: `ai_overview: true`, `ai_citations: 3`
- If `"photography courses"` (3 citations) AND `"photography classes"` (2 citations) cite this URL:
  - Keyword Task: `ai_overview: true`, `ai_citations: 3`
  - URL Task: `ai_overview: true`, `ai_citations: 5` (3+2)
  - ⚠️ They differ (URL task aggregates all citations)

---

### Scenario 2: Keyword Task without URL vs URL Task

**When**: A keyword task has only a keyword (no URL), and a URL task targets a URL that the keyword cites.

**Expected Behavior**:
- **Keyword Task**: Gets AI data from the keyword row (regardless of which URL it cites)
- **URL Task**: Aggregates AI data from all keywords citing the URL
- **Match**: They should match **IF**:
  - The keyword task's keyword cites the URL task's target URL
  - AND the keyword is the ONLY keyword citing that URL

**Example**:
- Keyword Task: `keyword="photography courses"` (no URL)
- URL Task: `url="www.alanranger.com/photography-courses-coventry"`
- If `"photography courses"` cites this URL and is the only keyword doing so:
  - ✅ Both should show: `ai_overview: true`, `ai_citations: 3`

---

## Verification Checklist

### ✅ Code Consistency Verification

1. **Both use same data source**: ✅
   - Keyword tasks: `ranking_ai_data.combinedRows` from latest audit
   - URL tasks: `ranking_ai_data.combinedRows` from latest audit

2. **Both fetch from Supabase**: ✅
   - Both call `fetchLatestAuditFromSupabase()` to get fresh data
   - Both load `combinedRows` from the same sources (RankingAiModule, `window.rankingAiData`, localStorage)

3. **Both use consistent logic**: ✅
   - Keyword tasks: Match by keyword (URL optional)
   - URL tasks: Use `computeAiMetricsForPageUrl()` which searches `ai_alan_citations` arrays
   - Both use the same `combinedRows` data structure

4. **Both handle missing data**: ✅
   - Both check if `combinedRows` is loaded before processing
   - Both retry loading from Supabase if data is empty
   - Both log warnings when data is unavailable

---

### ✅ Functional Verification

To verify that AI data matches between keyword tasks and URL tasks:

1. **Create a keyword task** with a keyword that cites a specific URL:
   - Go to Ranking & AI tab
   - Find a keyword that has AI Citations
   - Note the URL it cites (from `ai_alan_citations` array)
   - Click "Track" to create a keyword task
   - Note the AI Overview and AI Citations values

2. **Create a URL task** for the same URL:
   - Go to Money Pages tab
   - Find the same URL (or create a URL task manually)
   - Click "Track" to create a URL task
   - Note the AI Overview and AI Citations values

3. **Compare the values**:
   - **If only one keyword cites the URL**: Values should match exactly
   - **If multiple keywords cite the URL**: URL task's citations should be >= keyword task's citations

4. **Test "Add Measurement"** for both tasks:
   - Click "Add Measurement" on the keyword task
   - Click "Add Measurement" on the URL task
   - Verify that both get the same AI data as at creation time

5. **Check debug logs**:
   - Open browser console
   - Look for `[computeAiMetricsForPageUrl]` logs
   - Verify that URL matching is working correctly
   - Verify that `combinedRows` is loaded

---

## Expected Results

### ✅ Correct Behavior

1. **Keyword task with URL**:
   - Gets AI data from the keyword row
   - Shows: `ai_overview: true/false`, `ai_citations: N` (from that keyword)

2. **URL task**:
   - Gets AI data by aggregating all keywords citing the URL
   - Shows: `ai_overview: true` (if any keyword has overview), `ai_citations: SUM` (sum of all citations)

3. **When they match**:
   - If only one keyword cites the URL, both should show the same values
   - If multiple keywords cite the URL, URL task should show aggregated values (>= keyword task)

### ❌ Incorrect Behavior (Should Not Happen)

1. **Keyword task shows AI data, URL task shows `null`**:
   - ❌ This indicates `computeAiMetricsForPageUrl()` is not finding matches
   - Check: URL normalization, `combinedRows` loading, `ai_alan_citations` array structure

2. **URL task shows different values on "Add Measurement" vs task creation**:
   - ❌ This indicates inconsistent logic between creation and measurement
   - Check: Both should use `computeAiMetricsForPageUrl()` with same parameters

3. **Values change unexpectedly**:
   - ❌ This indicates data source inconsistency
   - Check: Both should fetch from latest audit in Supabase

---

## Code Verification Summary

### ✅ Both Task Types Use Same Data Source

| Aspect | Keyword Tasks | URL Tasks | Status |
|--------|--------------|-----------|--------|
| **Data Source** | `ranking_ai_data.combinedRows` | `ranking_ai_data.combinedRows` | ✅ Same |
| **Fetch Method** | `fetchLatestAuditFromSupabase()` | `fetchLatestAuditFromSupabase()` | ✅ Same |
| **Data Loading** | Multiple sources (RankingAiModule, window, localStorage) | Multiple sources (same) | ✅ Same |
| **Lookup Method** | Keyword match in `combinedRows` | `computeAiMetricsForPageUrl()` | ✅ Different (by design) |
| **AI Overview** | From matching row | Aggregated (any keyword has overview) | ✅ Different (by design) |
| **AI Citations** | From matching row | Aggregated (sum of all citations) | ✅ Different (by design) |

### ✅ Consistency Across Operations

| Operation | Keyword Tasks | URL Tasks | Status |
|-----------|--------------|-----------|--------|
| **Task Creation** | ✅ Fetches from Supabase | ✅ Fetches from Supabase | ✅ Consistent |
| **Add Measurement** | ✅ Fetches from Supabase | ✅ Fetches from Supabase | ✅ Consistent |
| **Rebaseline** | ✅ Fetches from Supabase | ✅ Fetches from Supabase | ✅ Consistent |
| **Start New Cycle** | ✅ Queries `keyword_rankings` table | ⚠️ Falls back to latest measurement | ⚠️ Could be improved |

---

## Conclusion

✅ **Code Verification**: Both keyword tasks and URL tasks use the same data source (`ranking_ai_data.combinedRows` from latest audit) and fetch it consistently across all operations.

✅ **Logic Verification**: The logic is correct but intentionally different:
- **Keyword tasks**: Get AI data from a single keyword row
- **URL tasks**: Aggregate AI data across all keywords citing the URL

✅ **Expected Matching**: They should match when only one keyword cites the URL. When multiple keywords cite the URL, the URL task will show aggregated values (which is correct behavior).

✅ **Consistency**: Both task creation and "Add Measurement" now use the same logic for fetching AI data, ensuring consistency across all operations.

---

## Next Steps

1. **Test with real data**: Create both task types for the same URL and verify they show expected values
2. **Monitor debug logs**: Check `[computeAiMetricsForPageUrl]` logs to verify URL matching is working
3. **Verify aggregation**: Test with URLs that have multiple keywords citing them to verify aggregation works correctly
4. **Check edge cases**: Test with URLs that have no citations, URLs with only one citation, and URLs with many citations
