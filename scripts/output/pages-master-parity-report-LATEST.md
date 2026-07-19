# pages_master Phase 1 SHADOW — parity report

**Generated:** 2026-07-19T11:06:29.997Z

## Counts

| Metric | n |
|---|---:|
| pages_master rows | 564 |
| 06-site-urls paths | 496 |
| segmentation CSV paths | 540 |
| overrides DB | 562 |
| flagged | 24 |
| Tier F | 24 |

### By tier

- **A_landing:** 43
- **B_product:** 51
- **C_event:** 131
- **D_blog:** 312
- **E_academy:** 3
- **F_unmapped:** 24

### By money_role

- **cannibal:** 2
- **commercial:** 55
- **event_admin:** 131
- **funnel:** 1
- **null:** 313
- **product:** 51
- **utility:** 11

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

Utility OK (role=utility|null): **true**

## Cannibal rows

- `/photography-mentoring-online-assignments` → tier=A_landing, money_role=cannibal, target_class=cannibal_candidate
- `/photography-tuition-services` → tier=A_landing, money_role=cannibal, target_class=cannibal_candidate

## Parity vs live consumers

| Class | Count |
|---|---:|
| EXPECTED diffs | 0 |
| UNEXPECTED diffs | 0 |
| Total diffs | 0 |

### UNEXPECTED (investigate before Phase 2)

_None_

### EXPECTED sample (first 40)


### Tier F sample (first 80)

- `/academy/trial-expired`
- `/blog-on-photography//product-photography-warwickshire`
- `/blog-on-photography/food-photography-at-home`
- `/blog-on-photography/food-photography-tips`
- `/blog-on-photography/how-photography-and-data-analysis-work`
- `/blog-on-photography/patricia-pearl-lrps-rps-distinctions-panel`
- `/intentions-course-six-month-photography-project`
- `/one-day-landscape-photography-workshops`
- `/outdoor-photography-exposure-calculator`
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
- `/which-photography-style-is-right-for-you`

## Consumers compared (shadow — not rewired)

- tier-segmentation.js (CSV lookup)
- moneyPageRoles.js
- schema-audit / content-extractability / local-signals / technical-foundation / RF / dfs (all use tier-segmentation)
- TradSEO tier column (tier-segmentation)
- NOTE: pages_master not wired — shadow only

