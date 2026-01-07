# All Audit/Scan/Update/Refresh Processes

**⚠️ NOTE**: For the most current status of fixes and ongoing issues (as of 2026-01-07), see **`HANDOVER.md`**.

## Overview

This document lists ALL processes that can update/refresh/scan/audit data in the AI GEO Audit application. Understanding these processes is critical for identifying data consistency issues.

---

## Main Audit/Scan Processes

### 1. Run Audit Scan (`runAudit()`)
**Location**: Line ~24438  
**Trigger**: "Run Audit Scan" button  
**What it does**:
- Fetches GSC data via `fetchSearchConsoleData()`
- Fetches Local Signals (GBP) via `/api/aigeo/local-signals`
- Fetches Trustpilot reviews via `/api/reviews/site-reviews`
- Fetches Backlink metrics from localStorage or API
- Fetches Schema audit via `/api/schema-audit`
- Calculates pillar scores
- Calculates snippet readiness
- **Stores in**:
  - `localStorage.last_audit_results` (structure: `{scores, searchData, snippetReadiness, schemaAudit, localSignals, siteReviews, backlinkMetrics}`)
  - Supabase `audit_results` table:
    - `query_totals` (JSONB) - stores `searchData.queryTotals` array
    - `search_data` (JSONB) - stores full searchData object
    - `scores` (JSONB) - stores calculated scores
    - `money_pages_metrics` (JSONB) - stores Money Pages data
- **Does NOT update**: Ranking & AI data (separate process)

**Data Sources**:
- GSC API (query-level performance data)
- Schema audit API
- Local Signals API
- Trustpilot API
- Backlink metrics (localStorage or API)

**Key Fields Created**:
- `queryTotals`: Array of `{query, clicks, impressions, position, ctr}` (NO ranking/AI data)
- `queryPages`: Array of query+page combinations
- `moneyPagesMetrics`: Money Pages aggregated data

---

### 2. Run Ranking & AI Scan (`loadRankingAiData()` / `renderRankingAiTab()`)
**Location**: Multiple locations (Ranking & AI tab)  
**Trigger**: "Run Ranking & AI Scan" button OR "Run Ranking & AI check" button  
**What it does**:
- Fetches SERP data from DataForSEO API for tracked keywords
- Combines with GSC queryTotals data
- Creates `combinedRows` array with ranking and AI data
- **Stores in**:
  - `localStorage.rankingAiData` = `{combinedRows: [...], timestamp: ...}`
  - Supabase `audit_results.ranking_ai_data` = `{combinedRows: [...]}`
  - Supabase `keyword_rankings` table (one row per keyword)
  - `window.rankingAiData` = combinedRows array
  - `RankingAiModule.state().combinedRows` = combinedRows array

**Data Sources**:
- DataForSEO SERP API (ranking positions, AI Overview, citations)
- GSC API (for GSC metrics if available)

**Key Fields Created**:
- `combinedRows`: Array of `{keyword, best_rank_group, best_rank_absolute, has_ai_overview, ai_total_citations, best_url, ...}`
- `keyword_rankings` table: Individual rows with same structure

**Note**: This is a SEPARATE process from main audit. Must be run separately.

---

### 3. Run Money Pages Scan (`dashboardRunMoneyPagesScan()`)
**Location**: Dashboard tab  
**Trigger**: "Run scan" button in Money Pages card  
**What it does**:
- Refreshes Money Pages metrics using latest audit from Supabase
- Does NOT run a new audit - uses existing audit data
- Updates Money Pages aggregated metrics
- **Stores in**: Updates `window.moneyPagesMetrics` and localStorage

**Data Sources**:
- Latest audit from Supabase (`audit_results.money_pages_metrics`)
- Or from localStorage (`last_audit_results.scores.moneyPagesMetrics`)

**Key Fields Used**:
- Money Pages rows with `{url, clicks, impressions, ctr, avg_position}`

---

### 4. Run Domain Strength Snapshot (`runDomainStrengthSnapshot()`)
**Location**: Ranking & AI tab / Dashboard  
**Trigger**: "Run snapshot" button in Domain Strength card  
**What it does**:
- Calculates domain strength score based on ranking positions
- Compares against competitors
- **Stores in**: Supabase and localStorage

**Data Sources**:
- Ranking & AI data (`combinedRows`)
- Competitor data

---

### 5. Sync CSV (`syncCsv()`)
**Location**: Main dashboard  
**Trigger**: "Sync CSV" button  
**What it does**:
- Syncs CSV data from configured source
- Updates URL list for schema audit
- Updates backlink data
- **Stores in**: localStorage

**Data Sources**:
- Remote CSV files (GitHub/hosted)

---

## Optimization Task Update Processes

### 6. Add Measurement (Individual Task) (`addMeasurementBtn` click handler)
**Location**: Line ~13715  
**Trigger**: "Add Measurement" button on individual task  
**What it does**:
- Captures current metrics for a single task
- **Data Source Priority**:
  1. GSC Page Totals API (for URL-only tasks)
  2. `RankingAiModule.state().combinedRows` (requires keyword + URL match)
  3. `window.rankingAiData` (requires keyword + URL match)
  4. Money Pages from localStorage
  5. `queryTotals` from localStorage (`searchData.queryTotals`)
  6. `queryPages` from localStorage
  7. Supabase `queryTotals` (`audit_results.query_totals`)
  8. Supabase `queryPages`
- **Stores in**: Supabase `optimisation_measurements` table

**Key Issue**: Steps 2-3 require URL match, which may fail for keyword-only tasks.

---

### 7. Update Task Latest (Individual Task) (`updateTaskLatest()`)
**Location**: Line ~15478  
**Trigger**: "Update" button on individual task  
**What it does**:
- Similar to "Add Measurement" but updates latest measurement
- Uses same data source priority as "Add Measurement"
- **Stores in**: Supabase `optimisation_measurements` table (updates latest)

---

### 8. Bulk Update All Tasks (`bulkUpdateAllTasks()`)
**Location**: Line ~14498  
**Trigger**: "Update All Tasks with Latest Data" button  
**What it does**:
- Updates ALL active tasks with latest data
- Fetches latest audit from Supabase first
- Loads Ranking & AI data from latest audit
- Processes each task sequentially (max 3 concurrent)
- **Data Source Priority** (for each task):
  1. `combinedRows` from RankingAiModule (keyword match, URL optional if no URL in task)
  2. Money Pages data (for URL-only tasks)
  3. `queryTotals` from localStorage
  4. `queryTotals` from Supabase
  5. `queryPages` from Supabase
- **Stores in**: Supabase `optimisation_measurements` table (creates new measurement for each task)

**Key Difference**: Bulk update has BETTER logic - allows keyword match without URL requirement (line 14808).

---

## Global Run Process

### 9. Run All Audits & Updates (`dashboardRunAll()`)
**Location**: Line ~51610  
**Trigger**: "Run All Audits & Updates" button  
**What it does**:
- Runs multiple processes in sequence:
  1. Sync CSV
  2. Run Audit Scan
  3. Run Ranking & AI Scan
  4. Run Money Pages Scan
  5. Run Domain Strength Snapshot
  6. Update All Tasks with Latest Data
- **Stores in**: All of the above storage locations

**Note**: This is the most comprehensive process, ensuring all data is fresh and consistent.

---

## Data Refresh Processes

### 10. Ranking & AI Tab Refresh (`renderRankingAiTab()`)
**Location**: Ranking & AI tab  
**Trigger**: When Ranking & AI tab is opened/clicked  
**What it does**:
- Loads `combinedRows` from:
  1. `RankingAiModule.state().combinedRows`
  2. `window.rankingAiData`
  3. `localStorage.rankingAiData`
- Displays data in table
- **Does NOT fetch new data** - only displays existing data

---

### 11. Dashboard Tab Refresh (`renderDashboardTab()`)
**Location**: Dashboard tab  
**Trigger**: When Dashboard tab is opened/clicked  
**What it does**:
- Loads latest audit from localStorage
- Displays summary cards
- Refreshes Domain Strength cache if needed
- **Does NOT fetch new data** - only displays existing data

---

## Potential Inconsistency Issues

### Issue 1: Separate Data Sources
- **Main Audit** creates `queryTotals` (GSC data only, NO ranking/AI)
- **Ranking & AI Scan** creates `combinedRows` (ranking/AI data)
- These are DIFFERENT processes that may run at different times
- **Impact**: If Ranking & AI scan is stale, Optimization Task module may not find ranking/AI data

### Issue 2: Different Update Processes Use Different Logic
- **"Add Measurement"**: Requires URL match for `combinedRows` check
- **"Bulk Update"**: Allows keyword match without URL requirement
- **Impact**: Same task may get different data depending on which process is used

### Issue 3: Data Source Priority Differences
- **"Add Measurement"**: Checks `combinedRows` first (requires URL match)
- **"Bulk Update"**: Checks `combinedRows` first (URL optional)
- **Impact**: Inconsistent data retrieval

### Issue 4: Stale Data in localStorage
- Multiple processes store data in localStorage
- If one process fails or is not run, data may be stale
- **Impact**: Modules may use outdated data

### Issue 5: Supabase vs localStorage
- Some processes read from Supabase, others from localStorage
- If Supabase is updated but localStorage is not, inconsistency occurs
- **Impact**: Different modules may show different data

### Issue 6: Timing Dependencies
- "Bulk Update" runs after "Run Audit Scan" in global run
- But "Add Measurement" can be run independently
- **Impact**: "Add Measurement" may use stale audit data

---

## Recommendations

1. **Standardize Data Source Priority**: Make all processes use the same priority and matching logic
2. **Make URL Matching Optional**: For keyword tasks, URL should be optional in `combinedRows` checks
3. **Ensure Data Freshness**: Always fetch latest from Supabase before using cached localStorage data
4. **Document Dependencies**: Clearly document which processes depend on which data sources
5. **Add Data Validation**: Check data freshness before using it
6. **Unify Update Logic**: Make "Add Measurement" use same logic as "Bulk Update"

---

## Process Execution Order (Recommended)

For consistent data:

1. **Sync CSV** (if needed)
2. **Run Audit Scan** (creates `queryTotals`, Money Pages data)
3. **Run Ranking & AI Scan** (creates `combinedRows`, `keyword_rankings`)
4. **Run Money Pages Scan** (refreshes Money Pages from audit)
5. **Run Domain Strength Snapshot** (uses Ranking & AI data)
6. **Update All Tasks** (uses all above data sources)

**Note**: "Run All Audits & Updates" button does this automatically.

---

## Files Modified by Each Process

### Main Audit (`runAudit()`)
- `localStorage.last_audit_results`
- Supabase `audit_results` table
- `window.moneyPagesMetrics`

### Ranking & AI Scan (`loadRankingAiData()`)
- `localStorage.rankingAiData`
- Supabase `audit_results.ranking_ai_data`
- Supabase `keyword_rankings` table
- `window.rankingAiData`
- `RankingAiModule.state().combinedRows`

### Add Measurement / Update Task Latest
- Supabase `optimisation_measurements` table

### Bulk Update All Tasks
- Supabase `optimisation_measurements` table (multiple rows)

---

## Data Flow Diagram

```
GSC API → Main Audit → queryTotals → localStorage + Supabase
                                    ↓
                              Optimization Tasks (if URL matches)

DataForSEO API → Ranking & AI Scan → combinedRows → localStorage + Supabase + keyword_rankings
                                      ↓
                              Optimization Tasks (if keyword + URL matches)

Main Audit → Money Pages → localStorage + Supabase
            ↓
      Money Pages Scan → window.moneyPagesMetrics
            ↓
      Optimization Tasks (if URL matches)
```

---

## Summary

**Total Processes**: 11 distinct processes
- 5 Main audit/scan processes
- 3 Optimization task update processes
- 1 Global run process
- 2 Refresh/display processes

**Key Inconsistency**: Different processes use different data sources and matching logic, leading to inconsistent results.
