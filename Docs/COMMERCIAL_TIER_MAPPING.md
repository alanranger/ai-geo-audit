# Commercial-tier mapping (alanranger.com)

_Generated 2026-05-17 by `scripts/build-tier-mapping.mjs`._

This file is the single source of truth for **which Squarespace products belong to
which commercial money-page tier** on alanranger.com. It is built by joining:

1. `alan-shared-resources/csv/raw-01-products-sqsp-export.csv` (Squarespace product export)
2. `alan-shared-resources/csv processed/05-event-product-mappings-latest.csv` (event ↔ product links)
3. The tier classifier in `api/aigeo/commercial-tier.js` (URL + product-name + category fallback)

The product list is **deduped by Product ID** (Squarespace exports one row per variant).
Hidden products (`Visible = No`) are excluded.

## Summary by tier

| Commercial tier | Unique products | Linked event pages | Price range |
| --- | --- | --- | --- |
| Workshops | 34 | 62 | £15 - £1595 |
| Courses | 5 | 37 | £150 - £495 |
| 1-2-1 & Services (revenue gap) | 9 | 0 | £15 - £1200 |
| Hire / Commercial (revenue gap) | 3 | 0 | £50.57 - £135.95 |
| Academy (revenue gap) | 0 | 0 | - - - |
| Other / unclassified | 0 | 0 | - - - |

> **Why "(revenue gap)" matters:** Two of the five commercial tiers - **Hire**
> and **Academy** - and a chunk of **Services** revenue do not flow through the
> Squarespace Commerce store. See the gap callouts under each tier below for the
> exact reason and what's needed to capture them.

## Site structure model

The site has a 3-layer hierarchy per tier:

```
HUB (top-level money page)
  └── LANDING / SERVICE PAGE (sub-hubs, multiple per tier)
        └── PRODUCT BLOCK (Squarespace product, the bookable thing)
              └── EVENT PAGE (dated occurrences for courses/workshops only)
```

For the 5 commercial tiers, the hierarchy looks like:

| Tier | Hub | Landing/service sub-pages | Squarespace store page | Bookable products |
| --- | --- | --- | --- | --- |
| Workshops | `/photography-workshops` | 5 landings | `/photo-workshops-uk/` | 34 |
| Courses | `/photography-courses-coventry` | 10 landings | `/photography-services-near-me/` | 5 |
| Services | `/photography-tuition-services` | 10 landings | `/photography-services-near-me/` | 9 + Acuity |
| Hire | `/hire-a-professional-photographer-in-coventry` | 7 landings | `/photography-services-near-me/` | 3 (prints only) + off-platform |
| Academy | `/free-online-photography-course` | 3 landings | _(Member Areas)_ | £79/yr membership |


## Workshops

**Hub:** `/photography-workshops`

**Landing pages in this tier:**
- `/photography-workshops`
- `/photographic-workshops-near-me`
- `/photo-workshops-uk`
- `/landscape-photography-workshops`
- `/one-day-landscape-photography-workshops`


**Squarespace store pages used by this tier:**
- `/photo-workshops-uk/` - 34 products

**Products (34) in this tier:**

| Product page | Product title | Price | Variants | Events | Squarespace ID |
| --- | --- | --- | --- | --- | --- |
| `/photo-workshops-uk/landscape-photography-workshops-anglesey` | ANGLESEY Landscape Photography Workshop -  May 2027 | £975 | 1 | 1 | `5d35e3d43891800001d08ea9` |
| `/photo-workshops-uk/batsford-arboretum-photography-workshops` | BATSFORD Arboretum Autumn Photography Workshops 23 - 31 Oct | £125 | 1 | 6 | `5ba27ee7cd83662812f383a9` |
| `/photo-workshops-uk/bluebell-woodlands-photography-workshops` | BLUEBELL WOODLANDS Photography - Warks - 20 Apr- 30 Apr | £125 | 1 | 11 | `5c2c8834c2241bc8b409723c` |
| `/photo-workshops-uk/long-exposure-photography-workshops-burnham` | BURNHAM ON SEA Long Exposure Photography Workshop 1 Aug | £95 | 1 | 1 | `5cf3fbeac83f430001d51443` |
| `/photo-workshops-uk/christmas-photography-workshops` | Christmas Photography Seasonal Workshops \| Warwickshire | £50 | 1 | 0 | `5dcc0172b5374e1d7824be37` |
| `/photo-workshops-uk/dartmoor-photography-landscape-workshop` | DARTMOOR Photography Workshop - Landscapes - 9th - 11th Oct | £875 | 1 | 1 | `651aa989c83e3c0339e3340a` |
| `/photo-workshops-uk/dorset-landscape-photography-workshop` | DORSET Landscape Photography Workshop Purbeck 25 - 27 Sep | £925 | 1 | 1 | `5dde6365e59abc3a72382ab2` |
| `/photo-workshops-uk/exmoor-photography-workshops-lynmouth` | EXMOOR Photography Workshop - Sat 23rd - Sun 24th May 2026 | £575 | 1 | 1 | `644522e64d4b020935b4fd3f` |
| `/photo-workshops-uk/long-exposure-photography-workshop-fairy-glen` | FAIRY GLEN and Fairy Falls Long Exposure Photography | £125 | 1 | 2 | `5cc817ebf9619ad23bf0ea6c` |
| `/photo-workshops-uk/fireworks-photography-workshop-kenilworth` | Fireworks Photography Workshop \| Long Exposure \| Kenilworth | £75 | 1 | 2 | `63594ef26db66b1bd58e000f` |
| `/photo-workshops-uk/landscape-photography-wales-photo-workshop` | GOWER Landscape Photography Wales - 28 Aug - 30 Aug 2026 | £825 | 1 | 1 | `61952249ff6ee011961c2a97` |
| `/photo-workshops-uk/ireland-photography-workshops-dingle` | KERRY - Southern Ireland Photography Workshop - Mar 2026 | £1595 | 1 | 0 | `5d814673c92e2260b6deb11b` |
| `/photo-workshops-uk/lake-district-photography-workshop` | LAKE DISTRICT Photography Workshops - Jan - Mar - Sep - Nov | £1125 | 1 | 4 | `5cfcd2e5d316ce00011602b3` |
| `/photo-workshops-uk/landscape-photography-devon-hartland-quay` | Landscape Photography DEVON Workshops - Various Dates | £895 | 1 | 1 | `5cadde664e17b65642ad1f9e` |
| `/photo-workshops-uk/landscape-photography-snowdonia-workshops` | Landscape Photography SNOWDONIA - Sat 26 - Sun 27 Sep 2026 | £595 | 1 | 1 | `5dde5e6678ecef62376b7767` |
| `/photo-workshops-uk/landscape-photography-workshop-norfolk` | Landscape Photography Workshop NORFOLK - Coastal 20 - 22 Nov | £1075 | 1 | 1 | `5d67be2133f508000120c936` |
| `/photo-workshops-uk/yorkshire-dales-photography-workshops` | Landscape YORKSHIRE DALES Photography Workshop - 16 - 18 Apr | £895 | 1 | 2 | `5dcc08ddb5374e1d78252ae6` |
| `/photo-workshops-uk/photography-workshops-lavender-fields` | LAVENDER FIELD Photography Workshop - Gloucestershire July | £150 | 1 | 2 | `5cf4045aa71de400015cf81f` |
| `/photo-workshops-uk/long-exposure-photography-kenilworth` | Long Exposure Photography Workshop KENILWORTH Sunset | £65 | 1 | 2 | `5e26cd276764070705ec2a0d` |
| `/photo-workshops-uk/abstract-and-macro-photography-workshops` | MACRO Photography Workshops Warwickshire - Feb and Mar | £65 | 1 | 1 | `5dca98092391642d185a3e0f` |
| `/photo-workshops-uk/landscape-photography-workshops-nant-mill` | NANT MILL Woodlands and Waterfalls Photo Workshop 30 May | £125 | 1 | 0 | `5d6781f08fc07e0001679882` |
| `/photo-workshops-uk/north-yorkshire-landscape-photography` | NORTH YORKSHIRE Landscape Photography Workshop - Sep 2026 | £1495 | 1 | 0 | `5dd7d7aaf1ff1e5b1babea6b` |
| `/photo-workshops-uk/coastal-northumberland-photography-workshops` | NORTHUMBERLAND Photography Workshops - Mar 18 - 21 | £995 | 1 | 1 | `5d46d53ed73cd50001207bd8` |
| `/photo-workshops-uk/peak-district-heather-photography-workshop` | PEAK DISTRICT HEATHER Photography Workshops - 15-16 Aug | £145 | 1 | 2 | `64453699bf740f5d5d817498` |
| `/photo-workshops-uk/landscape-peak-district-photography-workshops-derbyshire` | PEAK DISTRICT Photography Workshops - May, Oct and Nov | £175 | 1 | 4 | `5d15dc975ecd1700017d2678` |
| `/photo-workshops-uk/photography-workshops-chesterton-windmill` | Photography Workshops CHESTERTON WINDMILL - Warwickshire | £65 | 1 | 3 | `5cadd08815fcc0f9e6591598` |
| `/photo-workshops-uk/poppy-fields-photography-workshops` | Poppy Fields Photography Workshops \| Worcestershire | £95 | 1 | 0 | `5cc6acfeb2512d0001944b6a` |
| `/photo-workshops-uk/sezincote-garden-photography-workshop` | SEZINCOTE Garden Photography Workshop - Gloucs 29 May | £55 | 1 | 1 | `64465cd72c9e8f3806783982` |
| `/photo-workshops-uk/suffolk-landscape-photography-workshops` | SUFFOLK Landscape Photography Workshops - 5th-7th Feb | £1075 | 1 | 1 | `5dcc10bf22360a310f7b155c` |
| `/photo-workshops-uk/garden-photography-workshop` | The Art of GARDEN PHOTOGRAPHY  - Coventry -  May and July | £35 | 1 | 2 | `612b52cc22f4ea70425a22b2` |
| `/photo-workshops-uk/secrets-of-woodland-photography-workshop` | The Secret of WOODLAND PHOTOGRAPHY- 1-Day Jan, Apr, Aug, Oct | £150 | 1 | 4 | `64944ec344451161154f25d7` |
| `/photo-workshops-uk/urban-architecture-photography-workshops-coventry` | URBAN ARCHITECTURE Photography Workshops - Coventry 9 Sep | £65 | 1 | 1 | `5e26c228cbdce948ffa3a507` |
| `/photo-workshops-uk/wales-photography-workshop-pistyll-rhaeadr` | WALES Photography Workshop \| Lake Vyrnwy 30-31 May | £625 | 1 | 1 | `5ddba51cd84dd30db44a0d93` |
| `/photo-workshops-uk/woodland-photography-walk-warwickshire` | WARWICKSHIRE Woodland PHOTOGRAPHY WALKS - Monthly - 2hrs | £15 | 1 | 1 | `55782219e4b0d550f907de55` |

## Courses

**Hub:** `/photography-courses-coventry`

**Landing pages in this tier:**
- `/photography-courses-coventry`
- `/beginners-photography-lessons`
- `/beginners-photography-classes`
- `/photo-editing-course-coventry`
- `/lightroom-courses-for-beginners-coventry`
- `/black-and-white-photography-course-coventry`
- `/photography-masterclasses`
- `/intentions-course-six-month-photography-project`
- `/intermediates-intentions`
- `/intermediates-lightroom`


**Squarespace store pages used by this tier:**
- `/photography-services-near-me/` - 5 products

**Products (5) in this tier:**

| Product page | Product title | Price | Variants | Events | Squarespace ID |
| --- | --- | --- | --- | --- | --- |
| `/photography-services-near-me/beginners-photography-course` | Beginners Photography Course \| 3 Weekly Evening Classes | £150 | 1 | 28 | `5cac6142e2c483ccc66e32c6` |
| `/photography-services-near-me/beginners-portrait-photography-course` | Beginners Portrait Photography Course - Coventry - 1 Day | £195 | 1 | 0 | `5db45dcd118b996830e61700` |
| `/photography-services-near-me/intermediates-intentions-photography-project-course` | Intermediates Intentions Photography Project Course | £495 | 1 | 0 | `5cacaff0971a185e7818aa12` |
| `/photography-services-near-me/lightroom-courses-for-beginners-coventry` | Lightroom Courses for Beginners Photo Editing - Coventry | £150 | 1 | 9 | `53d3bd62e4b02158d29bb1a9` |
| `/photography-services-near-me/black-and-white-photography-course` | Professional Black and White Photography Course \| Coventry | £165 | 1 | 0 | `53d3b67be4b0984ca9af4ded` |

## 1-2-1 & Services

**Hub:** `/photography-tuition-services`

**Landing pages in this tier:**
- `/photography-tuition-services`
- `/private-photography-lessons`
- `/photography-lessons-online-121`
- `/photography-mentoring-online-assignments`
- `/monthly-online-photography-mentoring`
- `/rps-mentoring`
- `/rps-courses-mentoring-distinctions`
- `/photography-gift-vouchers`
- `/photography-payment-plan`
- `/photography-services-near-me/camera-sensor-clean`


**Squarespace store pages used by this tier:**
- `/photography-services-near-me/` - 9 products

> **Coverage gap:** Private 1-2-1 photography lessons and ongoing mentoring sessions
> are booked via **Acuity Scheduling** ([https://acuityscheduling.com](https://acuityscheduling.com)),
> which **bypasses the Squarespace Commerce store**. The Acuity API requires the
> Powerhouse plan (currently locked out with HTTP 403). Until the plan is upgraded
> *or* a Stripe Secret Key is added, this revenue is invisible to the Revenue Funnel
> sync.

**Products (9) in this tier:**

| Product page | Product title | Price | Variants | Events | Squarespace ID |
| --- | --- | --- | --- | --- | --- |
| `/photography-services-near-me/four-private-photography-classes` | 4 x 2hr Private Photography Classes - Face to Face Coventry | £480 | 1 | 0 | `5ba115d388251bcae140b69c` |
| `/photography-services-near-me/annual-pick-n-mix-subscription` | Annual Pick N Mix Subscription \| Interest Free Payment Plan | £1200 | 1 | 0 | `5bf2ba47575d1f96f71de175` |
| `/photography-services-near-me/monthly-online-photography-mentoring` | Monthly Photography Mentoring Sessions - Online - Zoom | £15 | 1 | 0 | `5bf2bc0f352f533b08d31d0a` |
| `/photography-services-near-me/monthly-pick-n-mix-subscription` | Monthly Pick N Mix Subscription \| Interest Free Payment Plan | £42 | 1 | 0 | `5bf2b2b2aa4a996c65c36a71` |
| `/photography-services-near-me/private-online-photography-classes-zoom` | Online Photography Classes 121 - Zoom - Package Options | £50 | 1 | 0 | `653b74e7c4d5ef5558553e1f` |
| `/photography-services-near-me/photo-print-preparation-service-30min` | Photo Print Preparation Service 30-min – File Check & Advice | £29 | 1 | 0 | `68a4c383a807f03e768c409d` |
| `/photography-services-near-me/camera-sensor-clean` | Professional Digital DSLR Camera Sensor Clean \| Coventry | £30 | 1 | 0 | `53d3d368e4b0f70dee8dc2e7` |
| `/photography-services-near-me/quarterly-pick-n-mix-subscription` | Quarterly Pick N Mix Subscription \| Interest Free Payments | £250 | 1 | 0 | `5bf2b5901ae6cf7a69626ba4` |
| `/photography-services-near-me/rps-mentoring-photography-course` | RPS Courses - Independent RPS Mentoring for RPS Distinctions | £295 | 1 | 0 | `53d3be3be4b0498d331bd7a9` |

## Hire / Commercial

**Hub:** `/hire-a-professional-photographer-in-coventry`

**Landing pages in this tier:**
- `/hire-a-professional-photographer-in-coventry`
- `/professional-commercial-photographer-coventry`
- `/professional-photographer-near-me`
- `/portrait-photography`
- `/corporate-photography-training`
- `/product-photographer`
- `/property-photographer`


**Squarespace store pages used by this tier:**
- `/photography-services-near-me/` - 3 products

> **Coverage gap:** The hire-tier landing pages (`/professional-commercial-photographer-coventry`,
> `/portrait-photography`, `/corporate-photography-training`,
> `/professional-photographer-near-me`) embed image-block links to
> `/products-and-services/{hash}` URLs that **are not real Squarespace Commerce
> products** - they're navigation/portfolio tiles. The only true Hire-tier products
> in the Squarespace store are the 3 Fine Art Print SKUs above. Live commercial
> photography work (headshots, product, property, corporate training) is invoiced
> **off-platform** and will not appear in the Squarespace Orders API.

**Products (3) in this tier:**

| Product page | Product title | Price | Variants | Events | Squarespace ID |
| --- | --- | --- | --- | --- | --- |
| `/photography-services-near-me/fine-art-photography-prints-canvas` | Fine Art Photography Prints - Canvas wrap-round - Multi Size | £135.95 | 1 | 0 | `5d2b1f9f80735f000178c809` |
| `/photography-services-near-me/fine-art-photography-prints-unframed` | Fine Art Photography Prints - Unframed Prints - Multi Sizes | £50.57 | 1 | 0 | `5d2dcae32daa030001a6d19e` |
| `/photography-services-near-me/framed-fine-art-photography-prints` | Framed Fine Art Photography Prints - Multiple Sizes | £133.85 | 1 | 0 | `5d2dd5d69a283b00018be5b0` |

## Academy

**Hub:** `/free-online-photography-course`

**Landing pages in this tier:**
- `/free-online-photography-course`
- `/free-photography-course`
- `/academy`


> **Coverage gap:** The £79/year Academy annual membership is sold via
> **Squarespace Member Areas**, which is a different Squarespace product type from
> Commerce. Member Areas subscriptions **do not** appear in the standard
> `/api/1.0/commerce/orders` endpoint - they're managed under
> `/config/member-areas` and only surface via Stripe. The Pocket Guide series
> (`#04 Top 10 Tips`, `composition-viewing-frames`, etc) are Commerce products
> but use legacy URL paths that aren't on the current site. To capture Academy
> revenue, the Revenue Funnel needs Stripe API access or a CSV export from Member
> Areas.

**Products (0) in this tier:**

_No products classified into this tier._

## Other / unclassified

Products the classifier could not place into one of the 5 money-page tiers.
Review these and tell me which tier each one belongs to so the rules can be updated.

_No products classified into this tier._

---

## Revenue-capture truth table

| Tier | Squarespace API captures it? | What's needed for full capture |
| --- | --- | --- |
| Workshops | YES (all 34 products) | nothing - already complete |
| Courses | YES (all 5 products + 37 event variants) | nothing - already complete |
| Services - Pick N Mix / Mentoring / RPS / Sensor / Print Prep | YES | nothing |
| Services - private 1-2-1 lessons via Acuity | **NO** | Acuity Powerhouse upgrade ($45/mo) **OR** Stripe Secret Key |
| Hire - Fine Art Prints (3 SKUs) | YES | nothing |
| Hire - live commercial / headshots / property / corporate training | **NO** | off-platform invoicing - needs Stripe or manual entry |
| Academy - £79/yr membership (Member Areas) | **NO** | Stripe Secret Key (membership uses Stripe Subscriptions) |

## How to use this for review

1. Skim the **Other / unclassified** section first - those are the highest-value to triage.
2. Within each tier, eyeball the **Product title** column - if you spot a product in the wrong tier, note the Product ID.
3. Reply with: `<Product ID> belongs in <tier>` and I'll patch `api/aigeo/commercial-tier.js` accordingly.

The CSV companion (`commercial-tier-mapping.csv`) is in the same folder for spreadsheet review.
