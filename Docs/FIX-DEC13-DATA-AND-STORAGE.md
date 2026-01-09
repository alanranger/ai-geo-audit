# Fix Dec 13 Data and Store Computed Fields

## Issues to Address

### 1. Dec 13 Anomalous Data
- **Problem:** Dec 13 has double clicks/impressions (13,612 clicks vs ~6,500 normal, 2.6M impressions vs ~1.4M normal)
- **Impact:** Tomorrow (Jan 10) will target Dec 13 for 28-day comparison, but we skip it, so it falls back to Dec 12
- **Solution:** Clean up Dec 13 data by halving the values to match surrounding days

### 2. Missing Computed Fields Storage
- **Problem:** `aiSummaryComponents`, `eeatScore`, `domainStrength` are computed but not stored
- **Impact:** Cannot calculate historical deltas for these tiles
- **Solution:** Store these computed fields in `audit_results` table

### 3. Missing Data Fallback Logic
- **Problem:** When Dec 12 is missing data (e.g., ranking_ai_data), we show "-N/A"
- **Impact:** Users can't see trends even when earlier data exists
- **Solution:** Implement fallback to next available audit (e.g., Dec 11 for ranking data)

---

## Implementation Plan

### Phase 1: Fix Dec 13 Data (Immediate)

**SQL Migration:**
```sql
-- Fix Dec 13 anomalous data by halving clicks/impressions
UPDATE audit_results
SET 
  gsc_clicks = ROUND(gsc_clicks / 2.0),
  gsc_impressions = ROUND(gsc_impressions / 2.0),
  updated_at = NOW()
WHERE property_url = 'https://www.alanranger.com'
  AND audit_date = '2025-12-13'
  AND gsc_clicks > 10000; -- Only fix if clearly anomalous
```

**Verification:**
- Dec 13 should have ~6,500 clicks and ~1,300,000 impressions (matching Dec 12/14 pattern)
- After fix, Dec 13 can be used for 28-day comparisons

### Phase 2: Store Computed Fields (Next Audit)

**Add to `save-audit.js`:**
1. **ai_summary_components** (JSONB):
   - Store: `{snippetReadiness, visibility, brand}`
   - Computed from: `snippetReadiness`, `scores.visibility`, `scores.brandOverlay.score`

2. **eeat_score** (NUMERIC):
   - Store: Computed EEAT score (0-100)
   - Computed from: `computeEeatScore()` function

3. **eeat_confidence** (TEXT):
   - Store: 'High', 'Medium', 'Low'
   - Computed from: `computeEeatConfidence()` function

4. **eeat_subscores** (JSONB):
   - Store: `{experience, expertise, authoritativeness, trustworthiness}`
   - Computed from: EEAT calculation

5. **domain_strength** (JSONB):
   - Store: `{selfScore, topCompetitorScore, strongerCount, competitorsCount, snapshotDate}`
   - Fetched from: Domain Strength API/snapshot

**Database Migration:**
```sql
ALTER TABLE audit_results
ADD COLUMN IF NOT EXISTS ai_summary_components JSONB,
ADD COLUMN IF NOT EXISTS eeat_score NUMERIC,
ADD COLUMN IF NOT EXISTS eeat_confidence TEXT,
ADD COLUMN IF NOT EXISTS eeat_subscores JSONB,
ADD COLUMN IF NOT EXISTS domain_strength JSONB;
```

### Phase 3: Implement Fallback Logic (Next)

**Modify `fetchPreviousAuditForDeltas`:**
- When Dec 12 is missing `ranking_ai_data`, try Dec 11
- When Dec 12 is missing domain strength, try Dec 14 (first snapshot)
- Log which audit date is actually used for transparency

**Fallback Priority:**
1. Target date (27 days ago)
2. Skip anomalous dates
3. If target date missing required field, try ±1 day
4. If still missing, try ±2 days
5. If still missing, use oldest available with data

---

## Questions Answered

### Q1: Will tomorrow use Dec 13?
**A:** Currently, tomorrow (Jan 10) will target Dec 13, but we skip it due to anomalous data, so it uses Dec 12. After fixing Dec 13 data, we can remove it from the skip list and it will be used normally.

### Q2: Should we store computed fields?
**A:** Yes, we should store:
- `ai_summary_components` - for AI Citations tile deltas
- `eeat_score`, `eeat_confidence`, `eeat_subscores` - for EEAT tile deltas
- `domain_strength` - for Domain Strength tile deltas (or link to snapshot)

### Q3: How to handle missing data?
**A:** Implement fallback logic:
- For Ranking tile: If Dec 12 missing ranking data, use Dec 11 (has data)
- For Domain Strength: If Dec 12 missing snapshot, use Dec 14 (first snapshot) or show N/A
- For computed fields: If Dec 12 missing, compute from available data or show N/A

---

## Next Steps

1. ✅ Create SQL migration to fix Dec 13 data
2. ✅ Add computed fields to `save-audit.js`
3. ✅ Add database columns for new fields
4. ✅ Implement fallback logic in `fetchPreviousAuditForDeltas`
5. ✅ Test with tomorrow's audit (Jan 10)
