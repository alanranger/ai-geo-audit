# Money Page Proportions - How They Work

## 2026-02-01 Clarification (Plain English)

- Money Pages metrics are **page‑level totals** (all queries for the page).
- Keyword metrics are **query‑level totals** (one keyword only).
- These are different slices of GSC, so they will not match 1:1.

## What Are Money Page Proportions?

Money page proportions tell us **what percentage of total site traffic comes from money pages** and how that traffic is distributed across different money page types.

### Example:
If your latest audit shows:
- **Total site clicks:** 10,000
- **Money pages clicks:** 2,000
- **Money page proportion:** 20% (2,000 / 10,000)

And within money pages:
- **Landing pages:** 800 clicks (40% of money pages)
- **Event pages:** 600 clicks (30% of money pages)
- **Product pages:** 600 clicks (30% of money pages)

## Where Do They Come From?

### 1. **Stored in Supabase** (Automatic)
When an audit runs, it calculates `moneySegmentMetrics` which contains:
```json
{
  "allMoney": {
    "clicks": 2000,
    "impressions": 50000,
    "ctr": 4.0,
    "avgPosition": 8.5,
    "behaviourScore": 27.5
  },
  "landingPages": {
    "clicks": 800,
    "impressions": 20000,
    "ctr": 4.0,
    "avgPosition": 9.0
  },
  "eventPages": {
    "clicks": 600,
    "impressions": 15000,
    "ctr": 4.0,
    "avgPosition": 7.5
  },
  "productPages": {
    "clicks": 600,
    "impressions": 15000,
    "ctr": 4.0,
    "avgPosition": 8.0
  }
}
```

This is **automatically saved** to `audit_results.money_segment_metrics` (JSONB column) during every audit.

### 2. **Calculated On-the-Fly** (No Separate Storage Needed)
The dashboard calculates proportions from the latest audit's `moneySegmentMetrics`:

```javascript
// Money page proportion of total site
moneyClicksProportion = allMoney.clicks / totalSiteClicks
moneyImpressionsProportion = allMoney.impressions / totalSiteImpressions

// Segment proportions within money pages
landingPages.clicks = landingPages.clicks / allMoney.clicks
eventPages.clicks = eventPages.clicks / allMoney.clicks
productPages.clicks = productPages.clicks / allMoney.clicks
```

**No separate storage needed** - proportions are calculated from existing data.

## How Are They Used?

### The Problem:
- `gsc_timeseries` table has **daily aggregate data** (total site clicks/impressions per date)
- But it **doesn't have money page breakdowns** for each date
- We need money page metrics for each date in the 28-day window

### The Solution:
1. Get the latest audit's `moneySegmentMetrics` (from `audit_results.money_segment_metrics`)
2. Get the total site clicks/impressions for that audit date from `gsc_timeseries`
3. Calculate proportions: `moneyClicksProportion = allMoney.clicks / totalSiteClicks`
4. Apply those proportions to **each date** in the 28-day window:

```javascript
// For Dec 15 (example date)
const dec15TotalClicks = 5000; // From gsc_timeseries
const dec15MoneyClicks = dec15TotalClicks * moneyClicksProportion; // 5000 * 0.20 = 1000
const dec15LandingClicks = dec15MoneyClicks * landingPagesProportion; // 1000 * 0.40 = 400
```

## Do You Need to Do Anything in Supabase?

### ✅ **No Action Required** - It's Automatic!

1. **Every audit automatically saves `money_segment_metrics`** to `audit_results` table
2. **Proportions are calculated on-the-fly** from this stored data
3. **Works regardless of audit frequency** (daily, weekly, monthly)

### What Happens If Audits Aren't Run Daily?

- **Latest audit's proportions are used** for all dates in the 28-day window
- This is a **reasonable approximation** because:
  - Money page proportions are relatively stable (don't change dramatically day-to-day)
  - The latest audit represents the current state of your site
  - GSC timeseries data (total site clicks/impressions) is accurate for each date
  - Only the money page breakdown uses proportions (which is an approximation)

### Example Timeline:
- **Dec 10:** Audit runs → saves `money_segment_metrics` (20% money pages)
- **Dec 11-17:** No audits run
- **Dec 18:** Dashboard shows last 28 days (Nov 20 - Dec 17)
  - Uses Dec 10 audit's proportions (20%) for all dates
  - Applies to actual GSC timeseries data for each date
  - Result: Accurate total site data + approximated money page breakdown

## Data Flow Summary

```
1. Audit runs → Calculates moneySegmentMetrics
                ↓
2. Saved to audit_results.money_segment_metrics (JSONB)
                ↓
3. Dashboard loads latest audit's moneySegmentMetrics
                ↓
4. Gets total site clicks/impressions from gsc_timeseries for audit date
                ↓
5. Calculates proportions: moneyClicks / totalClicks = 0.20 (20%)
                ↓
6. For each date in 28-day window:
   - Get total clicks from gsc_timeseries
   - Calculate money clicks = totalClicks × 0.20
   - Calculate segment clicks = moneyClicks × segmentProportion
                ↓
7. Display in charts and tables
```

## Why This Approach?

### ✅ **Advantages:**
- Uses **actual GSC data** for total site metrics (accurate)
- Uses **latest audit's breakdown** for money page proportions (reasonable approximation)
- **No additional storage needed** (uses existing data)
- **Works with any audit frequency** (daily, weekly, monthly)

### ⚠️ **Limitations:**
- Money page proportions are **approximated** (not exact for each date)
- If site structure changes significantly, proportions may be slightly off
- But total site metrics are always accurate from GSC timeseries

## Conclusion

**You don't need to do anything** - the system automatically:
1. Saves `money_segment_metrics` during every audit
2. Calculates proportions from the latest audit
3. Applies proportions to GSC timeseries data
4. Displays accurate metrics for all dates

The proportions are **calculated automatically** from data that's **already being stored** during audits. No manual intervention or additional Supabase setup required.

