# Data Retrieval Strategy: Historical Scores & Time Period Performance

## Current Problem

When switching time periods (30 days → 60 days → 12 months → 18 months), the trend chart:
1. Fetches historical audit records from Supabase ✅
2. **Calculates scores on-the-fly** from GSC timeseries data for each date ❌
3. Causes lag/delay when switching periods ❌

## Recommended Solution: **Pre-calculate & Store All Scores**

### Strategy Overview

**Principle:** Calculate once, store forever, retrieve instantly.

1. **At Audit Time (when "Run Audit" clicked):**
   - Calculate all pillar scores from fresh GSC data
   - **Save ALL scores to database** (`audit_results` table)
   - Store GSC raw data in `gsc_timeseries` table

2. **When Switching Time Periods:**
   - **Fetch pre-calculated scores from database** (fast, no calculation)
   - Only calculate on-the-fly if score is missing (edge case)

3. **Historical Backfill:**
   - One-time migration to calculate and store scores for all historical dates
   - Use available GSC data (`gsc_timeseries` or `gsc_avg_position`/`gsc_ctr`)

---

## Implementation Plan

### Phase 1: Ensure All Scores Are Saved ✅ (Already Done)

**Current Status:**
- ✅ `authority_score` and `visibility_score` are saved to `audit_results` table
- ✅ `content_schema_score`, `local_entity_score`, `service_area_score` are saved
- ✅ Save logic is in `api/supabase/save-audit.js`

**Action:** No changes needed - this is working.

---

### Phase 2: Optimize Trend Chart Data Retrieval

**Current Behavior:**
```javascript
// Current: Calculates on-the-fly for each timeseries point
timeseries.forEach(point => {
  const calculated = calculatePillarFromMetrics(position, ctr, dateStr, ...);
  // Uses calculated scores even if stored scores exist
});
```

**Recommended Behavior:**
```javascript
// New: Use stored scores first, only calculate if missing
timeseries.forEach(point => {
  // 1. Try stored score from database (fast)
  const storedVisibility = visibilityMap.get(pointDate);
  const storedAuthority = authorityMap.get(pointDate);
  
  // 2. Only calculate if missing (edge case)
  if (storedVisibility === null || storedAuthority === null) {
    const calculated = calculatePillarFromMetrics(...);
    // Use calculated as fallback
  }
});
```

**Changes Needed:**
1. Update `renderTrendChart()` to prioritize stored scores over calculated scores
2. Only calculate on-the-fly when stored score is missing
3. Add loading indicator when fetching from database (better UX than silent lag)

---

### Phase 3: Complete Historical Backfill

**Current Status:**
- ✅ Migration created: `backfill_authority_visibility_scores.sql`
- ✅ 34 records updated (Nov 6 - Dec 10, 2025)
- ❌ 470 records still missing scores (no GSC data available)

**Action Required:**
1. Import historical GSC data into `gsc_timeseries` table for missing dates
2. Re-run backfill migration to calculate remaining scores
3. Verify all historical records have scores populated

---

### Phase 4: Cache Strategy (Optional Performance Enhancement)

**For Very Large Date Ranges (18+ months):**

**Option A: Database Indexing**
- Ensure `audit_results.audit_date` and `audit_results.property_url` are indexed
- Query optimization: `SELECT ... WHERE property_url = ? AND audit_date BETWEEN ? AND ? ORDER BY audit_date`

**Option B: Client-Side Caching**
- Cache fetched historical data in `localStorage` or `sessionStorage`
- Key: `trendChart_${propertyUrl}_${startDate}_${endDate}`
- TTL: 1 hour (refresh if new audit run)

**Option C: API Response Caching**
- Add caching headers to `get-audit-history` API
- Cache for 5-10 minutes (scores don't change unless new audit run)

---

## Code Changes Required

### 1. Update `renderTrendChart()` Function

**File:** `audit-dashboard.html`

**Change:** Prioritize stored scores over calculated scores

```javascript
// BEFORE: Always calculates from GSC data
const visibility = calculatePillarFromMetrics(...).visibility;

// AFTER: Use stored score first
let visibility;
const storedVisibility = visibilityMap.get(pointDate);
if (storedVisibility !== null && storedVisibility !== undefined) {
  visibility = storedVisibility; // Use stored (fast)
} else {
  // Fallback: calculate from GSC data (slow, but only for missing data)
  visibility = calculatePillarFromMetrics(...).visibility;
}
```

### 2. Add Loading Indicator

**File:** `audit-dashboard.html`

**Add:** Show loading spinner when fetching historical data

```javascript
// Show loading indicator
const loadingDiv = document.getElementById('trend-chart-loading');
if (loadingDiv) loadingDiv.style.display = 'block';

// Fetch historical data
const contentSchemaHistory = await fetchContentSchemaHistory(...);

// Hide loading indicator
if (loadingDiv) loadingDiv.style.display = 'none';
```

### 3. Optimize Database Query

**File:** `api/supabase/get-audit-history.js`

**Ensure:** Query only fetches needed columns and is optimized

```javascript
// Current query is good, but ensure it's using indexes
// Add ORDER BY audit_date ASC for consistent results
```

---

## Performance Comparison

### Current Approach (Calculate On-the-Fly)
- **30 days:** ~30 calculations = ~500ms
- **90 days:** ~90 calculations = ~1.5s
- **12 months:** ~52 calculations = ~1s (weekly)
- **18 months:** ~78 calculations = ~1.5s (weekly)
- **User Experience:** Noticeable lag when switching periods

### Recommended Approach (Pre-calculated)
- **30 days:** 1 database query = ~50ms
- **90 days:** 1 database query = ~50ms
- **12 months:** 1 database query = ~50ms
- **18 months:** 1 database query = ~50ms
- **User Experience:** Instant, no lag

**Improvement:** 10-30x faster ⚡

---

## Migration Checklist

- [x] Create backfill migration for Authority and Visibility scores
- [x] Apply migration (34 records updated)
- [ ] Import historical GSC data for remaining 470 records
- [ ] Re-run backfill migration
- [ ] Update `renderTrendChart()` to prioritize stored scores
- [ ] Add loading indicator for better UX
- [ ] Test all date range selections (30, 60, 90, 120, 180, 365, 540 days)
- [ ] Verify performance improvement

---

## Summary

**Best Approach:** Store all calculated scores in database, retrieve instantly when switching time periods.

**Benefits:**
1. ✅ Fast retrieval (50ms vs 1-2s)
2. ✅ No lag when switching periods
3. ✅ Consistent scores (same calculation method)
4. ✅ Works offline (if cached)
5. ✅ Scales to any date range

**Trade-offs:**
- Requires one-time historical backfill
- Slightly more database storage (minimal - just integers)
- Need to ensure scores are saved for all new audits (already done)

