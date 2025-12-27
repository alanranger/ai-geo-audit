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
1. Open browser console and UI debug log
2. Run "Fetch All Data" or global audit
3. Check UI debug log for:
   - `[Optimisation] Fetching fresh task data from API...`
   - `[Optimisation] Task X has new data: [old] -> [new]`
   - `[Optimisation] Force refreshing all UI components...`
4. Verify:
   - Optimisation dashboard shows updated metrics
   - Task drawers show new measurements
   - Traffic lights reflect changes

## Potential Issues to Check
- [ ] Is `window.moneyPagesMetrics` set when audit completes?
- [ ] Is `last_audit_results` structure correct?
- [ ] Are API calls succeeding (check network tab)?
- [ ] Is cache-busting working (check API URLs have `_t=` parameter)?
