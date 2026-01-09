# Complete Button Audit - All Update/Refresh/Scan Buttons

## Purpose
This document provides a comprehensive, module-by-module audit of ALL buttons in the application that perform any sort of data update, refresh, scan, or audit operation.

---

## Module 1: Configuration & Reporting Tab

### Buttons That Update Data:

1. **Run Audit Scan**
   - **Element ID**: `runAudit` (button with `onclick="runAudit()"`)
   - **Function**: `window.runAudit()`
   - **Location**: Line ~3710
   - **What it does**: Runs comprehensive audit scan (GSC, schema, local signals, reviews, backlinks)
   - **Stores to**: `audit_results` table via `saveAuditToSupabase()`
   - **Computed Fields**: ✅ YES - All fields stored via `saveAuditToSupabase()`

2. **Sync CSV**
   - **Element ID**: `syncCsvBtn` (button with `onclick="syncCsv()"`)
   - **Function**: `window.syncCsv()`
   - **Location**: Line ~3713
   - **What it does**: Syncs CSV data from remote source (GitHub/remote)
   - **Stores to**: localStorage only (not Supabase)
   - **Computed Fields**: ❌ NO - Only updates localStorage, doesn't create audit

3. **Share Audit**
   - **Element ID**: `shareAudit` (button with `onclick="shareAudit()"`)
   - **Function**: `window.shareAudit()`
   - **Location**: Line ~3711
   - **What it does**: Generates shareable link token
   - **Stores to**: Creates share token in database
   - **Computed Fields**: ❌ NO - Only creates share token, doesn't create audit

4. **Save Configuration**
   - **Element ID**: `saveConfig` (button with `onclick="saveConfig()"`)
   - **Function**: `saveConfig()`
   - **Location**: Line ~3712
   - **What it does**: Saves config to localStorage
   - **Stores to**: localStorage only
   - **Computed Fields**: ❌ NO - Only saves config, doesn't create audit

5. **Save Admin Key**
   - **Element ID**: Admin key input with `onclick="saveAdminKey()"`
   - **Function**: `saveAdminKey()`
   - **Location**: Line ~3745
   - **What it does**: Saves admin key to sessionStorage/localStorage
   - **Stores to**: sessionStorage/localStorage only
   - **Computed Fields**: ❌ NO - Only saves key, doesn't create audit

6. **Load CSV** (URL List)
   - **Element ID**: Button with `onclick="loadUrlListFromFile()"`
   - **Function**: `loadUrlListFromFile()`
   - **Location**: Line ~3672
   - **What it does**: Loads CSV file for URL list
   - **Stores to**: localStorage only
   - **Computed Fields**: ❌ NO - Only loads file, doesn't create audit

7. **Load CSV** (Backlinks)
   - **Element ID**: Button with `onclick="loadBacklinkCsvFromFile()"`
   - **Function**: `loadBacklinkCsvFromFile()`
   - **Location**: Line ~3697
   - **What it does**: Loads CSV file for backlink data
   - **Stores to**: localStorage only
   - **Computed Fields**: ❌ NO - Only loads file, doesn't create audit

8. **Retry Failed URLs** (Schema Audit)
   - **Element ID**: `retryButton` (dynamically created)
   - **Function**: `retryFailedUrls(schemaAudit)`
   - **Location**: Line ~21544
   - **What it does**: Retries schema audit for failed URLs
   - **Stores to**: `audit_results` via `saveAuditResults()` → `saveAuditToSupabase()`
   - **Computed Fields**: ✅ YES - Stores via `saveAuditToSupabase()`

---

## Module 2: Dashboard Tab

### Buttons That Update Data:

1. **Run All Audits & Updates**
   - **Element ID**: `dashboard-run-all-btn`
   - **Function**: `window.runDashboardGlobalRun()`
   - **Location**: Line ~3943
   - **What it does**: Runs all scans in sequence (CSV sync → Audit → Ranking & AI → Money Pages → Domain Strength → Update All Tasks)
   - **Stores to**: Multiple tables via various functions
   - **Computed Fields**: ✅ YES - Via Audit Scan step

2. **Run scan** (Ranking & AI card)
   - **Element ID**: N/A (button in card)
   - **Function**: `window.dashboardRunRankingAiScan()`
   - **Location**: Dashboard card
   - **What it does**: Runs Ranking & AI scan from dashboard
   - **Stores to**: `audit_results.ranking_ai_data` via `loadRankingAiData()`
   - **Computed Fields**: ✅ YES - Via enhanced `save-audit.js` partial update handling

3. **Run scan** (Money Pages card)
   - **Element ID**: N/A (button in card)
   - **Function**: `window.dashboardRunMoneyPagesScan()`
   - **Location**: Dashboard card
   - **What it does**: Refreshes Money Pages data from latest audit
   - **Stores to**: N/A - Only refreshes from existing audit
   - **Computed Fields**: ❌ NO - Doesn't create new audit

4. **Run snapshot** (Domain Strength card)
   - **Element ID**: N/A (button in card)
   - **Function**: `window.runDomainStrengthSnapshot()`
   - **Location**: Dashboard card
   - **What it does**: Runs domain strength snapshot
   - **Stores to**: `domain_strength_snapshots` + `audit_results.domain_strength`
   - **Computed Fields**: ✅ YES - Updates `audit_results.domain_strength`

---

## Module 3: Keyword Ranking and AI Tab

### Buttons That Update Data:

1. **Run ranking & AI check**
   - **Element ID**: `ranking-ai-refresh`
   - **Function**: `window.loadRankingAiData(true)`
   - **Location**: Line ~4533
   - **What it does**: Fetches SERP data from DataForSEO
   - **Stores to**: `audit_results.ranking_ai_data` via direct API call
   - **Computed Fields**: ✅ YES - Via enhanced `save-audit.js` partial update handling

2. **Refresh GSC Data**
   - **Element ID**: `ranking-gsc-refresh`
   - **Function**: `window.refreshRankingAiGscData()`
   - **Location**: Line ~4536
   - **What it does**: Refreshes CTR & Impressions from GSC (query-level)
   - **Stores to**: Updates `keyword_rankings` table
   - **Computed Fields**: ❌ NO - Only updates keyword_rankings, not audit_results

3. **Edit Keywords**
   - **Element ID**: `edit-keywords-btn`
   - **Function**: Opens modal, saves via API
   - **Location**: Line ~4539
   - **What it does**: Edits tracked keywords list
   - **Stores to**: `tracked_keywords` table via API
   - **Computed Fields**: ❌ NO - Only updates keywords list, doesn't create audit

4. **Save Keywords** (in Edit Keywords modal)
   - **Element ID**: `edit-keywords-save`
   - **Function**: Saves keywords via API
   - **Location**: Line ~4581
   - **What it does**: Saves edited keywords
   - **Stores to**: `tracked_keywords` table
   - **Computed Fields**: ❌ NO - Only updates keywords list

5. **Run Domain Strength Snapshot**
   - **Element ID**: `domain-strength-run-btn`
   - **Function**: `window.runDomainStrengthSnapshot()`
   - **Location**: Line ~4716
   - **What it does**: Runs domain strength snapshot
   - **Stores to**: `domain_strength_snapshots` + `audit_results.domain_strength`
   - **Computed Fields**: ✅ YES - Updates `audit_results.domain_strength`

6. **Backfill Domain Ranks**
   - **Element ID**: `backfill-domain-ranks-btn`
   - **Function**: `backfillMissingDomainRanks()`
   - **Location**: Line ~5168
   - **What it does**: Fetches domain rank for domains showing '—'
   - **Stores to**: `domain_strength_snapshots` table
   - **Computed Fields**: ❌ NO - Only updates domain_strength_snapshots, not audit_results

7. **Track** (per domain row in Domain Strength table)
   - **Element ID**: Dynamically created `trackBtn`
   - **Function**: Adds domain to tracking queue
   - **Location**: Line ~48184
   - **What it does**: Adds domain to pending queue for snapshot
   - **Stores to**: `domain_strength_pending` table
   - **Computed Fields**: ❌ NO - Only adds to queue, doesn't create audit

---

## Module 4: Optimisation Tracking Tab

### Buttons That Update Data:

1. **Update All Tasks with Latest Data**
   - **Element ID**: `optimisation-bulk-update-btn`
   - **Function**: `window.bulkUpdateAllTasks()`
   - **Location**: Line ~5333
   - **What it does**: Updates all active tasks with latest metrics
   - **Stores to**: `optimisation_measurements` table
   - **Computed Fields**: ❌ NO - Only updates measurements, not audit_results

2. **Update** (per row in tasks table)
   - **Element ID**: `optimisation-update-btn-{taskId}` (dynamically created)
   - **Function**: `window.updateTaskLatest(taskId)`
   - **Location**: Line ~9516
   - **What it does**: Updates single task with latest metrics
   - **Stores to**: `optimisation_measurements` table
   - **Computed Fields**: ❌ NO - Only updates measurements, not audit_results

3. **Add Measurement** (in task details drawer)
   - **Element ID**: `optimisation-add-measurement-btn`
   - **Function**: Add Measurement handler
   - **Location**: Line ~5928
   - **What it does**: Creates new measurement entry for task
   - **Stores to**: `optimisation_measurements` table
   - **Computed Fields**: ❌ NO - Only updates measurements, not audit_results

4. **Rebaseline** (in task details drawer)
   - **Element ID**: `optimisation-rebaseline-btn`
   - **Function**: Rebaseline handler
   - **Location**: Line ~5927
   - **What it does**: Creates new baseline measurement for task
   - **Stores to**: `optimisation_measurements` table
   - **Computed Fields**: ❌ NO - Only updates measurements, not audit_results

5. **Complete Cycle**
   - **Element ID**: `optimisation-complete-cycle-btn`
   - **Function**: `window.completeCycle()`
   - **Location**: Task details drawer
   - **What it does**: Marks cycle as complete
   - **Stores to**: `optimisation_cycles` table
   - **Computed Fields**: ❌ NO - Only updates cycle status

6. **Archive Cycle**
   - **Element ID**: `optimisation-archive-cycle-btn`
   - **Function**: `window.archiveCycle()`
   - **Location**: Task details drawer
   - **What it does**: Archives cycle
   - **Stores to**: `optimisation_cycles` table
   - **Computed Fields**: ❌ NO - Only updates cycle status

7. **Start New Cycle**
   - **Element ID**: `optimisation-start-cycle-btn`
   - **Function**: `window.startNewCycle()`
   - **Location**: Task details drawer
   - **What it does**: Creates new cycle
   - **Stores to**: `optimisation_cycles` table
   - **Computed Fields**: ❌ NO - Only creates cycle

---

## Module 5: Other Buttons (Non-Data Updates)

### Buttons That Don't Update Data:

1. **Generate PDF Report**
   - **Element ID**: `generatePdfBtn`
   - **Function**: `generatePDFReport()`
   - **Location**: Line ~3921
   - **What it does**: Generates PDF report
   - **Stores to**: N/A - Only generates PDF
   - **Computed Fields**: ❌ NO - Read-only operation

2. **Date Range Buttons** (30, 60, 90, 120, 180, 365, 540 days, Custom)
   - **Element IDs**: `date-range-btn`, `customDateBtn`
   - **Function**: `setDateRange()`, `showCustomDateRange()`, `applyCustomDateRange()`
   - **Location**: Line ~4405-4417
   - **What it does**: Changes date range for display
   - **Stores to**: localStorage only
   - **Computed Fields**: ❌ NO - Only changes display filter

3. **Authority Trend Mode Buttons** (All, Non-Education, Money)
   - **Element IDs**: `trend-mode-all`, `trend-mode-nonEducation`, `trend-mode-money`
   - **Function**: Changes trend display mode
   - **Location**: Line ~4495-4501
   - **What it does**: Changes display filter
   - **Stores to**: N/A - Only changes display
   - **Computed Fields**: ❌ NO - Read-only operation

4. **Filter Buttons** (various)
   - **Element IDs**: Multiple filter buttons
   - **Function**: Various filter functions
   - **What it does**: Filters displayed data
   - **Stores to**: N/A - Only changes display
   - **Computed Fields**: ❌ NO - Read-only operation

5. **Pagination Buttons** (various)
   - **Element IDs**: Multiple pagination buttons
   - **Function**: Pagination functions
   - **What it does**: Changes page view
   - **Stores to**: N/A - Only changes display
   - **Computed Fields**: ❌ NO - Read-only operation

---

## Summary: Buttons That Store Computed Fields

### ✅ Buttons That DO Store Computed Fields:

1. **Run Audit Scan** - ✅ Stores all computed fields via `saveAuditToSupabase()`
2. **Run All Audits & Updates** - ✅ Stores via Audit Scan step
3. **Run ranking & AI check** (Dashboard) - ✅ Stores via enhanced partial update handling
4. **Run ranking & AI check** (Ranking & AI tab) - ✅ Stores via enhanced partial update handling
5. **Run snapshot** (Domain Strength) - ✅ Updates `audit_results.domain_strength`
6. **Retry Failed URLs** - ✅ Stores via `saveAuditToSupabase()`

### ❌ Buttons That DON'T Store Computed Fields (Correctly):

1. **Sync CSV** - Only updates localStorage
2. **Share Audit** - Only creates share token
3. **Save Configuration** - Only saves config
4. **Save Admin Key** - Only saves key
5. **Load CSV** buttons - Only load files
6. **Refresh GSC Data** - Only updates keyword_rankings
7. **Edit Keywords** - Only updates keywords list
8. **Backfill Domain Ranks** - Only updates domain_strength_snapshots
9. **Track** (domain) - Only adds to queue
10. **All Optimisation Tracking buttons** - Only update optimisation_measurements/cycles
11. **Generate PDF** - Read-only
12. **All filter/pagination buttons** - Read-only

---

## Verification Status

All buttons that should store computed fields are now correctly doing so:
- ✅ Full audit scans store all fields
- ✅ Partial updates (Ranking & AI) now fetch latest audit and recompute fields
- ✅ Domain strength snapshots update audit_results.domain_strength

All buttons that shouldn't store computed fields are correctly not doing so.
