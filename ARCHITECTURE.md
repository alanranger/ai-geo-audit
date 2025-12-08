# AI GEO Audit - Architecture & Data Flow Overview

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    CLIENT (Browser)                          │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         audit-dashboard.html (Single Page App)       │   │
│  │  - UI Components (Charts, Metrics Cards, Forms)      │   │
│  │  - Client-side Calculations (Pillar Scores)         │   │
│  │  - Chart.js for Visualizations                      │   │
│  └──────────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────────┘
                        │ HTTP Requests
                        │
┌───────────────────────▼─────────────────────────────────────┐
│              VERCEL SERVERLESS FUNCTIONS                      │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  /api/aigeo/gsc-entity-metrics                       │   │
│  │  /api/fetch-search-console (legacy)                  │   │
│  │  /api/schema-audit                                    │   │
│  │  /api/aigeo/serp-features                            │   │
│  │  /api/aigeo/schema-coverage                          │   │
│  │  /api/aigeo/local-signals (STUB)                     │   │
│  │  /api/aigeo/backlink-metrics (STUB)                  │   │
│  │  /api/aigeo/entity-extract (STUB)                    │   │
│  └──────────────────────────────────────────────────────┘   │
└───────────────────────┬─────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┬───────────────┐
        │               │               │               │
┌───────▼──────┐ ┌─────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
│ Google Search│ │  GitHub    │ │  External   │ │  Vercel     │
│   Console    │ │  CSV Repo  │ │   Sites     │ │  Env Vars   │
│    API       │ │            │ │  (Crawling) │ │  (OAuth2)   │
│  (OAuth2)    │ │            │ │             │ │             │
└──────────────┘ └────────────┘ └─────────────┘ └─────────────┘
```

### Technology Stack

- **Frontend**: Vanilla JavaScript, HTML5, CSS3, Chart.js (CDN)
- **Backend**: Vercel Serverless Functions (Node.js)
- **Authentication**: OAuth2 (Google Search Console)
- **Data Storage**: 
  - Browser localStorage (for UI preferences)
  - Vercel Environment Variables (for OAuth2 credentials)
  - GitHub-hosted CSV (for site URLs)
- **Deployment**: Vercel (with automatic GitHub integration)

---

## Data Flow

### Audit Execution Flow

```
1. USER INPUT
   └─> Property URL (e.g., "https://alanranger.com")
   └─> Date Range (30/60/90/120/180 days)

2. CLIENT-SIDE INITIALIZATION
   └─> Check for API key (Vercel env var → config.js → localStorage)
   └─> Validate property URL
   └─> Show loading indicator

3. PARALLEL API CALLS
   │
   ├─> GSC Data Fetch
   │   └─> GET /api/aigeo/gsc-entity-metrics?property=...&startDate=...&endDate=...
   │       └─> Serverless function authenticates with OAuth2
   │       └─> Calls Google Search Console API
   │       └─> Returns: overview, timeseries, topQueries, topPages, searchAppearance
   │
   └─> Schema Audit
       └─> GET /api/schema-audit (or POST with manual URL list)
           └─> Fetches CSV from GitHub (or uses manual URLs)
           └─> Crawls each URL for JSON-LD schema
           └─> Checks for inherited schema from parent pages
           └─> Returns: coverage %, schema types, missing pages

4. CLIENT-SIDE CALCULATIONS
   └─> calculatePillarScores(GSC data, schema audit, localSignals, siteReviews, backlinkMetrics)
       ├─> Visibility Score: Based on average position (1-40 → 100-10)
       ├─> Authority Score: 4-component model
       │   ├─> Behaviour (40%): CTR for ranking queries + top-10 CTR
       │   ├─> Ranking (20%): Average position + top-10 impression share
       │   ├─> Backlinks (20%): Referring domains + follow ratio
       │   └─> Reviews (20%): Combined GBP and on-site ratings/counts
       ├─> Local Entity Score: NAP consistency + knowledge panel + locations (from GBP API)
       ├─> Service Area Score: Service areas count + NAP multiplier (from GBP API)
       ├─> Content/Schema Score: (Foundation × 30%) + (Rich Results × 35%) + (Coverage × 20%) + (Diversity × 15%)
       ├─> Brand Overlay (overlay metric, does not affect AI GEO score):
       │   ├─> Brand Query Classification: isBrandQuery() filters queries by brand terms
       │   ├─> Brand Metrics: calculateBrandMetrics() computes share, CTR, avg position
       │   └─> Brand Overlay Score: computeBrandOverlay() combines brand search (40%), reviews (30%), entity (30%)
       └─> AI Summary Likelihood (overlay metric):
           └─> computeAiSummaryLikelihood() combines snippet readiness (50%), visibility (30%), brand (20%)

5. UI RENDERING
   └─> displayDashboard(scores, data, snippetReadiness, schemaAudit)
       ├─> Render Site AI Health Dashboard
       │   ├─> Calculate AI GEO Score (weighted average of 5 pillars)
       │   ├─> Calculate AI Summary Likelihood (high/medium/low)
       │   ├─> Render Speedometer Gauge (SVG-based circular progress ring)
       │   │   ├─> Color segments: Red (0-50%), Amber (50-70%), Green (70-100%)
       │   │   ├─> Needle indicator pointing to current score
       │   │   ├─> Tick marks for current score and AI threshold (55)
       │   │   └─> Labels: 50%, 100%, current score, AI threshold
       │   └─> Display status badge and AI summary likelihood
       ├─> Update 5 Pillar Score Cards
       ├─> Render Radar Chart (5 pillars)
       ├─> Render Trend Chart (timeseries data)
       ├─> Render Metrics Cards (clicks, impressions, CTR, position)
       ├─> Render Recommended Actions Table (segment-aware recommendations)
       ├─> Render Top Queries Table
       └─> Show Completion Modal (with schema audit summary)

6. COMPLETION
   └─> Hide loading indicator
   └─> Show completion modal with audit summary
```

---

## API Endpoints

### ✅ Fully Implemented (Real Data)

#### 1. `/api/aigeo/gsc-entity-metrics` (GET)
**Purpose**: Comprehensive Google Search Console data aggregation

**Parameters**:
- `property` (required): Property URL
- `startDate` (optional): YYYY-MM-DD (defaults to 30 days ago)
- `endDate` (optional): YYYY-MM-DD (defaults to today)

**Returns**:
```json
{
  "status": "ok",
  "data": {
    "overview": {
      "totalClicks": 1234,
      "totalImpressions": 56789,
      "avgPosition": 12.5,
      "ctr": 2.17
    },
    "timeseries": [...],  // Daily data points
    "topQueries": [...],  // Top 100 queries
    "topPages": [...],    // Top 100 pages
    "searchAppearance": [...] // SERP feature breakdown
  }
}
```

**Data Source**: ✅ **REAL** - Google Search Console API (OAuth2)

---

#### 2. `/api/schema-audit` (GET or POST)
**Purpose**: Scan URLs for JSON-LD schema markup coverage

**GET Request**: Fetches URLs from GitHub CSV
**POST Request**: Accepts manual URL list in body: `{ "urls": ["https://...", ...] }`

**Returns**:
```json
{
  "status": "ok",
  "data": {
    "totalPages": 150,
    "pagesWithSchema": 120,
    "pagesWithInheritedSchema": 15,
    "coverage": 80.0,
    "schemaTypes": [...],
    "missingSchemaPages": [...],
    "richEligible": {...}
  },
  "meta": {
    "diagnostic": {
      "successfulPages": 145,
      "failedPages": 5,
      "errorTypes": {...}
    }
  }
}
```

**Data Source**: ✅ **REAL** - Crawls actual website pages, extracts JSON-LD

**Features**:
- Inherited schema detection (checks parent collection pages)
- Error categorization (timeout, HTTP errors, DNS errors, etc.)
- Retry logic for failed crawls
- Concurrency control (4 concurrent requests)

---

#### 3. `/api/aigeo/serp-features` (GET)
**Purpose**: SERP feature breakdown from GSC searchAppearance dimension

**Parameters**: Same as `gsc-entity-metrics`

**Returns**:
```json
{
  "status": "ok",
  "data": {
    "totalImpressions": 56789,
    "totalClicks": 1234,
    "appearances": [
      {
        "key": "web_results",
        "label": "Web Results",
        "impressions": 50000,
        "clicks": 1000,
        "ctr": 2.0,
        "shareOfTotalImpressions": 88.0
      },
      ...
    ]
  }
}
```

**Data Source**: ✅ **REAL** - Google Search Console API

---

#### 4. `/api/aigeo/schema-coverage` (GET)
**Purpose**: Basic schema coverage for specified URLs

**Parameters**:
- `property` (required)
- `urls` (optional): Comma-separated URL list

**Returns**: Similar to schema-audit but simpler (no inheritance checking)

**Data Source**: ✅ **REAL** - Crawls actual pages

---

#### 5. `/api/fetch-search-console` (POST) - **LEGACY**
**Purpose**: Legacy endpoint, still functional but superseded by `gsc-entity-metrics`

**Data Source**: ✅ **REAL** - Google Search Console API

---

#### 6. `/api/supabase/save-audit` (POST)
**Purpose**: Save audit results to Supabase for historical tracking

**Body**:
```json
{
  "propertyUrl": "https://alanranger.com",
  "auditDate": "2025-12-05",
  "scores": { "visibility": 80, "authority": 35, ... },
  "schemaAudit": { "data": { ... } },
  "gscData": { "totalClicks": 6897, ... }
}
```

**Returns**:
```json
{
  "status": "ok",
  "message": "Audit results saved to Supabase",
  "data": [...]
}
```

**Data Source**: ✅ **REAL** - Stores actual audit results in Supabase database

**Note**: Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment variables. If not configured, returns `status: "skipped"`.

---

#### 7. `/api/supabase/get-audit-history` (GET)
**Purpose**: Fetch historical audit data for all pillars from Supabase

**Parameters**:
- `propertyUrl` (required)
- `startDate` (required): YYYY-MM-DD
- `endDate` (required): YYYY-MM-DD

**Returns**:
```json
{
  "status": "ok",
  "data": [
    { "date": "2025-12-01", "contentSchemaScore": 75 },
    { "date": "2025-12-02", "contentSchemaScore": 76 },
    ...
  ]
}
```

**Data Source**: ✅ **REAL** - Retrieves historical data from Supabase database

**Note**: Returns historical data for all pillars including Brand overlay and AI summary scores. If Supabase is not configured, returns `status: "skipped"`.

---

#### 8. `/api/supabase/create-shared-audit` (POST)
**Purpose**: Create a shareable audit link for public viewing

**Body**:
```json
{
  "auditData": { /* Full audit JSON object */ }
}
```

**Returns**:
```json
{
  "status": "ok",
  "shareId": "abc123xyz456",
  "shareUrl": "https://ai-geo-audit.vercel.app/audit-dashboard.html?share=abc123xyz456",
  "expiresAt": "2026-01-08T00:00:00Z"
}
```

**Data Source**: ✅ **REAL** - Stores audit data in Supabase `shared_audits` table

**Note**: Links expire after 30 days. Shareable links allow viewing complete audit results without running an audit.

---

#### 9. `/api/supabase/get-shared-audit` (GET)
**Purpose**: Retrieve shared audit data by share ID

**Parameters**:
- `shareId` (required): 12-character shareable ID

**Returns**:
```json
{
  "status": "ok",
  "data": { /* Full audit JSON object */ },
  "shareId": "abc123xyz456",
  "createdAt": "2025-12-08T00:00:00Z",
  "expiresAt": "2026-01-08T00:00:00Z"
}
```

**Data Source**: ✅ **REAL** - Retrieves from Supabase `shared_audits` table

**Note**: Returns 404 if share ID not found or expired. Dashboard automatically loads shared audit when `?share=ID` parameter is present in URL.

---

### ⚠️ Stubs (Placeholder Data)

#### 8. `/api/aigeo/local-signals` (GET)
**Status**: ✅ **IMPLEMENTED** - Returns real Google Business Profile data

**Returns**:
```json
{
  "status": "ok",
  "data": {
    "localBusinessSchemaPages": 892,
    "napConsistencyScore": 100,
    "knowledgePanelDetected": true,
    "serviceAreas": [
      { "name": "UK", "type": "COUNTRY" },
      { "name": "England", "type": "ADMINISTRATIVE_AREA" },
      ...
    ],
    "locations": [...],
    "gbpRating": 4.81,
    "gbpReviewCount": 221
  }
}
```

**Data Source**: ✅ **REAL** - Google Business Profile API (OAuth2)
- Fetches location details, service areas, NAP data
- Attempts to fetch reviews from Reviews API endpoint
- Falls back to static JSON file (`data/gbp-reviews.json`) if API unavailable

---

#### 9. `/api/aigeo/backlink-metrics` (GET/POST)
**Status**: ✅ **IMPLEMENTED** - Accepts CSV upload and computes metrics

**GET**: Returns default empty metrics (Vercel has read-only filesystem)

**POST**: Accepts CSV body (as JSON `{csv: "..."}` or raw `text/csv`)
- Parses CSV with custom parser (handles multi-line quoted fields)
- Extracts URLs from "Linking Page + URL" column
- Extracts link types from "Link Type" column
- Computes metrics: referring domains, total backlinks, follow ratio

**Returns**:
```json
{
  "status": "ok",
  "data": {
    "referringDomains": 356,
    "totalBacklinks": 1234,
    "followRatio": 0.567,
    "generatedAt": "2025-12-07T13:56:00.000Z"
  }
}
```

**Data Source**: ✅ **REAL** - CSV upload from user (stored in browser localStorage)
- Client-side stores computed metrics in localStorage
- Metrics are used in Authority score calculation

---

#### 10. `/api/aigeo/entity-extract` (POST)
**Status**: ⚠️ **STUB** - Returns static sample data

**Returns**:
```json
{
  "data": {
    "entities": [
      { "name": "Alan Ranger", "type": "Person", "salience": 0.95 }
    ],
    "keywords": ["landscape photography", "workshops"],
    "notes": "Entity extraction not yet implemented. This is static sample output."
  }
}
```

**Future Implementation**:
- Google Cloud Natural Language API
- Topic modeling
- Keyword extraction
- Salience scoring

---

## Calculations

### 5 Pillar Scores

All scores are calculated client-side in `calculatePillarScores()` function.

#### 1. **Visibility Score** (0-100)
**Formula**: Based on average position from GSC
```javascript
position = averagePosition (1 = best, 40 = worst)
clampedPos = Math.max(1, Math.min(40, position))
scale = (clampedPos - 1) / 39  // 0 to 1
visibility = 100 - scale * 90  // 100 to 10
```

**Data Source**: ✅ **REAL** - GSC `avgPosition`

---

#### 2. **Authority Score** (0-100)
**Formula**: 4-component weighted model
```javascript
// Component 1: Behaviour Score (40%)
// Uses queries with position ≤ 20
ctrAll = totalClicks / totalImpressions (for ranking queries)
ctrTop10 = top10Clicks / top10Impressions (for position ≤ 10)
ctrScoreAll = normalisePct(ctrAll, 0.05)  // 0-5% → 0-100
ctrScoreTop10 = normalisePct(ctrTop10, 0.10)  // 0-10% → 0-100
behaviourScore = 0.5 * ctrScoreAll + 0.5 * ctrScoreTop10

// Component 2: Ranking Score (20%)
avgPos = impression-weighted average position (for position ≤ 20)
posScore = normalisePosition(avgPos, 1, 20)  // 1 → 100, 20 → 0
top10Share = % of impressions where position ≤ 10
top10Score = top10Share * 100
rankingScore = 0.5 * posScore + 0.5 * top10Score

// Component 3: Backlink Score (20%)
rdScore = min(referringDomains / 100, 1) * 100  // 100+ domains = 100
followScore = clamp(followRatio, 0, 1) * 100
backlinkScore = 0.7 * rdScore + 0.3 * followScore

// Component 4: Review Score (20%)
// GBP: ratingScore = (gbpRating / 5) * 100, countScore = min(gbpCount / 500, 1) * 100
// Site: ratingScore = (siteRating / 5) * 100, countScore = min(siteCount / 500, 1) * 100
// gbpScore = 0.6 * gbpRatingScore + 0.4 * gbpCountScore
// siteScore = 0.6 * siteRatingScore + 0.4 * siteCountScore
// reviewScore = 0.6 * gbpScore + 0.4 * siteScore (if both exist)

// Final Authority Score
authority = 0.4 * behaviourScore + 0.2 * rankingScore + 0.2 * backlinkScore + 0.2 * reviewScore
```

**Data Source**: ✅ **REAL** - GSC `topQueries` (for Behaviour & Ranking), Backlink CSV upload (for Backlinks), GBP API + site-reviews.json (for Reviews)

---

#### 3. **Local Entity Score** (0-100)
**Formula**: NAP consistency + bonuses
```javascript
if (localSignals available) {
  baseScore = napConsistencyScore || 0
  if (knowledgePanelDetected) baseScore = min(100, baseScore + 10)
  if (locations.length > 0) baseScore = min(100, baseScore + 5)
  localEntity = clampScore(baseScore)
} else {
  // Fallback: derived from GSC
  localEntity = 60 + 0.3 * (posScore - 50) + 0.2 * (ctrScore - 50)
}
```

**Data Source**: ✅ **REAL** - Google Business Profile API (NAP consistency, knowledge panel, locations)

---

#### 4. **Service Area Score** (0-100)
**Formula**: Service areas count + NAP multiplier
```javascript
if (localSignals available) {
  serviceAreasCount = serviceAreas.length
  if (serviceAreasCount === 0) serviceArea = 0
  else if (serviceAreasCount >= 8) serviceArea = 100
  else serviceArea = min(100, serviceAreasCount * 12.5)  // Linear: 1 = 12.5, 8 = 100
  // Apply NAP consistency multiplier
  if (napConsistencyScore < 100) {
    serviceArea = round(serviceArea * (napConsistencyScore / 100))
  }
} else {
  // Fallback: derived from Local Entity
  serviceArea = localEntity - 5
}
```

**Data Source**: ✅ **REAL** - Google Business Profile API (service areas, NAP consistency)

---

#### 5. **Content/Schema Score** (0-100)
**Formula**: Weighted calculation based on four components
```javascript
// 1. Foundation Schemas (30%): Organization, Person, WebSite, BreadcrumbList
foundationScore = (foundationPresent / 4) * 100

// 2. Rich Result Eligibility (35%): Article, Event, FAQPage, Product, LocalBusiness, Course, Review, HowTo, VideoObject, ImageObject, ItemList
richResultScore = (richEligibleCount / 11) * 100

// 3. Coverage (20%): Pages with schema / total pages
coverageScore = coverage percentage

// 4. Type Diversity (15%): Number of unique schema types (normalized to 15 types)
diversityScore = min((uniqueTypesCount / 15) * 100, 100)

// Final score
contentSchema = (foundationScore * 0.30) + (richResultScore * 0.35) + (coverageScore * 0.20) + (diversityScore * 0.15)
```

**Data Source**: ✅ **REAL** - Schema audit data (foundation schemas, rich result eligibility, coverage, type diversity)

---

### Snippet Readiness Score (0-100)

**Formula**: Weighted average of three pillars
```javascript
snippetReadiness = 
  (contentSchema * 0.4) + 
  (visibility * 0.35) + 
  (authority * 0.25)
```

**Data Source**: ✅ **REAL** - Calculated from real pillar scores

---

### RAG Status (Red/Amber/Green)

**Thresholds**:
- **Green**: Score ≥ 70
- **Amber**: Score ≥ 40 and < 70
- **Red**: Score < 40

Applied to all 5 pillar scores and snippet readiness.

---

## UI Components

### Main Dashboard (`audit-dashboard.html`)

#### 1. **Configuration Panel**
- Property URL input
- Date range selector (30/60/90/120/180 days)
- "Run Audit Scan" button
- Status messages (success/error/info)

#### 2. **5 Pillar Score Cards**
- Local Entity (with RAG indicator)
- Service Area (with RAG indicator)
- Authority (with RAG indicator)
- Visibility (with RAG indicator)
- Content/Schema (with RAG indicator)

#### 3. **Radar Chart** (Chart.js)
- Visual representation of 5 pillar scores
- RAG color-coded score labels displayed at each data point (red/amber/green)
- Timestamp showing current data date and time (not historical)
- Custom Chart.js plugin for score label rendering

#### 4. **Trend Chart** (Chart.js)
- Timeseries line chart
- Shows clicks, impressions, CTR, position over time
- Content/Schema score shown as dashed line (uses current score for historical points until Supabase data is available)
- **Data Source**: ✅ **REAL** - GSC timeseries data for Visibility/Authority; Supabase for Content/Schema historical data

#### 5. **Metrics Cards**
- Total Clicks
- Total Impressions
- Average CTR
- Average Position
- **Data Source**: ✅ **REAL** - GSC overview data

#### 6. **Top Queries Table**
- Top 10 queries with clicks, impressions, CTR, position
- **Data Source**: ✅ **REAL** - GSC topQueries data

#### 7. **Snippet Readiness Gauge** (Chart.js Doughnut)
- Nested doughnut chart showing weighted breakdown of snippet readiness
- Outer ring displays three segments with weight percentages (Content/Schema 40%, Visibility 35%, Authority 25%)
- Inner ring shows actual pillar scores as "fuel gauge" fills within each segment
- Color-coded by RAG status (green/amber/red) for each score
- Overall snippet readiness score and status displayed prominently
- Detailed legend showing weight, score, RAG status, and contribution points for each component
- Explanation box for Content/Schema score breakdown (Foundation, Rich Results, Coverage, Diversity)
- Timestamp showing current data date and time (not historical)
- Custom Chart.js plugin for segment labels, arrows, and score indicators

#### 8. **Completion Modal**
- Shows schema audit summary
- Displays crawl success/failure counts
- Lists pages without schema
- Error breakdown by type
- "Retry Failed URLs" button to rescan only failed URLs

#### 9. **Retry Failed URLs Button**
- Appears in URL load section (outside modal) when failed URLs exist
- Allows rescanning only failed/missing URLs without running full audit
- Merges new results with existing audit data
- Updates dashboard and saves to localStorage

#### 10. **Debug Log Panel** (Collapsible)
- Real-time logging of audit process
- Color-coded messages (info/success/warning/error)
- Scrollable log history

---

## Real Data vs Mock Data

### ✅ **REAL DATA** (Live from APIs)

1. **Google Search Console Metrics**
   - Total clicks, impressions, CTR, average position
   - Timeseries data (daily breakdown)
   - Top queries and pages
   - SERP feature appearances
   - **Source**: Google Search Console API (OAuth2)

2. **Schema Coverage**
   - Pages with/without JSON-LD schema
   - Schema type inventory
   - Inherited schema detection
   - Missing schema pages list
   - **Source**: Actual website crawling

3. **Pillar Scores**
   - Visibility: ✅ Real (from GSC position)
   - Authority: ✅ Real (4-component: Behaviour from GSC topQueries, Ranking from GSC topQueries, Backlinks from CSV upload, Reviews from GBP API + site-reviews.json)
   - Content/Schema: ✅ Real (from schema audit: foundation schemas, rich results, coverage, diversity)
   - Local Entity: ✅ Real (from Google Business Profile API: NAP consistency, knowledge panel, locations)
   - Service Area: ✅ Real (from Google Business Profile API: service areas count, NAP multiplier)

4. **Snippet Readiness**
   - ✅ Real (calculated from real pillar scores)

---

### ⚠️ **MOCK/PLACEHOLDER DATA**

1. **Entity Extraction**
   - Entities: **Static sample data** (stub)
   - Keywords: **Static sample data** (stub)

---

## Remaining Steps for Full Automation

### Phase 1: Complete Data Integration

#### 1.1 Local Signals API Implementation
- [ ] Integrate Google Business Profile API
- [ ] Implement LocalBusiness schema scanning
- [ ] Build NAP consistency checker
- [ ] Add knowledge panel detection
- [ ] Update Local Entity pillar to use real local signals

**Impact**: Local Entity and Service Area scores will use real data instead of derived calculations.

---

#### 1.2 Backlink Metrics API Implementation
- [ ] Choose backlink provider (Ahrefs/Semrush/Moz)
- [ ] Implement API integration
- [ ] Calculate domain rating
- [ ] Update Authority pillar to incorporate backlink data

**Impact**: Authority score will include real backlink metrics.

---

#### 1.3 Entity Extraction Implementation
- [ ] Integrate Google Cloud Natural Language API
- [ ] Implement entity extraction from page content
- [ ] Add topic modeling
- [ ] Calculate salience scores

**Impact**: Better entity recognition and content analysis.

---

### Phase 2: Automation & Scheduling

#### 2.1 Automated Scheduling
- [ ] Set up Vercel Cron Jobs (or external scheduler)
- [ ] Configure daily/weekly audit runs
- [ ] Store historical data (database or file storage)
- [ ] Send email notifications on score changes

**Current State**: 
- Manual trigger only (user clicks "Run Audit Scan")
- ✅ Dashboard persistence via localStorage (last audit results load automatically)
- ✅ Retry failed URLs functionality (rescan only failed URLs without full audit)

---

#### 2.2 Data Persistence
- [ ] Choose storage solution (Vercel KV, Supabase, or file-based)
- [ ] Store historical audit results
- [ ] Track score trends over time
- [ ] Build comparison views (this week vs last week)
- [ ] **Historical Schema Coverage Tracking**: Implement Supabase database with cron job to track schema coverage changes over time. This will enable real Content/Schema trend lines showing actual historical schema changes (currently shows flat line because schema audit is only run once per audit, not historically).

**Current State**: 
- ✅ **Supabase integration**: Historical tracking for ALL pillars (not just Content/Schema)
  - `audit_results` table stores: all pillar scores, Authority component scores, Brand overlay, AI summary
  - Segmented Authority data (All pages, Exclude education, Money pages) stored as JSON
  - Brand overlay and AI summary scores stored for trend tracking
- ✅ **Historical data retrieval**: 
  - All pillars fetch historical data from Supabase for trend charts
  - Brand & Entity uses fallback calculation from GSC timeseries when stored data unavailable
  - Trend charts show real historical data, not just current score
- ✅ **Shareable audit links**: 
  - `shared_audits` table stores full audit JSON with unique share_id
  - 30-day expiration for shared links
  - Public access via `?share=ID` URL parameter
- ✅ **Data storage**: 
  - Audit results saved after each scan with complete data
  - Historical tracking enables trend analysis over time
  - Fallback calculations ensure charts always show data

---

#### 2.3 Multi-Property Support
- [ ] Allow multiple property URLs
- [ ] Store property configurations
- [ ] Batch audit execution
- [ ] Property comparison dashboard

**Current State**: Single property per audit

---

### Phase 3: Enhanced Features

#### 3.1 Advanced Analytics
- [ ] Score trend analysis
- [ ] Anomaly detection (sudden drops)
- [ ] Competitor comparison
- [ ] Predictive scoring

---

#### 3.2 Reporting
- [ ] PDF report generation
- [ ] Email reports
- [ ] Scheduled report delivery
- [ ] Customizable report templates

---

#### 3.3 Alerts & Notifications
- [ ] Score threshold alerts
- [ ] Schema coverage warnings
- [ ] GSC data anomalies
- [ ] Integration with Slack/Discord/Email

---

### Phase 4: UI/UX Improvements

#### 4.1 Dashboard Enhancements
- [ ] Historical trend visualization
- [ ] Score comparison charts
- [ ] Export functionality (CSV/JSON)
- [ ] Dark mode

---

#### 4.2 Performance Optimization
- [ ] Cache GSC data (reduce API calls)
- [ ] Optimize schema crawling (parallel processing)
- [ ] Lazy loading for large datasets
- [ ] Progressive data loading

---

## Current Limitations

1. **Partial Data Persistence**: Content/Schema historical tracking via Supabase (optional), other pillars use GSC timeseries
2. **Manual Trigger Only**: No automated scheduling
3. **Single Property**: One property per audit session
4. **Limited Local Signals**: Local Entity/Service Area use derived calculations (GBP API not integrated)
5. **No Backlink Data**: Authority score doesn't include backlink metrics
6. **No Entity Extraction**: Content analysis is limited to schema markup
7. **Error Recovery**: ✅ Retry failed URLs functionality implemented
8. **No Multi-User Support**: No authentication or user management

---

## Security Considerations

1. **OAuth2 Credentials**: Stored in Vercel environment variables (secure)
2. **No Client-Side Secrets**: All API calls go through serverless functions
3. **CORS**: Configured for cross-origin requests
4. **Rate Limiting**: Not implemented (could hit GSC API limits)
5. **Input Validation**: Basic validation on property URLs

---

## Performance Characteristics

- **GSC API Calls**: ~5-6 requests per audit (overview, timeseries, queries, pages, appearance)
- **Schema Crawling**: 4 concurrent requests, 150ms delay between requests
- **Retry Logic**: Failed crawls retried with 1.5s delay, 2 concurrent
- **Vercel Timeout**: 10 seconds per function (may need optimization for large URL lists)
- **Client-Side Processing**: All calculations done in browser (fast, no server load)

---

## Dependencies

### External APIs
- Google Search Console API (OAuth2)
- GitHub (for CSV hosting)
- Target websites (for schema crawling)
- Supabase (optional - for historical Content/Schema data storage)

### Libraries
- Chart.js (via CDN) - Chart rendering
- SVG (for speedometer gauge rendering)
- Vanilla JavaScript - No framework dependencies

### UI Components

#### Site AI Health Dashboard
- **Location**: Top of dashboard, above pillar cards
- **Components**:
  - Speedometer-style circular gauge (SVG-based, 30% larger)
  - Color-coded segments: Red (0-49), Amber (50-69), Green (70-100)
  - Multiple needle indicators: AI GEO Score (thick solid), AI Summary Likelihood (medium solid), Brand & Entity (medium dashed)
  - Tick marks and labels for all three metrics
  - RAG status pills with detailed breakdown boxes (not just tooltips)
  - Standardized pill and box sizing for alignment
  - Status badge: RAG-based (Green/Amber/Red)
  - AI Summary Likelihood indicator: High (≥70), Medium (50-69), Low (<50)
  - Brand & Entity chip: Strong (≥70), Developing (40-69), Weak (<40)
- **Score Calculation**: 
  - **AI GEO Score**: Weighted average of 5 core pillars (Authority 30%, Content/Schema 25%, Visibility 20%, Local Entity 15%, Service Area 10%)
  - **AI Summary Likelihood**: Snippet Readiness (50%) + Visibility (30%) + Brand Score (20%)
  - **Brand Overlay**: Brand Search (40%) + Reviews (30%) + Entity (30%) - overlay metric, does not affect AI GEO score

### Infrastructure
- Vercel - Hosting and serverless functions
- Browser localStorage - UI preferences and last audit results persistence
- Supabase (optional) - Historical Content/Schema data storage

---

## File Structure

```
AI GEO Audit/
├── audit-dashboard.html          # Main UI (single file app)
├── index.html                     # Redirect to audit-dashboard.html
├── vercel.json                    # Vercel configuration
├── package.json                   # Dependencies
├── config.example.js             # API key template
├── api/
│   ├── fetch-search-console.js    # Legacy GSC endpoint
│   ├── schema-audit.js            # Schema crawling endpoint
│   ├── get-api-key.js             # API key helper
│   ├── sync-csv.js                # CSV sync helper
│   └── aigeo/
│       ├── gsc-entity-metrics.js  # Main GSC endpoint
│       ├── serp-features.js       # SERP feature breakdown
│       ├── schema-coverage.js      # Basic schema scanner
│       ├── local-signals.js        # STUB: Local signals
│       ├── backlink-metrics.js     # STUB: Backlinks
│       ├── entity-extract.js       # STUB: Entity extraction
│       └── utils.js                # Shared utilities
│   └── supabase/
│       ├── save-audit.js           # Save audit results to Supabase (includes brand_overlay, ai_summary)
│       ├── get-audit-history.js    # Fetch historical audit data for all pillars
│       ├── create-shared-audit.js  # Create shareable audit link
│       └── get-shared-audit.js     # Retrieve shared audit by ID
└── scripts/
    └── sync-site-urls.js          # CSV sync script
```

---

## Summary

**Current State**: 
- ✅ **Fully Implemented**: All core features production-ready
- ✅ **5 Core Pillars** with real data sources:
  - **Authority** (30%): 4-component model (Behaviour 40%, Ranking 20%, Backlinks 20%, Reviews 20%)
  - **Content/Schema** (25%): Schema audit (Foundation 30%, Rich Results 35%, Coverage 20%, Diversity 15%)
  - **Visibility** (20%): GSC position and CTR data
  - **Local Entity** (15%): Google Business Profile API (NAP consistency, Knowledge Panel, locations)
  - **Service Area** (10%): Google Business Profile API (service areas, NAP multiplier)
- ✅ **Brand & Entity Overlay**: Brand query classification, metrics calculation, trend tracking
  - Brand query share, branded CTR, brand average position
  - Combined with review and entity scores
  - Overlay metric (does not affect AI GEO score)
- ✅ **AI Summary Likelihood**: Composite score for AI/Google answer accuracy
  - Snippet Readiness (50%) + Visibility (30%) + Brand Score (20%)
  - RAG thresholds: Low <50, Medium 50-69, High ≥70
- ✅ **Backlink metrics**: CSV upload with domain rating and metrics computation
- ✅ **Review data**: GBP API + Trustpilot snapshot integration
- ✅ **Supabase integration**: Historical tracking for all pillars (not just Content/Schema)
  - Brand overlay and AI summary scores stored
  - Segmented Authority data (All pages, Exclude education, Money pages)
  - Trend charts with fallback calculations
- ✅ **Shareable Audit Links**: Public sharing with 30-day expiration
  - `shared_audits` table in Supabase
  - API endpoints for create/retrieve
  - `?share=ID` URL parameter support
- ✅ **Enhanced visualizations**: 
  - Speedometer with multiple indicators (30% larger)
  - Radar chart with RAG color-coded labels
  - Trend charts for all 6 metrics (5 pillars + Brand & Entity)
  - Snippet readiness nested doughnut chart
  - Brand queries mini-table
- ✅ **Dashboard features**: Persistence, retry failed URLs, page segmentation, collapsible sections
- ⚠️ **1 API endpoint is a stub**: `entity-extract` (optional feature)

**Next Priority**: 
1. Real-time SERP feature monitoring and alerts
2. Advanced backlink analysis with automated discovery
3. Competitive analysis and benchmarking
4. Automated action recommendations engine
5. Export capabilities (PDF, CSV reports)

