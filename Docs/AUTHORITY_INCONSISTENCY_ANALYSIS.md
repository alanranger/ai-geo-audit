# Authority Score Inconsistency Analysis

## Summary of Findings

After analyzing all 3 images and Supabase data, here are the key inconsistencies and root causes:

## Image Analysis

### Image 1: Authority Dashboard (Current View)
- **Authority Score:** 53 (Amber)
- **Review Score:** 83/100
- **GBP Rating:** N/A (N/A reviews) ← **CRITICAL ISSUE**
- **Trustpilot:** 4.60 (610 reviews)
- **Components:**
  - Behaviour: 11/100
  - Ranking: 71/100
  - Backlinks: 87/100
  - Reviews: 83/100

**Analysis:** This appears to be showing Dec 16 or Dec 17 data. The Review Score of 83 is calculated from Trustpilot ONLY (since GBP is N/A). However, if GBP is missing, the Review Score should be calculated as 100% Trustpilot, which would give ~95, not 83. This suggests either:
1. The Review Score (83) is from an older calculation when GBP was partially available
2. There's a calculation error in how Review Score handles missing GBP data

### Image 2: Score Trends Chart
- **Authority Line:** Shows significant drop around Dec 13-15, falling to ~35-40
- **Overall Change:** ↓ 43.5% decrease
- **Pattern:** Authority was stable around 60-62, then dropped sharply to 35-37 on Dec 13-15, then recovered to 53-55 on Dec 16-17

**Analysis:** This matches the Supabase data perfectly - the drop corresponds to when Backlinks = 0.

### Image 3: Pillar Scorecard
- **Authority Score:** 35 (Red status)
- **Data Date:** 15 Dec 2025
- **Improvement Suggestions:** Focuses on Behaviour Score (11)

**Analysis:** This is correctly showing the historical score for Dec 15 (35), which matches Supabase. The scorecard is working as intended - it shows the score for the last date in the chart range.

## Supabase Data Analysis

### Dec 13, 2025
- Authority: **37**
- Behaviour: 14
- Ranking: 72
- **Backlinks: 0** ← CSV not loaded
- Reviews: 83
- Calculated: 37 ✓ (matches stored)

### Dec 15, 2025
- Authority: **35**
- Behaviour: 11
- Ranking: 71
- **Backlinks: 0** ← CSV not loaded
- Reviews: 83
- Calculated: 35 ✓ (matches stored)

### Dec 16, 2025
- Authority: **53**
- Behaviour: 11
- Ranking: 71
- **Backlinks: 87** ← CSV loaded
- Reviews: 83
- Calculated: 53 ✓ (matches stored)

### Dec 17, 2025
- Authority: **55**
- Behaviour: 11
- Ranking: 71
- Backlinks: 87
- **Reviews: 95** ← Increased from 83
- Calculated: 55 ✓ (matches stored)

## Root Causes Identified

### 1. **Backlink CSV Loading Issue (PRIMARY CAUSE)**
- **Problem:** Backlink CSV not loaded consistently on Dec 13-15
- **Impact:** Backlink Score dropped from 87 to 0, causing Authority to drop from 53 to 35-37
- **Calculation:** 0.2 * (87 - 0) = 17.4 point drop in Authority
- **Status:** This is the main cause of the "rollercoaster" pattern

### 2. **GBP Reviews Not Being Fetched (SECONDARY ISSUE)**
- **Problem:** GBP rating/reviews showing as N/A in dashboard
- **Impact:** Review Score calculated from Trustpilot only (should be 60% GBP + 40% Trustpilot)
- **Current State:** 
  - Dec 13-16: Reviews = 83 (Trustpilot only)
  - Dec 17: Reviews = 95 (Trustpilot only, but higher calculation)
- **Expected:** If GBP was working, Review Score should be higher (GBP typically has 4.81 rating, 221 reviews)

### 3. **Review Score Calculation Inconsistency**
- **Issue:** Review Score shows 83 in Image 1, but Dec 17 shows 95
- **Possible Causes:**
  - Review Score calculation changed between audits
  - Trustpilot-only calculation is inconsistent
  - GBP data was partially available in some audits but not others

## Data Inconsistencies Summary

| Date | Authority | Backlinks | Reviews | GBP Status | Issue |
|------|-----------|-----------|---------|------------|-------|
| Dec 13 | 37 | 0 | 83 | Unknown | Backlinks missing |
| Dec 15 | 35 | 0 | 83 | Unknown | Backlinks missing |
| Dec 16 | 53 | 87 | 83 | N/A | GBP missing, but backlinks restored |
| Dec 17 | 55 | 87 | 95 | N/A | GBP missing, Review Score increased |

## Recommendations

### Immediate Actions:
1. **Fix GBP Reviews Fetching:** The API changes I made should help, but need to verify GBP reviews are actually being returned
2. **Verify Review Score Calculation:** Check why Review Score is 83 vs 95 - should be consistent if both are Trustpilot-only
3. **Backlink CSV Loading:** Ensure backlink CSV is loaded consistently (this seems to be working now on Dec 16-17)

### Historical Data Fixes Needed:
1. **Dec 13:** Authority should be recalculated with Backlinks = 87 (if we know CSV should have been loaded)
2. **Dec 15:** Authority should be recalculated with Backlinks = 87 (if we know CSV should have been loaded)
3. **Review Scores:** Need to determine if GBP was available on these dates and recalculate Review Score accordingly

## Critical Discovery: Review Score Calculation

**Review Score = 83** = GBP (4.81, 221) + Trustpilot (4.6, 610) - **BOTH AVAILABLE**
**Review Score = 95** = Trustpilot ONLY (4.6, 610) - **GBP MISSING**

### This Reveals:
- **Dec 13-16:** Reviews = 83 → **GBP WAS AVAILABLE** during these audits
- **Dec 17:** Reviews = 95 → **GBP NOT AVAILABLE**, using Trustpilot only

### Contradiction:
- Image 1 shows "GBP rating: N/A (N/A reviews)" but Review Score is 83
- This suggests GBP data was fetched during audit but not displayed in UI
- OR the UI is showing stale/cached data

## Questions to Resolve

1. **Why does Image 1 show GBP as N/A when Review Score 83 indicates GBP was available?**
   - Possible: UI not displaying GBP data correctly
   - Possible: GBP data in API response but not parsed correctly for display
   - Possible: Stale UI data vs fresh audit data

2. **Why did GBP stop working on Dec 17?**
   - API endpoint changed?
   - Token expired?
   - API response structure changed?

3. **Is the backlink smoothing code working?** It should prevent the 0→87 jumps in historical data

4. **Should we recalculate historical Review Scores?**
   - If GBP was available on Dec 13-16, scores are correct (83)
   - If GBP was NOT available, should recalculate to 95 (Trustpilot only)

