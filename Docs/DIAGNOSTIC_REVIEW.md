# Diagnostic Review: GSC Trend Chart Issue

## Problem Statement
GSC-based lines (Authority, Visibility, Brand & Entity) stop at Dec 12 in the trend chart, despite:
- Timeseries data existing in `gsc_timeseries` table up to **Dec 13**
- Audit data existing in `audit_results` table for **Dec 12, 13, 14, 15, 16** with visibility/authority scores

## How GSC Data is Fetched During Audit

### 1. Audit Run Process (`runAudit()` function)
- **Location**: `audit-dashboard.html` line ~9118
- **Date Range**: Uses `dateRange` input (default: 30 days)
- **Calculation**: 
  ```javascript
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days); // days = 30 by default
  const endDate = new Date(); // Today
  ```
- **API Call**: `/api/aigeo/gsc-entity-metrics?property=...&startDate=...&endDate=...`
- **Returns**: Timeseries array for the entire date range (up to 30 days of daily data)

### 2. GSC Entity Metrics Endpoint (`/api/aigeo/gsc-entity-metrics.js`)
- **Lines 176-386**: Timeseries fetching logic
- **Process**:
  1. Checks Supabase `gsc_timeseries` table for cached data
  2. Identifies missing dates
  3. Fetches missing dates from GSC API
  4. Saves new dates to `gsc_timeseries` table
  5. Merges cached + new data
  6. Returns complete timeseries array

**Key Point**: The endpoint fetches **up to 30 days** of data, not just the audit date. This means when an audit runs on Dec 16, it fetches GSC data for Nov 16 - Dec 16 (30 days).

### 3. Data Storage
- **Timeseries**: Saved to `gsc_timeseries` table (property_url, date, clicks, impressions, ctr, position)
- **Audit Scores**: Saved to `audit_results` table (audit_date, visibility_score, authority_score, brand_score)

## Current Database State

### `gsc_timeseries` Table
- **Last Date**: Dec 13, 2025
- **Total Records**: 500
- **Sample (Dec 10-13)**:
  - Dec 13: 162 clicks, 44,738 impressions, position 14.61, CTR 0.36%
  - Dec 12: 213 clicks, 46,612 impressions, position 12.29, CTR 0.46%
  - Dec 11: 190 clicks, 51,111 impressions, position 12.33, CTR 0.37%
  - Dec 10: 230 clicks, 54,993 impressions, position 12.22, CTR 0.42%

### `audit_results` Table
- **Audit Dates with Scores**:
  - Dec 16: visibility=77, authority=53, brand=67
  - Dec 15: visibility=77, authority=35, brand=67
  - Dec 14: visibility=78, authority=53, brand=67
  - Dec 13: visibility=80, authority=37, brand=68
  - Dec 12: visibility=78, authority=53, brand=67
  - Dec 11: visibility=null, authority=null, brand=null (no audit run)
  - Dec 10: visibility=79, authority=53, brand=68

## How Trend Chart Uses Data

### 1. Data Source (`renderTrendChart()` function)
- **Location**: `audit-dashboard.html` line ~18600
- **Timeseries Source**: `data.timeseries` (passed from `displayDashboard`)
- **Historical Scores**: Fetched from Supabase `audit_results` table via `/api/supabase/get-audit-history`

### 2. Timeseries Processing
- **Line 18699**: `const timeseries = data.timeseries || [];`
- **Line 19496**: `const lastTimeseriesDate = timeseries.length > 0 ? timeseries[timeseries.length - 1].date : null;`
- **Issue**: If `data.timeseries` only contains dates up to Dec 12, then `lastTimeseriesDate` will be Dec 12, even though the database has Dec 13.

### 3. Historical Score Maps
- **Lines 18732-18735**: Maps created for historical scores:
  - `visibilityMap` - from `audit_results.visibility_score`
  - `authorityMap` - from `audit_results.authority_score`
  - `brandOverlayMap` - from `audit_results.brand_score`
- **Population**: Lines 19126-19477 (inside `timeseries.forEach` loop)

### 4. Last GSC Date Calculation
- **Lines 19498-19516**: Determines `lastGscDateForRange`
- **Current Logic**:
  ```javascript
  let actualLastGscDate = lastTimeseriesDate; // From timeseries array
  // Then checks maps for dates <= lastTimeseriesDate
  // Uses latest date from maps that is <= lastTimeseriesDate
  const lastGscDateForRange = actualLastGscDate || lastTimeseriesDate;
  ```
- **Problem**: If `lastTimeseriesDate` is Dec 12 (from `data.timeseries` array), then even if maps have Dec 13-14, they're filtered out because they're > Dec 12.

### 5. Date Filling Logic
- **Lines 19575-19911**: Fills missing dates from `lastDateInChartStr` to `latestAuditDateStr`
- **GSC-Based Pillars** (Authority, Visibility, Brand & Entity):
  - **Line 19578**: `const isDateWithinGscRange = lastGscDateForRange && dateStr <= lastGscDateForRange;`
  - **Lines 19583-19604**: Only shows data if `isDateWithinGscRange && historicalVisibility !== undefined`
  - **Problem**: If `lastGscDateForRange` is Dec 12, then Dec 13-14 won't show even though they have data in maps.

## Root Cause Analysis

### Primary Issue
The `data.timeseries` array passed to `renderTrendChart` is likely only containing dates up to Dec 12, even though:
1. The database (`gsc_timeseries`) has data up to Dec 13
2. The audit results have scores for Dec 13-16

### Why Timeseries Array Might Be Truncated
1. **Source**: `data.timeseries` comes from `displayDashboard` function parameter
2. **Origin**: Set in `runAudit()` at line 9098: `timeseries: gsc.data.timeseries || []`
3. **GSC API Response**: The `/api/aigeo/gsc-entity-metrics` endpoint returns timeseries based on:
   - Cached data from Supabase
   - New data fetched from GSC API
   - **GSC API Limitation**: GSC data is delayed by 2-3 days, so requesting data up to "today" might only return data up to 2-3 days ago

### Secondary Issue
The logic at lines 19500-19513 filters map dates to only include those `<= lastTimeseriesDate`. This means:
- If `lastTimeseriesDate` = Dec 12 (from timeseries array)
- And maps have Dec 13-14 data (from audit_results)
- The Dec 13-14 data is filtered out, even though it's valid GSC-derived data

## Expected Behavior

### When Audit Runs on Dec 16
1. **GSC API Call**: Requests data for Nov 16 - Dec 16 (30 days)
2. **GSC API Response**: Returns data up to Dec 13 (due to 2-3 day delay)
3. **Timeseries Saved**: Dec 13 data saved to `gsc_timeseries` table
4. **Audit Scores Saved**: Dec 16 audit saves scores to `audit_results` for Dec 16
5. **Historical Scores**: Dec 13-14 scores should be in `audit_results` (from previous audits)

### Chart Should Display
- **Timeseries Data**: Up to Dec 13 (last actual GSC data date)
- **GSC-Based Pillars**: Should show data up to Dec 13 (from timeseries) OR Dec 14 (from audit_results if it has GSC-derived scores)
- **Non-GSC Pillars**: Should show data up to Dec 16 (latest audit date)

## Recommended Fix Strategy

### Option 1: Use Latest Date from Maps, Not Timeseries Array
Instead of using `lastTimeseriesDate` from the timeseries array, determine the last GSC date by:
1. Finding the latest date in `visibilityMap`, `authorityMap`, `brandOverlayMap`
2. Finding the latest date in `gsc_timeseries` table (via API call or passed data)
3. Using the maximum of these two dates as `lastGscDateForRange`

### Option 2: Don't Filter Map Dates by Timeseries Date
Remove the filter at lines 19502-19513 that only includes map dates `<= lastTimeseriesDate`. Instead:
- Use the latest date from maps as the GSC cutoff
- Only show GSC-based pillar data for dates that exist in the maps (don't forward-fill)

### Option 3: Fetch Timeseries from Database, Not from Audit Response
Instead of relying on `data.timeseries` from the audit response, fetch timeseries directly from Supabase in `renderTrendChart`:
- Call `/api/supabase/get-audit-history` to get complete timeseries
- This ensures we have the latest data, not just what was fetched during the last audit

## Questions to Answer

1. **What is the actual content of `data.timeseries` when `renderTrendChart` is called?**
   - Check console logs or add debug logging
   - Verify if it only goes to Dec 12 or includes Dec 13

2. **When was the last audit run?**
   - If last audit was Dec 12, then `data.timeseries` would only have data up to Dec 12
   - If last audit was Dec 16, then `data.timeseries` should have data up to Dec 13

3. **Are the Dec 13-14 scores in `audit_results` actually GSC-derived?**
   - If they were calculated from GSC data, they should be shown
   - If they're estimates or forward-filled, they shouldn't be shown

## Critical Finding: Stale Timeseries Data

### Issue at Line 20847-20876
When `displayDashboard` is called, it uses `savedAudit.searchData.timeseries` which may be stale:
- **Line 20846**: `const searchDataWithTimeseries = savedAudit.searchData || {};`
- **Line 20847**: `if (!searchDataWithTimeseries.timeseries)` - Only fetches from Supabase if timeseries is MISSING
- **Problem**: If `savedAudit.searchData.timeseries` exists (even if stale/old), it won't refresh from Supabase

### Example Scenario
1. Audit run on Dec 12 → `savedAudit.searchData.timeseries` contains data up to Dec 12
2. Audit run on Dec 16 → New timeseries data (up to Dec 13) saved to Supabase
3. Page reload → `displayDashboard` uses `savedAudit.searchData.timeseries` from Dec 12 audit (stale)
4. Chart renders with Dec 12 as `lastTimeseriesDate`
5. Dec 13-14 data in maps is filtered out because it's > Dec 12

### Secondary Issue at Line 4453
When date range changes, `displayDashboard` is called with `savedAudit.searchData` directly:
- No attempt to refresh timeseries from Supabase
- Uses whatever timeseries was saved during the last audit

## Root Cause Summary

1. **Stale Timeseries Array**: `data.timeseries` passed to `renderTrendChart` is from the last audit's localStorage, not the latest Supabase data
2. **Filtering Logic**: Lines 19502-19513 filter map dates to only include those `<= lastTimeseriesDate`, which is based on the stale timeseries array
3. **No Refresh Mechanism**: The code only fetches from Supabase if timeseries is completely missing, not if it's outdated

## Recommended Fix

### Fix 1: Always Fetch Fresh Timeseries from Supabase
In `renderTrendChart`, always fetch timeseries from Supabase instead of relying on `data.timeseries`:
```javascript
// Instead of: const timeseries = data.timeseries || [];
// Fetch directly from Supabase:
const timeseriesResponse = await fetch(`/api/supabase/get-audit-history?propertyUrl=...&startDate=...&endDate=...`);
const timeseries = timeseriesResponse.timeseries || [];
```

### Fix 2: Use Latest Date from Maps, Not Timeseries Array
Change the `lastGscDateForRange` calculation to use the maximum date from:
- Timeseries array (actual GSC data)
- Historical maps (audit_results with GSC-derived scores)

```javascript
// Find latest date from ALL sources
const allGscDates = new Set();
timeseries.forEach(point => allGscDates.add(point.date));
visibilityMap.forEach((score, date) => allGscDates.add(date));
authorityMap.forEach((score, date) => allGscDates.add(date));
brandOverlayMap.forEach((score, date) => allGscDates.add(date));

const sortedDates = Array.from(allGscDates).sort();
const lastGscDateForRange = sortedDates[sortedDates.length - 1];
```

### Fix 3: Remove Date Filter on Maps
Remove the filter at lines 19502-19513 that excludes map dates > `lastTimeseriesDate`. Instead, use all dates from maps that have actual scores.

## Next Steps

1. **Immediate**: Check console logs to confirm `data.timeseries` last date vs database last date
2. **Fix**: Implement Fix 1 (always fetch fresh timeseries) OR Fix 2 (use latest from all sources)
3. **Test**: Verify chart shows GSC lines up to Dec 13 (last timeseries) or Dec 14 (if audit_results has GSC-derived scores)

