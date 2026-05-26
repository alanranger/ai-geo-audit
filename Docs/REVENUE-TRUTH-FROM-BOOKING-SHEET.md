# Revenue Truth — Booking Sheet is the Single Source

**Status:** ✅ IMPLEMENTED in Phase L (2026-05-26) with correction in Phase L1 (same day). Schema, parser, importer and four reader paths are live; data reconciles to the penny against YTD Actual for both 2025 and 2026 YTD.
**Date:** 2026-05-26.
**Supersedes:** `Docs/REVENUE-DATA-AUDIT.md` "Trustworthy monthly revenue series" section. That table summed Squarespace API + Stripe API + `booking_sheet`-source rows and produced **£72,251.50** as the 17-month total. **That figure is wrong — it double-counts.** This document replaces it.

**British English used throughout. All money in GBP.**

---

## Phase L1 correction — three tier systems, not one

Phase L initially rolled the 12 verbatim Booking Sheet categories into 5 invented "tiers" (`courses`, `workshops_nonres`, `workshops_residential`, `services`, `academy`). The `services` bucket merged eight unrelated categories (D2C, B2B and ADJUSTMENT lines) into one figure that corresponded to nothing real. Phase L1 deletes the invented rollup and replaces it with the right model — three separate tier systems:

1. **Accounting categories (12)** — what was bought. Verbatim Booking Sheet categories. Revenue truth layer. Stored in `public.booking_sheet_monthly_category`. Never merged.
2. **Business market (3)** — who the customer is. Derived attribute per category:
   - **D2C** — `1. Courses/masterclasses`, `2. Workshops Non Residential`, `3. Workshops Residential`, `6. Mentoring`, `7. 1-2-1`, `12. Academy`
   - **B2B** — `10. Prints & Royalties`, `11 Commissions`
   - **ADJUSTMENT** — `4. Pick n Mix Inc`, `5. Pick n Mix Out`, `8. Gift Vouchers Inc`, `9. Gift Vouchers Out`. **Not revenue** — deferred-spend accounting plumbing (advance purchase booked `Inc`, then credited `Out` against the D2C category it is eventually spent on). Nets toward zero. Shown on the dashboard as its own labelled line, never silently in or out of the headline.

   The mapping is stored as DATA in `public.booking_sheet_category_market` (12 rows), joined by the wide view. Editing the table changes the dashboard without a code release.
3. **Page tiers (A–F: Landing, Product, Event, Blog, Academy, Unmapped)** — where on the website the journey happens. SEO/money-pages classification. **Stays out of the revenue data layer entirely.** The two systems meet only via the `market` attribute on money pages (a separate follow-up, not done yet).

**Headline rules (locked by Alan 2026-05-26 — REVISED, see history note below):**

- **Primary headline** = `revenue_amount` = **full 12-category sum** = **the spreadsheet YTD Actual cell** (J47 for 2025, J48 for 2026). The dashboard headline MUST equal the figure the user reads on the Booking Sheet — anything else destroys trust on every glance.
  - 2025 headline = **£46,567.46**
  - 2026 YTD headline = **£19,598.04**
- **Tier-band comparison** (survival £3k / comfortable £5k / thrive £8k bands) is also against `revenue_amount`, so "which tier am I in" matches what the spreadsheet says.
- **Secondary breakdown line** = `operational_revenue` = D2C + B2B, labelled **"service revenue (excl. voucher timing)"**. Shown beneath the headline.
- **ADJUSTMENT** = `adjustment_net`, shown as its own visible labelled line (e.g. "voucher / deferred-spend timing: −£1,228.75") so the user can see headline = operational + adjustment at a glance.
- **Import gate** verifies `SUM(12 categories) === YTD Actual` to the penny. The gate proves the import is complete. The headline is `revenue_amount` (which IS the gate's basis), so the on-screen number and the import-gate number are the same number.

> **Headline-decision history (kept honest):** an earlier draft of this section locked in `operational_revenue` (D2C + B2B) as the primary headline with `revenue_amount` as the secondary "incl. timing adjustment" figure. That was reversed on 2026-05-26 before any UI work shipped: the user's live workflow reads the Booking Sheet `Sales YYYY` row 18 (= `revenue_amount`) constantly, and a dashboard headline that differs from the spreadsheet by £1,229 in either direction destroys trust the moment they cross-check it. The data layer doesn't change — both fields are already on the matview — only which field the UI reads for the headline + tier-band comparison.

**Sparklines** on the Revenue Funnel tab will be three lines on one chart (D2C, B2B, ADJUSTMENT) on a shared `revenue_amount`-basis y-axis, in the UI rebuild turn that follows Phase L1. The sparkline breakdown is per-market; the bar / headline total each month is `revenue_amount` (so the three lines sum to the bar, with ADJUSTMENT visible as its own line).

---

## 1. The conceptual error the previous audit made

The previous audit treated the three `source` values in `revenue_snapshots` as if they were independent revenue streams that could be summed:

- `squarespace_api` — orders pulled from the Squarespace Orders API
- `stripe_supplemental` — Stripe charges with Squarespace-Commerce stamped charges deliberately excluded
- `booking_sheet` — selected funding rows imported from the user's `.xlsm` (Bank + PayPal + Cash + voucher re-attribution; Stripe rows excluded)

The exclusions were designed so the three streams "wouldn't overlap". They **still do**:

- Every Squarespace order paid by a Bank Transfer arrives **once** in the Squarespace Orders API (the customer's order was placed on the SQ site) **and again** in the Booking Sheet (recorded as the Bank receipt). Summing the two double-counts that money.
- The same customer may also generate Acuity follow-up sessions in Stripe, mentoring deposits in the Booking Sheet, etc.
- There is no transaction-level join between SQ orders, Stripe charges, and Booking Sheet rows. A sum of these sources can never be reconciled.

The user has now stated the rule plainly:

> **"The Booking Sheet is the SINGLE SOURCE OF TRUTH for total revenue. It is not one of three streams to be summed. The Squarespace and Stripe APIs are useful only for transaction-level DETAIL (product names, dates), never as additive revenue totals."**

This document operates under that rule.

---

## 2. What was extracted, and from where

**Files read (read-only, from the user's Dropbox):**

- `G:/Dropbox/1. Bookings/Booking Sheet 2025 - Alan Ranger Photography.xlsm`, tab **`Sales 2025`**
- `G:/Dropbox/1. Bookings/Booking Sheet 2026 - Alan Ranger Photography.xlsm`, tab **`Sales 2026`**

**Method:** `scripts/audit-booking-sheet-truth.mjs` (run 2026-05-26 20:35 local). Output saved verbatim at `scripts/audit-bs-output.json`. Nothing was written to Supabase. The extractor anchors on `"Tuition Categories"` (2025 sheet) or `"Sales Categories"` (2026 sheet) in column **I** at row **5**, then reads:

| Column | Excel | Contains |
|---|---|---|
| Label | I | category name (e.g. "1. Courses/masterclasses") |
| Target | J | annual target |
| Months Jan→Dec | K..V | the **12 monthly actuals** |
| Year total | W | the category's row total |

Categories are rows 6..17. The "Totals" row is row 18. The master annual figure ("YTD Actual") sits at cell **J47** on `Sales 2025` and **J48** on `Sales 2026`.

**Self-check at extraction time:** for **every** category on both sheets, `sum(monthly[Jan..Dec]) === yearTotal` to the penny (`sumMatchesYearTotal: true` for all 26 rows). The two sheets are internally consistent.

---

## 3. Reconciliation against the user's stated truth

| Year | Sum of 12 monthly Totals row cells | "YTD Actual" cell | User-stated truth | Delta |
|---|---:|---:|---:|---:|
| 2025 (Jan–Dec, full year) | **£46,567.46** | **£46,567.46** (J47) | **£46,567.46** | **£0.00** |
| 2026 YTD (Jan–May) | **£19,598.04** | **£19,598.04** (J48) | **£19,598.04** | **£0.00** |
| **Combined** | **£66,165.50** | — | — | **£0.00** |

**Perfect match.** No silent adjustments. The Booking Sheet, as extracted, IS the user's stated revenue truth.

---

## 4. Sales 2025 — per category × per month (the truth)

All values in £. Negative lines are voucher / Pick-n-Mix re-attribution that move money between categories (net zero across the in/out pair). The "Totals" row is the user's authoritative monthly figure.

| Category | Target | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec | **Year** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1. Courses / masterclasses | 800 | 425.00 | 0.00 | 0.00 | 600.00 | 1,200.00 | 450.00 | 1,500.00 | 775.00 | 0.00 | 420.00 | 2,640.00 | 570.00 | **8,580.00** |
| 2. Workshops Non-Residential | 1,200 | 497.00 | 328.00 | 1,312.00 | 1,193.00 | 1,172.00 | 3,437.20 | 2,380.00 | 634.00 | 1,894.00 | 1,022.00 | 940.00 | 4,088.00 | **18,897.20** |
| 3. Workshops Residential | 1,000 | 3,404.00 | 995.00 | 0.00 | 0.00 | 0.00 | 2,620.00 | 895.00 | 82.40 | 750.00 | 0.00 | 0.00 | 0.00 | **8,746.40** |
| 4. Pick n Mix Inc | 150 | 250.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 1,200.00 | 0.00 | 0.00 | 0.00 | **1,450.00** |
| 5. Pick n Mix Out | −100 | −845.75 | −65.00 | 0.00 | 0.00 | 0.00 | −1,120.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | **−2,030.75** |
| 6. Mentoring | 80 | 85.00 | 55.00 | 70.00 | 50.00 | 200.00 | 50.00 | 35.00 | 35.00 | 35.00 | 35.00 | 275.00 | 40.00 | **965.00** |
| 7. 1-2-1 | 800 | 780.00 | 600.00 | 315.00 | 150.00 | 1,260.00 | 365.00 | 1,055.00 | 0.00 | 755.00 | 505.00 | 240.00 | 65.00 | **6,090.00** |
| 8. Gift Vouchers Inc | 225 | 0.00 | 0.00 | 0.00 | 0.00 | 125.00 | 400.00 | 0.00 | 100.00 | 150.00 | 65.00 | 0.00 | 100.00 | **940.00** |
| 9. Gift Vouchers Out | −150 | −589.00 | 0.00 | −100.00 | −50.00 | −150.00 | 0.00 | −300.00 | −99.00 | 0.00 | 0.00 | −300.00 | 0.00 | **−1,588.00** |
| 10. Prints & Royalties | 100 | 67.61 | 70.84 | 80.83 | 0.00 | 0.00 | 87.10 | 0.00 | 0.00 | 14.48 | 0.00 | 279.80 | 41.95 | **642.61** |
| 11. Commissions | 500 | 150.00 | 335.00 | 0.00 | 0.00 | 225.00 | 800.00 | 0.00 | 75.00 | 0.00 | 695.00 | 0.00 | 400.00 | **2,680.00** |
| 12. Academy | 50 | 75.00 | 25.00 | 30.00 | 25.00 | 60.00 | 50.00 | 135.00 | 25.00 | 310.00 | 350.00 | 20.00 | 90.00 | **1,195.00** |
| **Totals (row 18)** | **4,655** | **4,298.86** | **2,343.84** | **1,707.83** | **1,968.00** | **4,092.00** | **7,139.30** | **5,700.00** | **1,627.40** | **5,108.48** | **3,092.00** | **4,094.80** | **5,394.95** | **46,567.46** |

YTD Actual cell **J47** = **£46,567.46** — matches the row 18 sum exactly.

---

## 5. Sales 2026 — per category × per month (the truth, YTD = Jan–May)

| Category | Target | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Sep | Oct | Nov | Dec | **Year-to-date** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1. Courses / masterclasses | 666.67 | 750.00 | 450.00 | 150.00 | 750.00 | 290.00 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **2,390.00** |
| 2. Workshops Non-Residential | 1,666.67 | 1,158.00 | 595.00 | 706.00 | 2,219.00 | 0.00 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **4,678.00** |
| 3. Workshops Residential | 833.33 | 2,175.00 | 2,415.00 | 0.00 | 2,720.00 | 0.00 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **7,310.00** |
| 4. Pick n Mix Inc | 100 | 0.00 | 286.00 | 0.00 | 0.00 | 0.00 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **286.00** |
| 5. Pick n Mix Out | −100 | −1,020.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **−1,020.00** |
| 6. Mentoring | 80 | 20.00 | 20.00 | 20.00 | 20.00 | 0.00 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **80.00** |
| 7. 1-2-1 | 800 | 300.00 | 50.00 | 770.00 | 190.00 | 130.00 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **1,440.00** |
| 8. Gift Vouchers Inc | 83 | 0.00 | 450.00 | 0.00 | 200.00 | 150.00 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **800.00** |
| 9. Gift Vouchers Out | −100 | 0.00 | 0.00 | 0.00 | −325.00 | 0.00 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **−325.00** |
| 10. Prints & Royalties | 100 | 236.67 | 0.00 | 141.62 | 32.75 | 0.00 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **411.04** |
| 11. Commissions | 250 | 600.00 | 150.00 | 1,295.00 | 200.00 | 0.00 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **2,245.00** |
| 12. Academy | 666.67 | 553.00 | 158.00 | 316.00 | 59.00 | 217.00 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **1,303.00** |
| **Totals (row 18)** | **5,046.33** | **4,772.67** | **4,574.00** | **3,398.62** | **6,065.75** | **787.00** | **0** | **0** | **0** | **0** | **0** | **0** | **0** | **19,598.04** |

YTD Actual cell **J48** = **£19,598.04** — matches the row 18 sum exactly.

Note: 2026-05 shows only £787 because May is still in progress at the time of extraction. This is partial-month data, not a downturn — the figure will increase as bookings complete the month.

---

## 6. The single-source-of-truth monthly series (17 months, 2025-01 → 2026-05)

This is the **only** "monthly revenue series" anyone should quote. It is the row-18 "Totals" line from each sheet, concatenated.

| YYYY-MM | True monthly revenue (£) |
|---|---:|
| 2025-01 | 4,298.86 |
| 2025-02 | 2,343.84 |
| 2025-03 | 1,707.83 |
| 2025-04 | 1,968.00 |
| 2025-05 | 4,092.00 |
| 2025-06 | 7,139.30 |
| 2025-07 | 5,700.00 |
| 2025-08 | 1,627.40 |
| 2025-09 | 5,108.48 |
| 2025-10 | 3,092.00 |
| 2025-11 | 4,094.80 |
| 2025-12 | 5,394.95 |
| 2026-01 | 4,772.67 |
| 2026-02 | 4,574.00 |
| 2026-03 | 3,398.62 |
| 2026-04 | 6,065.75 |
| 2026-05 (partial) | 787.00 |
| **17-month total** | **£66,165.50** |

Of which:
- **2025 full year**: £46,567.46 ✓ reconciles to user-stated truth
- **2026 YTD (Jan–May)**: £19,598.04 ✓ reconciles to user-stated truth

---

## 7. How wrong was `revenue_snapshots.source='booking_sheet'`?

The current importer (`lib/booking-sheet-parser.mjs`) walks **transactional rows** in the Booking Sheet and applies a **funding filter** — it deliberately drops anything funded by Stripe, on the assumption the dashboard would also be summing the Stripe API source. Result:

| YYYY-MM | True (per sheet Totals row) | Stored `booking_sheet` row in Supabase | Captured % |
|---|---:|---:|---:|
| 2025-01 | 4,298.86 | 1,175.86 | 27% |
| 2025-02 | 2,343.84 | 255.84 | 11% |
| 2025-03 | 1,707.83 | 669.83 | 39% |
| 2025-04 | 1,968.00 | 1,395.00 | 71% |
| 2025-05 | 4,092.00 | 2,864.00 | 70% |
| 2025-06 | 7,139.30 | 4,349.10 | 61% |
| 2025-07 | 5,700.00 | 4,605.00 | 81% |
| 2025-08 | 1,627.40 | 1,020.00 | 63% |
| 2025-09 | 5,108.48 | 1,434.48 | 28% |
| 2025-10 | 3,092.00 | 570.00 | 18% |
| 2025-11 | 4,094.80 | 2,804.80 | 69% |
| 2025-12 | 5,394.95 | 4,110.95 | 76% |
| 2026-01 | 4,772.67 | 601.67 | 13% |
| 2026-02 | 4,574.00 | 456.00 | 10% |
| 2026-03 | 3,398.62 | 701.62 | 21% |
| 2026-04 | 6,065.75 | 1,072.75 | 18% |
| 2026-05 | 787.00 | 240.00 | 30% |
| **Total** | **66,165.50** | **28,326.90** | **43%** |

The `booking_sheet` source rows currently in Supabase represent only **43%** of the true total. The remaining **57%** is the bookings funded via Stripe / Squarespace Commerce that the importer drops. Under the **previous** model (sum three sources), that 57% was supposed to come back in via `squarespace_api` + `stripe_supplemental`. Under the **new** single-source model, the importer should instead read the **per-sheet row-18 Totals** directly and ignore the funding column entirely.

---

## 8. Explicit guard-rails for downstream code (do not violate)

1. **The Booking Sheet `Sales YYYY` row 18 "Totals" is the single source of truth for total revenue.** Nothing else.
2. **The Squarespace Orders API** is for transaction-level **detail only**: order ids, product names, dates, customer email, line items, refunds. **It must never be summed with the Booking Sheet total.**
3. **The Stripe API** is for transaction-level **detail only**: charge ids, payment method, Acuity appointment metadata, subscription identifiers. **It must never be summed with the Booking Sheet total.**
4. There is **no de-duplication key** that joins SQ orders, Stripe charges and Booking Sheet rows at the transaction level. Any code that attempts to "merge then de-dup" these three sources is wrong by design — the data to do it doesn't exist.
5. The Booking Sheet's category names (Courses, Workshops Non-Res, Workshops Residential, Pick n Mix Inc/Out, Mentoring, 1-2-1, Gift Vouchers Inc/Out, Prints & Royalties, Commissions, Academy) are **the** canonical category set. Map dashboard tier labels to these, not the other way round.

---

## 9. Revised plan for the Revenue & Conversion Tab — specify, do NOT build yet

> **⚠️ This section is historical (discovery-stage spec from before any build).** The actual schema shipped is different and is described in the "Phase L1 correction" section at the top of this document. Key differences:
>
> - The proposed `booking_sheet_monthly` table here was built in Phase L then **dropped in Phase L1** (the 5-tier rollup it implied was an invented dimension that conflated D2C, B2B and ADJUSTMENT lines into one "services" bucket). The verbatim 12-category truth lives in `public.booking_sheet_monthly_category` instead.
> - The category → market mapping (D2C / B2B / ADJUSTMENT) is stored as data in a separate table `public.booking_sheet_category_market` (not derived in code).
> - Dashboard reads go through the materialised view `public.booking_sheet_monthly_wide` which exposes `category_revenue` jsonb (12 verbatim categories), `market_revenue` jsonb (D2C / B2B / ADJUSTMENT), `operational_revenue` (D2C + B2B — the "service revenue excl. voucher timing" secondary breakdown line), `adjustment_net` (voucher timing line), **`revenue_amount` (full 12-cat sum = YTD Actual = the dashboard headline + tier-band comparison basis — must equal the spreadsheet figure on every screen)**.
> - `revenue_snapshots` was demoted to detail-only (the §9.2 plan), the importer was rewritten with a hard reconciliation gate (the §9.3 plan, plus the L1 correction that the gate checks the **full 12-cat sum**, not the operational subset).
>
> The §9 text below is kept for the historical record. Read the Phase L1 section at the top of this doc for what's actually in production.

The previous plan (in `Docs/DATA-INVENTORY-CONVERSION-TAB.md`) assumed `revenue_snapshots` SUM-across-sources could be the headline. It cannot. Replace with:

### 9.1 Data layer

**A new authoritative table** (proposed name: `booking_sheet_monthly`) replaces the headline-total role of `revenue_snapshots`:

```sql
CREATE TABLE booking_sheet_monthly (
  year                 int          NOT NULL,
  month                int          NOT NULL,        -- 1..12
  category             text         NOT NULL,        -- '1. Courses/masterclasses' .. '12. Academy'
  revenue_amount       numeric(12,2) NOT NULL,       -- can be negative for *_Out rows
  target_annual        numeric(12,2),                -- col J on the sheet
  imported_at          timestamptz  NOT NULL DEFAULT now(),
  source_workbook      text         NOT NULL,        -- 'Sales 2025' | 'Sales 2026'
  source_cell_range    text,                         -- e.g. 'K6:V6' for audit traceability
  PRIMARY KEY (year, month, category)
);
```

Headline monthly revenue is then `SELECT year, month, SUM(revenue_amount) FROM booking_sheet_monthly GROUP BY 1, 2`. The 17-month total is guaranteed to match the user's £46,567.46 + £19,598.04 because it is read directly from the Totals row.

### 9.2 `revenue_snapshots`

Demote, do not delete. It becomes a **detail-only** table used for:

- Per-order Squarespace counts (transactions, AOV, refund rate) — never summed as revenue.
- Per-charge Stripe classification (Acuity vs Member Areas vs direct subs) — never summed as revenue.

Either (a) rename it to `revenue_snapshots_detail` and add an explicit `is_headline_total boolean NOT NULL DEFAULT false` column wired to `false` for every existing row, or (b) leave the name but add a hard SQL check that the dashboard only reads `booking_sheet_monthly` for headline totals. Option (a) is safer because a column rename is enforced by the database.

### 9.3 Sync pipeline

Replace `lib/booking-sheet-parser.mjs`'s "walk transactional rows + funding filter" with `scripts/audit-booking-sheet-truth.mjs`'s "read row 18 Totals from `Sales YYYY` tab". The new importer:

1. Reads the `.xlsm` from upload or Dropbox.
2. For each `Sales YYYY` sheet, extracts the 12 monthly Totals values + each of the 12 category × month values.
3. Upserts into `booking_sheet_monthly` keyed on `(year, month, category)`.
4. Verifies `SUM(per-category) == per-month-Totals == YTD Actual cell`. If not, refuses to import and surfaces the discrepancy.

### 9.4 Dashboard reads

Monthly bar chart, YTD vs target, GP overlay — all of them must `SELECT FROM booking_sheet_monthly`. The Squarespace / Stripe detail can appear in a separate "Where did the bookings come from?" drilldown but must not be summed back into the headline.

### 9.5 Fossil-row cleanup

**Do NOT run the `revenue_snapshots` fossil-row cleanup yet.** It was scoped to fix duplicate rows within each source. But while the dashboard is still doing `SUM(across sources)`, removing fossils would just leave a smaller wrong number. Sequence the changes:

1. Build `booking_sheet_monthly` and the new importer.
2. Migrate the dashboard headline to read from it.
3. Then (optional) clean up `revenue_snapshots` fossils, because by then it is detail-only and the cleanup affects only drilldowns, not the headline.

---

## 10. Audit trail (so this can be reproduced)

- Booking Sheet files read (read-only): `G:/Dropbox/1. Bookings/Booking Sheet 2025 - Alan Ranger Photography.xlsm`, `G:/Dropbox/1. Bookings/Booking Sheet 2026 - Alan Ranger Photography.xlsm`. Files last modified 2026-02-02 and 2026-05-26 (per file system).
- Extractor script: `scripts/audit-booking-sheet-truth.mjs` (committed in this change). Reads cells via `xlsx`, never writes.
- Raw extractor output: `scripts/audit-bs-output.json` (this file is generated and can be regenerated by `node scripts/audit-booking-sheet-truth.mjs`).
- Stored-vs-truth comparison in §7 uses a SQL pull against project `igzvwbvgvmzvvzoclufx` (MCP `user-supabase-ai-chat`), table `revenue_snapshots`, filter `source='booking_sheet' AND period_start >= '2025-01-01'`.
- Reconciliation deltas: 2025 = £0.00, 2026 YTD = £0.00 (both the user-stated truth and the sheet's own `J47/J48` "YTD Actual" cell match the per-month row 18 sum exactly).

---

## 11. What needs the user's confirmation before any build

> **✅ All four items below were confirmed (with corrections) on 2026-05-26 and built in Phase L + L1 the same day. Kept for historical record.**

1. **Confirm** the new authoritative table `booking_sheet_monthly` (schema in §9.1) is the model you want to adopt. — _Confirmed; corrected in Phase L1: the authoritative table is `booking_sheet_monthly_category` keyed on the 12 verbatim categories (not pre-rolled into 5 tiers). Dashboard reads use the matview `booking_sheet_monthly_wide`._
2. **Confirm** that `revenue_snapshots` should be demoted to detail-only (renamed `revenue_snapshots_detail`, or flagged via `is_headline_total = false`). — _Confirmed (Phase L): demoted via `COMMENT ON TABLE` warning + deletion of the 17 superseded `source='booking_sheet'` rows. Not renamed (would have broken too many existing reads). No headline reader now consumes it._
3. **Confirm** the order in §9.5 — build new authoritative table first, migrate dashboard reads second, fossil cleanup last (and only if still wanted). — _Confirmed; first two done. Fossil cleanup not yet run, harmless to defer._
4. **Confirm** the category names in §4/§5 are the canonical set you want surfaced on the dashboard (verbatim, including the leading numbers), or supply the preferred display labels. — _Confirmed verbatim. The 12 labels in `booking_sheet_category_market.category_label` are the canonical display set._

Once confirmed, the build can begin. Until then, nothing in the database changes.
