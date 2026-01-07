# URL Task AI Matching - Diagnostic Tools

**Date Created**: 2026-01-07  
**Purpose**: Diagnostic tools and code added to identify why URL task AI data matching is failing

---

## Tools Added

### 1. Enhanced Diagnostic Logging in `addMeasurementBtn` Handler

**Location**: `audit-dashboard.html` line ~14110-14155

**What it logs**:
- Sample of first 5 `combinedRows` with their data structure
- Task URL and GSC URL being checked
- Potential matches found (rows with "photography-courses" in URL)
- Before/after calling `computeAiMetricsForPageUrl`
- Exact results returned from the function

**How to use**:
1. Open browser console (F12)
2. Click "Add Measurement" on the URL task
3. Check UI debug log for `[Optimisation] URL task DIAGNOSTIC:` messages
4. All diagnostic logs are at `error` level to bypass suppression

---

### 2. Enhanced Diagnostic Logging in `computeAiMetricsForPageUrl` Function

**Location**: `audit-dashboard.html` line ~12767-12793

**What it logs**:
- Function start with normalized target URL
- First 3 row comparisons with exact match results
- Sample rows structure showing field names
- Match attempts for rows containing "photography-courses"
- Final result summary

**How to use**:
- Automatically logs when URL contains "photography-courses-coventry"
- Check UI debug log for `[computeAiMetricsForPageUrl]` messages

---

### 3. Test Function: `window.testUrlTaskAiMatching()`

**Location**: `audit-dashboard.html` line ~12943

**What it does**:
- Tests URL matching logic directly
- Shows sample rows from `combinedRows`
- Finds potential matches
- Tests both `computeAiMetricsForPageUrl` with different URL formats
- Returns detailed diagnostic information

**How to use**:
1. Open browser console (F12)
2. Ensure Ranking & AI data is loaded (run Ranking & AI scan if needed)
3. Run: `await window.testUrlTaskAiMatching()`
4. Check console output and UI debug log for results

**Example Output**:
```javascript
{
  testUrl: "www.alanranger.com/photography-courses-coventry",
  testUrlFull: "https://www.alanranger.com/photography-courses-coventry",
  testUrlNormalized: "alanranger.com/photography-courses-coventry",
  totalRows: 80,
  matchingRowsCount: 5,
  sampleRows: [...],
  matchingRows: [...],
  result1: { ai_overview: true, ai_citations: 3 },
  result2: { ai_overview: true, ai_citations: 3 }
}
```

---

### 4. Node.js Diagnostic Script

**Location**: `test-url-task-ai-matching.js`

**What it does**:
- Queries Supabase `keyword_rankings` table directly
- Finds keywords with "photography" and "course"
- Checks `best_url` format and normalization
- Verifies AI overview and citations data exists
- Tests URL normalization logic

**How to use**:
```bash
# Set environment variable
export SUPABASE_SERVICE_ROLE_KEY=your_key_here

# Run script
node test-url-task-ai-matching.js
```

**Prerequisites**:
- Node.js 18+ (for native `fetch` support)
- `SUPABASE_SERVICE_ROLE_KEY` environment variable set
- Supabase project: `igzvwbvgvmzvvzoclufx` (supabase-main)

---

## Diagnostic Workflow

### Step 1: Verify Data Exists in Supabase

Run the Node.js script:
```bash
node test-url-task-ai-matching.js
```

**Expected Output**:
- Should find rows with keyword "photography courses" (or similar)
- Should show `best_url` containing "photography-courses-coventry"
- Should show `has_ai_overview: true` and `ai_alan_citations_count` > 0

**If no data found**:
- Check if Ranking & AI scan has been run recently
- Verify Supabase connection
- Check `audit_date` is recent

---

### Step 2: Test Matching Logic in Browser

1. Open browser console (F12)
2. Ensure Ranking & AI data is loaded:
   ```javascript
   // Check if data is available
   window.getRankingAiCombinedRows().length
   // Should be > 0
   ```
3. Run test function:
   ```javascript
   await window.testUrlTaskAiMatching()
   ```
4. Review output:
   - Check `matchingRowsCount` - should be > 0
   - Check `result1` and `result2` - should have non-null values
   - Review `sampleRows` to see data structure

---

### Step 3: Test "Add Measurement" with Enhanced Logging

1. Open UI debug log panel (bottom of dashboard)
2. Click "Add Measurement" on the URL task
3. Look for diagnostic messages:
   - `[Optimisation] URL task DIAGNOSTIC:` - Shows data structure
   - `[computeAiMetricsForPageUrl] START:` - Shows function entry
   - `[computeAiMetricsForPageUrl] Row 0/1/2:` - Shows URL comparisons
   - `[AI match debug]` - Shows when matches are found
   - `[AI match summary]` - Shows final decision

**What to check**:
- Are `combinedRows` loaded? (should see count > 0)
- What URLs are in the sample rows?
- Are any rows matching? (check `matchingRowsCount`)
- What does `computeAiMetricsForPageUrl` return?

---

## Common Issues & Solutions

### Issue 1: No `combinedRows` Available

**Symptoms**:
- `[Optimisation] URL task: Found 0 combinedRows for AI lookup`
- `[TEST] ERROR: No combinedRows available`

**Solution**:
1. Run Ranking & AI scan first
2. Check `localStorage.getItem('rankingAiData')` has data
3. Verify Supabase `audit_results.ranking_ai_data` exists

---

### Issue 2: URLs Don't Match After Normalization

**Symptoms**:
- `[TEST] Found 0 rows that should match`
- `[computeAiMetricsForPageUrl] Row 0: exactMatch=false`

**Solution**:
1. Check actual `best_url` format in Supabase (may have query params)
2. Verify normalization function handles all cases
3. Check if `best_url` is relative vs absolute

---

### Issue 3: Field Name Mismatch

**Symptoms**:
- `has_ai_overview: false` when it should be `true`
- `ai_alan_citations_count: 0` when it should be > 0

**Solution**:
1. Check `sampleRows` output to see actual field names
2. Verify field name variations are checked (snake_case vs camelCase)
3. Check if data structure differs from expected

---

### Issue 4: Function Not Being Called

**Symptoms**:
- No `[computeAiMetricsForPageUrl] START:` logs
- No diagnostic messages at all

**Solution**:
1. Hard refresh browser (Ctrl+Shift+R) to clear cache
2. Verify latest code is deployed
3. Check browser console for JavaScript errors
4. Verify function exists: `typeof window.computeAiMetricsForPageUrl === 'function'`

---

## Next Steps After Diagnosis

Once diagnostic tools reveal the issue:

1. **If data structure mismatch**: Update field name variations in `computeAiMetricsForPageUrl`
2. **If URL normalization issue**: Fix normalization logic or matching criteria
3. **If data not loaded**: Fix data loading in `addMeasurementBtn` handler
4. **If function not called**: Check browser cache and deployment

---

## Files Modified

1. **`audit-dashboard.html`**:
   - Enhanced `addMeasurementBtn` handler with diagnostic logging (line ~14110)
   - Enhanced `computeAiMetricsForPageUrl` function with diagnostic logging (line ~12767)
   - Added `window.testUrlTaskAiMatching()` test function (line ~12943)

2. **`test-url-task-ai-matching.js`** (NEW):
   - Node.js script to query Supabase directly
   - Tests URL normalization
   - Verifies data exists and format

---

## Usage Summary

**Quick Test in Browser**:
```javascript
// In browser console
await window.testUrlTaskAiMatching()
```

**Quick Test via Node.js**:
```bash
export SUPABASE_SERVICE_ROLE_KEY=your_key
node test-url-task-ai-matching.js
```

**Full Diagnostic**:
1. Run Node.js script to verify Supabase data
2. Run browser test function to verify matching logic
3. Click "Add Measurement" and check UI debug log
4. Compare results to identify the issue

---

**Status**: ✅ All diagnostic tools added and ready for use
