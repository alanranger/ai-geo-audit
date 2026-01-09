# URL Task AI Data Issue - Summary & Next Steps

## Date: 2026-01-07 14:24 UTC

## Problem Statement
URL task for `www.alanranger.com/photography-courses-coventry` is not displaying AI Overview or AI Citation data when "Add Measurement" is clicked.

## Evidence from UI Debug Log

### Key Log Entries:
```
[2026-01-07T14:24:12.325Z] [WARN] [Optimisation] URL task: Inconsistent result from computeAiMetricsForPageUrl for https://www.alanranger.com/photography-courses-coventry - Overview: false, Citations: null
[2026-01-07T14:24:12.325Z] [WARN] [Optimisation] URL task: Inconsistent result from computeAiMetricsForPageUrl for www.alanranger.com/photography-courses-coventry - Overview: false, Citations: null
[2026-01-07T14:24:12.325Z] [WARN] [Optimisation] URL task: No AI data found for https://www.alanranger.com/photography-courses-coventry or www.alanranger.com/photography-courses-coventry in 80 rows
```

### What This Tells Us:
1. ✅ Function is executing: `computeAiMetricsForPageUrl` is being called
2. ✅ Data is available: 80 rows in `combinedRows` are being checked
3. ❌ No match found: The function is not finding the URL in any of the 80 rows
4. ⚠️ Missing detailed logs: The internal matching logs (`[computeAiMetricsForPageUrl] Match attempt`, `strictPathMatch`, `domainOnlyMatch`) are **NOT** appearing in the UI debug log

## Root Cause Hypothesis

The `computeAiMetricsForPageUrl` function is likely failing to match because:

1. **URL Format Mismatch**: The task URL (`www.alanranger.com/photography-courses-coventry`) may not match the format stored in `combinedRows.best_url` (e.g., `https://www.alanranger.com/photography-courses-coventry?param=value`)

2. **Query Parameters**: The `best_url` field in `combinedRows` may contain query parameters that the matching logic doesn't handle

3. **Normalization Issues**: The URL normalization may be too strict or not accounting for all variations

## Immediate Actions Required

### 1. Find the Function Definition
Search `audit-dashboard.html` for:
- `window.computeAiMetricsForPageUrl =`
- `function computeAiMetricsForPageUrl`
- `computeAiMetricsForPageUrl = function`

### 2. Query Actual Data
Check what `best_url` values actually exist in the database for "photography courses" keywords to understand the format mismatch.

### 3. Fix Debug Log Saving
The Supabase `debug_logs` table only has 1 test entry. The automatic saving isn't working, preventing us from seeing detailed matching logs. Check:
- Network errors in browser console
- API endpoint `/api/supabase/save-debug-log-entry` response
- Silent error handling in `debugLog` function

### 4. Add Comprehensive Logging
Once the function is found, add logging to show:
- Each URL comparison (task URL vs row URL)
- Normalized versions of both URLs
- Why each match attempt fails
- Sample `best_url` values from rows being checked

### 5. Fix URL Matching
Update matching logic to handle:
- Query parameters (strip before comparison)
- Protocol differences (http vs https)
- Trailing slashes
- www vs non-www
- Path-only vs full URL formats

## Files Involved

1. `audit-dashboard.html` - Contains `computeAiMetricsForPageUrl` function (needs to be found)
2. `api/supabase/save-debug-log-entry.js` - Already checked, looks correct
3. Supabase database - Need to query actual `best_url` values

## Next Steps

1. **Locate the function** - Search for `computeAiMetricsForPageUrl` in `audit-dashboard.html`
2. **Query database** - Check actual `best_url` format for "photography courses" keywords
3. **Fix debug log saving** - Ensure logs are being saved to Supabase
4. **Enhance logging** - Add detailed matching diagnostics
5. **Fix matching logic** - Update to handle URL format variations

---

## Update: 2026-01-07 15:35 UTC

### What we tried
- Added a targeted match debug and an end-of-function summary log in `computeAiMetricsForPageUrl` scoped only to `photography-courses-coventry`.
- Re-ran “Add Measurement” multiple times to surface `[AI match summary]` entries.

### What happened
- The UI debug log still shows only the existing optimisation/traffic-lights warnings and the “Inconsistent result … Overview: false, Citations: null” message.
- No `[AI match summary]` entries appeared, which strongly suggests the function never found a matching row (the summary only emits when it reaches the return path).

### Current hypothesis
- The matching loop is not hitting any `urlMatches` branch for this URL, so `matchedKeyword` remains falsy. The “no match” debug is still not visible, likely because suppression filters hide WARN-level noise; we may need a higher-severity, no-match emit with a small sample of candidate URLs.
- We still need to verify the actual `best_url` values for this URL in Supabase (`ranking_ai_data`) to confirm whether data exists and how it is formatted (protocol, www, trailing slash, query params).

### Next actions
1) Query Supabase `ranking_ai_data` for `%photography-courses-coventry%` and record `best_url`, overview flags, and citation counts/array length.  
2) Emit a single no-match debug (error level) listing the first few normalized candidate `best_url` values when no match is found for this target.  
3) Re-run “Add Measurement” once and capture the new log line to see exactly what URLs were checked.

---

## Update: 2026-01-07 15:56 UTC

### Supabase Query Results (CONFIRMED)

**Database:** `supabase-main` (project_ref=igzvwbvgvmzvvzoclufx)  
**Table:** `keyword_rankings` (NOT `ranking_ai_data`)

**Key Findings:**
1. ✅ **Data EXISTS**: Found multiple rows with `best_url` containing `photography-courses-coventry`
2. ✅ **AI Overview Present**: 
   - "photography courses coventry": `has_ai_overview=true`, `ai_overview_present_any=true`, `ai_alan_citations_count=3`
   - "photography courses": `has_ai_overview=true`, `ai_overview_present_any=true`, `ai_alan_citations_count=0`
3. ⚠️ **Query Parameters**: All `best_url` values include query parameters like `?srsltid=AfmBOor95__fTIUJ_GMlKkAQoUjSIIal0CjjtW6Dp0QUuWyhvI3t5PAX`
4. ✅ **Normalization Should Work**: The `normalizeUrl` function strips query params (line 12753: `normalized.split('?')[0]`), so both should normalize to `alanranger.com/photography-courses-coventry`

### Root Cause Identified

The matching logic **should** work because:
- Task URL: `www.alanranger.com/photography-courses-coventry` → normalizes to `alanranger.com/photography-courses-coventry`
- DB URL: `https://www.alanranger.com/photography-courses-coventry?srsltid=...` → normalizes to `alanranger.com/photography-courses-coventry`
- These should match via `exactMatch` (line 12795)

**But it's not matching**, which suggests:
1. The `combinedRows` data structure might use different field names than expected
2. The `rowBestUrl` extraction (line 12778) might be failing
3. The rows might not be loaded correctly

### Debug Logs Added

Added critical debug logs (error level) that will show:
- Exact normalized target URL at function start
- First 3 row URLs and their normalized versions
- Whether `exactMatch` is true/false for each comparison

**Next Step:** Run "Add Measurement" again and check for new `[computeAiMetricsForPageUrl] START` and `Row 0/1/2` debug lines to see exactly what's being compared.

---

## Update: 2026-01-07 16:30 UTC

### Matching Logic Enhanced (Ultra-Permissive)

**Current State**: Matching logic has been made "ultra-permissive" with multiple fallback strategies:

1. **exactMatch**: Normalized URLs match exactly
2. **lastSegmentMatch**: Last path segment matches (e.g., "photography-courses-coventry")
3. **segmentContainsMatch**: Any segment contains the target segment
4. **pathOverlapMatch**: Paths have any overlap
5. **keywordMatch**: Both URLs contain the same keyword string (e.g., "photography-courses-coventry")

**Code Location**: `audit-dashboard.html` line ~12700-12900

### Critical Debug Logs Not Appearing

**Problem**: New critical debug logs (set to `error` level) are NOT appearing in UI debug log:
- `[computeAiMetricsForPageUrl] START` - Should log at function start
- `[computeAiMetricsForPageUrl] Row 0/1/2` - Should log first 3 row comparisons
- `[AI match debug]` - Should log when match found
- `[AI match summary]` - Should log final decision

**Possible Causes**:
1. Browser caching preventing latest code from loading
2. Function not being called
3. Logs being suppressed despite `error` level
4. Deployment not active in user's browser

### Current Status

**✅ Confirmed**:
- Data exists in Supabase `keyword_rankings` table
- `normalizeUrl` function should handle query parameters
- Matching logic is ultra-permissive with multiple fallback strategies

**❌ Still Failing**:
- URL matching not finding matches
- Debug logs not appearing
- AI Overview/Citations not displaying for URL tasks

**🔍 Needs Investigation**:
- Why matching logic is still failing despite ultra-permissive approach
- Why debug logs aren't appearing (browser cache?)
- Actual structure of `combinedRows` vs expected structure
- Whether `rowBestUrl` extraction is working correctly

### Next Actions

1. **Verify Latest Code is Running**:
   - Check browser cache (hard refresh: Ctrl+Shift+R)
   - Add unique marker string to verify latest code is loaded
   - Temporarily add `console.log` to confirm function is being called

2. **Verify Data Structure**:
   - Query Supabase to confirm `combinedRows` structure
   - Verify field names (`best_url` vs `targetUrl` vs `ranking_url`)
   - Check if `combinedRows` are being loaded from correct source

3. **Diagnose Matching Failure**:
   - Add temporary console.log to see actual URL values being compared
   - Verify `normalizeUrl` is working correctly on both URLs
   - Check if `rowBestUrl` extraction is finding the correct field

**See `HANDOVER.md` for comprehensive handover document with all context.**  
