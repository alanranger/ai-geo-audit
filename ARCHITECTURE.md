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
   └─> calculatePillarScores(GSC data, schema audit)
       ├─> Visibility Score: Based on average position (1-40 → 100-10)
       ├─> Authority Score: 60% CTR + 40% Position
       ├─> Local Entity Score: 60 + 0.3*(position-50) + 0.2*(CTR-50)
       ├─> Service Area Score: Local Entity - 5
       └─> Content/Schema Score: (Foundation × 30%) + (Rich Results × 35%) + (Coverage × 20%) + (Diversity × 15%)

5. UI RENDERING
   └─> displayDashboard(scores, data, snippetReadiness, schemaAudit)
       ├─> Update 5 Pillar Score Cards
       ├─> Render Radar Chart (5 pillars)
       ├─> Render Trend Chart (timeseries data)
       ├─> Render Metrics Cards (clicks, impressions, CTR, position)
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
**Purpose**: Fetch historical Content/Schema scores from Supabase

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

**Note**: If Supabase is not configured, returns `status: "skipped"`. Trend chart will use current score for all historical points (dashed line).

---

### ⚠️ Stubs (Placeholder Data)

#### 8. `/api/aigeo/local-signals` (GET)
**Status**: ⚠️ **STUB** - Returns placeholder data

**Returns**:
```json
{
  "data": {
    "localBusinessSchemaPages": 0,
    "napConsistencyScore": null,
    "knowledgePanelDetected": false,
    "serviceAreas": [],
    "notes": "Local signals module is stubbed; implement GBP + LocalBusiness scanning in later batch."
  }
}
```

**Future Implementation**:
- Google Business Profile API integration
- LocalBusiness schema scanning
- NAP (Name, Address, Phone) consistency checking
- Knowledge panel detection

---

#### 9. `/api/aigeo/backlink-metrics` (GET)
**Status**: ⚠️ **STUB** - Returns placeholder data

**Returns**:
```json
{
  "data": {
    "totalReferringDomains": null,
    "totalBacklinks": null,
    "avgDomainRating": null,
    "notes": "Backlink metrics API not connected yet; this is a stub."
  }
}
```

**Future Implementation**:
- Ahrefs API integration
- Semrush API integration
- Moz API integration
- Domain rating calculations

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
**Formula**: Weighted combination of CTR and Position
```javascript
ctrDecimal = ctr / 100  // Convert percentage to decimal
ctrScore = Math.min((ctrDecimal / 0.10) * 100, 100)  // Cap at 100
authority = 0.6 * ctrScore + 0.4 * posScore
```

**Data Source**: ✅ **REAL** - GSC `ctr` and `avgPosition`

---

#### 3. **Local Entity Score** (0-100)
**Formula**: Anchored around 60 with position and CTR adjustments
```javascript
localEntity = 60 + 0.3 * (posScore - 50) + 0.2 * (ctrScore - 50)
```

**Data Source**: ⚠️ **DERIVED** - Calculated from GSC data (not using Local Signals API yet)

---

#### 4. **Service Area Score** (0-100)
**Formula**: Derived from Local Entity
```javascript
serviceArea = localEntity - 5
```

**Data Source**: ⚠️ **DERIVED** - Not using real service area data yet

---

#### 5. **Content/Schema Score** (0-100)
**Formula**: Weighted calculation based on four components
```javascript
// 1. Foundation Schemas (30%): Organization, Person, WebSite, BreadcrumbList
foundationScore = (foundationPresent / 4) * 100

// 2. Rich Result Eligibility (35%): Article, Event, Course, FAQ, HowTo, VideoObject, Recipe, Product, LocalBusiness, Review
richResultScore = (richEligibleCount / 10) * 100

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
   - Authority: ✅ Real (from GSC CTR + position)
   - Content/Schema: ✅ Real (from schema audit: foundation schemas, rich results, coverage, diversity)
   - Local Entity: ⚠️ Derived (calculated from GSC, not using Local Signals API)
   - Service Area: ⚠️ Derived (calculated from Local Entity)

4. **Snippet Readiness**
   - ✅ Real (calculated from real pillar scores)

---

### ⚠️ **MOCK/PLACEHOLDER DATA**

1. **Local Signals**
   - LocalBusiness schema pages: **0** (stub)
   - NAP consistency: **null** (stub)
   - Knowledge panel: **false** (stub)
   - Service areas: **[]** (stub)

2. **Backlink Metrics**
   - Total referring domains: **null** (stub)
   - Total backlinks: **null** (stub)
   - Average domain rating: **null** (stub)

3. **Entity Extraction**
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
- ✅ Supabase integration implemented for Content/Schema historical tracking
- ✅ Audit results saved to Supabase after each scan
- ✅ Historical Content/Schema data fetched from Supabase for trend chart
- ⚠️ If Supabase not configured, trend chart shows dashed line using current score for all historical points
- ⚠️ Other pillars (Visibility, Authority) use GSC timeseries data (no storage needed)

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
- Vanilla JavaScript - No framework dependencies

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
│       ├── save-audit.js           # Save audit results to Supabase
│       └── get-audit-history.js    # Fetch historical Content/Schema data
└── scripts/
    └── sync-site-urls.js          # CSV sync script
```

---

## Summary

**Current State**: 
- ✅ Core functionality working with real GSC and schema data
- ✅ 3 of 5 pillars use real data (Visibility, Authority, Content/Schema - with weighted foundation/rich results/coverage/diversity calculation)
- ⚠️ 2 pillars use derived calculations (Local Entity, Service Area)
- ⚠️ 3 API endpoints are stubs (local-signals, backlink-metrics, entity-extract)
- ✅ Supabase integration for Content/Schema historical tracking
- ✅ Enhanced visualizations (radar chart with score labels, snippet readiness nested doughnut chart)
- ✅ Dashboard persistence and retry failed URLs functionality

**Next Priority**: 
1. Implement Local Signals API (Google Business Profile)
2. Implement Backlink Metrics API
3. Add automated scheduling (cron jobs)
4. Expand historical tracking to other pillars if needed

