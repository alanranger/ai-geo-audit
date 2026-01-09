# Schema Detection Progress Report

**Date:** 2025-12-11 14:23  
**Audit:** Latest (432 pages crawled)

## Comparison: Baseline vs Current

| Schema Type | Expected | Baseline | Current | Change | % Detected | Status |
|------------|----------|----------|---------|--------|------------|--------|
| **BreadcrumbList** | 220 | 3 (1.4%) | **6 (2.7%)** | **+3 (+100%)** | 2.7% | 🔴 Still Critical |
| **BlogPosting** | 220 | 24 (10.9%) | **27 (12.3%)** | **+3 (+12.5%)** | 12.3% | 🔴 Still Critical |
| **HowTo** | 219 | 1 (0.5%) | **1 (0.5%)** | **0 (0%)** | 0.5% | 🔴 No Progress |
| **WebPage** | 220 | 85 (38.6%) | **98 (44.5%)** | **+13 (+15.3%)** | 44.5% | 🟡 Improving |
| **FAQPage** | 142 | 75 (52.8%) | **91 (64.1%)** | **+16 (+21.3%)** | 64.1% | 🟡 Improving |

## Progress Summary

### ✅ Improvements Made:
1. **BreadcrumbList**: +3 pages detected (100% improvement, but still only 2.7% of expected)
2. **BlogPosting**: +3 pages detected (12.5% improvement, but still only 12.3% of expected)
3. **WebPage**: +13 pages detected (15.3% improvement)
4. **FAQPage**: +16 pages detected (21.3% improvement)

### 🔴 Still Critical Issues:
1. **BreadcrumbList**: Only 6/220 detected (97.3% still missing)
2. **BlogPosting**: Only 27/220 detected (87.7% still missing)
3. **HowTo**: Only 1/219 detected (99.5% still missing)

## Current Detection Counts (Latest Audit)

| Schema Type | Pages Detected | Notes |
|------------|----------------|-------|
| ImageObject | 432 | Foundation + page schemas |
| Organization | 432 | Foundation schema |
| WebSite | 432 | Foundation schema |
| LocalBusiness | 432 | Foundation schema |
| Place | 432 | Foundation schema |
| Person | 432 | Foundation schema |
| Service | 432 | Foundation schema |
| SearchAction | 432 | Foundation schema |
| GeoCoordinates | 432 | Foundation schema |
| PostalAddress | 432 | Foundation schema |
| ContactPoint | 432 | Foundation schema |
| **Article** | **188** | Should be ~220 (BlogPosting) |
| Event | 129 | ✓ Correct |
| **WebPage** | **98** | Should be ~220 (improved from 85) |
| **FAQPage** | **91** | Should be ~142 (improved from 75) |
| Country | 87 | ✓ Correct |
| Answer | 82 | Part of FAQPage |
| Question | 82 | Part of FAQPage |
| Offer | 70 | ✓ Correct |
| ListItem | 70 | Part of BreadcrumbList/ItemList |
| ItemList | 67 | ✓ Correct |
| Product | 61 | ✓ Correct |
| AdministrativeArea | 31 | ✓ Correct |
| TextDigitalDocument | 28 | ✓ Correct |
| **BlogPosting** | **27** | Should be ~220 (improved from 24) |
| AggregateOffer | 28 | ✓ Correct |
| MediaObject | 25 | ✓ Correct |
| MerchantReturnPolicy | 6 | ✓ Correct |
| DefinedRegion | 6 | ✓ Correct |
| **BreadcrumbList** | **6** | Should be ~220 (improved from 3) |
| OfferShippingDetails | 6 | ✓ Correct |
| Brand | 5 | ✓ Correct |
| Audience | 4 | ✓ Correct |
| Thing | 4 | ✓ Correct |
| Rating | 3 | ✓ Correct |
| DownloadAction | 3 | ✓ Correct |
| DigitalDocument | 3 | ✓ Correct |
| Review | 3 | ✓ Correct |
| MonetaryAmount | 3 | ✓ Correct |
| AggregateRating | 3 | ✓ Correct |
| ServiceChannel | 2 | ✓ Correct |
| CreativeWork | 2 | ✓ Correct |
| PropertyValue | 1 | ✓ Correct |
| HowToTool | 1 | Part of HowTo |
| HowToStep | 1 | Part of HowTo |
| **HowTo** | **1** | Should be ~219 (NO CHANGE) |
| EntryPoint | 1 | ✓ Correct |
| Dataset | 1 | ✓ Correct |
| DataCatalog | 1 | ✓ Correct |
| VideoObject | 1 | ✓ Correct |
| WatchAction | 1 | ✓ Correct |
| Course | 1 | ✓ Correct |
| Blog | 1 | ✓ Correct |

## Issues Still Present

### From Logs Analysis:
- **BlogPosting**: Still seeing `⚠️ BlogPosting mentioned in HTML but not detected in JSON-LD` for many pages
- **Parse Errors**: `⚠️ JSON-LD extraction: 1/8 blocks failed to parse` - parse error recovery not working effectively
- **Aggressive Regex Fallback**: Not triggering - logs show BlogPosting mentioned but no `🔍 BlogPosting mentioned in HTML but not in extracted blocks` messages

### Root Causes:
1. **Parse Error Recovery**: BlogPosting blocks are failing to parse, but recovery isn't extracting `@type` successfully
2. **Aggressive Regex Fallback**: Not finding script tags containing BlogPosting when standard extraction fails
3. **HowTo**: Still completely broken - only 1 detected out of 219 expected

## Next Steps Needed

1. **Fix Parse Error Recovery**: Need to see actual failed JSON samples to understand why `@type` extraction isn't working
2. **Fix Aggressive Regex**: The fallback should trigger when BlogPosting is mentioned but not detected, but it's not working
3. **Investigate HowTo**: Why is HowTo detection completely broken? Need to check if it's a parsing issue or extraction issue

## Overall Assessment

**Progress:** 🟡 **Minor Improvements**  
- Made small gains on BreadcrumbList (+3), BlogPosting (+3), WebPage (+13), FAQPage (+16)
- Still missing 97%+ of BreadcrumbList, 88%+ of BlogPosting, and 99.5% of HowTo
- **Critical types still severely under-detected**

