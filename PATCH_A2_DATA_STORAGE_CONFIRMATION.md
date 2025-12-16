# PATCH A2: Data Storage Confirmation

## Current Status: What's Saved During Audit Run

### ✅ Saved to Supabase (during audit run):

1. **queryTotals[]** (query-only per tracked keyword)
   - **Location:** `audit_results.query_totals` (JSONB column)
   - **Source:** Fetched during audit via `gsc-entity-metrics.js`
   - **Format:** `[{query, clicks, impressions, ctr, position}, ...]`
   - **Used by:** Table (CTR & Impressions columns)

2. **queryPages** (query+page combinations - full snapshot)
   - **Location:** `audit_results.query_pages` (JSONB column)
   - **Source:** Fetched during audit via `gsc-entity-metrics.js` (dimensions: ['query', 'page'])
   - **Format:** `[{query, page, clicks, impressions, ctr, position}, ...]`
   - **Used by:** Segmentation calculations, fallback for scorecard
   - **Note:** This is the FULL snapshot, not per-keyword breakdown

### ❌ NOT Saved (fetched on-demand when scorecard opens):

3. **pageTotals** (page-only per target page)
   - **Location:** NOT saved, fetched on-demand
   - **Source:** `/api/aigeo/gsc-page-totals` (called when scorecard renders)
   - **Format:** `{clicks, impressions, ctr, position}`
   - **Used by:** Scorecard "Target page totals" tile

4. **query→pages breakdown** (per selected keyword)
   - **Location:** NOT saved, fetched on-demand
   - **Source:** `/api/aigeo/gsc-query-pages` (called when scorecard renders)
   - **Format:** `{query, pages: [{page, clicks, impressions, ctr, position}, ...]}`
   - **Used by:** Scorecard "Advanced" section

## Date Window

- **Default:** Changed from 30 days to **28 days** (matches GSC UI standard)
- **Location:** `api/aigeo/utils.js` - `parseDateRange()` function
- **Applies to:** All GSC API calls (queryTotals, pageTotals, query→pages breakdown)

## Recommendation

If you want **all three** saved during audit run:
- Need to fetch `pageTotals` for each tracked keyword's `best_url` during audit
- Need to fetch `query→pages breakdown` for each tracked keyword during audit
- This would require additional API calls during audit (could be slow for many keywords)

**Current approach (on-demand) is more efficient** - only fetches when user views scorecard.

