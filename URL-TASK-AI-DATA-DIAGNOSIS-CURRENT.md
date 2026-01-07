# URL Task AI Data Issue - Current Diagnosis

## Date: 2026-01-07

## Problem
URL task for `www.alanranger.com/photography-courses-coventry` is not displaying AI Overview or AI Citation data, despite:
- 80 rows being checked in `combinedRows`
- The function `computeAiMetricsForPageUrl` being called with both `https://www.alanranger.com/photography-courses-coventry` and `www.alanranger.com/photography-courses-coventry`
- The function returning `Overview: false, Citations: null`

## UI Debug Log Evidence
From the user's UI debug log (Issues section):
```
[2026-01-07T14:24:12.325Z] [WARN] [Optimisation] URL task: Inconsistent result from computeAiMetricsForPageUrl for https://www.alanranger.com/photography-courses-coventry - Overview: false, Citations: null
[2026-01-07T14:24:12.325Z] [WARN] [Optimisation] URL task: Inconsistent result from computeAiMetricsForPageUrl for www.alanranger.com/photography-courses-coventry - Overview: false, Citations: null
[2026-01-07T14:24:12.325Z] [WARN] [Optimisation] URL task: No AI data found for https://www.alanranger.com/photography-courses-coventry or www.alanranger.com/photography-courses-coventry in 80 rows
```

## Key Observations

1. **Function is being called**: The function `computeAiMetricsForPageUrl` is executing
2. **Data is available**: 80 rows are being checked (`combinedRows.length = 80`)
3. **No match found**: The function is not finding a match for the URL in any of the 80 rows
4. **Inconsistent return**: The function returns `Overview: false, Citations: null` which is flagged as "inconsistent" by the calling code
5. **Missing detailed logs**: The detailed internal matching logs (e.g., `[computeAiMetricsForPageUrl] Match attempt`, `strictPathMatch`, `domainOnlyMatch`) are **NOT** appearing in the UI debug log, suggesting either:
   - The function isn't logging these diagnostics
   - The logs aren't being saved to Supabase (only 1 test entry found)
   - A condition is preventing the logs from being displayed

## Root Cause Hypothesis

The `computeAiMetricsForPageUrl` function is likely failing to match the URL `photography-courses-coventry` against the `best_url` or `targetUrl` fields in the `combinedRows` data because:

1. **URL Format Mismatch**: The task URL format (`www.alanranger.com/photography-courses-coventry`) may not match the format stored in `combinedRows` (e.g., `https://www.alanranger.com/photography-courses-coventry?param=value` or a different path)

2. **Matching Logic Too Strict**: The URL matching logic (`strictPathMatch`, `domainOnlyMatch`) may be too strict and not accounting for:
   - Query parameters in `best_url`
   - Trailing slashes
   - Protocol differences (http vs https)
   - www vs non-www

3. **Data Structure Issue**: The `best_url` field in `combinedRows` may contain a different URL format than expected

## Next Steps

1. **Find the function definition**: Locate `computeAiMetricsForPageUrl` in `audit-dashboard.html` to examine its matching logic
2. **Check actual data**: Query Supabase to see what `best_url` values exist for keywords related to "photography courses"
3. **Add more diagnostic logging**: Enhance the function to log:
   - Each URL being compared
   - The normalized versions of both URLs
   - Why each match attempt fails
   - Sample `best_url` values from the rows being checked
4. **Fix URL matching**: Update the matching logic to handle:
   - Query parameters
   - Protocol differences
   - Trailing slashes
   - www vs non-www
   - Path-only vs full URL formats

## Debug Log Saving Issue

The Supabase `debug_logs` table only contains 1 test entry, indicating that the automatic saving of UI debug logs is not working. This needs to be fixed so we can:
- See the detailed matching logs from `computeAiMetricsForPageUrl`
- Track diagnostic information over time
- Search logs without copy-paste

## Files to Examine

1. `audit-dashboard.html` - Find `computeAiMetricsForPageUrl` function definition
2. `api/supabase/save-debug-log-entry.js` - Verify it's working correctly
3. Supabase `audit_results` table - Check actual `best_url` values for "photography courses" keywords
