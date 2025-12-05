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

- **5 Pillar Score Tracking**: Local Entity, Service Area, Authority, Visibility, Content/Schema
- **Real-time Data**: Google Search Console API integration
- **Visual Dashboards**: Radar charts, trend graphs, metrics cards
- **RAG Status**: Color-coded Red/Amber/Green indicators
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

- ✅ Dashboard UI complete
- ✅ Visual charts and graphs
- ✅ Google Search Console API integration (OAuth2)
- ✅ Schema audit and coverage scanning
- ✅ Entity metrics and SERP features tracking
- ✅ Real-time data from GSC API
- ✅ Configuration management

## API Endpoints

The following serverless functions are available:

- `/api/fetch-search-console` - Fetch GSC performance data
- `/api/schema-audit` - Scan URLs for JSON-LD schema coverage
- `/api/aigeo/gsc-entity-metrics` - Comprehensive GSC entity metrics
- `/api/aigeo/schema-coverage` - Schema coverage analysis
- `/api/aigeo/serp-features` - SERP feature detection
- `/api/aigeo/local-signals` - Local SEO signals
- `/api/aigeo/backlink-metrics` - Backlink analysis
- `/api/aigeo/entity-extract` - Entity extraction (placeholder)

## Next Steps

- [ ] Add Google Analytics integration
- [ ] Implement automated scheduling
- [ ] Add email notifications
- [ ] Expand entity extraction capabilities

## Notes

- OAuth2 credentials are stored securely in Vercel environment variables
- All API calls are handled server-side via Vercel serverless functions
- Charts use Chart.js (loaded via CDN)
- Schema audit reads URLs from GitHub-hosted CSV file

