# Multi-scenario validation report

Generated: 2026-05-23T11:06:01.095Z
Property: https://www.alanranger.com

## Seasonality snapshot

Current month: **May**
URLs in monitoring: **1**

_Seasonality: 74 months of booking data, blended 70% observed + 30% stated (6 tiers with enough history)._

| Tier | Band | Factor |
|---|---|---|
| workshops_residential | Above-average month | x1.18 |
| workshops_nonres | Below-average month | x0.60 |
| courses | Below-average month | x0.58 |
| services | Below-average month | x0.53 |
| hire | GAP month | x0.39 |
| academy | GAP month | x0.37 |

## Baseline top 3

- academy/rank - "One plan for /free-online-photography-course: "photography lessons online" (CTR + rank)" - https://www.alanranger.com/free-online-photography-course  [seasonx0.37]
- courses/ctr - "Lift CTR on photography courses coventry" - https://www.alanranger.com/photography-courses-coventry  [seasonx0.58]
- academy/aio - "Get cited in Google's AI Overview for "photography lessons online"" - https://www.alanranger.com/free-online-photography-course  [seasonx0.37]

Suppression flags in top 8: **0**
Seasonality-scaled in top 8: **8**

## Custom weight permutations

| Scenario | Top 3 URLs | Diff from baseline | Suppressed | Season-scaled |
|---|---|---|---|---|
| workshops_peak | https://www.alanranger.com/photo-workshops-uk/somerset-landscape-photography-workshops<br>https://www.alanranger.com/photo-workshops-uk/cotswolds-landscape-photography-workshop<br>https://www.alanranger.com/photography-workshops | 3 | 0 | 8 |
| services_opportunity | https://www.alanranger.com/hire-a-professional-photographer-in-coventry<br>https://www.alanranger.com/quarterly-pick-n-mix-subscription<br>https://www.alanranger.com/photography-services-near-me/intermediates-lightroom-photography-course | 3 | 0 | 8 |

## Auto-Optimise presets

| Preset | Top 3 URLs | Diff from baseline | Suppressed | Season-scaled | Mo GP | Yr GP |
|---|---|---|---|---|---|---|
| easy | https://www.alanranger.com/free-online-photography-course<br>https://www.alanranger.com/hire-a-professional-photographer-in-coventry<br>https://www.alanranger.com/photography-workshops | 2 | 0 | 5 | £375 | £4500 |
| balanced | https://www.alanranger.com/free-online-photography-course<br>https://www.alanranger.com/hire-a-professional-photographer-in-coventry<br>https://www.alanranger.com/photography-courses-coventry | 1 | 0 | 8 | £833 | £10000 |
| hard | https://www.alanranger.com/photography-workshops<br>https://www.alanranger.com/free-online-photography-course<br>https://www.alanranger.com/beginners-photography-classes | 2 | 0 | 10 | £1125 | £13500 |

## Verdict

- Auto preset vs baseline: PASS
- Custom vs baseline: PASS
- Easy/Balanced/Hard cross-divergence: PASS
- Suppression layer firing: FAIL
- Seasonality layer firing: PASS