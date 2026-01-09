# URL Task AI Data Issue - Action Plan

## Date: 2026-01-07

## Current Status
- **Problem**: URL task for `www.alanranger.com/photography-courses-coventry` is not displaying AI Overview or AI Citation data
- **Evidence**: UI debug log shows `computeAiMetricsForPageUrl` checking 80 rows but returning `Overview: false, Citations: null`
- **Root Cause**: Function is not finding a URL match in the `combinedRows` data

## Immediate Next Steps

### 1. Find the Function Definition
The `computeAiMetricsForPageUrl` function needs to be located in `audit-dashboard.html`. Since the file is 50,000+ lines, search for:
- `window.computeAiMetricsForPageUrl =`
- `function computeAiMetricsForPageUrl`
- `computeAiMetricsForPageUrl = function`

### 2. Check Actual Data in Database
Query Supabase to see what `best_url` values exist for keywords related to "photography courses":
```sql
-- Check what URLs are stored for photography courses keywords
SELECT keyword, best_url, ai_overview, ai_citations
FROM [ranking_ai_data_table]
WHERE keyword LIKE '%photography%course%'
ORDER BY created_at DESC
LIMIT 20;
```

### 3. Fix Debug Log Saving
The Supabase `debug_logs` table only has 1 test entry, meaning UI debug logs aren't being saved. This prevents us from seeing the detailed matching logs. Check:
- Is the API endpoint `/api/supabase/save-debug-log-entry` being called?
- Are there network errors in the browser console?
- Is the function catching errors silently?

### 4. Enhance Function Logging
Once the function is found, add comprehensive logging to show:
- Each URL being compared (task URL vs row URL)
- Normalized versions of both URLs
- Why each match attempt fails (exactMatch, pathMatch, strictPathMatch, domainOnlyMatch)
- Sample `best_url` values from the first 5 rows being checked

### 5. Fix URL Matching Logic
The matching logic likely needs to handle:
- Query parameters in `best_url` (e.g., `photography-courses-coventry?param=value`)
- Protocol differences (http vs https)
- Trailing slashes
- www vs non-www
- Path-only vs full URL formats

## Diagnostic Information Needed

1. **Actual `best_url` values**: What format are they stored in the database?
2. **Task URL format**: What exact format is the task URL stored in?
3. **Normalization function**: How is `normalizeUrl` working?
4. **Matching logic**: What are the exact conditions for each match type?

## Files to Examine

1. `audit-dashboard.html` - Find `computeAiMetricsForPageUrl` function (search for assignment to `window`)
2. `api/supabase/save-debug-log-entry.js` - Verify it's working (already checked, looks correct)
3. Supabase database - Query actual `best_url` values for "photography courses" keywords

## Expected Outcome

After fixes:
- `computeAiMetricsForPageUrl` should find matches for URLs that are a keyword's `best_url`
- Detailed matching logs should appear in Supabase `debug_logs` table
- AI Overview and AI Citations should display correctly for URL tasks
