# Changelog

All notable changes to the AI GEO Audit Dashboard project will be documented in this file.

## [2025-12-08] - Brand Overlay, AI Summary Likelihood, and Shareable Links

### Added
- **Brand & Entity Overlay Metrics**: New overlay pillar tracking brand search performance
  - Brand query classification using configurable brand terms
  - Brand metrics: query share, CTR, average position
  - Brand overlay score combining brand search (40%), reviews (30%), entity (30%)
  - Brand & Entity row in Pillar Scorecard with detailed metrics
  - Brand queries mini-table in Authority section showing top branded queries
  - Trend chart integration with yellow dashed line (#FFFF66)
  - Fallback calculation from GSC timeseries for historical dates
- **AI Summary Likelihood**: Composite score for AI/Google answer accuracy
  - Calculated from Snippet Readiness (50%), Visibility (30%), Brand Score (20%)
  - RAG thresholds: Low <50, Medium 50-69, High ≥70 (matching AI GEO bands)
  - Detailed breakdown display next to RAG pills
  - Speedometer indicator with dedicated tick mark
- **Shareable Audit Links**: Public sharing functionality
  - "Share Audit" button to generate shareable URLs
  - 30-day expiration for shared links
  - Supabase `shared_audits` table for storage
  - API endpoints: `/api/supabase/create-shared-audit` and `/api/supabase/get-shared-audit`
  - Support for `?share=ID` URL parameter to load shared audits
  - Read-only view with banner indicator for shared audits
- **Enhanced Speedometer**: Improved visualization
  - 30% size increase for better visibility
  - Multiple needle indicators: AI GEO Score, AI Summary Likelihood, Brand & Entity
  - Removed 50% marker for cleaner appearance
  - RAG breakdown boxes displayed next to pills (not just in tooltips)
  - Standardized pill and box sizing for alignment

### Changed
- **Data Date Display**: Brand & Entity now uses GSC date (matching Authority/Visibility)
- **Historical Tracking**: Extended to all pillars, not just Content/Schema
  - Brand & Entity trend data with fallback calculation
  - Historical Authority segmented data (All pages, Exclude education, Money pages)
- **RAG Thresholds**: Standardized to Red (0-49), Amber (50-69), Green (70-100) across all scores
- **Pillar Scorecard**: Added Brand & Entity row with overlay indicator
- **CSV Upload Sections**: Made collapsible and collapsed by default for cleaner UI

### Fixed
- Brand & Entity trend chart data population (was missing from timeseries loop)
- Data date not updating for Brand & Entity (now uses GSC date)
- AI Summary Likelihood thresholds aligned with RAG bands
- Snippet Readiness data format handling (number vs object)
- Supabase save errors (improved data validation and error logging)
- Missing database columns (added `brand_overlay`, `brand_score`, `ai_summary`, `ai_summary_score`)

### Technical Details
- Brand query classification: `isBrandQuery()` function with configurable terms
- Brand metrics calculation: `calculateBrandMetrics()` from GSC query data
- Brand overlay scoring: `computeBrandOverlay()` with weighted components
- AI Summary calculation: `computeAiSummaryLikelihood()` using snippet readiness, visibility, brand
- Supabase schema: Added columns for brand and AI summary data
- Fallback calculation: Estimates brand metrics from GSC timeseries when stored data unavailable

## [2025-01-XX] - Site AI Health Speedometer Enhancement

### Added
- **Site AI Health Dashboard Section**: New prominent health score visualization at the top of the dashboard
  - Circular speedometer-style gauge showing overall AI GEO Score (0-100)
  - Color-coded segments: Red (0-49), Amber (50-69), Green (70-100)
  - Visual needle indicator pointing to current score
  - Status badge showing RAG status
  - AI Summary Likelihood indicator (High/Medium/Low)

### Changed
- **Page Segmentation**: Fine-art print pages reclassified from "Money pages" to informational/portfolio pages
- **Recommended Actions Table**: Enhanced with priority highlighting and improved formatting

### Fixed
- Speedometer label positioning and visibility
- Marker alignment with progress ring
- Title centering over dial section
- Removed duplicate "Pillar Status Summary" table

## Previous Versions

See git history for earlier changes.

