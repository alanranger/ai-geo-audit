# Money Pages Performance & Actions - Feature Specification

## Implementation Status (2025-12-22)

✅ **Fully Implemented**:
- Performance Trends charts (split into Volume and Rate/Score charts for better Y-axis scaling)
  - Uses actual Google Search Console timeseries data for last 28 days
  - Displays 8 weekly data points (28 days / 4 = 7 weeks)
  - Calculates metrics from GSC data using money page proportions from latest audit
- KPI Tracker (last 28 days) with chart and table side-by-side
  - Uses actual Google Search Console timeseries data
  - Displays 8 weekly data points across 28-day range
  - Calculates segment metrics (All, Landing, Event, Product) from GSC data
  - Supports CTR, Impressions, Clicks, and Avg Position metrics
- Priority & Actions section with impact/difficulty matrix
- Filter dropdowns with persistent counts
- Accurate CTR plotting (calculated directly from clicks/impressions)
- Enhanced CTR Y-axis precision (0.02 stepSize, 2 decimal places)
- Bold, larger chart axis labels for better visibility
- Correct trend calculations (percentage points, not multiplied values)
- **Phase 4: Suggested (Top 10) Priority Pages Panel**
  - Card-based display of top 10 priority pages ranked by impact and difficulty
  - Shows optimization status (✓ Being Optimised badge for tracked pages)
  - Clickable URLs that open in new browser window
  - Color-coded page type labels (Landing, Event, Product) with bold styling
  - Potential impact clicks 28d metric displayed prominently
  - "Create Task" / "Manage Task" buttons matching Priority & Actions table behavior
  - Enhanced optimization status detection (checks multiple task types)

---

## 2026-02-01 Clarification (Plain English)

- Money Pages tables and charts use **page‑level totals** (all queries for the page).
- Keyword tables use **query‑level totals** (one keyword only).
- These are **different slices of GSC**, so they will not match 1:1.

## Overview

A dedicated section that tracks how money pages perform vs the rest of the site, highlights which specific URLs need attention, and suggests concrete actions based on real GSC + schema data.

## Purpose

- Track money pages performance vs the rest of the site
- Highlight which specific URLs need attention
- Suggest concrete actions based on real GSC + schema data
- Reuse existing segmentation logic (money / education / general)

## UI Placement

New section in the lower half of the dashboard, just after the current Segmented CTR block, titled:

**"Money Pages Performance & Actions"**

Uses the existing segment classifier (money / education / general) so no new classification logic is needed.

---

## Structure

### 2.1 Summary Strip (at the top of the section)

A thin horizontal strip with 3–4 key numbers, similar style to top KPIs:

1. **Money page share of clicks**
   - e.g. "Money pages: 32% of site clicks (last 90 days)"

2. **Money page share of impressions**
   - e.g. "Money pages: 18% of site impressions"

3. **Money page average CTR vs site CTR**
   - e.g. "Money pages CTR: 3.1% vs site CTR: 1.4%"

4. **Money page average position vs site**
   - e.g. "Money pages avg position: 10.4 vs site: 17.3"

**RAG Coloring:**
- **Green**: money CTR ≥ site CTR AND money avg position better than site
- **Amber**: mixed (CTR better but position worse, or vice-versa)
- **Red**: both worse than site

### 2.2 KPIs and Charts Block

Right under the strip, a 2-column layout:

**Left: Money vs Non-Money Comparison Chart**
- Stacked bar chart (preferable):
  - Bar 1 (Clicks): [Money | Education | General]
  - Bar 2 (Impressions): [Money | Education | General]
- Shows if money pages are over- or under-performing relative to their visibility

**Right: Money Pages KPI Cards**
3–4 cards:

1. **Money CTR Score**
   - e.g. "Money CTR: 3.1% (target: 5%+)"
   - Scaled to 0–100: `min(ctr / 0.05, 1) * 100`

2. **Money Average Position Score**
   - e.g. "Avg position: 10.4 (target: ≤ 8)"
   - Score from `normalisePosition(10.4, 1, 20)`

3. **Money Coverage Score**
   - % of money pages seen in GSC in period
   - e.g. "18 of 40 money URLs had impressions (45%)"
   - Score = `coveragePct`

4. **Money Schema Readiness Score** (optional)
   - % of money URLs with Product / Event / LocalBusiness / FAQ schema
   - e.g. "Schema-ready: 12 of 18 active money URLs (66%)"
   - Reuses schema audit data if URL list is mapped

**Optional Combined Score:**
```
Money Health = 0.4 * CTR_score + 0.3 * Position_score
             + 0.2 * Coverage_score + 0.1 * Schema_score
```

### 2.3 Money Pages Opportunity Table

Below the KPIs, a table focused only on money-segment URLs.

**Columns:**
- URL (truncated with full URL on hover, plus "Copy URL" icon/button)
- Page title
- Clicks
- Impressions
- CTR
- Avg position
- Opportunity category (High / Maintain / Visibility fix)
- Recommended action (dynamic text)

**Rows:**
- Default sort by Opportunity category then by impressions desc
- Top 10–20 money pages by impressions, with pagination or "Show all"

---

## Logic: Opportunity Categories and Actions

### 3.1 Opportunity Categories (per URL)

Using thresholds, each money page gets 1 category:

#### High Opportunity: Improve CTR
**Conditions:**
- Avg position between 3 and 15
- Impressions above minimum threshold (e.g. impressions >= 100 over the period)
- CTR below target line for that position:
  - If position 3–6 and CTR < 0.05 (5%)
  - If position 7–10 and CTR < 0.03 (3%)
  - If position 11–15 and CTR < 0.02 (2%)

**Priority:** These are your priority money pages.

#### Maintain: Performing Well
**Conditions:**
- Avg position ≤ 8
- CTR >= target line (e.g. CTR ≥ 5% for top 8)

**Priority:** Defensive - strong pages you monitor but don't need immediate changes.

#### Visibility Fix: Low Impressions / Poor Ranking
**Conditions:**
- Impressions < 100 OR
- Avg position > 15 OR
- No impressions in current period (if combining with schema data and URL list)

**Priority:** Pages that probably need linking, schema, or on-page SEO to get any real data.

#### Watchlist (Optional)
**Conditions:**
- Growing impressions but falling CTR or position vs previous audit (requires Supabase history)

**Priority:** Flagged with simple icon if comparing current vs last audit.

### 3.2 Recommended Actions (Dynamic)

Each category maps to recommendation templates with parameters filled from data.

#### High Opportunity: Improve CTR
**Template:**
```
"High opportunity: Good visibility (avg position {avgPosition}) but low CTR ({ctr}%) on {impressions} impressions.
Focus on title/meta refinements, 'Best + topic' language, stronger USPs, and richer FAQs for this money page."
```

**Suggestions:**
- Improve title/meta with clearer offer and location
- Add FAQ with buying objections
- Add internal links from educational posts

#### Maintain
**Template:**
```
"Strong performer: CTR ({ctr}%) and position (avg {avgPosition}) are above target.
Maintain current messaging, keep internal links updated, and consider testing a modest title variation only after other money pages are improved."
```

#### Visibility Fix
**Template:**
```
"Low visibility: Only {impressions} impressions and avg position {avgPosition}.
Prioritise internal links from high-traffic educational posts, ensure Product/Event schema is present, and consider adding a 'Best [topic]' section with clear outcomes."
```

#### Watchlist (if implemented)
**Template:**
```
"Watchlist: Impressions are up {impressionsChange}% since last audit but CTR fell from {previousCtr}% to {currentCtr}%.
Review SERP competitors and refine the page title/meta to reinforce the unique value."
```

**Helper Function:**
```javascript
getMoneyPageRecommendation(pageMetrics, segmentContext) {
  // Takes row's metrics + site averages
  // Returns: { categoryLabel, colour, shortActionText }
}
```

---

## Extra Controls and UX Details

### Segment Toggle Inherited
Even though this section is "Money Pages", keep the global segment toggle visible so you can quickly switch your whole dashboard back to "All" or "Exclude education", but this block always stays restricted to money pages.

### Copy URLs Button
At the top right of the table:
- "Copy top 10 money URLs" (copies list to clipboard)
- Row-level copy icon for one-by-one usage

### Audit Awareness
Small caption at bottom:
"Data calculated from Google Search Console timeseries for the last 28 days, displayed as 8 weekly data points. Metrics are calculated using money page proportions from the latest audit."

### RAG Legend
A small legend explaining the colours used for:
- Category chips
- KPI cards

---

## Implementation Phases

### Phase 1: Data Model + Calculations
- Derive money-segment aggregates and per-URL opportunity flags
- Store in audit results/Supabase
- Calculate opportunity categories for each money page
- Compute money vs site averages

### Phase 2: UI Block
- Summary strip with 3-4 key numbers
- Chart (stacked bar: clicks/impressions by segment)
- KPI cards (CTR, Position, Coverage, Schema readiness)
- Table skeleton with columns
- Copy URLs functionality

### Phase 3: Recommendation Text Engine
- Wire thresholds to opportunity categories
- Implement `getMoneyPageRecommendation()` helper
- Generate dynamic recommendation text
- Add watchlist comparison (if Supabase history available)

---

## Data Requirements

### From Existing Data Sources:
- GSC query/page data (already segmented)
- Schema audit data (for schema readiness)
- Supabase historical data (for watchlist comparisons)

### New Calculations Needed:
- Money segment aggregates (clicks, impressions, CTR, position)
- Per-URL opportunity category classification
- Money vs site averages comparison
- Coverage percentage (money URLs with impressions / total money URLs)

---

## Technical Notes

- Reuses existing `pageSegment.js` classification logic
- Leverages existing GSC data structure
- Can extend existing Supabase schema if needed
- Recommendation engine should be pure function for testability

