# Data Storage Analysis: What Needs Supabase vs GSC

## Summary

**From Google Search Console (GSC) - Historical data available:**
- ✅ Clicks, Impressions, CTR, Position (daily timeseries)
- ✅ Top Queries (historical)
- ✅ Top Pages (historical)
- ✅ SERP Features breakdown (historical)
- ✅ Visibility Pillar Score (calculated from GSC position data)
- ✅ Authority Pillar Score (calculated from GSC CTR + position data)
- ✅ Local Entity Pillar Score (partially - uses GSC position/CTR, but needs GBP data)
- ✅ Service Area Pillar Score (partially - derived from Local Entity)

**NOT from GSC - Needs Supabase storage for historical tracking:**
- ❌ **Schema Coverage %** (crawled data, changes over time)
- ❌ **Schema Types Found** (which types exist on site)
- ❌ **Missing Schema Pages** (which URLs lack schema)
- ❌ **Rich Result Eligibility** (which schema types are eligible)
- ❌ **Foundation Schema Presence** (Organization, Person, WebSite, BreadcrumbList)
- ❌ **Content/Schema Pillar Score** (calculated from schema data - currently shows flat line)
- ❌ **Local Business Schema Pages** (when GBP API integrated)
- ❌ **NAP Consistency Score** (when GBP API integrated)
- ❌ **Backlink Metrics** (when backlink API integrated)
- ❌ **Entity Extraction Results** (when NLP API integrated)

---

## Detailed Breakdown

### 1. **Content/Schema Pillar** (Currently 100% needs storage)

**Current State:**
- Shows flat line on trend chart (uses current score for all historical points)
- Schema audit is run once per audit (not daily)
- No historical tracking of schema changes

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
  local_entity_score INTEGER,
  service_area_score INTEGER,
  content_schema_score INTEGER,
  snippet_readiness INTEGER,
  
  -- Local Signals (when GBP API integrated)
  local_business_schema_pages INTEGER,
  nap_consistency_score INTEGER,
  knowledge_panel_detected BOOLEAN,
  service_areas JSONB,
  
  -- Backlinks (when backlink API integrated)
  domain_rating INTEGER,
  backlinks_count INTEGER,
  referring_domains INTEGER,
  
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

## Current Workaround

**What works now:**
- Visibility & Authority trends (from GSC timeseries)
- Current Content/Schema score (from schema audit)
- Dashboard persistence (localStorage - single snapshot)

**What doesn't work:**
- Content/Schema historical trends (shows flat line)
- Schema coverage changes over time
- Multi-day comparison of schema improvements

---

## Recommendation

**Start with Supabase for Content/Schema tracking:**
1. After each schema audit, save results to Supabase
2. On dashboard load, fetch last 30/60/90 days of schema data
3. Show real Content/Schema trend line (not flat)
4. Enable "Schema Coverage Over Time" visualization

**This addresses the biggest gap** - Content/Schema pillar showing real historical trends instead of a flat line.

