# Investigation: Keyword vs Page Task Data Consistency

**⚠️ NOTE**: This document is from an earlier investigation. For the most current status of fixes and issues, see **`HANDOVER.md`** (created 2026-01-07).

## Issue Summary

**Problem**: The "photography tuition" keyword task shows different data in:
- **Ranking & AI tab**: Rank #5, AI Overview: On, AI Citations: 0
- **Optimization Task module**: Rank —, AI Overview: Not present, AI Citations: 0

**User Observation**: 
- GSC screenshots show:
  - Query-level: "photography tuition" has 0 clicks, 187 impressions, avg position 14.2
  - Page-level: `/photography-tuition-services` has 3 clicks, 1,366 impressions, avg position 9.6
- The Ranking & AI tab shows rank #5 (likely from DataForSEO best_rank_group)
- The Optimization Task module is not capturing this data correctly

**Critical Insight**: 
- Keyword tasks should show **keyword-specific** metrics (impressions, clicks, CTR, ranking for that keyword)
- Page tasks should show **page-level** metrics (aggregated across all queries for that page)
- Both should use the **same source of truth** from Supabase

---

## Investigation Scope

### 1. Data Source Mapping
**Question**: Where does each module get its data?

#### Ranking & AI Tab
- **Data Source**: `RankingAiModule.state().combinedRows` OR `window.rankingAiData`
- **Fields Used**: 
  - `best_rank_group` (displays as "#5")
  - `has_ai_overview` (boolean)
  - `ai_alan_citations_count` (integer)
  - `gsc_clicks_28d`, `gsc_impressions_28d`, `gsc_ctr_28d`
- **Origin**: From audit run → stored in `localStorage.last_audit_results` → `searchData.queryTotals`

#### Optimization Task Module (Add Measurement)
- **Data Source Priority** (from code analysis):
  1. `RankingAiModule.state().combinedRows` (keyword match + URL match required)
  2. `window.rankingAiData` (keyword match + URL match required)
  3. Money Pages data from localStorage
  4. `queryTotals` from localStorage (`searchData.queryTotals`)
  5. Supabase audit data (`audit_results.search_data.queryTotals`)
  6. GSC page totals API (for URL-only tasks)

**Key Finding**: Optimization module requires **both keyword AND URL match**, which may be causing failures.

---

### 2. Update/Refresh/Audit Processes

**Need to Document**:
1. **Full Audit Run** ("Run Audit Scan" button)
   - When does it run?
   - What data does it fetch?
   - Where does it store data?
   - Does it update Ranking & AI data?
   - Does it update optimization task data?

2. **Ranking & AI Tab Refresh**
   - When does it refresh?
   - Does it fetch from Supabase or localStorage?
   - Does it update `window.rankingAiData`?

3. **Optimization Task "Add Measurement"**
   - What triggers it?
   - What data sources does it check?
   - Does it fetch fresh data or use cached?
   - Does it update Supabase?

4. **Bulk Update Tasks** ("Update All Tasks with Latest Data")
   - What does it do?
   - What data sources does it use?
   - Does it differ from "Add Measurement"?

5. **Background Updates**
   - Are there any scheduled/cron jobs?
   - Do any processes auto-refresh data?

---

### 3. Keyword vs Page Task Logic

**Current Understanding** (needs verification):

#### Keyword Task
- **Should Show**: Metrics for that specific keyword
  - Impressions: From GSC query-level data for "photography tuition"
  - Clicks: From GSC query-level data for "photography tuition"
  - CTR: Calculated from keyword clicks/impressions
  - Rank: Best rank for that keyword (from DataForSEO or GSC)
  - AI Overview: Whether AI Overview exists for that keyword
  - AI Citations: Count of citations for that keyword

#### Page Task
- **Should Show**: Metrics aggregated for that page across all queries
  - Impressions: Sum of all impressions for that page URL
  - Clicks: Sum of all clicks for that page URL
  - CTR: Weighted CTR across all queries for that page
  - Rank: Average position for that page (or best rank if keyword-specific)
  - AI Overview: Whether any AI Overview cites that page
  - AI Citations: Count of citations pointing to that page URL

**Question**: Is the code correctly distinguishing between these two cases?

---

### 4. Data Flow Analysis

**Need to Trace**:

1. **GSC Data → Audit Results**
   - How is GSC data fetched?
   - How is it stored in `audit_results` table?
   - What format is `search_data.queryTotals`?
   - What format is `search_data.queryPages`?

2. **Audit Results → Ranking & AI Tab**
   - How does Ranking & AI tab load data?
   - Does it read from Supabase or localStorage?
   - How is `combinedRows` built?
   - What fields are mapped?

3. **Audit Results → Optimization Task Module**
   - How does "Add Measurement" fetch data?
   - Does it use the same source as Ranking & AI?
   - Why might it fail to find matching data?

4. **Data Consistency Checks**
   - Are both modules using the same `queryTotals` array?
   - Are both using the same field names?
   - Are both using the same URL normalization?

---

### 5. Specific Issues to Investigate

#### Issue A: Rank Data Mismatch
- **Ranking & AI**: Shows rank #5 (from `best_rank_group`)
- **Optimization Task**: Shows rank — (not found)
- **Question**: Why isn't optimization module finding the same row?

#### Issue B: AI Overview Mismatch
- **Ranking & AI**: Shows "AI Overview: On" (from `has_ai_overview: true`)
- **Optimization Task**: Shows "AI Overview: Not present" (from `has_ai_overview: false` or null)
- **Question**: Why are they reading different values?

#### Issue C: URL Matching Requirement
- **Current Logic**: Optimization module requires both keyword match AND URL match
- **Problem**: If task URL doesn't match Ranking & AI row URL, match fails
- **Question**: Should keyword tasks require URL matching? Or should URL be optional for keyword-only tasks?

#### Issue D: Data Source Priority
- **Current**: Optimization module checks multiple sources in order
- **Question**: Are all sources using the same data? Or are some stale?

---

## Investigation Tasks

### Task 1: Document All Update Processes
**Action**: Search codebase for:
- "Run Audit Scan" button handler
- "Add Measurement" button handler
- "Update All Tasks" button handler
- Any refresh/reload functions
- Any Supabase fetch functions
- Any localStorage read/write for audit data

**Deliverable**: List of all processes that update/refresh data, with:
- Trigger (user action, automatic, scheduled)
- Data sources (GSC API, Supabase, localStorage)
- Data flow (fetch → transform → store → display)
- Dependencies (does one process depend on another?)

---

### Task 2: Map Data Sources for Each Module
**Action**: Trace data flow for:
- Ranking & AI tab: Where does `combinedRows` come from?
- Optimization Task "Add Measurement": What sources does it check?
- Optimization Task "Bulk Update": What sources does it use?

**Deliverable**: Data source map showing:
- Source → Transform → Storage → Display
- Field mappings (GSC field → internal field → display field)
- URL normalization steps
- Keyword matching logic

---

### Task 3: Compare Keyword vs Page Task Logic
**Action**: Find code that:
- Determines if task is keyword-based or page-based
- Fetches data for keyword tasks
- Fetches data for page tasks
- Aggregates data differently for each type

**Deliverable**: Comparison table showing:
- How keyword tasks fetch data
- How page tasks fetch data
- Differences in aggregation
- Differences in field selection

---

### Task 4: Verify Supabase Schema
**Action**: Check Supabase tables:
- `audit_results` table structure
- `search_data` JSONB structure
- `queryTotals` array structure
- `queryPages` array structure
- Field names and types

**Deliverable**: Schema documentation showing:
- Table structure
- JSONB field structure
- Field names used
- Data types
- Example records

---

### Task 5: Test Data Flow End-to-End
**Action**: Create test script that:
- Fetches latest audit from Supabase
- Extracts "photography tuition" from `queryTotals`
- Compares with what Ranking & AI tab shows
- Compares with what Optimization Task module would find
- Identifies discrepancies

**Deliverable**: Test results showing:
- What data exists in Supabase
- What Ranking & AI tab displays
- What Optimization Task module would find
- Where the mismatch occurs

---

## Files to Review

### Core Files
- `audit-dashboard.html` - Main dashboard (52,000+ lines)
  - Ranking & AI tab rendering
  - Optimization Task module
  - "Add Measurement" logic
  - "Bulk Update" logic
  - Data fetching functions

### API Files
- `api/supabase/save-audit.js` - How audit data is saved
- `api/supabase/get-audit-history.js` - How historical data is fetched
- `api/aigeo/gsc-entity-metrics.js` - How GSC data is fetched
- `api/aigeo/ai-mode-serp-batch-test.js` - How ranking/AI data is fetched

### Database Files
- `SUPABASE_SCHEMA.sql` - Database schema
- `migrations/*.sql` - Migration files

### Documentation Files
- `ARCHITECTURE.md` - System architecture
- `OPTIMISATION_TRACKING_MODULE_PLAN.md` - Optimization module design
- `OPTIMISATION_TRACKING_PHASES_COMPLETE.md` - Implementation status
- `DATA_RETRIEVAL_STRATEGY.md` - Data retrieval patterns

---

## Expected Findings

### Hypothesis 1: URL Matching Too Strict
- **Issue**: Optimization module requires URL match even for keyword-only tasks
- **Fix**: Make URL matching optional for keyword-based tasks
- **Risk**: Low (only affects keyword tasks without URL)

### Hypothesis 2: Different Data Sources
- **Issue**: Ranking & AI uses one source, Optimization uses another
- **Fix**: Ensure both use same source (Supabase `audit_results.search_data.queryTotals`)
- **Risk**: Medium (may require refactoring data fetching)

### Hypothesis 3: Stale Data
- **Issue**: Optimization module is reading stale/cached data
- **Fix**: Ensure fresh data fetch or proper cache invalidation
- **Risk**: Low (just need to refresh data source)

### Hypothesis 4: Field Name Mismatch
- **Issue**: Different field names used (`best_rank_group` vs `current_rank`)
- **Fix**: Standardize field names or add mapping layer
- **Risk**: Low (just need to map fields correctly)

### Hypothesis 5: Missing Data in Supabase
- **Issue**: Data exists in localStorage but not in Supabase
- **Fix**: Ensure audit saves all necessary data to Supabase
- **Risk**: Medium (may need to backfill or fix save logic)

---

## Next Steps

1. **Revert Previous Change** ✅ (Done - URL matching fix reverted)
2. **Read All Documentation** ✅ (Done - README, ARCHITECTURE, OPTIMISATION docs read)
3. **Create Investigation Plan** ✅ (This document)
4. **Execute Investigation Tasks** (Next - without making code changes)
5. **Report Findings** (After investigation complete)
6. **Propose Fixes** (After findings reviewed)

---

## Investigation Status

- [x] Reverted previous change
- [x] Read key documentation
- [x] Created investigation plan
- [x] Document all update/refresh processes (IN PROGRESS)
- [x] Map data sources for each module (IN PROGRESS)
- [ ] Compare keyword vs page task logic
- [ ] Verify Supabase schema
- [ ] Test data flow end-to-end
- [ ] Report findings

---

## Investigation Findings (In Progress)

### Task 1: Update/Refresh Processes - FINDINGS

#### 1. Full Audit Run ("Run Audit Scan" button)
**Location**: `audit-dashboard.html` line ~24438 (`runAudit()` function)

**Process Flow**:
1. **Fetches Data**:
   - GSC data via `fetchSearchConsoleData()` → stored in `searchData`
   - Local signals (GBP) via `/api/aigeo/local-signals`
   - Trustpilot reviews via `/api/reviews/site-reviews`
   - Backlink metrics from localStorage or API
   - Schema audit via `/api/schema-audit`

2. **Calculates Scores**:
   - Calls `calculatePillarScores()` with all fetched data
   - Calculates snippet readiness

3. **Stores Data**:
   - **localStorage**: `saveAuditResults()` → stores in `last_audit_results`
     - Structure: `{scores, searchData, snippetReadiness, schemaAudit, localSignals, siteReviews, backlinkMetrics}`
     - `searchData` contains: `queryTotals`, `queryPages`, `timeseries`, `topQueries`
   - **Supabase**: `saveAuditToSupabase()` → stores in `audit_results` table
     - `query_totals` field (JSONB) stores `searchData.queryTotals` array
     - `ranking_ai_data` field (JSONB) stores Ranking & AI data with `combinedRows`
     - Also saves to `keyword_rankings` table (one row per keyword)

4. **Updates Ranking & AI Data**:
   - Ranking & AI data comes from separate process (not part of main audit)
   - Stored in `localStorage.rankingAiData` with structure: `{combinedRows: [...], timestamp: ...}`
   - Also saved to Supabase `audit_results.ranking_ai_data` field

**Key Finding**: Full audit does NOT automatically refresh Ranking & AI data. Ranking & AI must be run separately.

---

#### 2. Ranking & AI Tab Refresh
**Location**: `audit-dashboard.html` line ~3831 (`renderRankingAiTab()` function)

**Process Flow**:
1. **Data Sources** (in priority order):
   - `RankingAiModule.state().combinedRows` (if RankingAiModule is loaded)
   - `window.rankingAiData` (if set)
   - `localStorage.getItem('rankingAiData')` → `parsed.combinedRows`

2. **Data Structure**:
   - `combinedRows` is an array of keyword objects
   - Each row contains: `keyword`, `best_rank_group`, `has_ai_overview`, `ai_alan_citations_count`, `best_url`, etc.

3. **When Does It Refresh?**:
   - When Ranking & AI tab is clicked/opened
   - When "Run Ranking & AI Scan" button is clicked (separate from main audit)
   - May fetch from Supabase or use cached localStorage data

**Key Finding**: Ranking & AI tab uses `combinedRows` which comes from Ranking & AI scan, NOT from main audit's `queryTotals`.

---

#### 3. Optimization Task "Add Measurement"
**Location**: `audit-dashboard.html` line ~13715 (button click handler)

**Data Source Priority** (lines 13728-14300):
1. **GSC Page Totals API** (for URL-only tasks, line 13735-13775)
   - Fetches from `/api/aigeo/gsc-page-totals`
   - Only used if task has NO keyword (`!hasKeyword`)

2. **RankingAiModule.state().combinedRows** (line 13789-13837)
   - **REQUIRES**: Both keyword match AND URL match
   - If keyword matches but URL doesn't → FAILS, moves to next source
   - Uses: `best_rank_group`, `has_ai_overview`, `ai_alan_citations_count`

3. **window.rankingAiData** (line 13840-13908)
   - **REQUIRES**: Both keyword match AND URL match
   - Same logic as #2

4. **Money Pages from localStorage** (line 13950-14001)
   - Checks `parsed.scores.moneyPagesMetrics.rows`
   - URL-based matching only

5. **queryTotals from localStorage** (line 14005-14073)
   - Checks `parsed.searchData.queryTotals`
   - **SUPPORTS**: Both keyword matching AND URL matching
   - **KEY FINDING**: For keyword tasks, this should work! (line 14017-14022)
   - Uses: `qt.best_rank`, `qt.has_ai_overview`, `qt.ai_alan_citations_count`

6. **queryPages from localStorage** (line 14075-14132)
   - Checks `parsed.scores.query_pages` or `parsed.searchData.queryPages`
   - Query+page level data

7. **Supabase queryTotals** (line 14192-14259)
   - Checks `supabaseData.searchData.queryTotals`
   - **SUPPORTS**: Both keyword matching AND URL matching
   - **KEY FINDING**: This should also work for keyword tasks! (line 14203-14207)

8. **Supabase queryPages** (line 14261-14320)
   - Query+page level data from Supabase

**CRITICAL ISSUE IDENTIFIED**:
- Lines 13789-13811: RankingAiModule check requires BOTH keyword AND URL match
- If task has keyword "photography tuition" but URL doesn't match → fails
- Falls through to queryTotals checks (lines 14005, 14192) which SHOULD work
- **Question**: Why isn't queryTotals matching working?

---

#### 4. Bulk Update Tasks ("Update All Tasks with Latest Data")
**Location**: `audit-dashboard.html` line ~14498 (`bulkUpdateAllTasks()` function)

**Process Flow**:
1. **Fetches Latest Audit from Supabase** (line 14505-14560)
   - Uses `fetchLatestAuditFromSupabase()` function
   - Updates localStorage with latest audit data
   - Loads Ranking & AI data from `latestAuditFromSupabase.ranking_ai_data`

2. **Loads Ranking & AI Data** (line 14561-14712)
   - Tries to load from latest audit's `ranking_ai_data.combinedRows`
   - Also calls `renderRankingAiTab()` to refresh data
   - Stores in `localStorage.rankingAiData`

3. **Gets combinedRows** (line 14714-14736)
   - Priority: RankingAiModule.state() → window.rankingAiData → localStorage

4. **Processes Each Task** (line 14768+)
   - For keyword tasks: Searches `combinedRows` by keyword (line 14798-14809)
     - **KEY DIFFERENCE**: Bulk update allows keyword match WITHOUT URL if no URL provided (line 14808)
   - For URL-only tasks: Searches Money Pages data (line 14813+)

**Key Finding**: Bulk update has DIFFERENT logic than "Add Measurement":
- Bulk update: Keyword match is sufficient if no URL (line 14808)
- Add Measurement: Requires BOTH keyword AND URL match (line 13797-13811)

---

### Task 2: Data Source Mapping - FINDINGS

#### Ranking & AI Tab Data Flow
```
1. User clicks "Run Ranking & AI Scan" (separate from main audit)
   ↓
2. Fetches SERP data from DataForSEO API
   ↓
3. Combines with GSC queryTotals data
   ↓
4. Creates combinedRows array
   ↓
5. Stores in:
   - localStorage.rankingAiData = {combinedRows: [...], timestamp: ...}
   - Supabase audit_results.ranking_ai_data = {combinedRows: [...]}
   - window.rankingAiData = combinedRows
   - RankingAiModule.state().combinedRows = combinedRows
   ↓
6. Ranking & AI tab displays from RankingAiModule.state().combinedRows
```

**Fields in combinedRows**:
- `keyword`: String
- `best_rank_group`: Integer (e.g., 5)
- `best_rank_absolute`: Integer
- `best_url`: String
- `has_ai_overview`: Boolean
- `ai_alan_citations_count`: Integer
- `gsc_clicks_28d`, `gsc_impressions_28d`, `gsc_ctr_28d`: Numbers

---

#### Optimization Task "Add Measurement" Data Flow
```
1. User clicks "Add Measurement" button
   ↓
2. Checks if task has keyword (hasKeyword = !!(task.keyword_text))
   ↓
3. If keyword task:
   a. Try RankingAiModule.state().combinedRows
      - Requires: keyword match AND URL match
      - If fails → next
   b. Try window.rankingAiData
      - Requires: keyword match AND URL match
      - If fails → next
   c. Try queryTotals from localStorage
      - Supports: keyword match OR URL match
      - Should work for keyword-only tasks!
   d. Try queryTotals from Supabase
      - Supports: keyword match OR URL match
      - Should work for keyword-only tasks!
   ↓
4. If URL-only task:
   a. Fetch from GSC page totals API
   b. Or search Money Pages data
```

**CRITICAL DISCOVERY**: 
- The queryTotals checks (steps 3c and 3d) SHOULD work for keyword-only tasks
- But they're checked AFTER RankingAiModule checks which fail
- **Question**: Are queryTotals checks actually being reached? Or is there an early return?

---

### Task 3: Keyword vs Page Task Logic - FINDINGS

#### How Task Type is Determined
**Location**: Line 13732
```javascript
const hasKeyword = !!(task.keyword_text && String(task.keyword_text).trim());
```

- **Keyword Task**: `hasKeyword === true` (has `keyword_text`)
- **Page Task**: `hasKeyword === false` (no `keyword_text`)

#### Data Fetching Logic

**For Keyword Tasks** (hasKeyword === true):
- **Should use**: `queryTotals` array (keyword-specific data)
- **Fields expected**: `query`, `clicks`, `impressions`, `ctr`, `best_rank`, `has_ai_overview`, `ai_alan_citations_count`
- **Current behavior**: Tries RankingAiModule first (requires URL match), then falls back to queryTotals

**For Page Tasks** (hasKeyword === false):
- **Should use**: GSC page totals API or Money Pages data (aggregated across all queries)
- **Fields expected**: `clicks`, `impressions`, `ctr`, `avg_position` or `position`
- **Current behavior**: Fetches from GSC page totals API (line 13735-13775)

**KEY ISSUE**: 
- Keyword tasks are trying RankingAiModule first (which requires URL match)
- If URL doesn't match, it should fall through to queryTotals
- But queryTotals matching logic (line 14017-14022) looks correct for keyword-only tasks
- **Question**: Is the queryTotals check actually being executed? Or is there a bug preventing it?

---

### Task 4: Supabase Schema - FINDINGS

**From `save-audit.js` (line 275-282)**:
- `query_totals` field stores `searchData.queryTotals` array
- Each item in array has: `query`, `clicks`, `impressions`, `ctr`, `best_rank`, `has_ai_overview`, `ai_alan_citations_count`, etc.

**From `save-audit.js` (line 1006-1117)**:
- `keyword_rankings` table stores individual keyword rows
- Fields: `keyword`, `best_rank_group`, `has_ai_overview`, `ai_alan_citations_count`, etc.
- This is populated from `rankingAiData.combinedRows`

**KEY FINDING**:
- `audit_results.query_totals` = GSC query-level data (from main audit)
- `audit_results.ranking_ai_data.combinedRows` = SERP ranking data (from Ranking & AI scan)
- `keyword_rankings` table = Individual keyword rows (from Ranking & AI scan)

**These are DIFFERENT data sources!**
- `queryTotals` comes from GSC API (query-level performance)
- `combinedRows` comes from Ranking & AI scan (SERP rankings + AI Overview)

---

## Preliminary Conclusions

### Root Cause Hypothesis

**The issue is likely a DATA SOURCE MISMATCH**:

1. **Ranking & AI tab** displays data from:
   - `RankingAiModule.state().combinedRows` 
   - Which comes from Ranking & AI scan (DataForSEO SERP data)
   - Shows: `best_rank_group: 5`, `has_ai_overview: true`

2. **Optimization Task "Add Measurement"** tries to get data from:
   - First: `RankingAiModule.state().combinedRows` (requires URL match) → FAILS if URL doesn't match
   - Then: `queryTotals` from localStorage/Supabase (should work for keyword-only)
   - But `queryTotals` comes from GSC API, NOT from Ranking & AI scan
   - GSC `queryTotals` may have different field names or structure

3. **The Mismatch**:
   - Ranking & AI tab uses `best_rank_group` from DataForSEO
   - Optimization Task may be looking for `best_rank` in queryTotals
   - These are different fields from different sources!

### Task 2: Data Source Mapping - FIELD MAPPING FINDINGS

#### Field Name Comparison

**Ranking & AI Tab (combinedRows)**:
- Rank: `best_rank_group` (integer, e.g., 5)
- AI Overview: `has_ai_overview` (boolean)
- AI Citations: `ai_alan_citations_count` (integer)
- Clicks: `gsc_clicks_28d` (number)
- Impressions: `gsc_impressions_28d` (number)
- CTR: `gsc_ctr_28d` (ratio 0-1)
- URL: `best_url` (string)

**Optimization Task from combinedRows** (line 13827):
- Rank: `matchingRow.best_rank_group || matchingRow.current_rank`
- AI Overview: `matchingRow.has_ai_overview`
- AI Citations: `matchingRow.ai_alan_citations_count`

**Optimization Task from queryTotals** (line 14060):
- Rank: `qt.best_rank || qt.avg_position`
- AI Overview: `qt.has_ai_overview`
- AI Citations: `qt.ai_alan_citations_count`

**KEY FINDING**: 
- `combinedRows` uses `best_rank_group` (from DataForSEO SERP data)
- `queryTotals` uses `best_rank` OR `avg_position` (from GSC or DataForSEO)
- These are DIFFERENT fields! `best_rank_group` may not exist in `queryTotals`

---

### Task 3: Keyword vs Page Task Logic - DETAILED FINDINGS

#### Current Logic Flow for Keyword Tasks

**"Add Measurement" for keyword task** (line 13715-14300):

1. **Check if hasKeyword** (line 13732): `hasKeyword = !!(task.keyword_text && String(task.keyword_text).trim())`

2. **If hasKeyword === true**:
   - **Step 1**: Try to refresh Ranking & AI data (line 13778-13786)
     - Calls `renderRankingAiTab()` to load data
     - Waits 500ms for data to load
   
   - **Step 2**: Try RankingAiModule.state().combinedRows (line 13789-13837)
     - **REQUIRES**: Keyword match AND URL match (line 13798-13811)
     - If keyword matches but URL doesn't → `matchingRow = null`
     - If `matchingRow` found → builds `currentMetrics` from `matchingRow` (line 13822-13836)
     - Uses: `best_rank_group`, `has_ai_overview`, `ai_alan_citations_count`
   
   - **Step 3**: Try window.rankingAiData (line 13840-13908)
     - Same logic as Step 2
     - **REQUIRES**: Keyword match AND URL match
   
   - **Step 4**: Try Money Pages data (line 13950-14001)
     - Only if `!currentMetrics` (hasn't found data yet)
     - URL-based matching only
   
   - **Step 5**: Try queryTotals from localStorage (line 14005-14073)
     - Checks `parsed.searchData.queryTotals`
     - **SUPPORTS**: Keyword matching OR URL matching (line 14007-14024)
     - **For keyword tasks**: Should match by keyword (line 14017-14022)
     - Uses: `qt.best_rank || qt.avg_position`, `qt.has_ai_overview`, `qt.ai_alan_citations_count`
     - **KEY**: This should work for keyword-only tasks!
   
   - **Step 6**: Try queryPages from localStorage (line 14075-14132)
     - Query+page level data
     - For keyword tasks: matches by keyword first, then URL if provided (line 14089-14101)
   
   - **Step 7**: Try Supabase queryTotals (line 14192-14259)
     - Checks `supabaseData.searchData.queryTotals`
     - **SUPPORTS**: Keyword matching OR URL matching (line 14193-14210)
     - **For keyword tasks**: Should match by keyword (line 14203-14207)
     - Uses: `qt.best_rank || qt.avg_position`, `qt.has_ai_overview`, `qt.ai_alan_citations_count`
     - **KEY**: This should also work for keyword-only tasks!

**CRITICAL DISCOVERY**:
- Steps 5 and 7 (queryTotals checks) SHOULD work for keyword-only tasks
- They support keyword matching without requiring URL match
- **Question**: Why aren't they finding the data?

**Possible Issues**:
1. **queryTotals may not contain "photography tuition"** - The keyword might not be in the queryTotals array
2. **Field name mismatch** - queryTotals might use different field names than expected
3. **Data structure mismatch** - queryTotals structure might be different from what the code expects
4. **Early return** - Something might be setting `currentMetrics` before reaching queryTotals checks

---

### Task 4: Supabase Schema Verification - FINDINGS

**From diagnostic script execution**:

#### query_totals Structure (from GSC API)
- **Fields**: `ctr, query, clicks, position, impressions`
- **Contains "photography tuition"**: ✅ YES
- **Has ranking data**: ❌ NO (`best_rank` = N/A, `avg_position` = N/A)
- **Has AI data**: ❌ NO (`has_ai_overview` = N/A, `ai_alan_citations_count` = N/A)
- **Source**: Google Search Console API (query-level performance data)

#### ranking_ai_data.combinedRows Structure (from Ranking & AI scan)
- **Fields**: `keyword, best_rank_group, best_rank_absolute, has_ai_overview, ai_total_citations, best_url, ...`
- **Contains "photography tuition"**: ✅ YES
- **Has ranking data**: ✅ YES (`best_rank_group: 5`, `best_rank_absolute: 7`)
- **Has AI data**: ✅ YES (`has_ai_overview: true`, `ai_total_citations: 18`)
- **Source**: DataForSEO SERP scan (SERP rankings + AI Overview data)

#### keyword_rankings Table Structure
- **Fields**: Same as combinedRows (individual rows per keyword)
- **Contains "photography tuition"**: ✅ YES
- **Has ranking data**: ✅ YES (`best_rank_group: 5`)
- **Has AI data**: ✅ YES (`has_ai_overview: true`)

**CRITICAL DISCOVERY**:
- `queryTotals` and `combinedRows` are **COMPLETELY DIFFERENT DATA SOURCES**
- `queryTotals` = GSC performance data (clicks, impressions, CTR, position)
- `combinedRows` = SERP ranking data (best_rank_group, has_ai_overview, AI citations)
- **They serve different purposes and have different fields!**

---

### Task 5: Data Flow End-to-End Test - FINDINGS

**Diagnostic script results** (see `scripts/diagnose-keyword-data-sources.js`):

#### What Exists in Supabase:
1. ✅ `query_totals` contains "photography tuition"
   - Has: `query`, `clicks`, `impressions`, `position`, `ctr`
   - Missing: `best_rank`, `has_ai_overview`, `ai_alan_citations_count`

2. ✅ `ranking_ai_data.combinedRows` contains "photography tuition"
   - Has: `best_rank_group: 5`, `has_ai_overview: true`, `ai_total_citations: 18`
   - Has: `best_url` (with query params: `?srsltid=...`)

3. ✅ `keyword_rankings` table contains "photography tuition"
   - Same data as combinedRows

#### What Ranking & AI Tab Shows:
- Uses `combinedRows` from `RankingAiModule.state()`
- Displays: `best_rank_group: 5` → shows as "#5"
- Displays: `has_ai_overview: true` → shows as "On"
- Displays: `ai_alan_citations_count: 0` → shows as "0"

#### What Optimization Task Module Would Find:

**Scenario 1: If task has URL that matches combinedRows URL**
- ✅ Would find in RankingAiModule (line 13789-13837)
- ✅ Would get: `best_rank_group: 5`, `has_ai_overview: true`

**Scenario 2: If task has URL that DOESN'T match combinedRows URL**
- ❌ Fails RankingAiModule check (requires URL match)
- Falls through to queryTotals check (line 14005-14073)
- ✅ Finds keyword in queryTotals
- ❌ But queryTotals has NO ranking/AI data!
- Result: Gets GSC metrics (clicks, impressions) but NO rank, NO AI Overview

**Scenario 3: If task has NO URL (keyword-only)**
- ❌ Fails RankingAiModule check (requires URL match, even if task has no URL)
- Falls through to queryTotals check
- ✅ Finds keyword in queryTotals
- ❌ But queryTotals has NO ranking/AI data!

---

## ROOT CAUSE IDENTIFIED

### The Problem

**Two separate data sources with different purposes**:

1. **queryTotals** (from GSC API):
   - Purpose: Query-level performance metrics
   - Contains: `query`, `clicks`, `impressions`, `position`, `ctr`
   - **Does NOT contain**: Ranking data (`best_rank`), AI data (`has_ai_overview`)

2. **combinedRows** (from Ranking & AI scan):
   - Purpose: SERP rankings and AI Overview data
   - Contains: `best_rank_group`, `has_ai_overview`, `ai_total_citations`, `best_url`
   - **Does NOT always contain**: GSC metrics (`gsc_clicks_28d`, `gsc_impressions_28d`)

**The Optimization Task "Add Measurement" logic**:
- Tries `combinedRows` first (which has ranking/AI data) → **REQUIRES URL MATCH**
- If URL doesn't match → falls through to `queryTotals` (which has NO ranking/AI data)
- Result: Gets GSC metrics but loses ranking/AI data

### Why Ranking & AI Tab Works

- Ranking & AI tab ONLY uses `combinedRows`
- It doesn't need to match URLs - it just displays all keywords
- So it always shows the ranking/AI data correctly

### Why Optimization Task Module Fails

- Tries `combinedRows` first but requires URL match
- If task URL doesn't exactly match `combinedRows.best_url` → fails
- Falls back to `queryTotals` which doesn't have ranking/AI data
- Result: Missing rank and AI Overview data

---

## Final Findings Summary

### Issue A: Rank Data Mismatch
- **Root Cause**: `queryTotals` doesn't contain `best_rank` or `avg_position` fields
- **Solution**: Must use `combinedRows` which has `best_rank_group`
- **Problem**: `combinedRows` check requires URL match, which may fail

### Issue B: AI Overview Mismatch
- **Root Cause**: `queryTotals` doesn't contain `has_ai_overview` field
- **Solution**: Must use `combinedRows` which has `has_ai_overview`
- **Problem**: Same as Issue A - URL matching requirement

### Issue C: URL Matching Requirement
- **Root Cause**: Lines 13797-13811 require BOTH keyword AND URL match
- **Impact**: If task URL doesn't match `combinedRows.best_url`, match fails
- **Solution**: For keyword-only tasks, URL matching should be optional

### Issue D: Data Source Priority
- **Root Cause**: `queryTotals` and `combinedRows` are different data sources
- **Impact**: Falling back to `queryTotals` loses ranking/AI data
- **Solution**: For keyword tasks, must prioritize `combinedRows` and make URL optional

---

## Recommended Fixes

### Fix 1: Make URL Matching Optional for Keyword Tasks
**Location**: Lines 13797-13811 and 13847-13860

**Change**: 
- If task has keyword but no URL → accept keyword match only
- If task has keyword and URL → try URL match, but don't require it for keyword tasks
- Priority: Keyword match > URL match for keyword-based tasks

**Risk**: Low (only affects keyword tasks)

### Fix 2: Improve Data Source Priority
**Location**: Lines 13788-14300

**Change**:
- For keyword tasks: Prioritize `combinedRows` (has ranking/AI data)
- Make URL matching optional in `combinedRows` check
- Only fall back to `queryTotals` for GSC metrics if `combinedRows` doesn't have them
- Combine data: Use `combinedRows` for ranking/AI, `queryTotals` for GSC metrics

**Risk**: Medium (requires careful data merging)

### Fix 3: Add Fallback to keyword_rankings Table
**Location**: After Supabase queryTotals check

**Change**:
- If `combinedRows` check fails, query `keyword_rankings` table directly
- Match by keyword only (no URL requirement)
- This table has the same structure as `combinedRows`

**Risk**: Low (adds another data source check)

---

## Next Steps

1. ✅ Documented all update/refresh processes
2. ✅ Mapped data sources for each module
3. ✅ Compared keyword vs page task logic
4. ✅ Verified Supabase schema structure
5. ✅ Tested data flow end-to-end
6. ✅ Identified root cause
7. [ ] Propose specific code fixes (after user review)
8. [ ] Implement fixes (after approval)

---

## Notes

- **No code changes** should be made until investigation is complete
- All findings should be documented
- User's GSC screenshots provide ground truth for expected data
- Focus on understanding the system before proposing fixes
