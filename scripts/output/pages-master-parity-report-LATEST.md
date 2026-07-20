# pages_master Phase 1 SHADOW — parity report

**Generated:** 2026-07-19T17:54:18.502Z

## Counts

| Metric | n |
|---|---:|
| pages_master rows | 563 |
| 06-site-urls paths | 496 |
| segmentation CSV paths | 540 |
| overrides DB | 562 |
| flagged | 23 |
| Tier F | 20 |

### By tier

- **A_landing:** 46
- **B_product:** 51
- **C_event:** 131
- **D_blog:** 312
- **E_academy:** 3
- **F_unmapped:** 20

### By money_role

- **cannibal:** 1
- **commercial:** 52
- **event_admin:** 131
- **funnel:** 3
- **null:** 313
- **product:** 51
- **utility:** 12

## Utility path set (must not be commercial money)

- `/photography-payment-plan` → tier=A_landing, money_role=utility, target_class=none_utility
- `/terms-and-conditions` → tier=A_landing, money_role=utility, target_class=none_utility
- `/course-finder-photography-classes-near-me` → tier=A_landing, money_role=utility, target_class=none_utility
- `/website-terms-and-conditions` → tier=A_landing, money_role=utility, target_class=none_utility
- `/data-privacy-policy` → tier=A_landing, money_role=utility, target_class=none_utility
- `/website-cookie-policy` → tier=A_landing, money_role=utility, target_class=none_utility
- `/copyright-policy-alan-ranger` → tier=A_landing, money_role=utility, target_class=none_utility
- `/schedule-an-appointment` → tier=A_landing, money_role=utility, target_class=none_utility
- `/my-ethical-policy` → tier=A_landing, money_role=utility, target_class=none_utility
- `/contact-us-alan-ranger-photography` → tier=A_landing, money_role=utility, target_class=none_utility
- `/academy/login` → tier=E_academy, money_role=utility, target_class=none_utility
- `/academy/trial-expired` → tier=A_landing, money_role=utility, target_class=legacy_unreviewed

Utility OK (role=utility|null): **true**

## Cannibal rows

- `/photography-tuition-services` → tier=A_landing, money_role=cannibal, target_class=longtail_by_design

## Parity vs live consumers

| Class | Count |
|---|---:|
| EXPECTED diffs | 3 |
| UNEXPECTED diffs | 0 |
| Total diffs | 3 |

### UNEXPECTED (investigate before Phase 2)

_None_

### EXPECTED sample (first 40)

- `/which-photography-style-is-right-for-you` tier: live=`F_unmapped` → master=`A_landing` — tier_inferred_from_money_role_path_set; not in segmentation CSV
- `/outdoor-photography-exposure-calculator` tier: live=`F_unmapped` → master=`A_landing` — tier_inferred_from_money_role_path_set; not in segmentation CSV
- `/academy/trial-expired` tier: live=`F_unmapped` → master=`A_landing` — tier_inferred_from_money_role_path_set; not in segmentation CSV

### Tier F sample (first 80)

- `/blog-on-photography/food-photography-at-home`
- `/blog-on-photography/food-photography-tips`
- `/blog-on-photography/how-photography-and-data-analysis-work`
- `/blog-on-photography/patricia-pearl-lrps-rps-distinctions-panel`
- `/intentions-course-six-month-photography-project`
- `/one-day-landscape-photography-workshops`
- `/photographic-workshops-near-me/christmas-photography-walk-warwickshire`
- `/photographic-workshops-near-me/leamington-spa-night-shoot`
- `/photography-masterclasses-online`
- `/photography-news-blog`
- `/photography-presents-for-photographers`
- `/photography-services-near-me/black-and-white-photography-course`
- `/photography-services-near-me/camera-settings-photography-field-checklists`
- `/photography-services-near-me/composition-settings-photography-field-checklists`
- `/photography-services-near-me/foundation-digital-pack-plus`
- `/photography-services-near-me/monthly-online-photography-mentoring`
- `/photography-services-near-me/photo-print-preparation-service-30min`
- `/photography-services-near-me/photography-35bundle-photography-field-checklists`
- `/photography-services-near-me/photography-foundation-course-ebook`
- `/photography-shop-services`

## Consumers compared (shadow — not rewired)

- tier-segmentation.js (CSV lookup)
- moneyPageRoles.js
- schema-audit / content-extractability / local-signals / technical-foundation / RF / dfs (all use tier-segmentation)
- TradSEO tier column (tier-segmentation)
- NOTE: pages_master not wired — shadow only

