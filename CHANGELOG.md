# Changelog

All notable changes to the AI GEO Audit Dashboard project will be documented in this file.

## [2025-01-XX] - Site AI Health Speedometer Enhancement

### Added
- **Site AI Health Dashboard Section**: New prominent health score visualization at the top of the dashboard
  - Circular speedometer-style gauge showing overall AI GEO Score (0-100)
  - Color-coded segments: Red (0-50%), Amber (50-70%), Green (70-100%)
  - Visual needle indicator pointing to current score
  - Tick marks for current score and AI summary likelihood threshold (55 for "Medium")
  - Labels for 50%, 100%, current score, and AI threshold
  - Status badge showing "Excellent", "Good", or "Needs Work"
  - AI Summary Likelihood indicator (High/Medium/Low)

### Changed
- **Page Segmentation**: Fine-art print pages reclassified from "Money pages" to informational/portfolio pages
  - Fine-art pages now excluded from "Money pages only" segment
  - Still included in "All pages" and "Exclude education" segments
- **Recommended Actions Table**: Enhanced with priority highlighting and improved formatting
  - Priority row highlighted with red border and "Priority" badge
  - Column headers updated: "Target" (from "Target Value"), "To Target" (from "Gap")
  - Signed difference values (e.g., `-1.68%` or `✓ On target`)
  - Segment context added above table
  - Numeric formatting: 1 decimal for current/target, 2 decimals for gap

### Fixed
- Speedometer label positioning and visibility
- Marker alignment with progress ring
- Title centering over dial section
- Removed duplicate "Pillar Status Summary" table
- Fixed pillar scorecard to use latest audit data

### Technical Details
- Speedometer uses SVG-based circular progress ring
- Marker positions calculated using trigonometry for precise alignment
- 0% marker removed (only 50% and 100% major markers shown)
- Current score and AI threshold have dedicated tick marks with labels
- Title "Site AI Health" centered directly over dial using flexbox layout

## Previous Versions

See git history for earlier changes.

