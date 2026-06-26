# Revenue Hub Attribution (§9 Revenue Funnel Diagnosis)

How the §9 hub cards decide which Booking-Sheet revenue belongs to which hub page.
Read this before changing `api/aigeo/revenue-funnel-product-breakdown.js`,
`api/aigeo/revenue-funnel-diagnosis.js`, or the §9 hub product table UI in
`lib/revenue-truth-section9-ui.mjs`.

Last updated: 2026-06-26.

---

## The two Booking-Sheet tags that drive attribution

Every booking-sheet transaction row (`public.booking_sheet_transactions`) carries
two user-maintained tags that matter here:

| Column | Field | Meaning |
|---|---|---|
| **I** | `canonical_product` | The product the booking maps to. Joined to `canonical_products.product_title` → `service_page_url` → hub page. |
| **J** | `landing_page_url` | The hub/landing page Alan wants this booking attributed to. **Authoritative** when set. |

### Rule: Column J wins (landing-page-authoritative)

A transaction with a **Column-J `landing_page_url`** belongs to **that hub card**,
overriding the `canonical_product → service_page_url` mapping from Column I.

**Why this rule exists — the combined Acuity-block problem.** Some engagements are
booked through a *shared* Acuity block, so they all carry the same combined
`canonical_product` even though they belong to different hubs. The canonical
example:

- **Property / interior photography** is booked through the **same Acuity block**
  as commercial/product shoots, so those rows have
  `canonical_product = "Commission - Commercial / Product Shoot"` (Column I),
  whose product maps to `/professional-commercial-photographer-coventry`.
- The only thing that distinguishes a property job is Alan tagging
  `landing_page_url = https://www.alanranger.com/property-photographer-coventry`
  (Column J).
- Without the Column-J rule, all property revenue would be stuck on the commercial
  hub card. With it, those rows move to the property hub card.

**Alan's workflow:** keep booking through the shared Acuity block (leave Column I
as the combined product) and just set **Column J** to the hub URL you want the
booking credited to. No need to invent per-hub product tags in Column I.

---

## How the breakdown API applies the rule

`api/aigeo/revenue-funnel-product-breakdown.js` (`?page=<slug>`):

1. `fetchProductsForSlug(slug)` — canonical products whose `service_page_url` maps
   to this hub. **If none, the endpoint returns an empty payload** — so a hub only
   appears if it has at least one `canonical_products` row (this is why a new hub
   like `/property-photographer-coventry` needs a dedicated `canonical_products`
   row even if no booking is tagged to it by Column I).
2. `fetchTxnsForProducts(titles)` — txns matching this page's products (Column I).
3. `fetchTxnsLandedOnPage(slug)` — txns whose `landing_page_url` slug matches this
   hub (Column J), regardless of product.
4. `buildProductBreakdown(products, txns, landingTxns, ctx)`:
   - **Drop** product-tagged txns whose Column-J slug points to a *different* hub
     (they now belong to that other hub — this removes them from the source card).
   - **Orphan rows** (`buildLandingOrphanRows`): txns landed on this hub whose
     `canonical_product` maps elsewhere are grouped by product and flagged
     `landing_attributed: true`.

Because the rule is symmetric (drop-from-source + add-to-target), **the same
revenue can never appear on two cards.**

### UI marker

`lib/revenue-truth-section9-ui.mjs` renders orphan rows with a small
**`landing-tagged`** pill (tooltip explains Column-J / Acuity attribution).

### Worked example (verified live 2026-06-26)

5 property bookings, £570, Column I = `Commission - Commercial / Product Shoot`,
Column J = `…/property-photographer-coventry`:

- **Property hub card** (`/property-photographer-coventry`): shows the £570 as a
  `landing-tagged` orphan row; its own dedicated product
  (`Commission - Property / Interior Photographer (Coventry)`) shows £0 (no Column-I
  txns).
- **Commercial hub card** (`/professional-commercial-photographer-coventry`): the
  `Commission - Commercial / Product Shoot` row drops from 16 → **11 txns**; the
  £570 no longer appears here.

---

## What is NOT affected

- **Commissions / any tier total** is **category-driven** (booking-sheet category,
  e.g. `11 Commissions`), not card-driven. Column-J re-tagging only re-splits
  revenue *between* hub cards inside a tier — it never changes the tier headline.
- The small per-card **"Window £" header tile** comes from a *different* data path
  (the GSC↔revenue join keyed on `page_slug`, `revenue_gsc_joined_with_policy`),
  not the product breakdown. It may still read £0 for a hub whose revenue is only
  Column-J-attributed. The detailed product table inside the card is where
  landing-tagged revenue shows. (Make the tile landing-page-aware only if asked.)

---

## New / low-data hub visibility gate

`api/aigeo/revenue-funnel-diagnosis.js` hides pages in `insufficient_data` state by
default: **under 1,000 impressions OR fewer than 6 months of GSC history**
(`isInsufficientData`). A new hub (e.g. property) is therefore hidden until it
clears the gate.

- The **"Show new / low-data pages"** toggle in the §9 header
  (`#rt-diag-show-new` in `audit-dashboard.html` → controller `rtDiagShowNewPages`
  → `&includeAllPages=true`) reveals them.
- **Do not default this on:** (1) it floods §9 with every low-signal page; (2) the
  diagnosis API intentionally **does not server-cache** `includeAllPages=true`
  responses (`cacheable = !opts.pages && !opts.includeAllPages`), so the slowest
  tab would lose its cache and recompute every load.
- A page only gets a `tier_key` (and joins a tier) if it has a `canonical_products`
  row. `assignTiersToDiagnostics` runs *before* the `insufficient_data` filter, so
  `d.tier_key` is available if a future change ever wants to always-show mapped
  hubs (considered 2026-06-26, left unchanged at Alan's request).

---

## Related files

- `api/aigeo/revenue-funnel-product-breakdown.js` — per-product breakdown + the
  Column-J authoritative attribution logic.
- `api/aigeo/revenue-funnel-diagnosis.js` — page classification, `insufficient_data`
  gate, `includeAllPages`, server cache rule.
- `lib/revenue-truth-section9-ui.mjs` — §9 hub product table + `landing-tagged` pill.
- `lib/revenue-truth-controller.mjs` — `rtDiagShowNewPages` state + toggle handler.
- `Docs/REVENUE-TRUTH-FROM-BOOKING-SHEET.md` — the 12-category revenue truth (tier
  totals live here; this doc only covers the *card-level split*).
