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

- **5 Pillar Score Tracking**: Local Entity, Service Area, Authority (4-component: Behaviour, Ranking, Backlinks, Reviews), Visibility, Content/Schema
- **Real-time Data**: Google Search Console API integration
- **Visual Dashboards**: 
  - Radar chart with RAG color-coded score labels at each data point
  - Trend graphs showing historical performance
  - Snippet Readiness nested doughnut chart with weighted segments and score indicators
  - Metrics cards with real-time data
- **RAG Status**: Color-coded Red/Amber/Green indicators on all scores
- **Historical Data**: Supabase integration for Content/Schema trend tracking
- **Dashboard Persistence**: Automatically loads last audit results on page reload
- **Retry Failed URLs**: Rescan failed/missing URLs without running full audit
- **Configuration**: Save API keys and settings locally

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

- ✅ Dashboard UI complete with enhanced visualizations
- ✅ Visual charts and graphs (radar, trend, snippet readiness)
- ✅ Google Search Console API integration (OAuth2)
- ✅ Schema audit and coverage scanning with retry mechanism
- ✅ Entity metrics and SERP features tracking
- ✅ Real-time data from GSC API
- ✅ Supabase integration for historical Content/Schema tracking
- ✅ Dashboard persistence (localStorage)
- ✅ Retry failed URLs functionality
- ✅ Configuration management
- ✅ Tooltips on all interactive buttons

## API Endpoints

The following serverless functions are available:

- `/api/fetch-search-console` - Fetch GSC performance data
- `/api/schema-audit` - Scan URLs for JSON-LD schema coverage
- `/api/aigeo/gsc-entity-metrics` - Comprehensive GSC entity metrics
- `/api/aigeo/schema-coverage` - Schema coverage analysis
- `/api/aigeo/serp-features` - SERP feature detection
- `/api/aigeo/local-signals` - Google Business Profile data (GBP rating, reviews, NAP consistency, service areas)
- `/api/aigeo/backlink-metrics` - Backlink metrics (referring domains, total backlinks, follow ratio)
- `/api/reviews/site-reviews` - On-site/Trustpilot review data
- `/api/aigeo/entity-extract` - Entity extraction (stub)
- `/api/supabase/save-audit` - Save audit results to Supabase
- `/api/supabase/get-audit-history` - Fetch historical Content/Schema data

## Next Steps

- [ ] Add Google Analytics integration
- [ ] Implement automated scheduling
- [ ] Add email notifications
- [ ] Expand entity extraction capabilities

## Notes

- OAuth2 credentials are stored securely in Vercel environment variables
- All API calls are handled server-side via Vercel serverless functions
- Charts use Chart.js (loaded via CDN) with custom plugins for enhanced visualizations
- Schema audit reads URLs from GitHub-hosted CSV file or accepts manual URL lists
- Historical Content/Schema data is stored in Supabase (requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment variables)
- Dashboard state persists in browser localStorage between sessions
- Snippet Readiness score is calculated as weighted average: Content/Schema (40%), Visibility (35%), Authority (25%)
- Content/Schema pillar uses weighted formula: Foundation (30%), Rich Results (35%), Coverage (20%), Diversity (15%)
- Authority pillar uses 4-component model: Behaviour (40%), Ranking (20%), Backlinks (20%), Reviews (20%)
  - Behaviour: CTR for ranking queries (position ≤ 20) + top-10 CTR
  - Ranking: Impression-weighted average position + top-10 impression share
  - Backlinks: Referring domains (100+ = max) + follow ratio (from CSV upload)
  - Reviews: Combined GBP and on-site ratings/counts (60% GBP, 40% site)

