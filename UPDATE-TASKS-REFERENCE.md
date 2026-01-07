# Update Tasks & Refresh Buttons Reference

**Last Updated**: 2026-01-07  
**Purpose**: Comprehensive reference of all buttons and functions that fetch, calculate, or update data across all modules in the AI GEO Audit dashboard.

---

## Overview

This document catalogs all update/refresh/scan/audit buttons and their associated functions, organized by module. This is essential for:
- Understanding data flow and dependencies
- Identifying which processes need to use the updated `computeAiMetricsForPageUrl` logic
- Tracking which functions fetch vs. calculate vs. display data
- Planning comprehensive testing after the URL Task AI Citations fix

---

## Module: Configuration & Reporting

**Location**: Left sidebar → "Configuration & Reporting"  
**Panel ID**: `data-panel="config"`

### Buttons & Functions

| Button/Label | Element ID | Function Called | What It Does | Data Fetched/Calculated |
|--------------|------------|-----------------|--------------|------------------------|
| **Run Audit Scan** | `runAudit` (button) | `window.runAudit()` | Runs full entity-level audit scan | GSC data, Local Signals (GBP), Trustpilot reviews, Backlink metrics, Schema audit, Pillar scores, Snippet readiness |
| **Sync CSV** | `syncCsvBtn` | `window.syncCsv()` | Syncs CSV from alan-shared-resources | CSV data from GitHub/remote source |
| **Share Audit** | `shareAudit` (button) | `window.shareAudit()` | Creates shareable audit link | Generates share token, stores in Supabase |
| **Save Configuration** | `saveConfig` (button) | `saveConfig()` | Saves GSC API key, property URL, date range | Saves to localStorage only |
| **Save Admin Key** | `saveAdminKey` (button) | `setAdminKey()` | Stores admin key for optimisation tracking | Saves to sessionStorage and localStorage |
| **Clear** (Admin Key) | `clearAdminKey` (button) | `clearAdminKey()` | Removes admin key | Clears sessionStorage and localStorage |
| **Generate PDF Report** | `generatePdfReport` (button) | `generatePdfReport()` | Creates PDF report from audit data | Reads from localStorage/Supabase, generates PDF |

### Notes
- **Run Audit Scan** is the primary data collection process
- Does NOT fetch Ranking & AI data (separate process)
- Creates `queryTotals` array (GSC data only, no ranking/AI)

---

## Module: Dashboard

**Location**: Left sidebar → "Dashboard"  
**Panel ID**: `data-panel="dashboard"`

### Buttons & Functions

| Button/Label | Element ID | Function Called | What It Does | Data Fetched/Calculated |
|--------------|------------|-----------------|--------------|------------------------|
| **Run All Audits & Updates** | `dashboard-run-all-btn` | `window.runDashboardGlobalRun()` | Runs all scans/updates in sequence | Executes: Sync CSV → Audit Scan → Ranking & AI Scan → Money Pages Scan → Domain Strength Snapshot → Update All Tasks |
| **Open** (Audit Scan card) | N/A | `setActivePanel('overview')` | Navigates to AI Health Scorecard | None (navigation only) |
| **Run scan** (Ranking & AI card) | N/A | `window.dashboardRunRankingAiScan()` | Runs Ranking & AI scan | DataForSEO SERP data, creates `combinedRows` |
| **Open** (Ranking & AI card) | N/A | `setActivePanel('ranking')` | Navigates to Keyword Ranking and AI tab | None (navigation only) |
| **Run scan** (Money Pages card) | N/A | `window.dashboardRunMoneyPagesScan()` | Refreshes Money Pages from latest audit | Fetches latest audit from Supabase, extracts Money Pages metrics |
| **Open** (Money Pages card) | N/A | `setActivePanel('money')` | Navigates to URL Money Pages tab | None (navigation only) |
| **Open** (Optimisation card) | N/A | `setActivePanel('optimisation')` | Navigates to Optimisation Tracking tab | None (navigation only) |
| **Run snapshot** (Domain Strength card) | N/A | `window.runDomainStrengthSnapshot()` | Runs Domain Strength snapshot | DataForSEO Labs domain data, calculates strength score |
| **Open** (Domain Strength card) | N/A | `setActivePanel('ranking')` | Navigates to Keyword Ranking and AI tab | None (navigation only) |

### Notes
- **Run All Audits & Updates** is the global execution function
- Dashboard cards show summary metrics but don't fetch data themselves
- "Run scan" buttons trigger module-specific scans
- Dashboard automatically refreshes when data is updated elsewhere

---

## Module: AI Health Scorecard (Overview)

**Location**: Left sidebar → "AI Health Scorecard"  
**Panel ID**: `data-panel="overview"`

### Buttons & Functions

| Button/Label | Element ID | Function Called | What It Does | Data Fetched/Calculated |
|--------------|------------|-----------------|--------------|------------------------|
| **Run Audit Scan** | `runAudit` (button) | `window.runAudit()` | Runs full audit scan | Same as Configuration & Reporting → Run Audit Scan |
| **Share Audit** | `shareAudit` (button) | `window.shareAudit()` | Creates shareable link | Same as Configuration & Reporting → Share Audit |

### Notes
- Uses data from `localStorage.last_audit_results`
- Displays pillar scores, GAIO score, snippet readiness
- No module-specific data fetching (uses audit data)

---

## Module: Portfolio

**Location**: Left sidebar → "Portfolio"  
**Panel ID**: `data-panel="portfolio"`

### Buttons & Functions

| Button/Label | Element ID | Function Called | What It Does | Data Fetched/Calculated |
|--------------|------------|-----------------|--------------|------------------------|
| **KPI Selector** (Chart) | `portfolio-kpi-select` | `renderPortfolioChart()` | Changes KPI displayed in chart | Reads from `portfolio_segment_metrics_28d` table |
| **Segment Selector** (Chart) | `portfolio-segment-select` | `renderPortfolioChart()` | Changes segment displayed | Reads from `portfolio_segment_metrics_28d` table |
| **Time Grain Selector** | `portfolio-time-grain` | `renderPortfolioChart()` | Changes time aggregation (weekly/monthly) | Reads from `portfolio_segment_metrics_28d` table |
| **KPI Selector** (Table) | `portfolio-table-kpi-select` | `renderPortfolioTable()` | Changes KPI displayed in table | Reads from `portfolio_segment_metrics_28d` table |

### Notes
- Portfolio module reads from `portfolio_segment_metrics_28d` Supabase table
- No explicit "refresh" button - data updates when new audits are run
- Supports AI Citations and AI Overview KPIs (keyword-driven, segment inferred from `best_url`)

---

## Module: Authority

**Location**: Left sidebar → "Authority"  
**Panel ID**: `data-panel="authority"`

### Buttons & Functions

| Button/Label | Element ID | Function Called | What It Does | Data Fetched/Calculated |
|--------------|------------|-----------------|--------------|------------------------|
| *(No explicit refresh buttons)* | N/A | N/A | Displays Authority breakdown | Uses data from latest audit (`last_audit_results`) |

### Notes
- Authority data comes from audit scan
- Shows Behaviour, Ranking, Backlinks, Reviews components
- No module-specific data fetching

---

## Module: URL Money Pages

**Location**: Left sidebar → "URL Money Pages"  
**Panel ID**: `data-panel="money"`  
**⚠️ RENAMED**: Previously "Money Pages" → Now "URL Money Pages"

### Buttons & Functions

| Button/Label | Element ID | Function Called | What It Does | Data Fetched/Calculated |
|--------------|------------|-----------------|--------------|------------------------|
| **Run scan** (Dashboard card) | N/A | `window.dashboardRunMoneyPagesScan()` | Refreshes Money Pages from latest audit | Fetches latest audit from Supabase, extracts `moneyPagesMetrics` |
| **Create Task** (Suggested Top 10 cards) | `money-pages-create-task-{index}` | `window.openTrackKeywordModal()` | Creates optimisation task for URL | Opens modal, then calls API to create task |
| **Manage Task** (Suggested Top 10 cards) | `money-pages-manage-task-{index}` | `window.openOptimisationTaskDrawer()` | Opens task details drawer | Loads task data from API |
| **Bulk create…** (Priority & Actions) | `money-pages-create-tasks-btn` | `wireMoneyPagesCreateTasksButton()` | Creates tasks for all money pages (CTR ≥ 2.5%) | Batch creates tasks via API |
| **Track** (Opportunity table rows) | `money-track-btn-{url}` | `window.openTrackKeywordModal()` | Creates optimisation task for specific URL | Opens modal, creates task |
| **Manage** (Opportunity table rows) | `money-manage-btn-{url}` | `window.openOptimisationTaskDrawer()` | Opens task details for URL | Loads task data from API |
| **Copy URLs** | `money-pages-copy-urls` | `attachMoneyPagesCopyHandler()` | Copies filtered URLs to clipboard | None (UI only) |

### Notes
- **Run scan** refreshes from latest audit (doesn't run new audit)
- Money Pages data comes from `audit_results.money_pages_metrics` or `last_audit_results.scores.moneyPagesMetrics`
- **⚠️ FUTURE**: Will need AI Citations column added (Phase 3 of Fix 0)
- **⚠️ FUTURE**: Row click breakdown will show AI Citations count (Phase 4 of Fix 0)

---

## Module: Keyword Ranking and AI

**Location**: Left sidebar → "Keyword Ranking and AI"  
**Panel ID**: `data-panel="ranking"`  
**⚠️ RENAMED**: Previously "Ranking & AI" → Now "Keyword Ranking and AI"

### Buttons & Functions

| Button/Label | Element ID | Function Called | What It Does | Data Fetched/Calculated |
|--------------|------------|-----------------|--------------|------------------------|
| **Run ranking & AI check** | `ranking-ai-refresh` | `window.loadRankingAiData(true)` | Runs full Ranking & AI scan | DataForSEO SERP API, creates `combinedRows`, stores in Supabase `keyword_rankings` table |
| **Refresh GSC Data** | `ranking-gsc-refresh` | `window.refreshRankingAiGscData()` | Refreshes CTR & Impressions from GSC | GSC API (query-level data), updates `combinedRows` with GSC metrics |
| **Edit Keywords** | `edit-keywords-btn` | Opens modal | Opens keyword editing modal | Loads keywords from API, saves via `/api/keywords/save` |
| **Run Domain Strength Snapshot** | `domain-strength-run-btn` | `window.runDomainStrengthSnapshot()` | Runs Domain Strength snapshot | DataForSEO Labs API, calculates strength score |
| **Track** (Keyword table rows) | `ranking-track-btn-{keyword}` | `window.openTrackKeywordModal()` | Creates optimisation task for keyword | Opens modal, creates task |
| **Manage** (Keyword table rows) | `ranking-manage-btn-{keyword}` | `window.openOptimisationTaskDrawer()` | Opens task details for keyword | Loads task data from API |
| **Backfill Domain Ranks** | `backfill-domain-ranks-btn` | `backfillMissingDomainRanks()` | Backfills missing domain ranks | Calls `/api/domain-strength/backfill` |

### Notes
- **Run ranking & AI check** is the primary data collection for keyword-level ranking and AI data
- Creates `combinedRows` array with `{keyword, best_rank_group, has_ai_overview, ai_alan_citations, ai_alan_citations_count, best_url, ...}`
- **⚠️ CRITICAL**: This is the data source used by `computeAiMetricsForPageUrl()` for URL tasks
- Stores in Supabase `keyword_rankings` table (one row per keyword)
- **Refresh GSC Data** updates existing `combinedRows` with fresh GSC metrics (no API costs)

---

## Module: Optimisation Tracking

**Location**: Left sidebar → "Optimisation Tracking"  
**Panel ID**: `data-panel="optimisation"`

### Buttons & Functions

| Button/Label | Element ID | Function Called | What It Does | Data Fetched/Calculated |
|--------------|------------|-----------------|--------------|------------------------|
| **Update All Tasks with Latest Data** | `optimisation-bulk-update-btn` | `window.bulkUpdateAllTasks()` | Updates all active tasks with latest metrics | Fetches latest audit from Supabase, uses `combinedRows` for keyword tasks, uses `computeAiMetricsForPageUrl()` for URL tasks |
| **Needs Update** | `optimisation-filter-needs-update` | Filter function | Filters tasks needing measurement update | None (filter only) |
| **Active Cycle Only** | `optimisation-filter-active-cycle` | Filter function | Filters to active cycles only | None (filter only) |
| **Overdue Cycle** | `optimisation-filter-overdue-cycle` | Filter function | Filters to overdue cycles | None (filter only) |
| **Update** (Per row in table) | `optimisation-update-btn-{taskId}` | `window.updateTaskLatest()` | Updates single task with latest metrics | Same logic as "Add Measurement" - fetches latest audit, uses `combinedRows` or `computeAiMetricsForPageUrl()` |
| **Open** (Per row in table) | `optimisation-open-btn-{taskId}` | `window.openOptimisationTaskDrawer()` | Opens task details drawer | Loads task data from API |
| **Rebaseline** (Task Details drawer) | `optimisation-rebaseline-btn` | Rebaseline handler | Creates new baseline measurement | Fetches latest audit, uses `combinedRows` for keyword tasks, uses `computeAiMetricsForPageUrl()` for URL tasks |
| **Add Measurement** (Task Details drawer) | `optimisation-add-measurement-btn` | Add Measurement handler | Captures new measurement snapshot | Fetches latest audit, uses `combinedRows` for keyword tasks, uses `computeAiMetricsForPageUrl()` for URL tasks |
| **Complete Cycle** | `optimisation-complete-cycle-btn` | `window.completeCycle()` | Marks current cycle as completed | Updates task status in API |
| **Archive Cycle** | `optimisation-archive-cycle-btn` | `window.archiveCycle()` | Archives current cycle | Updates task status in API |
| **Start New Cycle** | `optimisation-start-cycle-btn` | `window.startNewCycle()` | Begins new optimisation cycle | Creates new cycle in API |
| **Add Event** | `optimisation-add-event-btn` | Event handler | Adds timeline event | Saves event to API |
| **Save** (Status change) | `optimisation-save-status-btn` | Status handler | Updates task status | Saves status to API |
| **Cancel Task** | `optimisation-cancel-task-btn` | `window.stopTracking()` | Cancels task tracking | Updates task status to 'cancelled' |
| **Delete Task** | `optimisation-delete-task-btn` | `window.deleteTask()` | Permanently deletes task | Deletes task from API |

### Notes
- **⚠️ CRITICAL**: "Add Measurement" and "Rebaseline" use `computeAiMetricsForPageUrl()` for URL tasks
- **Update All Tasks** uses same logic as "Add Measurement" for each task
- All three functions (`addMeasurementBtn`, `rebaselineBtn`, `bulkUpdateAllTasks`) should use identical logic
- **⚠️ FIX APPLIED**: All three now use the corrected `computeAiMetricsForPageUrl()` function (Phase 1 complete)

---

## Module: AI Sources & Influence

**Location**: Left sidebar → "AI Sources & Influence"  
**Panel ID**: `data-panel="ai-sources"`

### Buttons & Functions

| Button/Label | Element ID | Function Called | What It Does | Data Fetched/Calculated |
|--------------|------------|-----------------|--------------|------------------------|
| *(No explicit refresh buttons)* | N/A | N/A | Displays AI sources analysis | Uses data from Ranking & AI scan (`combinedRows`) |

### Notes
- Data comes from Ranking & AI scan
- Shows competitor domains cited in AI Overviews
- No module-specific data fetching

---

## Module: Local & Reviews

**Location**: Left sidebar → "Local & Reviews"  
**Panel ID**: `data-panel="local"`

### Buttons & Functions

| Button/Label | Element ID | Function Called | What It Does | Data Fetched/Calculated |
|--------------|------------|-----------------|--------------|------------------------|
| *(No explicit refresh buttons)* | N/A | N/A | Displays Local Entity and Service Area data | Uses data from audit scan (Local Signals API) |

### Notes
- Data comes from audit scan (Local Signals API)
- Shows NAP consistency, knowledge panel, locations, service areas
- No module-specific data fetching

---

## Module: History

**Location**: Left sidebar → "History"  
**Panel ID**: `data-panel="history"`

### Buttons & Functions

| Button/Label | Element ID | Function Called | What It Does | Data Fetched/Calculated |
|--------------|------------|-----------------|--------------|------------------------|
| *(No explicit refresh buttons)* | N/A | N/A | Displays historical audit trends | Reads from Supabase `audit_results` table |

### Notes
- Displays historical data from Supabase
- Shows trend charts over time
- No module-specific data fetching

---

## Global Functions (Used by Multiple Modules)

### Data Fetching Functions

| Function Name | What It Does | Used By |
|---------------|--------------|---------|
| `window.fetchLatestAuditFromSupabase(propertyUrl, includeRankingAi)` | Fetches latest audit from Supabase | Add Measurement, Rebaseline, Bulk Update, Dashboard refresh |
| `window.loadRankingAiData(forceRefresh)` | Loads Ranking & AI data | Ranking & AI tab, Global run |
| `window.computeAiMetricsForPageUrl(pageUrl, combinedRows)` | **⚠️ CRITICAL FIX**: Calculates AI Overview and Citations for a URL | Add Measurement (URL tasks), Rebaseline (URL tasks), Bulk Update (URL tasks) |
| `window.getRankingAiCombinedRows()` | Gets `combinedRows` array | Multiple functions |
| `window.renderRankingAiTab()` | Renders Ranking & AI tab | Ranking & AI tab, Global run |
| `window.renderMoneyPagesSection()` | Renders Money Pages section | Money Pages tab, Dashboard refresh |
| `window.dashboardRunMoneyPagesScan()` | Refreshes Money Pages from latest audit | Dashboard, Global run |
| `window.runDomainStrengthSnapshot()` | Runs Domain Strength snapshot | Ranking & AI tab, Dashboard, Global run |

### Update Functions

| Function Name | What It Does | Used By |
|---------------|--------------|---------|
| `window.bulkUpdateAllTasks()` | Updates all active tasks with latest data | Optimisation Tracking tab, Global run |
| `window.updateTaskLatest(taskId)` | Updates single task with latest metrics | Optimisation Tracking table (per-row Update button) |
| *(Add Measurement handler)* | Captures new measurement for task | Task Details drawer |
| *(Rebaseline handler)* | Creates new baseline for task | Task Details drawer |

---

## Data Flow Summary

### Primary Data Collection Processes

1. **Run Audit Scan** → Creates `queryTotals` (GSC data), stores in Supabase `audit_results`
2. **Run Ranking & AI Scan** → Creates `combinedRows` (ranking + AI data), stores in Supabase `keyword_rankings` and `audit_results.ranking_ai_data`
3. **Run Money Pages Scan** → Refreshes from latest audit, extracts Money Pages metrics

### Data Update Processes

1. **Add Measurement** → Uses latest audit + `combinedRows` + `computeAiMetricsForPageUrl()` for URL tasks
2. **Rebaseline** → Same as Add Measurement
3. **Bulk Update All Tasks** → Same logic as Add Measurement, applied to all active tasks
4. **Update Task Latest** → Same logic as Add Measurement, for single task

### Data Dependencies

- **URL Tasks AI Data**: Requires `combinedRows` from Ranking & AI scan + `computeAiMetricsForPageUrl()` function
- **Keyword Tasks AI Data**: Requires `combinedRows` from Ranking & AI scan (direct lookup by keyword)
- **GSC Metrics**: Requires audit scan (`queryTotals`) or GSC Page Totals API
- **Money Pages Metrics**: Requires audit scan (Money Pages segment)

---

## Impact of URL Task AI Citations Fix (Fix 0)

### Functions Using `computeAiMetricsForPageUrl()`

All of these functions now use the corrected logic (finding keywords that cite the URL):

1. ✅ **Add Measurement** (URL tasks) - Line ~14214
2. ✅ **Rebaseline** (URL tasks) - Line ~15230
3. ✅ **Bulk Update All Tasks** (URL tasks) - Uses same logic as Add Measurement

### Functions That May Need Updates (Future Phases)

1. ⏸️ **Money Pages Table** - Will need AI Citations column (Phase 3)
2. ⏸️ **Money Pages Row Click Breakdown** - Will show AI Citations count (Phase 4)
3. ⏸️ **Priority Matrix** - May need AI citations weighting (if changed)

---

## Testing Checklist

After deploying the URL Task AI Citations fix, test these buttons:

### Critical (Must Test)
- [ ] **Add Measurement** (URL task) - Verify AI Overview and AI Citations populate
- [ ] **Rebaseline** (URL task) - Verify AI Overview and AI Citations populate
- [ ] **Update All Tasks** (with URL tasks) - Verify URL tasks get correct AI data

### Important (Should Test)
- [ ] **Run Ranking & AI Scan** - Verify `combinedRows` includes `ai_alan_citations` arrays
- [ ] **Run Audit Scan** - Verify doesn't break existing functionality
- [ ] **Run All Audits & Updates** - Verify end-to-end flow works

### Nice to Have
- [ ] All other buttons listed above - Verify no regressions

---

## Notes

- **UI Renaming Complete**: "Ranking & AI" → "Keyword Ranking and AI", "Money Pages" → "URL Money Pages"
- **Core Fix Complete**: `computeAiMetricsForPageUrl()` rewritten with correct logic
- **Future Work**: Phase 3 (AI Citations column) and Phase 4 (Row click breakdown) pending user approval

---

**Last Updated**: 2026-01-07  
**Related Documents**: 
- `FIX-PLAN-COMPREHENSIVE.md` - Overall fix plan
- `URL-TASK-AI-CITATIONS-FIX-ANALYSIS.md` - Impact analysis for Fix 0
- `ALL-AUDIT-SCAN-PROCESSES.md` - Detailed process documentation
