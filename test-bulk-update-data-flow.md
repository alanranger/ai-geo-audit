# Test Plan: Bulk Update Data Flow

## Issue
Tasks not updating after "Fetch All Data" or global audit runs.

## Root Cause (Fixed)
`bulkUpdateAllTasks` was using `localStorage.getItem('aigeo_audit_data')` instead of `last_audit_results`.

## Fix Applied
1. Changed to check `last_audit_results` first, then fallback to `aigeo_audit_data`
2. Replaced all console calls with debugLog
3. Verified UI refresh functions are called

## Data Flow Verification

### Step 1: Global Audit Saves Data
- `runDashboardGlobalRun()` → `runAudit()` → `saveAuditResults()`
- Saves to: `localStorage.setItem('last_audit_results', auditData)`
- Structure: `{ scores: { moneyPagesMetrics: {...}, ... }, searchData: { queryTotals: [...] }, ... }`
- Also sets: `window.moneyPagesMetrics = moneyPagesMetrics`

### Step 2: Bulk Update Reads Data
- `bulkUpdateAllTasks()` checks data sources in this order:
  1. `window.moneyPagesMetrics` (if audit just ran)
  2. `localStorage.getItem('last_audit_results')` → `parsed.scores.moneyPagesMetrics` ✓ FIXED
  3. `localStorage.getItem('aigeo_audit_data')` → `parsed.scores.moneyPagesMetrics` (legacy fallback)
  4. `parsed.searchData.queryTotals` (for URL-based tasks)

### Step 3: Creates Measurements
- For each task, creates measurement via API: `POST /api/optimisation/task/{id}/measurement`
- Waits 3 seconds for backend to process
- Reloads tasks with cache-busting

### Step 4: UI Refresh
- Calls `loadAllOptimisationTasks()` (with cache-busting)
- Calls `renderOptimisationTasksTable()`
- Calls `updateOptimisationSummaryCards()`
- Calls `updateTrafficLights()`
- Calls `renderDashboardTab()`

## Expected Behavior After Fix
1. Global audit completes → saves to `last_audit_results` ✓
2. `bulkUpdateAllTasks()` reads from `last_audit_results` ✓ (FIXED)
3. Creates measurements for all tasks ✓
4. UI refreshes to show updated metrics ✓

## Test Steps

### Prerequisites
1. Open the UI debug log (bottom panel with orange border)
2. Ensure you have at least one optimization task created
3. Have recent audit data available (run a global audit first if needed)

### Test 1: Verify Data Source Fix
1. Run "Fetch All Data" button in Optimisation tab
2. **Check UI debug log** for these messages:
   - `[Optimisation] ===== bulkUpdateAllTasks START =====`
   - `[Optimisation] Data sources available: last_audit_results=true, ...`
   - `[Optimisation] Reading audit data from last_audit_results for task X` ✓ (Should say "last_audit_results", NOT "aigeo_audit_data")
   - `[Optimisation] Parsed audit data: hasMoneyPagesData=true, ...`
3. **Verify**: The log should show it's reading from `last_audit_results`, not `aigeo_audit_data`

### Test 2: Verify Task Updates
1. After "Fetch All Data" completes, check UI debug log for:
   - `[Optimisation] Fetching fresh task data from API (attempt 1/3)...`
   - `[Optimisation] Task X has new data: [old timestamp] -> [new timestamp]` (if data changed)
   - `[Optimisation] Force refreshing all UI components...`
2. **Verify on dashboard**:
   - Optimisation tab shows updated metrics in summary cards
   - Task table shows updated values (clicks, impressions, CTR, rank, AI citations)
   - Traffic lights reflect changes (green=better, red=worse, gray=same)
3. **Verify in task drawer**:
   - Open any task drawer
   - Check "Latest Measurement" section shows new data
   - Check measurement history shows new entry with timestamp

### Test 3: Verify Global Audit Flow
1. Run "Run Global Audit" from dashboard
2. Wait for all steps to complete (including "Update All Tasks")
3. **Check UI debug log** for:
   - `[Global Run] Audit data found: hasSearchData=true, hasMoneyPagesMetrics=true, ...`
   - `[Optimisation] Reading audit data from last_audit_results...`
   - `[Optimisation] Task X has new data: ...`
4. **Verify**: Dashboard and optimisation tab both show updated data

## Code Verification (Completed)
✅ **Fixed**: `bulkUpdateAllTasks` now reads from `last_audit_results` first (line 14691)
✅ **Fixed**: `fetchMoneyPagesSegmentAll` now reads from `last_audit_results` first (line 29366)
✅ **Verified**: `saveAuditResults` saves to `last_audit_results` (line 19630)
✅ **Verified**: `runDashboardGlobalRun` checks `last_audit_results` before calling `bulkUpdateAllTasks` (line 51022)
✅ **Verified**: All logging uses `debugLog` (UI debug log, not browser console)
✅ **Verified**: No syntax errors in code

## Potential Issues to Check During Testing
- [ ] Is `window.moneyPagesMetrics` set when audit completes?
- [ ] Is `last_audit_results` structure correct? (Check: `parsed.scores.moneyPagesMetrics` exists)
- [ ] Are API calls succeeding (check network tab)?
- [ ] Is cache-busting working (check API URLs have `_t=` parameter)?
- [ ] Are tasks being skipped due to 5-minute window? (Check log for "skipped" messages)

## Quick Verification Checklist
After running "Fetch All Data" or "Run Global Audit", verify:

1. **UI Debug Log shows correct data source**:
   - ✅ `[Optimisation] Reading audit data from last_audit_results for task X`
   - ❌ NOT: `[Optimisation] Reading audit data from aigeo_audit_data for task X`

2. **Tasks have new measurements**:
   - ✅ Check task drawer → "Latest Measurement" shows new timestamp
   - ✅ Check measurement history has new entry

3. **Dashboard updates**:
   - ✅ Optimisation tab summary cards show updated metrics
   - ✅ Traffic lights reflect changes (green/red/gray)
   - ✅ Task table shows updated values

## Success Criteria (What to Look For)

### ✅ FIXED - You should see:
1. **In UI Debug Log** (after clicking "Fetch All Data"):
   ```
   [Optimisation] ===== bulkUpdateAllTasks START =====
   [Optimisation] Data sources available: last_audit_results=true, aigeo_audit_data=false, window.moneyPagesMetrics=false
   [Optimisation] Reading audit data from last_audit_results for task [task-id] ([keyword/url])
   [Optimisation] Parsed audit data: hasMoneyPagesData=true, moneyPagesRows=[number], hasSearchData=true, queryTotalsCount=[number]
   [Optimisation] Task [task-id] has new data: [old-timestamp] -> [new-timestamp]
   [Optimisation] Force refreshing all UI components...
   ```

2. **In Optimisation Tab**:
   - Summary cards show updated numbers (clicks, impressions, CTR, rank, AI citations)
   - Traffic lights show green (better), red (worse), or gray (same) based on changes
   - Task table rows show updated values

3. **In Task Drawer** (open any task):
   - "Latest Measurement" section shows a recent timestamp (within last few minutes)
   - Measurement history shows a new entry at the top
   - Metrics (clicks, impressions, CTR, rank, AI citations) show updated values

### ❌ NOT FIXED - If you see:
1. **In UI Debug Log**:
   ```
   [Optimisation] Reading audit data from aigeo_audit_data for task X
   ```
   → This means the fix didn't work (should say "last_audit_results")

2. **No new measurements**:
   - Task drawer shows old timestamp
   - No new entry in measurement history
   - Dashboard metrics unchanged

3. **All tasks show "skipped"**:
   - Check log for: `[Optimisation] Task X skipped (within 5-minute window)`
   - This is normal if you just updated tasks - wait 5 minutes and try again

## Quick Test (2 minutes)
1. Open UI debug log (bottom panel)
2. Click "📊 Update All Tasks with Latest Data" in Optimisation tab
3. **Immediately check log** - should see:
   - `[Optimisation] ===== bulkUpdateAllTasks START =====`
   - `[Optimisation] Data sources available: last_audit_results=true, ...`
   - `[Optimisation] Reading audit data from last_audit_results for task X` ✅ (NOT "aigeo_audit_data")
4. Wait for completion (watch for progress messages)
5. **Check log for results**:
   - `[Optimisation] Task X updated successfully: clicks=..., impressions=..., ...` (for successful updates)
   - `[Optimisation] Task X skipped: measurement too recent` (if within 5-minute window)
   - `[Optimisation] Task X: FAILED - No data found...` (if no data available)
6. Open any task drawer - check "Latest Measurement" timestamp is recent
7. Check Optimisation tab - metrics should be updated

**If step 3 shows "last_audit_results" → Fix is working! ✅**
**If step 3 shows "aigeo_audit_data" → Fix didn't work ❌**

## What to Look For in UI Debug Log

### ✅ SUCCESS - You should see:
```
[Optimisation] ===== bulkUpdateAllTasks START =====
[Optimisation] Data sources available: last_audit_results=true, aigeo_audit_data=false, window.moneyPagesMetrics=false
[Optimisation] last_audit_results structure: hasScores=true, hasMoneyPagesMetrics=true, hasSearchData=true, queryTotalsCount=[number]
[Optimisation] Reading audit data from last_audit_results for task [id] ([keyword/url])
[Optimisation] Parsed audit data: hasMoneyPagesData=true, moneyPagesRows=[number], hasSearchData=true, queryTotalsCount=[number]
[Optimisation] Task [id] ([keyword/url]): Found matching Money Page row in last_audit_results: clicks=..., impressions=..., ...
[Optimisation] Task [id] updated successfully: clicks=..., impressions=..., ctr=..., rank=...
[Optimisation] Force refreshing all UI components...
[Optimisation] Task [id] has new data: [old-timestamp] -> [new-timestamp]
```

### ❌ FAILURE - If you see:
```
[Optimisation] Reading audit data from aigeo_audit_data for task X
```
→ This means the fix didn't work (should say "last_audit_results")

### ⚠️ WARNING - If you see:
```
[Optimisation] Task X skipped: measurement too recent (within 5-minute window)
```
→ This is normal - wait 5 minutes and try again

### ❌ ERROR - If you see:
```
[Optimisation] Task X: FAILED - No data found in Ranking & AI, Money Pages, or audit results
[Optimisation] Task X search details: keyword="...", url="...", hasRankingData=false, hasMoneyPagesData=false, hasLastAuditResults=true
```
→ This means the task URL/keyword doesn't match any data in the audit results. Check:
- Is the task URL/keyword correct?
- Does the audit data contain data for this URL/keyword?
- Run a fresh audit if needed
