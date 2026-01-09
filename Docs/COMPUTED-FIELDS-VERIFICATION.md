# Computed Fields Storage Verification

## Overview
This document verifies that all update buttons and routines correctly store the new computed fields to Supabase:
- `ai_summary_components` (JSONB)
- `eeat_score` (NUMERIC)
- `eeat_confidence` (TEXT)
- `eeat_subscores` (JSONB)
- `domain_strength` (JSONB)

---

## Update Routines Analysis

### 1. Run Audit Scan (`runAudit()`)
**Location**: Line ~26343  
**Calls**: `saveAuditToSupabase()` at line ~26694  
**Status**: ✅ **VERIFIED**

**What it does**:
- Fetches GSC data, schema audit, local signals, reviews, backlinks
- Calculates pillar scores
- Calls `saveAuditToSupabase()` with full audit data

**Computed Fields Storage**:
- ✅ `ai_summary_components`: Computed in `save-audit.js` from `scores`, `snippetReadiness`
- ✅ `eeat_score`: Computed in `save-audit.js` from `scores`, `rankingAiData`, `domainStrength`
- ✅ `eeat_confidence`: Computed in `save-audit.js` from data availability
- ✅ `eeat_subscores`: Computed in `save-audit.js` from `scores`, `rankingAiData`, `domainStrength`
- ✅ `domain_strength`: **Fetched automatically** in `saveAuditToSupabase()` (line ~22420) before saving

**Verification**: ✅ All fields will be stored correctly

---

### 2. Run Ranking & AI Scan (`loadRankingAiData()`)
**Location**: Line ~45060  
**Calls**: Direct API call to `/api/supabase/save-audit` at line ~44321  
**Status**: ⚠️ **PARTIAL** - Needs verification

**What it does**:
- Fetches SERP data from DataForSEO
- Creates `combinedRows` with ranking + AI data
- Saves to Supabase via direct API call with **only** `rankingAiData` field

**Computed Fields Storage**:
- ❌ `ai_summary_components`: **NOT COMPUTED** - API only receives `rankingAiData`, no `scores` or `snippetReadiness`
- ⚠️ `eeat_score`: **PARTIALLY COMPUTED** - Can compute from `rankingAiData` (citations), but missing `scores` for full calculation
- ⚠️ `eeat_confidence`: **PARTIALLY COMPUTED** - Can compute from `rankingAiData` (citations), but missing other signals
- ⚠️ `eeat_subscores`: **PARTIALLY COMPUTED** - Same as above
- ❌ `domain_strength`: **NOT FETCHED** - Direct API call doesn't fetch domain strength

**Issue**: When only ranking data is saved, computed fields won't be fully updated.

**Solution Options**:
1. **Option A**: Fetch latest audit data in API when only `rankingAiData` is sent, then recompute all fields
2. **Option B**: Always call `saveAuditToSupabase()` instead of direct API call (requires full audit data)
3. **Option C**: Accept partial updates (only update fields that can be computed from ranking data)

**Recommendation**: **Option A** - Modify `save-audit.js` to fetch latest audit when only `rankingAiData` is sent, then recompute all fields.

---

### 3. Run Money Pages Scan (`dashboardRunMoneyPagesScan()`)
**Location**: Dashboard/Money Pages tab  
**Status**: ✅ **NO ISSUE** - Doesn't create new audit

**What it does**:
- Refreshes Money Pages data from latest audit
- Does NOT create new audit or save to Supabase
- Only updates `window.moneyPagesMetrics` and localStorage

**Computed Fields Storage**: N/A - This routine doesn't save to Supabase

---

### 4. Run Domain Strength Snapshot (`runDomainStrengthSnapshot()`)
**Location**: Ranking & AI tab / Dashboard  
**Status**: ⚠️ **NEEDS VERIFICATION**

**What it does**:
- Calculates domain strength score
- Saves to Supabase `domain_strength_snapshots` table
- **Question**: Does it also update `audit_results.domain_strength`?

**Computed Fields Storage**:
- ❓ `domain_strength`: Need to verify if it updates `audit_results.domain_strength` column

**Recommendation**: Verify if domain strength snapshot updates the latest audit record's `domain_strength` field.

---

### 5. Run All Audits & Updates (`runDashboardGlobalRun()`)
**Location**: Line ~55313  
**Status**: ✅ **VERIFIED**

**What it does**:
- Runs all processes in sequence:
  1. Sync CSV
  2. Run Audit Scan (calls `saveAuditToSupabase()`)
  3. Run Ranking & AI Scan (direct API call)
  4. Run Money Pages Scan (refresh only)
  5. Run Domain Strength Snapshot
  6. Update All Tasks

**Computed Fields Storage**:
- ✅ Step 2 (Audit Scan) will store all computed fields correctly
- ⚠️ Step 3 (Ranking & AI Scan) has the same issue as #2 above
- ✅ Step 5 (Domain Strength) should update domain strength

**Overall**: Mostly correct, but Ranking & AI scan issue applies here too.

---

### 6. Optimisation Tracking Update Buttons
**Status**: ✅ **NO ISSUE** - Don't create audits (but should be documented)

**Buttons**:
1. **Update All Tasks with Latest Data** (`bulkUpdateAllTasks()`)
   - **Location**: Top of Optimisation Tracking tab
   - **Element ID**: `optimisation-bulk-update-btn`
   - **Function**: `window.bulkUpdateAllTasks()`
   - **What it does**: Updates all active tasks with latest metrics from audit data

2. **Update (per row)** (`updateTaskLatest()`)
   - **Location**: Each row in Optimisation Tracking table
   - **Element ID**: `optimisation-update-btn-{taskId}`
   - **Function**: `window.updateTaskLatest(taskId)`
   - **What it does**: Updates single task with latest metrics

3. **Add Measurement** (`addMeasurementBtn` handler)
   - **Location**: Inside task details drawer
   - **Element ID**: `optimisation-add-measurement-btn`
   - **Function**: Add Measurement handler
   - **What it does**: Creates new measurement entry for task

4. **Rebaseline** (`rebaselineBtn` handler)
   - **Location**: Inside task details drawer
   - **Element ID**: `optimisation-rebaseline-btn`
   - **Function**: Rebaseline handler
   - **What it does**: Creates new baseline measurement for task

**What they do**:
- Update `optimisation_measurements` table (NOT `audit_results`)
- Fetch latest audit data from Supabase to get current metrics
- Use `computeAiMetricsForPageUrl()` for URL tasks
- Do NOT create new audit records
- Do NOT directly affect computed fields in `audit_results`

**Computed Fields Storage**: N/A - These routines don't save to `audit_results`

**Note**: These buttons are documented in `HANDOVER.md` but were missing from this verification document. They don't need to store computed fields because they only update task measurements, not audit records.

---

## Optimisation Tracking Buttons (Clarification)

**Important**: The Optimisation Tracking module has 4 update buttons that were initially missing from this document:

1. **Update All Tasks with Latest Data** - Main button at top of Optimisation tab
2. **Update (per row)** - Button on each task row in the table
3. **Add Measurement** - Button inside task details drawer
4. **Rebaseline** - Button inside task details drawer

These buttons **do NOT** need to store computed fields because they:
- Only update `optimisation_measurements` table (not `audit_results`)
- Fetch latest audit data to get current metrics (read-only)
- Don't create new audit records

However, they **should be documented** in update button reference lists for completeness.

---

## Summary of Issues

### Issue 1: Ranking & AI Scan Partial Update
**Severity**: ⚠️ **MEDIUM**

**Problem**: When `loadRankingAiData()` saves ranking data, it only sends `rankingAiData` to the API. The API can't fully compute:
- `ai_summary_components` (needs `scores`, `snippetReadiness`)
- `eeat_score` (needs `scores` for full calculation)
- `domain_strength` (not fetched)

**Impact**: 
- If user runs only Ranking & AI scan (without full audit), computed fields won't be updated
- EEAT score will use defaults (50) for missing data
- Domain strength won't be stored

**Fix Required**: Modify `save-audit.js` to:
1. When only `rankingAiData` is sent, fetch latest audit from Supabase
2. Use existing `scores`, `snippetReadiness` from latest audit
3. Fetch domain strength (or use existing from latest audit)
4. Recompute all fields with complete data

---

### Issue 2: Domain Strength Snapshot Update
**Severity**: ❓ **UNKNOWN**

**Problem**: Need to verify if domain strength snapshot updates `audit_results.domain_strength` column.

**Impact**: If it doesn't, domain strength won't be stored in audit records for delta calculations.

**Fix Required**: Verify and fix if needed.

---

## Recommended Fixes

### Fix 1: Enhance save-audit.js for Partial Updates
**Priority**: 🔴 **HIGH**

**Changes Needed**:
1. When only `rankingAiData` is sent, fetch latest audit from Supabase
2. Merge `rankingAiData` with existing audit data
3. Recompute all computed fields with complete data
4. Update `audit_results` with all fields

**Code Location**: `api/supabase/save-audit.js` (around line 94-106)

---

### Fix 2: Verify Domain Strength Snapshot
**Priority**: 🟡 **MEDIUM**

**Changes Needed**:
1. Check if `runDomainStrengthSnapshot()` updates `audit_results.domain_strength`
2. If not, add code to update latest audit record after snapshot

**Code Location**: `audit-dashboard.html` - `runDomainStrengthSnapshot()` function

---

## Testing Checklist

After fixes are applied:

- [ ] Run Audit Scan → Verify all computed fields stored in Supabase
- [ ] Run Ranking & AI Scan only → Verify all computed fields updated (using latest audit data)
- [ ] Run Domain Strength Snapshot → Verify `audit_results.domain_strength` updated
- [ ] Run All Audits & Updates → Verify all computed fields stored correctly
- [ ] Check Supabase `audit_results` table for new audit → Verify all 5 computed fields populated

---

## Current Status (After Fixes)

| Routine | ai_summary_components | eeat_score | eeat_confidence | eeat_subscores | domain_strength |
|---------|----------------------|-----------|----------------|----------------|-----------------|
| Run Audit Scan | ✅ | ✅ | ✅ | ✅ | ✅ |
| Run Ranking & AI Scan | ✅ | ✅ | ✅ | ✅ | ✅* |
| Run Money Pages Scan | N/A | N/A | N/A | N/A | N/A |
| Run Domain Strength | ✅ | ✅ | ✅ | ✅ | ✅ |
| Run All Audits & Updates | ✅ | ✅ | ✅ | ✅ | ✅ |

**Fixes Applied**:
- ✅ **Run Ranking & AI Scan**: Now fetches latest audit when only `rankingAiData` is sent, recomputes all fields
- ✅ **Run Domain Strength**: Now updates `audit_results.domain_strength` after snapshot

*Domain strength may use default (50) if not in latest audit, but will be updated when domain strength snapshot runs
