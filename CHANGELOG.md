# Changelog

All notable changes to the AI GEO Audit Dashboard project will be documented in this file.

## [2025-12-21] - v1.7.1 - Traffic Lights & Ranking & AI Task Creation Fixes

### Fixed
- **Traffic Lights Classification**: Fixed traffic lights showing tasks in multiple metric columns
  - Now only counts tasks that have the matching metric as their objective KPI
  - CTR task only appears in CTR column, not in Impressions/Clicks/Rank columns
  - AI Citations task only appears in AI Citations column
  - Prevents double-counting and confusion
- **Traffic Lights Baseline Detection**: Fixed "No baselineLatest" warnings for tasks with single measurement
  - Updated `getBaselineLatest` to handle single measurement case when filtered by cycle start date
  - If only 1 measurement exists and it's filtered out by cycle date, use it anyway (baseline case)
  - Ensures traffic lights can classify tasks with baseline-only measurements
- **Ranking & AI Task Creation**: Fixed missing keyword and title when creating tasks from Ranking & AI
  - Changed task type from `'on_page'` to `'content'` for keyword-level tasks
  - API now preserves keyword_text for non-page-level tasks (only forces empty for `'on_page'`)
  - Modal now suggests keyword as title for keyword-level tasks (doesn't reset to empty)
  - Updated cache key building to include `'content'` task type
  - Status lookup now correctly finds tasks created from Ranking & AI
- **Bulk Update Button**: Fixed to respect "Include Test Tasks" checkbox
  - Excludes test tasks from bulk update if checkbox is unchecked
  - Confirmation message shows correct count (excluding test tasks if unchecked)

### Changed
- **Debug Logging**: Moved from browser console to UI debug panel
  - All traffic lights debug logs now appear in UI debug panel
  - Easier to diagnose issues without opening browser console

### Technical
- **Task Type Mapping**: 
  - Ranking & AI tasks now use `'content'` task type (keyword-level)
  - Money Pages tasks use `'on_page'` task type (page-level)
  - Status API handles both types correctly
- **Traffic Lights Logic**:
  - Added objective KPI to metric key mapping
  - Only classifies metrics that match task's objective KPI
  - Prevents tasks from appearing in irrelevant metric columns

## [2025-12-19] - v1.7.0 - Optimisation Tracking Module (Phases 1-8 Complete)

### Added
- **Optimisation Tracking Module**: Complete implementation of keyword optimisation tracking system
  - Phase 1: Database schema with tasks, cycles, and events tables
  - Phase 2: UI integration in Ranking & AI module (Optimisation column)
  - Phase 3: Full Optimisation Tracking panel with filters, table, and task details modal
  - Phase 4: Performance snapshots and measurement history
  - Phase 5: Objective integrity with auto-status calculation (on_track/overdue/met)
  - Phase 5.6: Read-only share mode with token-based authentication
  - Phase 6: Cycle management with per-task cycle numbering and history
  - Phase 7: Cycle completion and archival with timeline events
  - Phase 8: Fixed KPI formatting bugs (CTR as pp, rank lower better, no double percentage)

### Features
- **Task Management**: Create, update, and track optimisation tasks per keyword+URL+type
- **Cycle Tracking**: Multiple optimisation cycles per task with baseline/latest measurements
- **Objective Tracking**: Set objectives with KPI, target, timeframe, and auto-calculated progress
- **Measurement History**: Track performance metrics over time with delta calculations
- **Timeline Events**: Log notes, measurements, status changes, and cycle events
- **Share Mode**: Generate shareable read-only links for optimisation tracking data
- **Filters**: Status, type, keyword, URL, optimisation status, needs update, active cycle, overdue cycle
- **Summary Cards**: Counts for all task statuses and objective statuses

### Fixed
- **Target Unit Bugs**: Fixed "Increase by 100%" showing as "+10000.00%"
- **CTR Formatting**: Deltas now show as percentage points (pp) instead of percentages
- **Rank Calculation**: Lower rank is now correctly treated as better (positive delta = improvement)
- **Progress Display**: Shows "Remaining: +X" instead of confusing double delta lines
- **Measurement Dates**: Fixed baseline/latest dates showing today instead of actual capture time
- **Timezone Display**: All dates/times now shown in UTC/GMT
- **Cycle Events**: Timeline now shows cycle_start, cycle_completed, and cycle_archived events

### Technical
- **Database Migrations**:
  - `20251218_optimisation_tracking_phase1.sql` - Initial schema
  - `20251219_phase5_objective_integrity.sql` - Objective fields in cycles
  - `20251219_fix_measurement_dates.sql` - Measurement timestamps
  - `20251219_add_cycle_status_values.sql` - Cycle status enum values
  - `20251219_add_cycle_event_types.sql` - Cycle event types
- **API Endpoints**: 12 new endpoints for task/cycle/event management
- **Authentication**: Admin key and share token support
- **KPI Formatting**: Shared helper for consistent progress calculation and display

## [2025-12-18] - v1.6.1 - Money Pages Data Accuracy & Chart Improvements

### Fixed
- **28-Day Date Range Calculation**: Fixed date range showing 29 days instead of 28
  - Changed calculation to go back 27 days (27 + end date = 28 days total)
  - Applied to both Performance Trends and KPI Tracker charts
  - Ensures exactly 28 days of data (e.g., 18 Nov to 15 Dec)
- **CTR Percentage Display**: Fixed CTR showing 800% instead of 8%
  - Removed double multiplication by 100 (values already stored as percentages 0-100)
  - Fixed in table cells, chart y-axis ticks, and tooltips
  - CTR now displays correctly (e.g., 8% instead of 800%)
- **Trend Calculation**: Fixed trend values showing incorrect percentage points
  - Removed multiplication by 100 for CTR trends (diff already in percentage points)
  - Trend now shows correct values (e.g., -0.6pp instead of -63.4pp)
- **Chart Axis Labels**: Made all axis labels bold and larger for better visibility
  - Axis titles: size 14, weight 'bold'
  - Axis ticks: size 12, weight 'bold'
  - Applied to KPI Tracker chart and Performance Trends charts

### Changed
- **Money Pages Data Source**: Changed from audit records to actual GSC timeseries data
  - KPI Tracker now calculates metrics from `gsc_timeseries` table for all dates
  - Uses money page proportions from latest audit to calculate segment metrics
  - Performance Trends charts use actual GSC data for all 28 days
  - Removed fallback to audit records (now uses real GSC data or shows null)
- **Weekly Data Points**: Changed from 15 evenly spaced points to 8 weekly points
  - 28 days / 4 = 7 weeks, so 8 data points (one per week)
  - Better fits container width and reduces chart clutter
  - Applied to both KPI Tracker and Performance Trends charts
- **Section Descriptions**: Updated to reflect actual data source
  - Performance Trends: "Weekly trends calculated from actual Google Search Console data for the last 28 days"
  - KPI Tracker: "Weekly KPI trends by money-page segment calculated from actual Google Search Console data"
  - Footer: "Data calculated from Google Search Console timeseries for the last 28 days, displayed as 8 weekly data points"

### Technical Details
- **Date Range Calculation**: 
  - `startDate = endDate - 27 days` (27 days back + end date = 28 days total)
  - Date points generated with `step = (28 - 1) / 7` for 8 weekly points
- **GSC Timeseries Calculation**:
  - Finds reference audit with both `moneySegmentMetrics` and matching timeseries data
  - Calculates money page proportions (clicks/impressions) from reference audit
  - Applies proportions to each date's GSC timeseries data
  - Calculates segment metrics using segment proportions from reference audit
- **CTR Formatting**:
  - Values stored as percentages (0-100), not decimals (0-1)
  - Display: `${value.toFixed(1)}%` (no multiplication)
  - Trend: `${diff.toFixed(1)}pp` (diff already in percentage points)

## [2025-12-16] - v1.6.0 - Money Pages UI Improvements & Branding Update

### Added
- **Money Pages Performance Trends Split Charts**: Split single chart into two side-by-side charts
  - Volume Metrics Chart: Clicks and Impressions (similar scales)
  - Rate & Score Metrics Chart: CTR (%) and Behaviour Score (similar scales)
  - Resolves Y-axis scaling issues with 4 series on different scales
  - Each chart has fixed height container (300px) to prevent auto-scaling loops
- **Enhanced CTR Y-Axis Precision**: Improved granularity for Rate & Score Metrics chart
  - stepSize set to 0.02 (shows 1.40%, 1.42%, 1.44%, etc.)
  - Labels display 2 decimal places (1.65% instead of 1.6%)
  - Makes small day-to-day CTR changes clearly visible
  - Tooltip precision matches axis (2 decimal places)

### Changed
- **Branding Update**: Replaced "AIO" with "GAIO" throughout UI
  - Main header: "GAIO (Generative AI Optimization) Audit Dashboard"
  - Subtitle: "Automated GAIO Performance Tracking & Optimisation"
  - All user-facing text, tooltips, and descriptions updated
  - Internal variable names preserved for compatibility
- **Money Pages Section Layout**: Reorganized section order
  - KPI Tracker (last 12 audits) now appears above Priority & Actions section
  - KPI Tracker chart and table displayed side-by-side (50/50 split)
  - Performance Trends charts displayed side-by-side (50/50 split)
- **CTR Calculation**: Now calculated directly from clicks/impressions for accuracy
  - Ensures plotted value matches actual calculated CTR
  - Fallback to stored values with smart detection (decimal vs percentage format)
  - Fixes tooltip/plotting mismatch issues

### Fixed
- **Dropdown Counts Persistence**: Fixed counts vanishing after filter selection
  - Counts now calculated from base data (after min impressions, before type filter)
  - Counts persist correctly when type filter changes
  - `renderMoneyPagesTable` now uses base data for counting instead of filtered data
- **Money Pages Filter Counts**: Fixed counts not updating when filters change
  - Counts update correctly when min impressions filter changes
  - Counts update correctly when type filter changes
  - Initial load respects min impressions filter value
- **CTR Plotting Accuracy**: Fixed CTR values not plotting at correct Y-axis position
  - Tooltip precision increased to 2 decimal places (matches axis)
  - Direct calculation from clicks/impressions ensures accuracy
  - Resolves issue where 1.50% appeared closer to 1.45% on axis
- **Chart Auto-Scaling Loop**: Fixed infinite Y-axis expansion
  - Added fixed-height containers (300px) for all charts
  - Set `maintainAspectRatio: true` with `aspectRatio: 2.5`
  - Removed manual canvas width/height settings
  - Added rendering guards to prevent simultaneous re-renders
- **Money Pages Section Restoration**: Restored complete HTML structure
  - All sub-sections, styling, and formatting preserved
  - KPI Tracker table restored and positioned correctly
  - Background and panel formatting maintained
  - Only change: Performance Trends split from 1 chart to 2 side-by-side charts

### Technical Details
- **Chart Configuration**: 
  - Volume chart: Clicks (min: 100, max: 500, stepSize: 50) and Impressions
  - Rate chart: CTR (stepSize: 0.02, 2 decimal places) and Behaviour Score
  - Both charts use fixed-height containers to prevent resizing loops
- **Filter Count Logic**: 
  - Counts calculated from `window.moneyPagePriorityData` + `window.authorityActionRows`
  - Min impressions filter applied before counting
  - Type filter NOT applied when counting (shows all available types)
- **CTR Data Extraction**:
  - Primary: Calculate from `(clicks / impressions) * 100` when available
  - Fallback: Use `summary.ctr` or `allMoney.ctr` with smart format detection
  - Handles both decimal (0.015) and percentage (1.5) formats

## [2025-12-17] - v1.5.0 - Intent-Based Keyword Segmentation & Preset Refactor

### Added
- **Intent-Based Keyword Segmentation**: Replaced URL-based classification with intent-based rules
  - New `lib/segment/classifyKeywordSegment.js` classifier with priority order: Brand → Money → Education → Other
  - Brand detection: matches brand terms (alan ranger, alanranger, photography academy, etc.)
  - Money detection: transactional terms (lessons, courses, workshops, etc.) OR local modifiers (near me, coventry, etc.) OR postcode patterns
  - Education detection: informational terms (how to, guide, tutorial, etc.) OR technique topics (aperture, shutter speed, etc.)
  - Returns segment, confidence (0-1), and reason for classification
- **Segment Metadata Columns**: Added to `keyword_rankings` table
  - `segment_source`: 'auto' (intent-based) or 'manual' (user override)
  - `segment_confidence`: 0-1 confidence score for auto-classification
  - `segment_reason`: Explanation text (e.g., "money: contains 'lessons'")
- **Backfill Script**: `scripts/retag-keyword-segments-direct.js` to re-classify all existing keywords
  - Skips rows with `segment_source='manual'` to preserve manual overrides
  - Shows summary of changes and top 20 examples
  - Run with: `npm run retag:segments` or `node scripts/retag-keyword-segments-direct.js`
- **Data-Driven Presets**: Refactored preset system with single source of truth
  - `DEFAULT_FILTERS` constant for default filter state
  - `PRESETS` object with all preset definitions (filters + sort)
  - Hard reset implementation (no filter stacking)
- **Blog Opportunities Preset**: Replaced "Education growth" preset
  - Uses `pageType: 'Blog'` (not `segment: 'Education'`)
  - Filters: Page type: Blog, Best rank: Not top 3, Min opportunity: ≥ 30
  - Sort: Opportunity score descending
- **Local Visibility Preset**: New preset for GBP/local queries
  - Uses `pageType: 'GBP'`
  - Filters: Page type: GBP, Best rank: Not top 3, Min opportunity: ≥ 30
  - Sort: Opportunity score descending
- **Not Top 3 Rank Filter**: Added new rank filter option
  - Filters keywords with rank > 3 or null (not in top 3)
  - Used by Blog opportunities and Local visibility presets
- **Competitor Checkbox in Competitors Table**: Added competitor checkbox column
  - Narrow "C" column header to save space
  - Checkbox updates competitor flag and shows/hides competitor badge
  - Wired to same update logic as other competitor checkboxes
- **Edit Keywords Modal**: Keyword management interface
  - Load existing keywords from Supabase
  - Add, remove, or edit keywords
  - Warning box about data loss when removing/changing keywords
  - Keywords updated on next Ranking & AI check (no automatic scan)
- **Pre-scan Keyword Count**: Display keyword count before starting scan
- **Stop Scan Button**: Ability to abort running scan in progress

### Changed
- **Keyword Classification**: Now based on keyword intent, not currently ranking URL
  - Keywords like "photography lessons" correctly classified as Money (not Education)
  - Keywords like "how to use aperture" correctly classified as Education
  - Page type used only as weak hint for confidence, not primary classifier
- **Preset System**: Complete refactor for maintainability
  - All presets defined in single `PRESETS` object
  - Hard reset ensures no filter stacking between presets
  - Tooltips and criteria chips automatically reflect preset definitions
- **Filter Dropdown Counts**: Updated to reflect new data structure
  - Added "Blog" to pageType counts
  - Added "not-top3" to rank counts
  - All dropdown options now show counts (even if 0)
- **Domain Rank Display**: Fixed missing Domain Rank in "AI Citations for Selected Keyword" table
  - Moved Domain Rank filling logic inside async IIFE after rows are appended
  - Added debug logging for troubleshooting

### Fixed
- **Domain Rank Missing**: Fixed Domain Rank not showing in "AI Citations for Selected Keyword" table
- **Filter Counts**: Fixed "Blog" page type not showing count in dropdown
- **Preset Filter Stacking**: Fixed presets accidentally stacking filters (now hard resets)
- **Education Segment Collapse**: Fixed "Education (6)" segment issue by using pageType-based presets
- **Competitor Badge Overlap**: Fixed competitor badge overlapping domain name in citation tables
  - Changed to vertical flex layout (badge below domain name)
  - Added word-break for long URLs
- **Domain Strength Table**: Fixed dropdown showing "Unmapped" instead of actual mapped value
- **Keyword List Loading**: Fixed modal not loading keywords from Supabase
- **Keyword Save**: Fixed error preventing keyword save without prior audit (now creates minimal audit record if needed)

### Technical Details
- **Migration**: `20251217_add_keyword_segment_metadata.sql` adds segment metadata columns
- **Classifier**: Priority-based matching with confidence scoring
- **Backfill**: Processes all keywords, preserves manual overrides, shows change summary
- **Preset Architecture**: Data-driven with `DEFAULT_FILTERS` and `PRESETS` object
- **Filter Counts**: Calculated based on rows matching all OTHER filters (excluding the filter being counted)
- **API Endpoints**: 
  - `/api/keywords/get` - Fetch current keyword list from latest audit
  - `/api/keywords/save` - Save updated keyword list to latest audit

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

