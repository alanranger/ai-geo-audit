# Money Page Segment URL Patterns

This document describes how the `money` pages are split into `event`, `product`, and `landing` sub-segments in AI GEO Audit, and lists the URLs currently labelled as `landing`.

## Scope

- This is the **sub-segmentation** logic used after a page is already considered a money page.
- Blog posts are **not** money pages and are classified separately.
- A page is labelled `landing` only when it is already in the money-page set and does not match `event` or `product`.

## Source Of Truth

- `audit-dashboard.html` (`classifyMoneyPageSubSegment()` and `classifyUrlForRankingAi()`)
- `lib/audit/moneyPages.js` (`classifyMoneyPageSubSegment()`)
- Current landing URL list extracted from `latest-audit-utf8.json` at:
  - `data.scores.moneyPagesMetrics.rows[*].subSegment === "LANDING"`

## Product Page URL Patterns

A money page is labelled `PRODUCT` when URL contains either of:

- `/photo-workshops-uk`
- `/photography-services-near-me`

## Event Page URL Patterns

A money page is labelled `EVENT` when URL contains either of:

- `/beginners-photography-lessons`
- `/photographic-workshops-near-me`

## Blog URL Pattern (Separate Category)

Blog posts are a separate category and are not part of money-page sub-segmentation.

- `/blog-on-photography/` (URL path starts with this slug)

## Landing Page Rule

A URL is labelled `LANDING` only when all of the following are true:

- It is already classified as a money page.
- It does **not** match the `PRODUCT` patterns.
- It does **not** match the `EVENT` patterns.
- It is **not** a blog URL (blog URLs start with `/blog-on-photography/` and are in the blog category).

## URLs Currently Labelled As Landing Pages

Snapshot source: `latest-audit-utf8.json`  
Total currently labelled `LANDING`: **44**

1. `https://www.alanranger.com/academy-robo-ranger`
2. `https://www.alanranger.com/academy/ebook`
3. `https://www.alanranger.com/academy/online-photography-course`
4. `https://www.alanranger.com/academy/photography-checklists`
5. `https://www.alanranger.com/academy/photography-exams-certification`
6. `https://www.alanranger.com/academy/photography-practice-packs`
7. `https://www.alanranger.com/academy/photography-questions-answers`
8. `https://www.alanranger.com/batsford-arboretum-photography`
9. `https://www.alanranger.com/beginners-photography-classes`
10. `https://www.alanranger.com/beginners-portrait-photography-course`
11. `https://www.alanranger.com/bluebell-woods-near-me`
12. `https://www.alanranger.com/contact-us-alan-ranger-photography`
13. `https://www.alanranger.com/copyright-policy-alan-ranger`
14. `https://www.alanranger.com/corporate-photography-training`
15. `https://www.alanranger.com/course-finder-photography-classes-near-me`
16. `https://www.alanranger.com/data-privacy-policy`
17. `https://www.alanranger.com/hire-a-professional-photographer-in-coventry`
18. `https://www.alanranger.com/home`
19. `https://www.alanranger.com/intentions-course-six-month-photography-project`
20. `https://www.alanranger.com/jaguar-land-rover-els`
21. `https://www.alanranger.com/landscape-photography-workshops`
22. `https://www.alanranger.com/my-ethical-policy`
23. `https://www.alanranger.com/one-day-landscape-photography-workshops`
24. `https://www.alanranger.com/photo-editing-course-coventry`
25. `https://www.alanranger.com/photography-courses-coventry`
26. `https://www.alanranger.com/photography-gift-vouchers`
27. `https://www.alanranger.com/photography-lessons-online-121`
28. `https://www.alanranger.com/photography-masterclasses-online`
29. `https://www.alanranger.com/photography-mentoring-online-assignments`
30. `https://www.alanranger.com/photography-payment-plan`
31. `https://www.alanranger.com/photography-presents-for-photographers`
32. `https://www.alanranger.com/photography-shop-services`
33. `https://www.alanranger.com/photography-special-offers`
34. `https://www.alanranger.com/photography-tuition-services`
35. `https://www.alanranger.com/photography-workshops`
36. `https://www.alanranger.com/photography-workshops-near-me`
37. `https://www.alanranger.com/private-photography-lessons`
38. `https://www.alanranger.com/professional-commercial-photographer-coventry`
39. `https://www.alanranger.com/professional-photographer-near-me`
40. `https://www.alanranger.com/rps-courses-mentoring-distinctions`
41. `https://www.alanranger.com/schedule-an-appointment`
42. `https://www.alanranger.com/terms-and-conditions`
43. `https://www.alanranger.com/website-cookie-policy`
44. `https://www.alanranger.com/website-terms-and-conditions`
