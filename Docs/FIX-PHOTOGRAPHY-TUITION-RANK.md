# Fix: Photography Tuition Rank/AI Data Not Showing in Optimization Task Module

**⚠️ NOTE**: This document describes Fix 1 (completed 2026-01-07). For the most current status of all fixes and ongoing issues, see **`HANDOVER.md`** (created 2026-01-07).

## Issue
- **Ranking & AI tab** shows: rank #5, AI Overview: On, AI Citations: 0 for "photography tuition"
- **Optimization task drawer** showed: rank —, AI Overview: —, AI Citations: —

## Root Cause
The optimization task module required **both keyword match AND URL match** to find data from Ranking & AI. Even though the keyword "photography tuition" matched, if the task's `target_url` didn't exactly match the Ranking & AI row's `best_url`, the match was rejected.

## Fix Applied (2026-01-07)
Made URL matching **optional** for keyword-based tasks in two locations:

1. **Line ~13801-13834**: Matching in `RankingAiModule.state().combinedRows`
2. **Line ~13872-13905**: Matching in `window.rankingAiData`

### Changes:
- If task has **no URL** → Accept keyword match only
- If task has **URL** → Try URL matching, but **don't require it** for keyword-based tasks
- Added detailed logging to track which matching strategy was used

### Logic Flow:
```
1. Check keyword match (required)
2. If keyword matches:
   - If task has no URL → ACCEPT (keyword match sufficient)
   - If task has URL:
     - Try URL matching
     - If URL matches → ACCEPT (preferred)
     - If URL doesn't match → STILL ACCEPT (keyword match is primary for keyword-based tasks)
```

## Testing
After this fix:
1. Open the optimization task drawer for "photography tuition"
2. Click "Add Measurement"
3. Should now show: rank #5, AI Overview: On, AI Citations: 0

## Revert Instructions
If this fix causes issues with other tasks:

1. **Location 1** (lines ~13801-13834): Restore original logic:
   ```javascript
   matchingRow = combinedRows?.find(r => {
     const keywordMatch = (r.keyword || '').toLowerCase() === (task.keyword_text || '').toLowerCase();
     if (!keywordMatch) return false;
     
     // Original: URL matching required
     const rowUrl = (r.best_url || r.targetUrl || r.ranking_url || '').toLowerCase();
     const rowUrlClean = rowUrl.replace(/^https?:\/\//, '').replace(/^www\./, '');
     const rowUrlPath = rowUrlClean.includes('/') ? rowUrlClean.split('/').slice(1).join('/') : '';
     
     return rowUrl === taskUrlClean || 
            rowUrlClean === taskUrlClean ||
            rowUrlPath === taskUrlPath ||
            rowUrl.includes(taskUrlClean) ||
            taskUrlClean.includes(rowUrlClean);
   });
   ```

2. **Location 2** (lines ~13872-13905): Same restore for `window.rankingAiData.find()`

3. Remove the FIX comments added at lines ~13789-13791 and ~13864

## Files Modified
- `audit-dashboard.html` (lines ~13788-13908)
