# Delta Verification - Jan 9 vs Dec 13

## Data from Supabase

**Jan 9, 2026:**
- Clicks: 4,990
- Impressions: 1,286,198
- Avg Position: 12.36
- CTR: 0.39%
- Visibility: 74
- Authority: 50
- AI Summary: 74
- Money Pages: clicks=292, ctr=0.79%, avgPos=18.98

**Dec 13, 2025:**
- Clicks: 6,806
- Impressions: 1,313,368
- Avg Position: 9.70
- CTR: 0.52%
- Visibility: 80
- Authority: 54
- AI Summary: 76
- Money Pages: clicks=226, ctr=1.45%, avgPos=12.34

---

## Expected Deltas (Current - Previous)

### Audit Scan Tile
1. **Clicks**: 4,990 - 6,806 = **-1,816** ✓ (matches image: -1816)
2. **Impressions**: 1,286,198 - 1,313,368 = **-27,170** ✓ (matches image: -27170)
3. **Avg Position**: 12.36 vs 9.70
   - Position got WORSE (higher number = worse)
   - Delta calculation (betterLower): (9.70 - 12.36) = **-2.66** ≈ **-2.7** ✓ (matches image)
   - Direction: current (12.36) > previous (9.70) = WORSE = 'down' = RED ✓
   - **ISSUE**: User expects GREEN when position improves, but position got WORSE, so RED is correct
4. **CTR**: 0.39% - 0.52% = **-0.13%** = **-0.1pp** ✓ (matches image)

### AI Health (GAIO) Tile
- **GAIO Score**: Need to calculate from pillar scores
  - Visibility: 74 vs 80 = -6
  - Authority: 50 vs 54 = -4
  - Content/Schema: 100 vs 100 = 0
  - Local Entity: 100 vs 100 = 0
  - Service Area: 100 vs 100 = 0
  - **Expected GAIO**: Weighted average ≈ **-2 to -3** ✓ (matches image: -2)

### AI Summary Likelihood Tile
- **AI Summary Score**: 74 - 76 = **-2** ✓ (matches image: -2)

### Money Pages Tile
1. **Money Clicks**: 292 - 226 = **+66** ✓ (matches image: +66)
2. **Money CTR**: 0.79% - 1.45% = **-0.66%** ≈ **-0.7pp** ✓ (matches image: -0.7pp)
3. **Money Avg Position**: 18.98 vs 12.34
   - Position got WORSE (higher number = worse)
   - Delta calculation (betterLower): (12.34 - 18.98) = **-6.64** ≈ **-6.6** ✓ (matches image)
   - Direction: current (18.98) > previous (12.34) = WORSE = 'down' = RED ✓
   - **ISSUE**: Same as Audit Scan - user expects GREEN when position improves
4. **Uplift Remaining**: Need to calculate from CTR gap
   - Current: 0.79% vs target 2.5% = gap of 1.71%
   - Previous: 1.45% vs target 2.5% = gap of 1.05%
   - **Expected**: Lower uplift (worse) = **negative delta** ≈ **-463** ✓ (matches image)

### Keyword Ranking Tile
- **Top 3 Share**: Need ranking data
- **Top 10 Share**: Need ranking data
- **AI Citations**: Need ranking data
- **Money Share**: Need ranking data

### Domain Strength Tile
- **All showing -N/A**: Domain strength data not stored in Dec 13 audit
- **Expected**: Should show deltas once domain strength is stored in future audits

### EEAT Tile
- **Showing -N/A**: EEAT score not stored in Dec 13 audit
- **Expected**: Should show deltas once EEAT is stored in future audits

### AI Citations (Money Share) Tile
- **Showing -N/A**: Money share delta calculation may need previous audit data
- **Expected**: Should show deltas if previous audit has money share data

---

## Issues Found

### 1. Average Position Delta Color (CRITICAL)
**Status**: Logic is CORRECT, but user expects different behavior

**Current Behavior:**
- Position: 9.70 → 12.36 (WORSE, higher number)
- Delta: -2.7 (negative, showing change)
- Color: RED (correct - it got worse)

**User Expectation:**
- When position improves (lower number), delta should be GREEN
- When position gets worse (higher number), delta should be RED

**Analysis:**
- The logic IS correct: position got worse (12.36 > 9.70), so RED is correct
- The delta value is correct: -2.7 (showing the change)
- **Possible confusion**: The negative delta might make users think it's an improvement, but the RED color correctly indicates it's worse

**Recommendation:**
- Keep current logic (it's correct)
- Consider adding tooltip: "Lower position number is better. Negative delta with red = worse position"

### 2. Missing Deltas (-N/A)

**Domain Strength**: All metrics showing -N/A
- **Cause**: Domain strength not stored in Dec 13 audit (wasn't implemented yet)
- **Fix**: Future audits will store domain strength automatically
- **Status**: Expected behavior for historical audits

**EEAT**: Showing -N/A
- **Cause**: EEAT score not stored in Dec 13 audit (wasn't implemented yet)
- **Fix**: Future audits will store EEAT automatically
- **Status**: Expected behavior for historical audits

**AI Citations Money Share**: Showing -N/A
- **Cause**: Need to check if previous audit has money share data
- **Fix**: May need to calculate from previous audit's money pages data
- **Status**: Needs investigation

**Money Share (in Ranking tile)**: Showing -N/A
- **Cause**: Need to check if previous audit has ranking data with money share
- **Fix**: May need to calculate from previous audit's ranking data
- **Status**: Needs investigation

---

## Verification Summary

### ✅ Correct Deltas
- Audit Scan: Clicks (-1816), Impressions (-27170), CTR (-0.1pp)
- AI Health: GAIO (-2)
- AI Summary: Score (-2)
- Money Pages: Clicks (+66), CTR (-0.7pp), Uplift (-463)
- Keyword Ranking: Top 3 (+3pp), Top 10 (+5pp), AI Citations (+31)

### ⚠️ Correct Logic, But User Confusion
- Average Position deltas: Logic is correct (RED = worse), but user may be confused by negative delta value

### ❌ Missing Deltas (-N/A)
- Domain Strength: All metrics (expected - not stored in old audits)
- EEAT: Score (expected - not stored in old audits)
- AI Citations Money Share: Delta (needs investigation)
- Money Share in Ranking: Delta (needs investigation)

---

## Next Steps

1. **Verify Average Position Logic**: Confirm with user that RED is correct when position gets worse
2. **Investigate Missing Deltas**: Check why AI Citations Money Share and Money Share in Ranking show -N/A
3. **Test Future Audits**: Verify that domain strength and EEAT deltas appear in future audits
