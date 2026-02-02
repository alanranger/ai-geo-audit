# Why Authority and Visibility Scores Were Missing Historically

## 2026-02-01 Clarification (Plain English)

- **Authority/Behaviour** are intentionally **query‑based** (keywords), because users search by keywords, not by page URL.
- **Money Pages tables** are **page‑level** and will not match keyword metrics.
- This is expected and not a data bug.

## The Problem

**Key Finding:**
- **First scores saved:** November 6, 2025
- **Earliest audit:** July 25, 2024  
- **Gap:** 470 audits (16+ months) without saved scores

## What Happened

### Timeline

1. **July 25, 2024 - November 5, 2025:**
   - 470 audits were run
   - GSC data was fetched and scores were **calculated** from GSC data
   - BUT the scores were **NOT saved** to `audit_results.authority_score` and `audit_results.visibility_score` columns
   - The columns either didn't exist yet, or the save logic wasn't including these fields

2. **November 6, 2025 onwards:**
   - Code was updated to save `authority_score` and `visibility_score` to the database
   - 34 audits since then have saved scores correctly

### Why Scores Were Missing

The scores **WERE calculated** from GSC data at audit time, but they **weren't saved** because:

1. **The database columns were added later** - The `authority_score` and `visibility_score` columns in `audit_results` table were added after many audits had already been run

2. **The save logic was updated later** - The `save-audit.js` API endpoint was updated to include these fields in the save operation, but this happened after 470 audits had already been run

3. **GSC data may not have been stored** - The `gsc_timeseries` table may not have been populated for those historical dates, so even if we wanted to recalculate, the raw GSC data wasn't available

### The Solution

The backfill migration I created:
- Calculates scores from any available GSC data (`gsc_timeseries` table or `gsc_avg_position`/`gsc_ctr` in `audit_results`)
- Updates the `authority_score` and `visibility_score` columns for historical records
- Successfully updated 34 records (Nov 6 - Dec 10, 2025) that had GSC data available

### Remaining Issue

470 records still don't have scores because:
- They don't have GSC data in `gsc_timeseries` table
- They don't have `gsc_avg_position` or `gsc_ctr` stored in `audit_results` table
- Without the raw GSC data (position, CTR), we can't recalculate the scores

### Next Steps

To backfill the remaining 470 records, you need to:
1. Import historical GSC data into the `gsc_timeseries` table for those dates, OR
2. Populate `gsc_avg_position` and `gsc_ctr` columns in `audit_results` for those dates

Once that data is available, re-run the backfill migration and it will calculate and save the scores.

