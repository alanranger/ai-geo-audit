# Investigation Findings: Photography Tuition Keyword Task Data Mismatch

## Executive Summary

**Issue**: "photography tuition" keyword task shows rank #5 and AI Overview in Ranking & AI tab, but shows "—" (missing) in Optimization Task module.

**Root Cause**: The Optimization Task "Add Measurement" function requires BOTH keyword match AND URL match when checking `combinedRows` (which contains ranking/AI data). If the task's URL doesn't match the `combinedRows` URL, it falls back to `queryTotals` (from GSC API), which does NOT contain ranking or AI Overview data.

**Solution**: Make URL matching optional for keyword-based tasks when checking `combinedRows`.

---

## Detailed Findings

### 1. Data Source Architecture

The system uses **TWO SEPARATE DATA SOURCES**:

#### Source A: queryTotals (from GSC API)
- **Purpose**: Query-level performance metrics
- **Fields**: `query`, `clicks`, `impressions`, `position`, `ctr`
- **Contains**: GSC performance data only
- **Missing**: Ranking data (`best_rank`), AI data (`has_ai_overview`, `ai_alan_citations_count`)
- **Stored in**: `audit_results.query_totals` (JSONB array)

#### Source B: combinedRows (from Ranking & AI scan)
- **Purpose**: SERP rankings and AI Overview data
- **Fields**: `keyword`, `best_rank_group`, `has_ai_overview`, `ai_total_citations`, `best_url`
- **Contains**: Ranking and AI data from DataForSEO SERP scan
- **Missing**: Sometimes GSC metrics (`gsc_clicks_28d`, `gsc_impressions_28d`)
- **Stored in**: `audit_results.ranking_ai_data.combinedRows` (JSONB array)
- **Also stored in**: `keyword_rankings` table (one row per keyword)

### 2. How Each Module Uses Data

#### Ranking & AI Tab
- **Data Source**: `RankingAiModule.state().combinedRows` OR `window.rankingAiData`
- **Matching**: No URL matching required - displays all keywords
- **Result**: ✅ Always shows ranking/AI data correctly

#### Optimization Task "Add Measurement"
- **Data Source Priority**:
  1. `RankingAiModule.state().combinedRows` → **REQUIRES keyword + URL match**
  2. `window.rankingAiData` → **REQUIRES keyword + URL match**
  3. Money Pages data (URL-only)
  4. `queryTotals` from localStorage → Supports keyword OR URL match
  5. `queryTotals` from Supabase → Supports keyword OR URL match
  6. `queryPages` from Supabase

- **Problem**: Steps 1-2 require URL match. If URL doesn't match, falls to steps 4-5 which have NO ranking/AI data.

### 3. Diagnostic Test Results

**Script**: `scripts/diagnose-keyword-data-sources.js`

**Results for "photography tuition"**:

✅ **query_totals**: Contains keyword
- Fields: `ctr, query, clicks, position, impressions`
- **Missing**: `best_rank`, `has_ai_overview`, `ai_alan_citations_count`

✅ **combinedRows**: Contains keyword
- Fields: `best_rank_group: 5`, `has_ai_overview: true`, `ai_total_citations: 18`
- URL: `https://www.alanranger.com/photography-tuition-services?srsltid=...`

✅ **keyword_rankings table**: Contains keyword
- Same data as combinedRows

### 4. The Mismatch

**Ranking & AI Tab**:
- Uses `combinedRows` directly
- No URL matching required
- Shows: rank #5, AI Overview: On ✅

**Optimization Task "Add Measurement"**:
- Tries `combinedRows` but requires URL match
- If task URL ≠ `combinedRows.best_url` → fails
- Falls back to `queryTotals` which has no ranking/AI data
- Shows: rank —, AI Overview: Not present ❌

---

## Recommended Fix

### Option 1: Make URL Matching Optional (Recommended)
**Location**: `audit-dashboard.html` lines 13797-13811 and 13847-13860

**Change**:
```javascript
// Current: Requires both keyword AND URL match
matchingRow = combinedRows?.find(r => {
  const keywordMatch = (r.keyword || '').toLowerCase() === (task.keyword_text || '').toLowerCase();
  if (!keywordMatch) return false;
  
  // REQUIRES URL match
  return rowUrl === taskUrlClean || ...;
});

// New: URL match optional for keyword tasks
matchingRow = combinedRows?.find(r => {
  const keywordMatch = (r.keyword || '').toLowerCase() === (task.keyword_text || '').toLowerCase();
  if (!keywordMatch) return false;
  
  // If task has no URL, keyword match is sufficient
  if (!taskUrlClean || taskUrlClean.length === 0) {
    return true; // Keyword match only
  }
  
  // If task has URL, try to match it (preferred but not required)
  const rowUrl = (r.best_url || r.targetUrl || r.ranking_url || '').toLowerCase();
  const rowUrlClean = rowUrl.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  const urlMatch = rowUrlClean === taskUrlClean || ...;
  
  // Accept if URL matches, OR if keyword matches (for keyword-only tasks)
  return urlMatch || true; // Always accept keyword match for keyword tasks
});
```

**Risk**: Low - only affects keyword tasks

### Option 2: Query keyword_rankings Table Directly
**Location**: Add new check after Supabase queryTotals check

**Change**:
- Add new data source check that queries `keyword_rankings` table directly
- Match by keyword only (no URL requirement)
- This table has the same structure as `combinedRows`

**Risk**: Low - adds another fallback option

### Option 3: Combine Data from Multiple Sources
**Location**: Lines 13822-13836

**Change**:
- Get GSC metrics from `queryTotals` (clicks, impressions, CTR)
- Get ranking/AI data from `combinedRows` (rank, AI Overview, citations)
- Merge both sources into `currentMetrics`

**Risk**: Medium - requires careful data merging logic

---

## Recommendation

**Implement Option 1** (Make URL matching optional):
- Simplest fix
- Addresses root cause directly
- Low risk
- Maintains backward compatibility

**Also consider Option 2** as a fallback:
- Provides additional data source
- More resilient if `combinedRows` isn't loaded

---

## Files to Modify

1. `audit-dashboard.html`:
   - Line ~13797-13811: RankingAiModule combinedRows matching
   - Line ~13847-13860: window.rankingAiData matching
   - Line ~14798-14809: Bulk update combinedRows matching (already has better logic!)

---

## Testing Plan

After implementing fix:

1. Test keyword task with matching URL → Should work (existing behavior)
2. Test keyword task with non-matching URL → Should now work (new behavior)
3. Test keyword task with no URL → Should now work (new behavior)
4. Test page task (no keyword) → Should still work (unchanged)
5. Verify Ranking & AI tab still works correctly
6. Verify other keyword tasks still work

---

## Additional Investigation: All Audit/Scan Processes

**New Document**: `ALL-AUDIT-SCAN-PROCESSES.md`

This document lists **11 distinct processes** that can update/refresh/scan/audit data:

### Main Processes:
1. **Run Audit Scan** - Creates `queryTotals` (GSC data, NO ranking/AI)
2. **Run Ranking & AI Scan** - Creates `combinedRows` (ranking/AI data)
3. **Run Money Pages Scan** - Refreshes Money Pages from audit
4. **Run Domain Strength Snapshot** - Calculates domain strength
5. **Sync CSV** - Syncs URL/backlink data

### Optimization Task Updates:
6. **Add Measurement** (individual) - Requires URL match for `combinedRows`
7. **Update Task Latest** (individual) - Same logic as Add Measurement
8. **Bulk Update All Tasks** - Allows keyword match without URL (BETTER logic)

### Global/Refresh:
9. **Run All Audits & Updates** - Runs all processes in sequence
10. **Ranking & AI Tab Refresh** - Displays existing data
11. **Dashboard Tab Refresh** - Displays existing data

### Key Inconsistency Issues Identified:

1. **Separate Data Sources**: Main Audit and Ranking & AI Scan are separate processes that may run at different times
2. **Different Matching Logic**: "Add Measurement" requires URL match, "Bulk Update" doesn't
3. **Data Source Priority Differences**: Different processes check data sources in different order
4. **Stale Data**: localStorage vs Supabase may be out of sync
5. **Timing Dependencies**: Some processes depend on others completing first

**See `ALL-AUDIT-SCAN-PROCESSES.md` for full details.**

---

## Investigation Status: COMPLETE ✅

- [x] Reverted previous change
- [x] Read key documentation
- [x] Created investigation plan
- [x] Documented all update/refresh processes
- [x] Mapped data sources for each module
- [x] Compared keyword vs page task logic
- [x] Verified Supabase schema structure
- [x] Tested data flow end-to-end
- [x] Identified root cause
- [x] Documented all audit/scan processes
- [x] Identified inconsistency issues across processes
- [x] Proposed solutions

**Ready for implementation after user review.**
