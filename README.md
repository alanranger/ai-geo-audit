# AI GEO Audit Dashboard

Automated SEO analysis tool for tracking AI-powered search visibility, entity recognition, and SERP behavior.

## Quick Start

### Local Testing
Simply open `audit-dashboard.html` in your browser - no server needed!

## Deployment

This project is deployed on **Vercel**. See `DEPLOY.md` for detailed deployment instructions.

### Live Dashboard
The dashboard is available at: `https://ai-geo-audit.vercel.app/`

### Updating the Dashboard

After making changes:
```bash
git add .
git commit -m "Update dashboard"
git push
```

Vercel will automatically rebuild and deploy (usually takes 1-2 minutes).

## Features

- **Site AI Health Dashboard**: Comprehensive health score visualization
  - Large speedometer gauge (30% larger) showing AI GEO Score (0-100)
  - Color-coded segments: Red (0-49), Amber (50-69), Green (70-100)
  - Visual needle indicators for AI GEO Score, AI Summary Likelihood, and Brand & Entity
  - RAG status pills with detailed breakdown boxes showing calculation components
  - AI Summary Likelihood indicator (High/Medium/Low) with breakdown
  - Brand & Entity overlay chip showing score and status
- **5 Core Pillars + Overlays**: 
  - **Authority** (30% weight): 4-component model (Behaviour 40%, Ranking 20%, Backlinks 20%, Reviews 20%)
  - **Content/Schema** (25% weight): Foundation schemas, Rich Results, Coverage, Type Diversity
  - **Visibility** (20% weight): Average position and CTR from GSC
  - **Local Entity** (15% weight): NAP consistency, Knowledge Panel, GBP signals
  - **Service Area** (10% weight): Service area coverage and NAP multiplier
  - **Brand & Entity Overlay**: Brand query performance, reviews, entity strength (does not affect AI GEO score)
  - **AI Summary Likelihood**: Composite score for AI/Google answer accuracy (snippet readiness, visibility, brand)
- **Real-time Data Sources**: 
  - Google Search Console API (OAuth2) - clicks, impressions, position, queries, brand queries
  - Google Business Profile API - ratings, reviews, locations, service areas, NAP data
  - Schema Audit - Full site crawl for JSON-LD markup validation
  - Backlink CSV Upload - Domain rating, referring domains, follow ratio
  - Trustpilot Reviews - Snapshot integration for review aggregation
- **Visual Dashboards**: 
  - Site AI Health speedometer with multiple score indicators
  - Radar chart with RAG color-coded score labels
  - Trend graphs showing historical performance for all 6 metrics (5 pillars + Brand & Entity)
  - Snippet Readiness nested doughnut chart with weighted segments
  - Pillar Scorecard table with detailed descriptions and improvement suggestions
  - Brand queries mini-table showing top branded queries with CTR/position
- **Historical Tracking**: 
  - Supabase integration for all pillars (not just Content/Schema)
  - Trend charts with segmented Authority data (All pages, Exclude education, Money pages only)
  - Brand & Entity fallback calculation from GSC for historical dates
- **Shareable Audit Links**: 
  - Generate shareable URLs with 30-day expiration
  - View complete audit results without running an audit
  - Perfect for client demos and team sharing
- **Dashboard Features**:
  - Automatic persistence (localStorage) - loads last audit on page reload
  - Retry failed URLs functionality
  - Page segmentation with segment-aware metrics
  - Collapsible CSV upload sections
  - Detailed calculation explanations
  - RAG status badges with tooltips

## Setup

1. **Configure OAuth2 Credentials** (see `GSC_API_SETUP.md` for detailed instructions):
   - Enable Google Search Console API in Google Cloud Console
   - Create OAuth2 credentials (Client ID and Client Secret)
   - Generate a refresh token
   - Add credentials to Vercel environment variables

2. **Access the Dashboard**:
   - Open the live dashboard at `https://ai-geo-audit.vercel.app/`
   - Enter your property URL (e.g., `https://alanranger.com`)
   - Click "Run Audit Scan"

## Current Status

- ✅ **Fully Implemented**: All core features are production-ready
- ✅ **Site AI Health Dashboard**: Speedometer with multiple score indicators, RAG pills with breakdown boxes
- ✅ **5 Core Pillars**: All pillars fully implemented with real data sources
- ✅ **Brand & Entity Overlay**: Brand query classification, metrics calculation, trend tracking
- ✅ **AI Summary Likelihood**: Composite scoring with snippet readiness, visibility, and brand signals
- ✅ **Google Search Console API**: Full OAuth2 integration with brand query detection
- ✅ **Schema Audit**: Complete site crawl with coverage, diversity, and rich result eligibility
- ✅ **Backlink Analysis**: CSV upload support with domain rating and metrics
- ✅ **Review Aggregation**: Trustpilot snapshot + Google Business Profile reviews
- ✅ **Local Entity Tracking**: Knowledge panel detection, NAP consistency, GBP integration
- ✅ **Historical Tracking**: Supabase integration for all pillars with trend charts
- ✅ **Shareable Links**: Public sharing with 30-day expiration
- ✅ **Page Segmentation**: Segment-aware metrics (All pages, Exclude education, Money pages only)
- ✅ **Dashboard Persistence**: Automatic localStorage saving and loading
- ✅ **Retry Mechanism**: Rescan failed URLs without full audit

## API Endpoints

The following serverless functions are available:

- `/api/fetch-search-console` - Fetch GSC performance data (legacy)
- `/api/schema-audit` - Scan URLs for JSON-LD schema coverage
- `/api/aigeo/gsc-entity-metrics` - Comprehensive GSC entity metrics with brand query classification
- `/api/aigeo/schema-coverage` - Schema coverage analysis
- `/api/aigeo/serp-features` - SERP feature detection
- `/api/aigeo/local-signals` - Google Business Profile data (GBP rating, reviews, NAP consistency, service areas)
- `/api/aigeo/backlink-metrics` - Backlink metrics (referring domains, total backlinks, follow ratio)
- `/api/reviews/site-reviews` - On-site/Trustpilot review data
- `/api/aigeo/entity-extract` - Entity extraction (stub)
- `/api/supabase/save-audit` - Save audit results to Supabase (includes brand_overlay, ai_summary)
- `/api/supabase/get-audit-history` - Fetch historical audit data for all pillars
- `/api/supabase/create-shared-audit` - Create shareable audit link
- `/api/supabase/get-shared-audit` - Retrieve shared audit by ID

## Next Steps

- [ ] Add Google Analytics integration
- [ ] Implement automated scheduling
- [ ] Add email notifications
- [ ] Expand entity extraction capabilities

## Notes

- **Authentication**: OAuth2 credentials stored securely in Vercel environment variables
- **API Architecture**: All API calls handled server-side via Vercel serverless functions
- **Visualizations**: Chart.js (CDN) with custom plugins for speedometer, radar, trend charts
- **Data Sources**: 
  - Schema audit reads from GitHub-hosted CSV or manual URL lists
  - Historical data stored in Supabase (requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`)
  - Brand queries classified using configurable brand terms list
- **Scoring Formulas**:
  - **AI GEO Score**: Weighted average of 5 pillars (Authority 30%, Content/Schema 25%, Visibility 20%, Local Entity 15%, Service Area 10%)
  - **AI Summary Likelihood**: Snippet Readiness (50%), Visibility (30%), Brand Score (20%) - thresholds: Low <50, Medium 50-69, High ≥70
  - **Brand Overlay**: Brand Search (40%) + Reviews (30%) + Entity (30%) - thresholds: Weak <40, Developing 40-69, Strong ≥70
  - **Snippet Readiness**: Content/Schema (40%), Visibility (35%), Authority (25%)
  - **Content/Schema**: Foundation (30%), Rich Results (35%), Coverage (20%), Diversity (15%)
  - **Authority**: Behaviour (40%), Ranking (20%), Backlinks (20%), Reviews (20%)
    - Behaviour: CTR for ranking queries (position ≤ 20) + top-10 CTR
    - Ranking: Impression-weighted average position + top-10 impression share
    - Backlinks: Referring domains (100+ = max) + follow ratio (from CSV upload)
    - Reviews: Combined GBP and on-site ratings/counts (60% GBP, 40% site)
- **RAG Thresholds**: Red (0-49), Amber (50-69), Green (70-100) - consistent across all scores
- **Dashboard State**: Persists in browser localStorage between sessions
- **Shareable Links**: Valid for 30 days, stored in Supabase `shared_audits` table

