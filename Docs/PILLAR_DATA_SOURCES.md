# Pillar Data Sources - Which Pillars Use GSC Data?

## Summary

## 2026-02-01 Clarification (Plain English)

- **URL metrics** = page‑level totals (all queries for the page).
- **Keyword metrics** = query‑level totals (one keyword only).
- Authority/Behaviour are **intentionally query‑based** because users search by keywords, not by page URL.
- Money Pages tables are **page‑level** by design.

**Pillars that USE GSC data (calculated at load time):**
1. **Visibility** - Uses GSC position data
2. **Authority** - Uses GSC position, CTR, clicks, impressions data
3. **Local Entity** - Uses GSC data as fallback (if Business Profile API unavailable)

**Pillars that DON'T use GSC data (stored in database):**
4. **Content/Schema** - Uses schema audit results (crawled page data)
5. **Service Area** - Uses Business Profile API data

---

## Detailed Breakdown

### 1. Visibility Pillar ✅ **USES GSC DATA**

**Data Source:** Google Search Console (GSC) API
- **Primary:** `position` or `avgPosition` from GSC API
- **Calculation:** `visibility = clampScore(posScore)` where `posScore` is calculated from average position
- **Formula:** `posScore = 100 - ((clampedPosition - 1) / 39) * 90` (position clamped to 1-40)

**When calculated:** At audit time (when you click "Run Audit")
**Stored in DB:** Yes, saved to `audit_results.visibility_score` column
**Historical data:** Can be backfilled from `gsc_timeseries.position` or `audit_results.gsc_avg_position`

---

### 2. Authority Pillar ✅ **USES GSC DATA**

**Data Source:** Google Search Console (GSC) API + Backlinks + Reviews
- **Primary:** `queryPages` or `topQueries` from GSC API (position, CTR, clicks, impressions)
- **Components:**
  - **Behaviour (40%):** Calculated from GSC CTR data
  - **Ranking (20%):** Calculated from GSC position data
  - **Backlinks (20%):** From backlink CSV upload (not GSC)
  - **Reviews (20%):** From Business Profile API + Trustpilot (not GSC)
    - GBP review count is pulled from the Business Profile **reviews endpoint** (v4), which is the most reliable source when location detail fields are missing.

**When calculated:** At audit time (when you click "Run Audit")
**Stored in DB:** Yes, saved to `audit_results.authority_score` column
**Historical data:** Can be backfilled from `gsc_timeseries.position` and `gsc_timeseries.ctr` (simplified calculation when `topQueries` not available)

---

### 3. Local Entity Pillar ⚠️ **PARTIALLY USES GSC DATA (FALLBACK)**

**Data Source:** Business Profile API (primary) OR GSC data (fallback)
- **Primary:** Google Business Profile API (NAP consistency, knowledge panel, locations)
- **Fallback:** If Business Profile API unavailable, uses GSC position and CTR:
  - Formula: `localEntity = 60 + 0.3 * (posScore - 50) + 0.2 * (ctrScore - 50)`

**When calculated:** At audit time (when you click "Run Audit")
**Stored in DB:** Yes, saved to `audit_results.local_entity_score` column
**Historical data:** Can be backfilled from Business Profile historical data OR GSC data (fallback)

---

### 4. Content/Schema Pillar ❌ **DOES NOT USE GSC DATA**

**Data Source:** Schema audit (crawled page data)
- **Primary:** Schema audit API that crawls pages and detects schema markup
- **Components:**
  - Foundation schemas (30%): Organization, Person, WebSite, BreadcrumbList
  - Rich Results (35%): Article, Event, FAQPage, Product, etc.
  - Coverage (20%): Pages with schema / total pages
  - Diversity (15%): Number of unique schema types

**When calculated:** At audit time (when you click "Run Audit")
**Stored in DB:** Yes, saved to `audit_results.content_schema_score` column
**Historical data:** Stored in `audit_results.content_schema_score` - no GSC dependency

---

### 5. Service Area Pillar ❌ **DOES NOT USE GSC DATA**

**Data Source:** Business Profile API
- **Primary:** Google Business Profile API (service areas count, NAP consistency)
- **Calculation:** 
  - Base score: `min(serviceAreasCount * 12.5, 100)` (8+ areas = 100)
  - Multiplied by NAP consistency score

**When calculated:** At audit time (when you click "Run Audit")
**Stored in DB:** Yes, saved to `audit_results.service_area_score` column
**Historical data:** Stored in `audit_results.service_area_score` - no GSC dependency

---

## Key Takeaways

1. **Visibility and Authority** are the two pillars that **primarily depend on GSC data** and can be calculated from historical GSC timeseries data.

2. **Content/Schema and Service Area** are **independent of GSC data** - they use schema audit results and Business Profile API respectively.

3. **Local Entity** uses GSC data only as a **fallback** when Business Profile API data is unavailable.

4. For historical backfilling:
   - **Visibility:** Can be calculated from `gsc_timeseries.position` or `audit_results.gsc_avg_position`
   - **Authority:** Can be calculated from `gsc_timeseries.position` and `gsc_timeseries.ctr` (simplified version when `topQueries` not available)
   - **Content/Schema, Service Area:** Already stored in database, no calculation needed
   - **Local Entity:** Can use Business Profile historical data OR GSC fallback

