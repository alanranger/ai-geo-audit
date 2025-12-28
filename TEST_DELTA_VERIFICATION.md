# Delta Calculation Verification Test

## Overview
This document verifies that deltas are calculated correctly between:
- **Baseline measurements**: Taken whenever the task/cycle was started
- **Latest audit data**: From the most recent `audit_date` in Supabase
- **Note**: GSC data is 2 days behind the `audit_date` (e.g., audit_date 2025-12-28 means GSC data is from 2025-12-26)

## Changes Made

### 1. Updated `bulkUpdateAllTasks()` function
- **Location**: `audit-dashboard.html` line ~14467
- **Change**: Now fetches latest audit from Supabase **before** updating tasks
- **Purpose**: Ensures tasks are updated with the most recent `audit_date` data, not stale localStorage data
- **Logging**: Added debug logs showing `audit_date` and GSC data date (2 days behind)

### 2. Updated `renderDashboardTab()` function  
- **Location**: `audit-dashboard.html` line ~50564
- **Change**: Now fetches previous audit by `audit_date` (not just global run snapshots)
- **Purpose**: Ensures dashboard deltas compare current `audit_date` vs previous `audit_date`
- **Function**: `fetchPreviousAuditForDeltas()` - finds the audit_date before current one

## Test Procedure

### Step 1: Check Current State
1. Open the Optimisation tab
2. Note the baseline dates for tasks (when cycle started)
3. Note the latest measurement dates
4. Check current deltas displayed

### Step 2: Run Global Audit
1. Go to Dashboard tab
2. Click "Run All Audits & Updates"
3. This will:
   - Sync CSV
   - Run Audit Scan (saves to Supabase with `audit_date`)
   - Run Ranking & AI Scan
   - Run Money Pages Scan
   - Run Domain Strength Snapshot
   - **Update All Tasks** (this is the critical step)

### Step 3: Verify Task Updates
1. After global run completes, go to Optimisation tab
2. Check that tasks show:
   - **Latest measurement date**: Should match the latest `audit_date` from Supabase
   - **Deltas**: Should show change from baseline (whenever it was taken) to latest audit data
   - **Note**: GSC metrics (clicks, impressions, CTR, rank) are 2 days behind the `audit_date`

### Step 4: Verify Delta Calculation
For each task, verify:
- **Baseline date**: e.g., 2025-12-24
- **Latest measurement date**: e.g., 2025-12-28 (matches latest audit_date)
- **Delta**: Latest value - Baseline value
- **GSC data date**: audit_date - 2 days (e.g., 2025-12-28 audit = 2025-12-26 GSC data)

## Expected Behavior

### Before Fix:
- Tasks might use stale localStorage data
- Deltas might not reflect latest audit_date
- Multiple runs on same day might not update properly

### After Fix:
- Tasks always use latest audit from Supabase (by audit_date)
- Deltas correctly compare baseline (whenever taken) vs latest audit_date
- GSC data date is properly noted (2 days behind audit_date)
- Dashboard deltas compare current audit_date vs previous audit_date

## SQL Verification Queries

### Check Latest Audit Date:
```sql
SELECT audit_date, property_url, gsc_clicks, gsc_impressions 
FROM audit_results 
WHERE property_url = 'https://www.alanranger.com'
ORDER BY audit_date DESC 
LIMIT 1;
```

### Check Task Baseline vs Latest:
```sql
SELECT 
  t.id,
  t.keyword_text,
  t.target_url,
  (SELECT e.event_at FROM optimisation_task_events e 
   WHERE e.task_id = t.id AND e.event_type = 'measurement' AND e.is_baseline = true 
   ORDER BY e.event_at DESC LIMIT 1) as baseline_date,
  (SELECT e.event_at FROM optimisation_task_events e 
   WHERE e.task_id = t.id AND e.event_type = 'measurement' AND e.is_baseline = false 
   ORDER BY e.event_at DESC LIMIT 1) as latest_date
FROM optimisation_tasks t
WHERE t.status NOT IN ('done', 'cancelled', 'deleted')
LIMIT 5;
```

### Verify Delta Calculation:
```sql
-- Get task with baseline and latest metrics
WITH task_metrics AS (
  SELECT 
    t.id as task_id,
    (SELECT e.metrics FROM optimisation_task_events e 
     WHERE e.task_id = t.id AND e.event_type = 'measurement' AND e.is_baseline = true 
     ORDER BY e.event_at DESC LIMIT 1) as baseline_metrics,
    (SELECT e.metrics FROM optimisation_task_events e 
     WHERE e.task_id = t.id AND e.event_type = 'measurement' AND e.is_baseline = false 
     ORDER BY e.event_at DESC LIMIT 1) as latest_metrics
  FROM optimisation_tasks t
  WHERE t.id = '02903996-b0f7-4e09-a34a-c288d919ca6f'
)
SELECT 
  (baseline_metrics->>'gsc_clicks_28d')::numeric as baseline_clicks,
  (latest_metrics->>'gsc_clicks_28d')::numeric as latest_clicks,
  (latest_metrics->>'gsc_clicks_28d')::numeric - (baseline_metrics->>'gsc_clicks_28d')::numeric as delta_clicks
FROM task_metrics;
```

## Success Criteria

✅ Tasks are updated with latest audit_date data from Supabase  
✅ Deltas show change from baseline (whenever taken) to latest audit_date  
✅ GSC data date is correctly noted as 2 days behind audit_date  
✅ Dashboard deltas compare current audit_date vs previous audit_date  
✅ Multiple runs on same day don't create false deltas  

## Notes

- **GSC Data Lag**: Google Search Console data is typically 2 days behind. So an audit_date of `2025-12-28` means the GSC data reflects `2025-12-26`.
- **Baseline Date**: Baselines are taken when a task/cycle starts, so they can be from any date in the past.
- **Delta Calculation**: Delta = Latest (from audit_date) - Baseline (from cycle start date)

