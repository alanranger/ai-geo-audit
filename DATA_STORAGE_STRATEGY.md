# Data Storage Strategy: What to Cache vs. What to Fetch Live

## Core Principle

**Historical data that doesn't change → Store in Supabase**  
**Live/current data that changes → Always fetch fresh**

---

## Data Classification

### ✅ **STORE IN SUPABASE** (Historical, Immutable)

#### 1. **GSC Timeseries Data** (HIGH PRIORITY)
- **Why:** Once Google reports data for a date, it never changes
- **What:** Daily clicks, impressions, CTR, position per property/date
- **Benefit:** Avoids repeated API calls for same date ranges
- **Storage:** `gsc_timeseries` table

```sql
CREATE TABLE gsc_timeseries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_url TEXT NOT NULL,
  date DATE NOT NULL,
  clicks INTEGER NOT NULL,
  impressions INTEGER NOT NULL,
  ctr DECIMAL(5,2) NOT NULL,
  position DECIMAL(5,2) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(property_url, date)
);

CREATE INDEX idx_gsc_timeseries_property_date ON gsc_timeseries(property_url, date DESC);
```

**Fetch Strategy:**
- Check Supabase for existing dates in requested range
- Only fetch missing dates from GSC API
- Merge stored + new data
- Save new data to Supabase

#### 2. **Schema Audit Results** (ALREADY IMPLEMENTED)
- **Why:** Snapshot of schema state at audit time
- **What:** Coverage %, schema types, missing pages, rich eligibility
- **Storage:** `audit_results` table (already exists)
- **Status:** ✅ Implemented

#### 3. **Calculated Pillar Scores** (ALREADY IMPLEMENTED)
- **Why:** Historical scores for trend analysis
- **What:** All 5 pillar scores + snippet readiness
- **Storage:** `audit_results` table (already exists)
- **Status:** ✅ Implemented

#### 4. **GSC Overview/Aggregates** (MEDIUM PRIORITY)
- **Why:** Can be recalculated from timeseries, but useful for quick access
- **What:** Total clicks, impressions, avg position, CTR for date range
- **Storage:** Could store in `audit_results` or calculate on-the-fly from timeseries
- **Decision:** Calculate from timeseries (no separate storage needed)

#### 5. **Top Queries/Pages** (LOW PRIORITY - Future)
- **Why:** Historical data, but changes less frequently
- **What:** Top 100 queries/pages for date range
- **Storage:** Could add `gsc_top_queries` and `gsc_top_pages` tables
- **Decision:** Defer - can always fetch from GSC API if needed

---

### 🔄 **ALWAYS FETCH LIVE** (Current, Changes)

#### 1. **Current Schema Audit** (When Running Audit)
- **Why:** Need fresh crawl of current site state
- **What:** Current schema coverage, types, missing pages
- **Strategy:** Always run fresh crawl, then save results to Supabase

#### 2. **Latest GSC Data** (Optional - Usually 1-2 Days Behind)
- **Why:** GSC data is typically 1-2 days behind
- **What:** "Today's" data (may not exist yet)
- **Strategy:** Fetch from GSC API, but don't expect data for today

#### 3. **Real-time Metrics** (Future)
- **Why:** Live data that changes constantly
- **What:** Current server status, real-time traffic, etc.
- **Strategy:** Always fetch fresh (no caching)

---

## Implementation Priority

### Phase 1: GSC Timeseries Caching (HIGH PRIORITY) ⚡
**Impact:** Massive reduction in API calls, faster dashboard loads

**Implementation:**
1. Create `gsc_timeseries` table in Supabase
2. Create `/api/supabase/get-gsc-timeseries` endpoint
3. Create `/api/supabase/save-gsc-timeseries` endpoint
4. Modify `/api/aigeo/gsc-entity-metrics` to:
   - Check Supabase for existing dates
   - Only fetch missing dates from GSC API
   - Merge and return combined data
   - Save new dates to Supabase
5. Update client to handle cached data transparently

**Benefits:**
- ✅ 90% reduction in GSC API calls (only fetch new dates)
- ✅ Faster dashboard loads (read from DB instead of API)
- ✅ Better rate limit management
- ✅ Historical data always available (even if GSC API is down)

### Phase 2: Schema Audit Optimization (MEDIUM PRIORITY)
**Status:** Already implemented, but could optimize

**Current:** Schema audit runs full crawl every time  
**Optimization:** Could detect which URLs changed and only crawl those
**Decision:** Defer - full crawl is acceptable for now

### Phase 3: Top Queries/Pages Caching (LOW PRIORITY)
**Impact:** Minor - these queries are fast and don't change much

**Decision:** Defer - can always fetch from GSC API when needed

---

## Data Flow: GSC Timeseries with Caching

### Current Flow (No Caching)
```
Client → GSC API → Fetch ALL dates → Return to Client
```
**Problem:** Fetches same historical data repeatedly

### New Flow (With Caching)
```
Client → GSC API Endpoint
  ↓
Check Supabase for existing dates
  ↓
Only fetch missing dates from GSC API
  ↓
Merge stored + new data
  ↓
Save new dates to Supabase
  ↓
Return merged data to Client
```

**Example:**
- User requests 180 days of data
- Supabase has last 150 days stored
- Only fetch last 30 days from GSC API
- Merge: 150 (stored) + 30 (new) = 180 days
- Save 30 new days to Supabase

---

## API Endpoint Changes

### `/api/aigeo/gsc-entity-metrics` (Modified)

**New Logic:**
```javascript
1. Parse date range from request
2. Query Supabase for existing timeseries data in range
3. Identify missing dates
4. If missing dates exist:
   - Fetch only missing dates from GSC API
   - Save new dates to Supabase
5. Merge stored + new data
6. Return complete timeseries to client
```

**Benefits:**
- Transparent to client (same API, faster response)
- Automatic caching (no client changes needed)
- Graceful fallback (if Supabase unavailable, fetch all from GSC)

---

## Supabase Schema Updates

### New Table: `gsc_timeseries`

```sql
CREATE TABLE gsc_timeseries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_url TEXT NOT NULL,
  date DATE NOT NULL,
  clicks INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  ctr DECIMAL(5,2) NOT NULL DEFAULT 0,
  position DECIMAL(5,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(property_url, date)
);

-- Index for fast date range queries
CREATE INDEX idx_gsc_timeseries_property_date 
  ON gsc_timeseries(property_url, date DESC);

-- Index for finding missing dates
CREATE INDEX idx_gsc_timeseries_property 
  ON gsc_timeseries(property_url);
```

---

## Migration Strategy

### Step 1: Add Supabase Tables
- Create `gsc_timeseries` table
- No data migration needed (will populate on first use)

### Step 2: Create Storage APIs
- `/api/supabase/get-gsc-timeseries` - Fetch stored data
- `/api/supabase/save-gsc-timeseries` - Save new data

### Step 3: Modify GSC Endpoint
- Add caching logic to `/api/aigeo/gsc-entity-metrics`
- Maintain backward compatibility (works even if Supabase unavailable)

### Step 4: Test & Deploy
- Test with fresh property (no cached data)
- Test with existing property (has cached data)
- Verify data accuracy (stored vs. fresh fetch)

---

## Error Handling & Fallbacks

### Supabase Unavailable
- **Behavior:** Fetch all data from GSC API (current behavior)
- **Impact:** No caching, but still works

### Partial Data in Supabase
- **Behavior:** Fetch missing dates, merge with stored data
- **Impact:** Optimal - only fetches what's needed

### GSC API Rate Limited
- **Behavior:** Use stored data for available dates, show warning for missing dates
- **Impact:** Dashboard still works with historical data

---

## Performance Impact

### Before (No Caching)
- **180-day audit:** ~180 API calls (one per day) or 1 call with 180 data points
- **Time:** 2-5 seconds per audit
- **Rate Limits:** High risk of hitting limits

### After (With Caching)
- **180-day audit (first time):** 1 API call, save 180 days
- **180-day audit (subsequent):** 0-30 API calls (only new dates)
- **Time:** 0.1-0.5 seconds (read from DB) + fetch new dates
- **Rate Limits:** Minimal risk (only fetch new dates)

**Expected Improvement:** 90%+ reduction in API calls for repeat audits

---

## Summary

**Store in Supabase:**
- ✅ GSC timeseries (daily clicks, impressions, CTR, position)
- ✅ Schema audit results (already implemented)
- ✅ Calculated pillar scores (already implemented)

**Always Fetch Live:**
- 🔄 Current schema audit (when running audit)
- 🔄 Latest GSC data (if needed, but usually 1-2 days behind)

**Key Benefit:** Massive reduction in API calls, faster dashboard loads, better rate limit management.



