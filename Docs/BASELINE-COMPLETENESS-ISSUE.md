# Baseline Completeness Issue

## Problem

Many baseline measurements created before recent fixes are missing critical fields:
- **AI Overview** (`ai_overview`)
- **AI Citations** (`ai_citations`)
- **Current Rank** (`current_rank`)

This distorts delta calculations and progress tracking because:
1. When baseline is `null` and latest has a value, deltas show incorrect improvements
2. Progress tracking can't accurately measure change
3. UI shows "—" for baseline but actual values for latest, making progress unclear

## Impact

From database analysis (as of 2026-01-10):
- Many baselines created before 2026-01-07 are missing AI Overview and AI Citations
- Some older baselines (Dec 21-23) are also missing Current Rank
- This affects delta calculations in the Performance Snapshot table

## Solution Options

### Option 1: Rebaseline Affected Tasks (Recommended)
Manually rebaseline tasks with incomplete baselines:
1. Open each affected task
2. Click "Rebaseline" button
3. This creates a new baseline with all fields properly captured

**Pros:**
- Ensures accurate baseline data going forward
- Fixes delta calculations immediately
- Preserves measurement history

**Cons:**
- Manual process (one task at a time)
- Time-consuming if many tasks affected

### Option 2: Add Graceful Handling for Missing Baseline Fields
Update delta calculation logic to handle missing baseline fields:
- If baseline field is `null`, treat it as "unknown" rather than "zero"
- Show "—" for delta when baseline is missing
- Add warning indicator when baseline is incomplete

**Pros:**
- No manual intervention needed
- Prevents incorrect delta calculations
- Clear indication of data quality issues

**Cons:**
- Doesn't fix historical data
- Still shows "—" for deltas (less useful)

### Option 3: Bulk Rebaseline Script
Create a script/API endpoint to automatically rebaseline all tasks with incomplete baselines:
1. Identify tasks with missing baseline fields
2. Fetch latest audit data
3. Create new baseline measurements with complete data

**Pros:**
- Automated fix for all affected tasks
- Ensures consistency

**Cons:**
- Requires careful testing
- May overwrite intentional baseline choices

## Recommended Approach

**Immediate:** Implement Option 2 (graceful handling) to prevent incorrect deltas
**Long-term:** Provide Option 3 (bulk rebaseline) or guide users to manually rebaseline

## Affected Tasks

Run this query to identify affected tasks:

```sql
SELECT 
  t.id as task_id,
  t.title,
  t.keyword_text,
  t.target_url,
  e.created_at as baseline_date,
  CASE 
    WHEN e.metrics->>'ai_overview' IS NULL THEN 'missing'
    WHEN e.metrics->>'ai_overview' = '' THEN 'empty'
    ELSE 'present'
  END as ai_overview_status,
  CASE 
    WHEN e.metrics->>'ai_citations' IS NULL THEN 'missing'
    WHEN e.metrics->>'ai_citations' = '' THEN 'empty'
    ELSE 'present'
  END as ai_citations_status,
  CASE 
    WHEN e.metrics->>'current_rank' IS NULL THEN 'missing'
    WHEN e.metrics->>'current_rank' = '' THEN 'empty'
    ELSE 'present'
  END as current_rank_status
FROM optimisation_tasks t
INNER JOIN optimisation_task_events e ON e.task_id = t.id
WHERE e.event_type = 'measurement'
  AND e.is_baseline = true
  AND (
    e.metrics->>'ai_overview' IS NULL 
    OR e.metrics->>'ai_citations' IS NULL 
    OR e.metrics->>'current_rank' IS NULL
    OR e.metrics->>'ai_overview' = ''
    OR e.metrics->>'ai_citations' = ''
    OR e.metrics->>'current_rank' = ''
  )
ORDER BY e.created_at DESC;
```

## Next Steps

1. ✅ Document the issue (this file)
2. ⏳ Implement graceful handling for missing baseline fields
3. ⏳ Add UI indicator when baseline is incomplete
4. ⏳ Consider bulk rebaseline utility (optional)
