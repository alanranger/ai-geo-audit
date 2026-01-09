# Phase 3: Update Buttons Audit & Alignment

**Status**: 🔄 **IN PROGRESS**  
**Created**: 2026-01-08  
**Purpose**: Ensure all update/refresh/audit buttons use consistent data source priority and standardized URL matching logic

---

## Overview

This document tracks the audit and alignment of all update buttons to ensure:
1. **Correct Data Source Strategy**: 
   - **Scan/Audit buttons**: Fetch fresh from APIs → Save to Supabase
   - **Measurement buttons**: Read from Supabase → Save measurement to Supabase
   - **Refresh buttons**: Read from Supabase only
2. **Consistent Data Source Priority** (for READ operations): Supabase → localStorage (fallback only)
3. **Standardized URL Matching**: Use `normalizeUrlForDedupe` consistently
4. **Unified Data Fetching**: Create reusable functions for common patterns

**Key Insight**: Not all buttons should use Supabase the same way. The data source strategy depends on the button's purpose (scan/audit vs measurement vs refresh).

---

## Data Source Strategy (By Button Type)

### Category 1: Scan/Audit Buttons (WRITE Operations)
**Purpose**: Fetch fresh data from external APIs and save to Supabase

**Data Flow**:
1. Fetch fresh from external APIs (GSC, DataForSEO, Local Signals, etc.)
2. Process and calculate metrics
3. Save to Supabase
4. Update localStorage (for performance/caching)

**Buttons**:
- Run Audit Scan
- Run Ranking & AI Scan
- Run Domain Strength Snapshot

**Rationale**: These buttons create new audit snapshots, so they must fetch fresh data from APIs.

---

### Category 2: Measurement Buttons (READ + WRITE Operations)
**Purpose**: Read latest saved audit from Supabase, then create new measurement

**Data Flow**:
1. **READ**: Fetch latest audit from Supabase (via `fetchLatestAuditFromSupabase()`)
2. **FALLBACK**: If Supabase unavailable, use localStorage (with warning)
3. Extract metrics from audit data
4. **WRITE**: Save new measurement to Supabase

**Buttons**:
- Add Measurement
- Rebaseline
- Update Task Latest
- Bulk Update All Tasks

**Rationale**: These buttons create measurements based on the latest saved audit, not fresh API calls. Supabase is the source of truth for audit data.

---

### Category 3: Refresh/Display Buttons (READ Operations)
**Purpose**: Read and display latest saved data from Supabase

**Data Flow**:
1. **READ**: Fetch latest audit from Supabase
2. **FALLBACK**: If Supabase unavailable, use localStorage (with warning)
3. Extract and display data

**Buttons**:
- Run Money Pages Scan (refreshes display from latest audit)
- Portfolio chart/table selectors (read from `portfolio_segment_metrics_28d` table)

**Rationale**: These buttons refresh the UI with latest saved data, not fresh API calls.

---

## Data Source Priority (For READ Operations)

**Priority Order** (highest to lowest):
1. **Supabase** (via `fetchLatestAuditFromSupabase()` or direct table queries)
2. **localStorage** (fallback only, with warning if used)

**Rationale**: Supabase is the source of truth. localStorage should only be used as a fallback when Supabase is unavailable or for performance optimization (with user awareness).

---

## Critical Buttons to Audit

### 1. Add Measurement (Optimisation Tracking)
**Category**: Measurement Button (READ + WRITE)  
**Location**: Line ~14384  
**Element ID**: `optimisation-add-measurement-btn`  
**Status**: ⏸️ **PENDING AUDIT**

**Expected Behavior**:
- ✅ Should READ latest audit from Supabase (not fetch fresh from APIs)
- ✅ Should fall back to localStorage only if Supabase unavailable
- ✅ Should use consistent URL matching logic
- ✅ Should handle Money Pages vs Ranking & AI tasks correctly
- ✅ Should WRITE new measurement to Supabase

**Current Behavior** (to be verified):
- [ ] Fetches from Supabase first?
- [ ] Falls back to localStorage?
- [ ] Uses consistent URL matching?
- [ ] Handles Money Pages vs Ranking & AI tasks correctly?
- [ ] Saves measurement to Supabase?

**Required Changes**:
- [ ] Ensure Supabase is checked first (READ operation)
- [ ] Standardize URL matching logic
- [ ] Add debug logging for data source used
- [ ] Verify measurement is saved to Supabase (WRITE operation)

---

### 2. Rebaseline (Optimisation Tracking)
**Category**: Measurement Button (READ + WRITE)  
**Location**: Line ~15230  
**Element ID**: `optimisation-rebaseline-btn`  
**Status**: ⏸️ **PENDING AUDIT**

**Expected Behavior**:
- ✅ Should READ latest audit from Supabase (not fetch fresh from APIs)
- ✅ Should fall back to localStorage only if Supabase unavailable
- ✅ Should use consistent URL matching logic
- ✅ Should handle Money Pages vs Ranking & AI tasks correctly
- ✅ Should WRITE new baseline measurement to Supabase

**Current Behavior** (to be verified):
- [ ] Fetches from Supabase first?
- [ ] Falls back to localStorage?
- [ ] Uses consistent URL matching?
- [ ] Handles Money Pages vs Ranking & AI tasks correctly?
- [ ] Saves baseline measurement to Supabase?

**Required Changes**:
- [ ] Ensure Supabase is checked first (READ operation)
- [ ] Standardize URL matching logic
- [ ] Add debug logging for data source used
- [ ] Verify baseline is saved to Supabase (WRITE operation)

---

### 3. Update Task Latest (Optimisation Tracking)
**Category**: Measurement Button (READ + WRITE)  
**Location**: Line ~15478  
**Element ID**: (to be identified)  
**Status**: ⏸️ **PENDING AUDIT**

**Expected Behavior**:
- ✅ Should READ latest audit from Supabase (not fetch fresh from APIs)
- ✅ Should fall back to localStorage only if Supabase unavailable
- ✅ Should use consistent URL matching logic
- ✅ Should WRITE new measurement to Supabase

**Current Behavior** (to be verified):
- [ ] Fetches from Supabase first?
- [ ] Falls back to localStorage?
- [ ] Uses consistent URL matching?
- [ ] Saves measurement to Supabase?

**Required Changes**:
- [ ] Ensure Supabase is checked first (READ operation)
- [ ] Standardize URL matching logic
- [ ] Add debug logging for data source used
- [ ] Verify measurement is saved to Supabase (WRITE operation)

---

### 4. Bulk Update All Tasks (Optimisation Tracking)
**Category**: Measurement Button (READ + WRITE)  
**Location**: Line ~14498  
**Element ID**: `optimisation-bulk-update-btn`  
**Status**: ⏸️ **PENDING AUDIT**

**Expected Behavior**:
- ✅ Should READ latest audit from Supabase once (not fetch fresh from APIs)
- ✅ Should fall back to localStorage only if Supabase unavailable
- ✅ Should use consistent URL matching logic for all tasks
- ✅ Should handle both Money Pages and Ranking & AI tasks
- ✅ Should WRITE new measurements to Supabase (batch operation)

**Current Behavior** (to be verified):
- [ ] Fetches from Supabase first (once for all tasks)?
- [ ] Falls back to localStorage?
- [ ] Uses consistent URL matching?
- [ ] Handles both Money Pages and Ranking & AI tasks?
- [ ] Saves measurements to Supabase (batch)?

**Required Changes**:
- [ ] Ensure Supabase is checked first (READ operation, once)
- [ ] Standardize URL matching logic
- [ ] Add debug logging for data source used
- [ ] Optimize batch processing
- [ ] Verify batch measurements are saved to Supabase (WRITE operation)

---

### 5. Run Audit Scan (Configuration/Overview)
**Category**: Scan/Audit Button (WRITE Operation)  
**Location**: Line ~24438  
**Element ID**: `runAudit`  
**Status**: ⏸️ **PENDING AUDIT**

**Expected Behavior**:
- ✅ Should fetch fresh from external APIs (GSC, Local Signals, etc.)
- ✅ Should NOT read from Supabase (creates new audit)
- ✅ Should save to Supabase first
- ✅ Should update localStorage after Supabase save
- ✅ Should create `queryTotals` array
- ✅ Should NOT fetch Ranking & AI data (separate process)

**Current Behavior** (to be verified):
- [ ] Fetches fresh from external APIs?
- [ ] Saves to Supabase first?
- [ ] Updates localStorage after Supabase?
- [ ] Creates `queryTotals` array?
- [ ] Does NOT fetch Ranking & AI data?

**Required Changes**:
- [ ] Verify Supabase save happens before localStorage update
- [ ] Document data flow
- [ ] Ensure error handling if Supabase save fails

---

### 6. Run Ranking & AI Scan (Ranking & AI tab)
**Category**: Scan/Audit Button (WRITE Operation)  
**Location**: (to be identified)  
**Element ID**: (to be identified)  
**Status**: ⏸️ **PENDING AUDIT**

**Expected Behavior**:
- ✅ Should fetch fresh from DataForSEO API
- ✅ Should NOT read from Supabase (creates new scan)
- ✅ Should save to Supabase first
- ✅ Should update localStorage after Supabase save
- ✅ Should create `combinedRows` array

**Current Behavior** (to be verified):
- [ ] Fetches fresh from DataForSEO API?
- [ ] Saves to Supabase first?
- [ ] Updates localStorage after Supabase?
- [ ] Creates `combinedRows` array?

**Required Changes**:
- [ ] Verify Supabase save happens before localStorage update
- [ ] Ensure error handling if Supabase save fails
- [ ] Add debug logging

---

### 7. Run Money Pages Scan (Dashboard/Money Pages)
**Category**: Refresh/Display Button (READ Operation)  
**Location**: (to be identified)  
**Element ID**: (to be identified)  
**Status**: ⏸️ **PENDING AUDIT**

**Expected Behavior**:
- ✅ Should READ latest audit from Supabase (not fetch fresh from APIs)
- ✅ Should fall back to localStorage only if Supabase unavailable
- ✅ Should extract `moneyPagesMetrics` from audit
- ✅ Should NOT save to Supabase (read-only operation)

**Current Behavior** (to be verified):
- [ ] Fetches latest audit from Supabase?
- [ ] Falls back to localStorage?
- [ ] Extracts `moneyPagesMetrics`?
- [ ] Does NOT save to Supabase?

**Required Changes**:
- [ ] Ensure Supabase is checked first (READ operation)
- [ ] Add debug logging for data source used
- [ ] Verify it's read-only (no Supabase writes)

---

### 8. Run All Audits & Updates (Dashboard)
**Category**: Orchestration Button (Multiple Operations)  
**Location**: Line ~51610  
**Element ID**: (to be identified)  
**Status**: ⏸️ **PENDING AUDIT**

**Expected Behavior**:
- ✅ Should execute scans in correct order (Sync CSV → Audit Scan → Ranking & AI Scan → Money Pages Scan → Domain Strength → Update All Tasks)
- ✅ Scan buttons should fetch fresh from APIs and save to Supabase
- ✅ Update buttons should read from Supabase and save measurements
- ✅ Should handle errors gracefully (continue on failure where possible)

**Current Behavior** (to be verified):
- [ ] Executes all audits in correct order?
- [ ] Scan buttons fetch fresh from APIs?
- [ ] Scan buttons save to Supabase first?
- [ ] Update buttons read from Supabase?
- [ ] Handles errors gracefully?

**Required Changes**:
- [ ] Verify execution order
- [ ] Ensure each button follows its category's data source strategy
- [ ] Standardize error handling
- [ ] Add progress tracking

---

## Unified Data Fetching Functions (To Be Created)

### Function 1: `getTaskMetricsFromDataSources()`
**Purpose**: Unified function to fetch task metrics with consistent priority

**Signature**:
```javascript
async function getTaskMetricsFromDataSources(task, options = {}) {
  // options: { preferSupabase: true, fallbackToLocalStorage: true, debug: false }
  // Returns: { metrics, dataSource: 'supabase' | 'localStorage', warnings: [] }
}
```

**Priority**:
1. Supabase (via `fetchLatestAuditFromSupabase`)
2. localStorage (with warning)

---

### Function 2: `getRankingAiDataFromSources()`
**Purpose**: Unified function to fetch Ranking & AI data

**Signature**:
```javascript
async function getRankingAiDataFromSources(propertyUrl, options = {}) {
  // Returns: { combinedRows: [], dataSource: 'supabase' | 'localStorage', warnings: [] }
}
```

**Priority**:
1. Supabase (via `fetchLatestAuditFromSupabase`)
2. `window.getRankingAiCombinedRows()` (if available)
3. `window.rankingAiData` (if available)
4. localStorage `rankingAiData` (with warning)

---

### Function 3: `normalizeUrlForMatching()`
**Purpose**: Standardized URL normalization for consistent matching

**Signature**:
```javascript
function normalizeUrlForMatching(url) {
  // Uses normalizeUrlForDedupe if available, otherwise standard normalization
  // Returns: normalized URL string
}
```

---

## Testing Plan

For each button:
1. **Test with Supabase available**: Verify Supabase is used
2. **Test with Supabase unavailable**: Verify localStorage fallback works
3. **Test URL matching**: Verify consistent matching across different URL formats
4. **Test error handling**: Verify graceful degradation
5. **Test debug logging**: Verify data source is logged

---

## Progress Tracking

- [ ] **Phase 3.1**: Audit all 8 buttons (current state)
- [ ] **Phase 3.2**: Create unified data fetching functions
- [ ] **Phase 3.3**: Update all buttons to use unified functions
- [ ] **Phase 3.4**: Test each button individually
- [ ] **Phase 3.5**: Document inconsistencies found
- [ ] **Phase 3.6**: Mark Phase 3 as complete

---

## Notes

- This audit should be done systematically, one button at a time
- Each button should be tested before moving to the next
- Inconsistencies should be documented as they're found
- Unified functions should be created after understanding all patterns

---

**Last Updated**: 2026-01-08
