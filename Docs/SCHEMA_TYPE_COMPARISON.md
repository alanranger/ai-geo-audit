# Schema Type Detection Comparison

## Expected Counts (from Schema Tools JSON files)

Based on analyzing 1,296 JSON files in the Schema Tools project:

| Schema Type | Expected Pages | Supabase Detected | Missing | % Detected |
|------------|---------------|-------------------|---------|------------|
| **BreadcrumbList** | 220 | 3 | **217** | 1.4% |
| **BlogPosting** | 220 | 24 | **196** | 10.9% |
| **ImageObject** | 220 | 396 | 0 | 180%* |
| **WebPage** | 220 | 85 | **135** | 38.6% |
| **HowTo** | 219 | 1 | **218** | 0.5% |
| **FAQPage** | 142 | 75 | **67** | 52.8% |

\* ImageObject shows 396 because it's detected on foundation pages too

## All Schema Types Detected in Supabase (Latest Audit)

| Schema Type | Pages Detected | Notes |
|------------|----------------|-------|
| Place | 396 | Foundation schema |
| WebSite | 396 | Foundation schema |
| LocalBusiness | 396 | Foundation schema |
| GeoCoordinates | 396 | Foundation schema |
| Person | 396 | Foundation schema |
| Service | 396 | Foundation schema |
| SearchAction | 396 | Foundation schema |
| Organization | 396 | Foundation schema |
| PostalAddress | 396 | Foundation schema |
| ContactPoint | 396 | Foundation schema |
| ImageObject | 396 | Foundation + page schemas |
| Article | 174 | Should be ~220 (BlogPosting) |
| Event | 127 | ✓ Correct |
| WebPage | 85 | Should be ~220 |
| Question | 75 | Part of FAQPage |
| Answer | 75 | Part of FAQPage |
| FAQPage | 75 | Should be ~142 |
| Country | 73 | ✓ Correct |
| Offer | 61 | ✓ Correct |
| ListItem | 60 | Part of BreadcrumbList/ItemList |
| ItemList | 58 | ✓ Correct |
| Product | 53 | ✓ Correct |
| AdministrativeArea | 28 | ✓ Correct |
| TextDigitalDocument | 27 | ✓ Correct |
| **BlogPosting** | **24** | **Should be ~220** ❌ |
| AggregateOffer | 24 | ✓ Correct |
| MediaObject | 24 | ✓ Correct |
| Thing | 4 | ✓ Correct |
| **BreadcrumbList** | **3** | **Should be ~220** ❌ |
| DownloadAction | 3 | ✓ Correct |
| DigitalDocument | 3 | ✓ Correct |
| Audience | 3 | ✓ Correct |
| OfferShippingDetails | 2 | ✓ Correct |
| CreativeWork | 2 | ✓ Correct |
| MerchantReturnPolicy | 2 | ✓ Correct |
| DefinedRegion | 2 | ✓ Correct |
| MonetaryAmount | 1 | ✓ Correct |
| Brand | 1 | ✓ Correct |
| Rating | 1 | ✓ Correct |
| Review | 1 | ✓ Correct |
| AggregateRating | 1 | ✓ Correct |
| HowToStep | 1 | Part of HowTo |
| ServiceChannel | 1 | ✓ Correct |
| EntryPoint | 1 | ✓ Correct |
| **HowTo** | **1** | **Should be ~219** ❌ |
| VideoObject | 1 | ✓ Correct |
| WatchAction | 1 | ✓ Correct |
| Course | 1 | ✓ Correct |
| HowToTool | 1 | Part of HowTo |

## Critical Issues

### Severely Under-Detected Types:
1. **BreadcrumbList**: 3/220 (1.4%) - Missing 217 pages
2. **HowTo**: 1/219 (0.5%) - Missing 218 pages  
3. **BlogPosting**: 24/220 (10.9%) - Missing 196 pages
4. **WebPage**: 85/220 (38.6%) - Missing 135 pages
5. **FAQPage**: 75/142 (52.8%) - Missing 67 pages

### Summary:
- **Total expected pages with BreadcrumbList**: 220
- **Total detected**: 3
- **Missing**: 217 (98.6% missing)

- **Total expected pages with HowTo**: 219
- **Total detected**: 1
- **Missing**: 218 (99.5% missing)

- **Total expected pages with BlogPosting**: 220
- **Total detected**: 24
- **Missing**: 196 (89.1% missing)

## Root Cause Analysis Needed

The schema detection logic in `api/schema-audit.js` is not properly detecting:
- BreadcrumbList (even though it has explicit `@type: "BreadcrumbList"`)
- HowTo (even though it has explicit `@type: "HowTo"`)
- BlogPosting (even though it has explicit `@type: "BlogPosting"`)

These are simple top-level schemas with explicit `@type` fields, so the detection should work. The issue is likely:
1. Schema extraction not finding all JSON-LD blocks
2. `normalizeSchemaTypes` function not properly handling these types
3. Schema blocks being parsed incorrectly

