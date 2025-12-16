# PATCH A2: End-to-End Data Pipeline Verification

## ✅ Complete Data Flow Checklist

### 1. **Audit Trigger & Data Fetch** ✅
- [x] `runAudit()` calls `fetchSearchConsoleData()` with `TRACKED_KEYWORDS`
- [x] `fetchSearchConsoleData()` passes keywords to `/api/aigeo/gsc-entity-metrics`
- [x] Backend API (`gsc-entity-metrics.js`) receives keywords parameter
- [x] Backend makes individual GSC API calls for each keyword (query-only)
- [x] Backend returns `queryTotals[]` in response
- [x] `fetchSearchConsoleData()` includes `queryTotals` in returned `searchData` object

**File:** `audit-dashboard.html` lines 9174-9268, 9354  
**File:** `api/aigeo/gsc-entity-metrics.js` lines 499-577

### 2. **Data Storage (localStorage)** ✅
- [x] `runAudit()` calls `saveAuditResults()` with `searchData` (includes `queryTotals`)
- [x] `saveAuditResults()` saves entire `searchData` object to localStorage
- [x] `queryTotals` is preserved in localStorage structure

**File:** `audit-dashboard.html` lines 5353-5402, 9653

### 3. **Data Storage (Supabase)** ✅
- [x] `runAudit()` calls `saveAuditToSupabase()` with `searchData` (includes `queryTotals`)
- [x] `saveAuditToSupabase()` passes `searchData` to `/api/supabase/save-audit`
- [x] Backend (`save-audit.js`) extracts `searchData.queryTotals`
- [x] Backend saves to `query_totals` JSONB column
- [x] Database column exists (`query_totals` added via migration)

**File:** `audit-dashboard.html` lines 5805-9659  
**File:** `api/supabase/save-audit.js` lines 274-282  
**Migration:** `add_query_totals_column` applied

### 4. **Data Loading (localStorage)** ✅
- [x] `loadAuditResultsSync()` loads from localStorage
- [x] Returns `searchData.queryTotals` in saved audit structure
- [x] `getQueryTotalForKeyword()` reads from `savedAudit.searchData.queryTotals`

**File:** `audit-dashboard.html` lines 5742-5752, 26027-26042

### 5. **Data Loading (Supabase)** ✅
- [x] `get-latest-audit.js` loads `query_totals` from Supabase
- [x] Parses JSONB column and includes in `searchData.queryTotals`
- [x] Returns in same structure as localStorage

**File:** `api/supabase/get-latest-audit.js` lines 619-640

### 6. **Data Display (Table)** ✅
- [x] `renderRankingAiTab()` renders keyword table
- [x] Table calls `getQueryTotalForKeyword()` for each keyword
- [x] Displays CTR from `queryTotal.ctr` (already percentage, no conversion needed)
- [x] Displays Impressions from `queryTotal.impressions`
- [x] Shows "—" with tooltip if no data found

**File:** `audit-dashboard.html` lines 26274-26282

### 7. **Data Display (Scorecard - Query-Only)** ✅
- [x] `renderKeywordScorecard()` calls `getQueryTotalForKeyword()`
- [x] Displays CTR & snippet tile with query-only metrics
- [x] Shows CTR, Impressions, Clicks from `queryTotal`
- [x] Includes "Expected CTR at this position" heuristic

**File:** `audit-dashboard.html` lines 26686-26750

### 8. **Data Display (Scorecard - Page-Only)** ✅
- [x] Scorecard fetches page totals on-demand via `/api/aigeo/gsc-page-totals`
- [x] Displays "Target page totals" tile with page-only metrics
- [x] Shows Clicks, Impressions, CTR, Avg Position for best_url

**File:** `audit-dashboard.html` lines 27137-27190

### 9. **Data Display (Scorecard - Query→Pages Breakdown)** ✅
- [x] Scorecard fetches query→pages breakdown on-demand via `/api/aigeo/gsc-query-pages`
- [x] Displays "Advanced" section with pages table
- [x] Highlights DataForSEO `best_url` row
- [x] Shows Page URL, Clicks, Impressions, CTR, Position for each page

**File:** `audit-dashboard.html` lines 27192-27250

### 10. **Backend API Endpoints** ✅
- [x] `/api/aigeo/gsc-entity-metrics` - Fetches queryTotals for tracked keywords
- [x] `/api/aigeo/gsc-page-totals` - Fetches page-only totals (NEW)
- [x] `/api/aigeo/gsc-query-pages` - Fetches query→pages breakdown (NEW)

**Files:**
- `api/aigeo/gsc-entity-metrics.js` ✅
- `api/aigeo/gsc-page-totals.js` ✅
- `api/aigeo/gsc-query-pages.js` ✅

### 11. **URL Canonicalization** ✅
- [x] `normalizeGscPageUrl()` used in all API endpoints
- [x] Used in frontend for URL matching
- [x] Consistent across table, scorecard, and storage keys

**File:** `audit-dashboard.html` lines 24711-24736

### 12. **Error Handling & Logging** ✅
- [x] Logs when `queryTotals` are fetched successfully
- [x] Warns if `queryTotals` are missing
- [x] Shows "—" with explanatory tooltips when data unavailable
- [x] Handles missing data gracefully in all display functions

**File:** `audit-dashboard.html` lines 9236-9240, 26267, 26280

## 🎯 Pipeline Flow Summary

```
1. User clicks "Run Audit Scan"
   ↓
2. runAudit() → fetchSearchConsoleData()
   ↓
3. Backend: gsc-entity-metrics.js
   - Receives TRACKED_KEYWORDS
   - Makes individual GSC API calls (query-only)
   - Returns queryTotals[]
   ↓
4. Frontend: searchData.queryTotals populated
   ↓
5. saveAuditResults() → localStorage (includes queryTotals)
   ↓
6. saveAuditToSupabase() → Supabase query_totals column
   ↓
7. Table Display:
   - getQueryTotalForKeyword() reads from savedAudit.searchData.queryTotals
   - Displays CTR & Impressions (query-only)
   ↓
8. Scorecard Display:
   - getQueryTotalForKeyword() for query-only metrics
   - fetchPageTotals() for page-only metrics (on-demand)
   - fetchQueryPagesBreakdown() for query→pages (on-demand)
```

## ✅ Confidence Level: **HIGH**

All end-to-end components are verified and connected:
- ✅ Data fetching (frontend → backend → GSC API)
- ✅ Data storage (localStorage + Supabase)
- ✅ Data loading (from both sources)
- ✅ Data display (table + scorecard)
- ✅ Error handling and fallbacks
- ✅ URL canonicalization consistency

The pipeline is **ready for a fresh audit scan**.

