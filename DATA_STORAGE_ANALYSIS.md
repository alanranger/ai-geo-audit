# Data Storage Analysis: What Needs Supabase vs GSC

## Summary

**From Google Search Console (GSC) - Historical data available:**
- ✅ Clicks, Impressions, CTR, Position (daily timeseries)
- ✅ Top Queries (historical)
- ✅ Top Pages (historical)
- ✅ SERP Features breakdown (historical)
- ✅ Visibility Pillar Score (calculated from GSC position data)
- ✅ Authority Pillar Score (4-component: Behaviour, Ranking, Backlinks, Reviews)
- ✅ Authority Component Scores (behaviour, ranking, backlinks, reviews stored in Supabase)
- ✅ Local Entity Pillar Score (from Google Business Profile API: NAP consistency, knowledge panel, locations)
- ✅ Service Area Pillar Score (from Google Business Profile API: service areas count, NAP multiplier)

**NOT from GSC - Needs Supabase storage for historical tracking:**
- ❌ **Schema Coverage %** (crawled data, changes over time)
- ❌ **Schema Types Found** (which types exist on site)
- ❌ **Missing Schema Pages** (which URLs lack schema)
- ❌ **Rich Result Eligibility** (which schema types are eligible)
- ❌ **Foundation Schema Presence** (Organization, Person, WebSite, BreadcrumbList)
- ❌ **Content/Schema Pillar Score** (calculated from schema data - currently shows flat line)
- ❌ **Local Business Schema Pages** (when GBP API integrated)
- ❌ **NAP Consistency Score** (when GBP API integrated)
- ✅ **Backlink Metrics** (from CSV upload, stored in browser localStorage, used in Authority calculation)
- ❌ **Entity Extraction Results** (when NLP API integrated)

---

## Detailed Breakdown

### 1. **Content/Schema Pillar** (Currently 100% needs storage)

**Current State:**
- ✅ Supabase integration implemented for historical tracking
- ✅ Audit results saved to Supabase after each scan
- ✅ Historical Content/Schema data fetched from Supabase for trend chart
- ⚠️ If Supabase not configured, shows dashed line using current score for all historical points
- ⚠️ Schema audit is run once per audit (not daily) - historical data accumulates over time

**What Needs Storage:**
```javascript
{
  date: "2025-12-05",
  totalPages: 431,
  pagesWithSchema: 419,
  coverage: 97.22,
  schemaTypes: ["Organization", "Article", "Event", ...],
  foundationSchemas: {
    Organization: true,
    Person: false,
    WebSite: true,
    BreadcrumbList: true
  },
  richEligible: {
    Article: true,
    Event: true,
    FAQPage: false,
    ...
  },
  contentSchemaScore: 76
}
```

**Impact:** This is the **biggest gap** - Content/Schema pillar can't show real trends without historical storage.

---

### 2. **Local Entity & Service Area Pillars** (Partially needs storage)

**Current State:**
- Uses derived calculation from GSC position/CTR
- Stub endpoint `/api/aigeo/local-signals` returns placeholder data

**What GSC Provides:**
- Position and CTR (used in current calculation)

**What Needs Storage (when GBP API integrated):**
```javascript
{
  date: "2025-12-05",
  localBusinessSchemaPages: 15,
  napConsistencyScore: 95,
  knowledgePanelDetected: true,
  serviceAreas: ["UK", "England", "Suffolk"],
  localEntityScore: 60,
  serviceAreaScore: 55
}
```

**Impact:** Currently works with derived data, but will need storage once GBP API is integrated.

---

### 3. **Visibility & Authority Pillars** (100% from GSC)

**Current State:**
- ✅ Fully calculated from GSC timeseries data
- ✅ Historical data available from GSC API
- ✅ Trend chart shows real historical trends

**What GSC Provides:**
- Daily position, clicks, impressions, CTR
- Can query any historical date range

**Impact:** **No storage needed** - GSC has all historical data.

---

### 4. **Future Integrations** (Will need storage)

#### Backlink Metrics (when implemented)
```javascript
{
  date: "2025-12-05",
  domainRating: 45,
  backlinks: 1234,
  referringDomains: 89,
  authorityScore: 35
}
```

#### Entity Extraction (when implemented)
```javascript
{
  date: "2025-12-05",
  entities: [
    { name: "Photography", salience: 0.85, type: "CONCEPT" },
    { name: "Workshop", salience: 0.72, type: "EVENT" },
    ...
  ],
  topicModeling: {...}
}
```

---

## Recommended Supabase Schema

### Table: `audit_results`

```sql
CREATE TABLE audit_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_url TEXT NOT NULL,
  audit_date DATE NOT NULL,
  
  -- GSC Data (for reference, but can be fetched from GSC API)
  gsc_clicks INTEGER,
  gsc_impressions INTEGER,
  gsc_avg_position DECIMAL(5,2),
  gsc_ctr DECIMAL(5,2),
  
  -- Schema Audit Data (NEEDS STORAGE)
  schema_total_pages INTEGER,
  schema_pages_with_schema INTEGER,
  schema_coverage DECIMAL(5,2),
  schema_types JSONB, -- Array of schema type strings
  schema_foundation JSONB, -- {Organization: true, Person: false, ...}
  schema_rich_eligible JSONB, -- {Article: true, Event: true, ...}
  schema_missing_pages JSONB, -- Array of URLs without schema
  
  -- Pillar Scores (calculated)
  visibility_score INTEGER,
  authority_score INTEGER,
  authority_behaviour_score INTEGER,  -- Authority component scores
  authority_ranking_score INTEGER,
  authority_backlink_score INTEGER,
  authority_review_score INTEGER,
  local_entity_score INTEGER,
  service_area_score INTEGER,
  content_schema_score INTEGER,
  snippet_readiness INTEGER,
  
  -- Local Signals (IMPLEMENTED - Google Business Profile API)
  local_business_schema_pages INTEGER,
  nap_consistency_score INTEGER,
  knowledge_panel_detected BOOLEAN,
  service_areas JSONB,
  
  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  -- Unique constraint: one audit per property per day
  UNIQUE(property_url, audit_date)
);

-- Index for fast historical queries
CREATE INDEX idx_audit_results_property_date ON audit_results(property_url, audit_date DESC);
```

---

## Implementation Priority

### Phase 1: Content/Schema Historical Tracking (HIGH PRIORITY)
- **Why:** Currently shows flat line, user can't see schema improvements over time
- **Impact:** High - this is a major gap in the dashboard
- **Effort:** Medium - need to store schema audit results after each scan

### Phase 2: Local Signals Storage (MEDIUM PRIORITY)
- **Why:** Will be needed when GBP API is integrated
- **Impact:** Medium - currently using derived data
- **Effort:** Low - can add columns when GBP API is ready

### Phase 3: Backlink & Entity Storage (LOW PRIORITY)
- **Why:** Future integrations
- **Impact:** Low - not yet implemented
- **Effort:** Low - can add when APIs are integrated

---

## Current Implementation

**What works now:**
- ✅ Visibility trends (from GSC timeseries)
- ✅ Authority trends (from Supabase stored scores, or simplified calculation for historical dates)
- ✅ Authority component scores stored in Supabase (behaviour, ranking, backlinks, reviews)
- ✅ Current Content/Schema score (from schema audit)
- ✅ Dashboard persistence (localStorage - last audit snapshot)
- ✅ Historical Content/Schema tracking (Supabase - if configured)
- ✅ Historical Authority tracking (Supabase - if configured)
- ✅ Trend chart shows real historical Content/Schema and Authority data when available
- ✅ Trend chart uses full Authority calculation for today's date, simplified for historical dates
- ⚠️ If Supabase not configured, trend chart shows simplified Authority calculation for historical dates

**What's improved:**
- ✅ Content/Schema historical trends (real data from Supabase)
- ✅ Schema coverage changes over time (tracked in Supabase)
- ✅ Multi-day comparison of schema improvements (via Supabase queries)

---

## Implementation Status

**✅ Supabase for Content/Schema and Authority tracking is implemented:**
1. ✅ After each audit, results are saved to Supabase (via `/api/supabase/save-audit`)
   - Includes Content/Schema data (coverage, types, rich eligibility)
   - Includes Authority score and component scores (behaviour, ranking, backlinks, reviews)
   - Includes Local Entity and Service Area scores (from GBP API)
2. ✅ On dashboard load, historical data is fetched from Supabase (via `/api/supabase/get-audit-history`)
   - Content/Schema scores for trend chart
   - Authority scores for trend chart
   - Local Entity and Service Area scores for trend chart
3. ✅ Trend chart shows real historical data:
   - Content/Schema: solid line for dates with data, null for dates without
   - Authority: uses stored scores from Supabase, or simplified calculation for historical dates
   - Today's date uses full Authority calculation with topQueries, backlinks, and reviews
   - Historical dates use simplified calculation or stored scores
4. ✅ Historical schema coverage and Authority component changes are tracked in Supabase

**Configuration Required:**
- Set `SUPABASE_URL` environment variable in Vercel
- Set `SUPABASE_SERVICE_ROLE_KEY` environment variable in Vercel
- If not configured, the system gracefully falls back to simplified calculations for historical dates

**This addresses the major gaps** - Content/Schema and Authority pillars now show real historical trends when Supabase is configured.

