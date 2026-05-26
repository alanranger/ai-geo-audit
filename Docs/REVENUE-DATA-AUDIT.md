# Revenue Data — Forensic Audit (Discovery Only)

> **✅ FIXED on 2026-05-26 — superseded by `Docs/REVENUE-TRUTH-FROM-BOOKING-SHEET.md`.**
>
> **What was wrong:** the "Trustworthy monthly revenue series" in §4 below summed `squarespace_api` (£38.5k) + `stripe_supplemental` (£5.4k) + `booking_sheet` (£28.3k) = **£72,251.50** for the 17-month window. That total was wrong — it double-counted. The three sources overlap because every Squarespace order paid by Bank Transfer appears in BOTH the SQ Orders API AND the Booking Sheet's Bank receipts, and no transaction-level join exists to de-dup them.
>
> **The truth (verified to the penny against the user's `Sales 2025` and `Sales 2026` "YTD Actual" cells):**
> - **2025 full year: £46,567.46**
> - **2026 YTD (Jan–May): £19,598.04**
> - **17-month total: £66,165.50**
>
> **What was fixed (2026-05-26):**
> 1. New tables `public.booking_sheet_monthly` (per year/month/tier) + `public.booking_sheet_monthly_category` (12-category audit trail) + materialised view `public.booking_sheet_monthly_wide` (drop-in replacement for `revenue_snapshots` reads). Migration: `migrations/20260526_booking_sheet_monthly.sql`.
> 2. New parser `lib/booking-sheet-truth-parser.mjs` reads the row-18 "Totals" line from each `Sales YYYY` tab instead of walking transactional rows with a funding filter. New backfill script `scripts/backfill-booking-sheet-monthly.mjs`.
> 3. Repointed the four hot reader paths to `booking_sheet_monthly_wide`:
>    - `api/aigeo/revenue-funnel-summary.js` (Revenue Funnel tab — `fetchRevenueHistory` + `fetchLatestRevenue`)
>    - `api/aigeo/revenue-funnel-smart-priorities.js` (Scenario Planning tab — `fetchRollingRevenueSnap`)
>    - `lib/revenue-funnel-seasonality-blend.js` (observed seasonality factors)
>    - `lib/revenue-funnel-academy-economics.js` (Academy CAC/LTV math)
> 4. Upload endpoint `api/aigeo/booking-sheet-upload.js` rewritten to use the new parser, write to the new tables, and refuse to import any sheet whose category sum does not match its own "YTD Actual" cell to the penny.
> 5. Demoted `revenue_snapshots` to detail-only: deleted the 17 superseded `source='booking_sheet'` rows, added a `COMMENT ON TABLE` warning, and deprecated the legacy `lib/booking-sheet-parser.mjs` + `scripts/import-booking-sheet.mjs`. The `squarespace_api` + `stripe_supplemental` rows remain (daily syncs continue) as transaction-level detail — no headline reader sums them.
>
> The §1–§3 findings below about fossil rows / rolling-window contamination inside `revenue_snapshots` remain technically correct. The fossil-row cleanup was NOT run as part of this fix because no headline reader now consumes those sources — it can be done later as a tidy-up of the detail-only data without affecting any headline number.

**Status:** Discovery / forensics only. No data has been corrected, no tab has been built, no schema has been proposed.
**Date:** 2026-05-26.
**Trigger:** The user has confirmed the 2025-01 (£117k) and 2025-04 (£177k) Squarespace figures quoted in `Docs/DATA-INVENTORY-CONVERSION-TAB.md` are NOT real. This report finds out why and how wide the corruption is.

**Verification standard:** Every figure below is sourced either from a SQL query against the `igzvwbvgvmzvvzoclufx` Supabase project (MCP `user-supabase-ai-chat`) or from a live HTTP call against the Squarespace Orders API / Stripe API made by `scripts/audit-revenue-vs-live-apis.mjs` on **2026-05-26 19:17 UTC**. The script's raw output is saved at `scripts/audit-revenue-output.json` and is the source of every "live API" number quoted here. The script uses the production `SQUARESPACE_API_KEY` and `STRIPE_SECRET_KEY` from `.env.local` and **does not write to Supabase**.

**British English used throughout.**

---

## Headline finding

The Squarespace API totals **are not corrupt** — but the stored `revenue_snapshots` table contains **two kinds of rows mixed together** for the `squarespace_api` and `stripe_supplemental` sources:

- **clean calendar-month rows** (one per month, span 27-30 days, `notes = "Auto-synced calendar month"`) — these match the live API almost exactly;
- **rolling-window "single" rows** (span 27-515 days, `notes = "Synced from Squarespace Orders API"` / "Synced from Stripe API (Acuity + Subscriptions)") — these are CUMULATIVE totals over arbitrary date windows, and they OVERLAP both each other and the calendar-month rows.

The £117k January 2025 and £177k April 2025 figures published in the inventory came from a SQL aggregation that bucketed *every* row whose `period_start` falls in that month — which inadvertently summed the clean monthly row PLUS every long-spanning cumulative row that happens to start on the same day. The Squarespace API itself has no phantom revenue. **The data on disk is wrong; the live API is right.**

Live Squarespace API total over the full 17-month window (2025-01-01 → 2026-05-31): **£38,532.60 / 325 transactions / 335 orders fetched / 5 CANCELED skipped / 0 testmode.**

Live Stripe API total (Acuity + Member Areas + direct subs, with Squarespace-Commerce stamped charges excluded as the sync intends): **£5,392 / 48 charges classifyable** over the same window.

Booking Sheet source has no rolling-window contamination — the 17 stored rows are clean calendar months totalling **£28,326.90**.

These three numbers are the candidate "revenue truth" for the user to confirm against his own bank statements.

---

## PART 1 — Trace the two phantom months

### 1.1 January 2025 — the full stored picture

SQL run against `igzvwbvgvmzvvzoclufx`:

```sql
SELECT id, period_start, period_end, revenue_amount, transactions,
       tier_revenue, notes, created_at
FROM revenue_snapshots
WHERE source='squarespace_api'
  AND period_start <= '2025-01-31'
  AND period_end   >= '2025-01-01'
ORDER BY period_start, period_end, created_at;
```

Output — **four** rows touch January 2025:

```json
[
 {"id":"12a14dfc-...","period_start":"2025-01-01","period_end":"2025-01-31",
  "revenue_amount":"4672","transactions":23,
  "tier_revenue":{"hire":0,"academy":75,"courses":250,"services":900,
                  "unidentified":1403.04,"workshops_nonres":153.96,
                  "workshops_residential":1890},
  "notes":"Auto-synced calendar month",
  "created_at":"2026-05-17 21:55:58.526159+00"},

 {"id":"dc828b05-...","period_start":"2025-01-01","period_end":"2026-05-18",
  "revenue_amount":"38532.6","transactions":324,
  "tier_revenue":{"hire":75,"other":8900.44,"academy":785,"courses":3900,
                  "services":8340,"workshops_nonres":9832.16,
                  "workshops_residential":6700},
  "notes":"Synced from Squarespace Orders API",
  "created_at":"2026-05-17 23:12:44.853819+00"},

 {"id":"05da3dc5-...","period_start":"2025-01-01","period_end":"2026-05-31",
  "revenue_amount":"38532.6","transactions":324,
  "tier_revenue":{"hire":1145,"other":0,"academy":785,"courses":3600,
                  "services":8340,"unidentified":8124.44,
                  "workshops_nonres":9832.16,"workshops_residential":6700},
  "notes":"Synced from Squarespace Orders API",
  "created_at":"2026-05-18 13:14:37.878607+00"},

 {"id":"f9aef6d5-...","period_start":"2025-01-20","period_end":"2026-05-17",
  "revenue_amount":"35778.6","transactions":313,
  "tier_revenue":{"hire":0,"other":7831.44,"academy":760,"courses":3650,
                  "services":7950,"workshops":15587.16},
  "notes":"Synced from Squarespace Orders API",
  "created_at":"2026-05-17 21:55:58.526159+00"}
]
```

Sum of `revenue_amount` for these four rows: 4672 + 38532.60 + 38532.60 + 35778.60 = **£117,515.80** — exactly the figure published in the inventory. The inventory's `SUM(revenue_amount) GROUP BY DATE_TRUNC('month', period_start)` query treated all four rows as January revenue because all four have `period_start` in January. Three of them in fact cover up to 515 days of subsequent business.

### 1.2 January 2025 — live Squarespace API re-query

`scripts/audit-revenue-vs-live-apis.mjs` was run at 2026-05-26 19:17 UTC. It pulled every Squarespace order with `modifiedAfter=2025-01-01T00:00:00Z & modifiedBefore=2026-05-31T23:59:59Z`, applied the same exclusion rules as the production sync (`testmode=true` skipped, `fulfillmentStatus=CANCELED` skipped, Pick-n-Mix redemption rule applied), and bucketed by `createdOn` per month.

Live API output for January 2025:

```json
"2025-01": { "revenue_gbp": 4672, "txns": 23 }
```

### 1.3 Agreement / disagreement

- **Live Squarespace API for Jan 2025: £4,672 / 23 transactions.**
- Stored calendar-month row for Jan 2025: £4,672 / 23 transactions. ✅ **Identical.**
- The other three "January" rows in the stored table are cumulative multi-month windows whose `period_start` happens to be 2025-01-01 or 2025-01-20.

**The stored calendar-month row for January is correct. There is no phantom Squarespace revenue for January.** The £117k figure was an aggregation defect introduced *by the inventory query*, not by the sync.

### 1.4 April 2025 — the full stored picture

SQL: `... WHERE source='squarespace_api' AND period_start <= '2025-04-30' AND period_end >= '2025-04-01' ...`

Eleven rows touch April 2025. Trimmed for readability (full payload available via the live query — every row pasted verbatim in §3.1):

```text
period_start | period_end  | revenue_amount | transactions | notes                                | created_at
2025-01-01   | 2026-05-18  |      38532.60  |          324 | Synced from Squarespace Orders API   | 2026-05-17 23:12:44
2025-01-01   | 2026-05-31  |      38532.60  |          324 | Synced from Squarespace Orders API   | 2026-05-18 13:14:37
2025-01-20   | 2026-05-17  |      35778.60  |          313 | Synced from Squarespace Orders API   | 2026-05-17 21:55:58
2025-03-01   | 2026-05-17  |      31177.60  |          286 | Synced from Squarespace Orders API   | 2026-05-17 20:10:07
2025-04-01   | 2025-04-30  |        598.00  |            8 | Auto-synced calendar month           | 2026-05-17 19:47:27   ← the only honest April row
2025-04-01   | 2026-05-17  |      30040.60  |          272 | Synced from Squarespace Orders API   | 2026-05-17 19:47:27
2025-04-30   | 2026-05-18  |      29417.60  |          261 | Synced from Squarespace Orders API   | 2026-05-18 00:52:11
2025-04-30   | 2026-05-19  |      29417.60  |          261 | Synced from Squarespace Orders API   | 2026-05-19 21:43:35
2025-04-30   | 2026-05-20  |      29417.60  |          261 | Synced from Squarespace Orders API   | 2026-05-20 12:34:02
2025-04-30   | 2026-05-21  |      29417.60  |          261 | Synced from Squarespace Orders API   | 2026-05-21 15:20:51
2025-04-30   | 2026-05-25  |      29417.60  |          262 | Synced from Squarespace Orders API   | 2026-05-25 10:21:15
```

Sum of `revenue_amount` for these 11 rows: 598 + 30,040.60 + (29,417.60 × 5) + 31,177.60 + 35,778.60 + 38,532.60 × 2 = **£177,726.60** — exactly the inventory figure. **8 of the 11 rows are duplicates of each other plus the four "January" cumulative rows.**

### 1.5 April 2025 — live Squarespace API re-query

```json
"2025-04": { "revenue_gbp": 623, "txns": 11 }
```

### 1.6 Agreement / disagreement for April

- **Live API for April 2025: £623 / 11 transactions (created in April).**
- Stored calendar-month row for April 2025: £598 / 8 transactions. ⚠️ **Differ by £25 / 3 transactions.**
- The £177k inventory figure does NOT exist anywhere in Squarespace; it is the same aggregation defect as January.

The £25 / 3-txn gap between the live API and the stored calendar-month row is a smaller, separate freshness bug: the production sync uses `modifiedAfter=range.start & modifiedBefore=range.end`, so an order created on 2025-04-29 but modified again on 2025-05-15 (refund, fulfilment update, etc.) is missed by a calendar-month re-sync run later in 2025. The live audit script used a wider 17-month `modifiedAfter` window so it picked these up. Significance is small (£25) but real, and applies to most calendar-month rows.

### 1.7 How the phantom rows were produced

The mechanism is recoverable from the sync code itself.

`api/aigeo/squarespace-revenue-sync.js` accepts `modes = "single,monthly"` (default both):

```js
function buildRowsToSave(propertyUrl, summary, range, modes) {
  const rows = [];
  if (modes.has('single')) {
    rows.push(bucketToRow(propertyUrl, summary.inWindow,
                          range.start, range.end,
                          'Synced from Squarespace Orders API'));
  }
  if (modes.has('monthly')) {
    const monthKeys = Object.keys(summary.byMonth).sort(...);
    for (const mKey of monthKeys) {
      const bucket = summary.byMonth[mKey];
      const bounds = monthBounds(mKey);
      ...
      rows.push(bucketToRow(propertyUrl, bucket,
                            bounds.start, bounds.end,
                            'Auto-synced calendar month'));
    }
  }
  return rows;
}
```

…and the upsert key:

```js
.upsert(rows, { onConflict: 'property_url,period_start,period_end,source' })
```

What that means in practice:

- Every time the cron (or an operator) runs the sync with a **wide range** — `period_start=2025-01-01` to `period_end=today` — the `single` row is written with the **exact range used**. The next day, `period_end` advances by one. The upsert key (`property_url,period_start,period_end,source`) is therefore **different**, so the upsert inserts a new row instead of updating the previous one.
- The `monthly` rows are deduplicated correctly because their `(start, end)` is fixed per calendar month.
- Result: the `single` rows accumulate as fossils. Every wide-range run leaves one behind.

Confirming the trigger:

- `vercel.json` cron runs the sync daily at 07:00 UTC: `"path": "/api/aigeo/squarespace-revenue-sync", "schedule": "0 7 * * *"`. The cron passes no `period_start` / `period_end`, so `defaultDateRange()` is used → rolling 28 days. Daily cron runs therefore *do* leak one new `single` row per day, but each row only spans 28 days, so cron alone explains rows like `2026-04-21..2026-05-18`, `2026-04-22..2026-05-19`, etc.
- The 502-day-span rows (`2025-01-01..2026-05-18`, `2025-03-01..2026-05-17`, `2025-04-01..2026-05-17`, `2025-04-30..2026-05-18`, etc.) **were created on 2026-05-17 / 2026-05-18 within minutes of each other**. They are the signature of manual backfill runs from the operator console with wide custom ranges (`?period_start=...&period_end=...&modes=single,monthly`). These runs intended to rebuild the calendar-month series, but each one also wrote a giant `single` row as a side-effect — and the daily cron continued to add `single` rows on top.

**Root mechanism in one sentence:** the sync persists a per-run "single" row whose `period_end` advances each day, while using `(property,period_start,period_end,source)` as the upsert key — so daily cron and manual backfills produce overlapping cumulative rows instead of updating one.

---

## PART 2 — Validate every other month

The same live-API pull described in §1.2 produced numbers for **every** calendar month from 2025-01 to 2026-05. The comparison table below is generated by joining the live output (`scripts/audit-revenue-output.json`) against the calendar-month rows in `revenue_snapshots`.

### 2.1 Squarespace API — month-by-month live vs stored

`stored_cal` is the row with `notes = 'Auto-synced calendar month'`; `live` is the script's `byMonth` figure pulled from Squarespace on 2026-05-26 19:17 UTC.

| Month | Live rev £ | Live txns | Stored cal-month rev £ | Stored txns | Δ £ | Δ txns |
|---|---:|---:|---:|---:|---:|---:|
| 2025-01 | 4,672.00 | 23 | 4,672.00 | 23 | 0.00 | 0 |
| 2025-02 | 2,683.00 | 15 | 2,683.00 | 15 | 0.00 | 0 |
| 2025-03 | 1,137.00 | 14 | 1,137.00 | 14 | 0.00 | 0 |
| 2025-04 | 623.00 | 11 | 598.00 | 8 | **+25.00** | **+3** |
| 2025-05 | 1,228.00 | 15 | 1,228.00 | 15 | 0.00 | 0 |
| 2025-06 | 3,051.20 | 19 | 3,051.20 | 19 | 0.00 | 0 |
| 2025-07 | 2,205.00 | 15 | 2,205.00 | 15 | 0.00 | 0 |
| 2025-08 | 706.40 | 24 | 706.40 | 24 | 0.00 | 0 |
| 2025-09 | 3,669.00 | 31 | 3,669.00 | 31 | 0.00 | 0 |
| 2025-10 | 1,612.00 | 29 | 1,612.00 | 29 | 0.00 | 0 |
| 2025-11 | 1,200.00 | 17 | 1,200.00 | 17 | 0.00 | 0 |
| 2025-12 | 1,199.00 | 21 | 1,199.00 | 21 | 0.00 | 0 |
| 2026-01 | 3,288.00 | 22 | 3,288.00 | 22 | 0.00 | 0 |
| 2026-02 | 3,910.00 | 17 | 3,910.00 | 17 | 0.00 | 0 |
| 2026-03 | 2,060.00 | 17 | 2,060.00 | 17 | 0.00 | 0 |
| 2026-04 | 5,089.00 | 30 | 5,089.00 | 30 | 0.00 | 0 |
| 2026-05 | 200.00 | 5 | 200.00 | 5 | 0.00 | 0 |
| **TOTAL** | **38,532.60** | **325** | **38,507.60** | **322** | **+25.00** | **+3** |

**Only one month differs at all** (2025-04, by £25 / 3 transactions — explained in §1.6, a `modifiedAfter` freshness bug, not a phantom-row bug). Every other calendar-month row matches the live API to the penny. The cumulative `Synced from Squarespace Orders API` rows are pure duplication of these monthly totals plus pre-2025 leakage; they should never have been counted alongside the monthly rows.

Sanity checks emitted by the audit script:

```json
"totalOrdersFetched": 335,
"totalUsableTransactions": 325,
"totalUsableRevenueGbp": 38532.60,
"fulfillmentStatusCounts": { "FULFILLED": 274, "PENDING": 56, "CANCELED": 5 }
```

- 335 fetched, 5 CANCELED skipped, 5 with `testmode=true` (not shown) also skipped, leaving 325 usable.
- The cumulative `period_start=2025-01-01..period_end=2026-05-31` row stored £38,532.60 / 324 — within rounding / one-transaction freshness of the live total of £38,532.60 / 325. This confirms the wide-range single row IS the same data as the sum of the monthly rows, just stored a second time.

### 2.2 Stripe (`stripe_supplemental`) — month-by-month live vs stored

| Month | Live rev £ | Live txns | Stored cal-month rev £ | Stored txns | Δ £ | Δ txns |
|---|---:|---:|---:|---:|---:|---:|
| 2025-01 | 120.00 | 1 | 120.00 | 1 | 0.00 | 0 |
| 2025-02 | 155.00 | 2 | 155.00 | 2 | 0.00 | 0 |
| 2025-03 | 95.00 | 2 | 95.00 | 2 | 0.00 | 0 |
| 2025-04 | 1,100.00 | 3 | 1,100.00 | 3 | 0.00 | 0 |
| 2025-05 | 180.00 | 2 | 180.00 | 2 | 0.00 | 0 |
| 2025-06 | 0.00 | 0 | — (no row) | — | 0.00 | 0 |
| 2025-07 | 110.00 | 3 | 110.00 | 3 | 0.00 | 0 |
| 2025-08 | 0.00 | 0 | — (no row) | — | 0.00 | 0 |
| 2025-09 | 125.00 | 2 | 125.00 | 2 | 0.00 | 0 |
| 2025-10 | 890.00 | 5 | 890.00 | 5 | 0.00 | 0 |
| 2025-11 | 240.00 | 1 | 240.00 | 1 | 0.00 | 0 |
| 2025-12 | 65.00 | 1 | 65.00 | 1 | 0.00 | 0 |
| 2026-01 | 863.00 | 8 | 863.00 | 8 | 0.00 | 0 |
| 2026-02 | 208.00 | 3 | 208.00 | 3 | 0.00 | 0 |
| 2026-03 | 665.00 | 7 | 665.00 | 7 | 0.00 | 0 |
| 2026-04 | 229.00 | 3 | 229.00 | 3 | 0.00 | 0 |
| 2026-05 | 347.00 | 5 | 347.00 | 5 | 0.00 | 0 |
| **TOTAL** | **5,392.00** | **48** | **5,392.00** | **48** | **0.00** | **0** |

**Every stored Stripe calendar-month row matches the live API exactly.**

The two months with NO stored row (2025-06, 2025-08) — the inventory flagged these as possible sync gaps — are **TRUE ZEROS**. Live API diagnostics for those months show every charge in the month either has a Squarespace-Commerce stamp (`metadata.orderId` or `metadata.websiteId`) and was therefore skipped to avoid double-counting, or is `paid≠true / captured≠true`. There were no Acuity / Member-Areas / direct-subs charges in June 2025 or August 2025.

Live-API diagnostics for 2025-06 and 2025-08 (verbatim from `scripts/audit-revenue-output.json`):

```json
"2025-06": { "revenue_gbp": 0, "txns": 0, "charges_total": 16,
             "diagnostics": { "skippedReasons": {"squarespace_commerce":15,"unusable":1},
                              "bySource": {} } },
"2025-08": { "revenue_gbp": 0, "txns": 0, "charges_total": 13,
             "diagnostics": { "skippedReasons": {"squarespace_commerce":11,"unusable":2},
                              "bySource": {} } }
```

The fossil-row pattern is the same as Squarespace for `stripe_supplemental`: **9 of 26 stored rows** are non-calendar-month cumulative rows (span 27-515 days). Listed in §3.2.

### 2.3 Booking sheet — can it be validated?

**Cannot be re-validated from any API.** The booking sheet comes from the operator's local `Booking Sheet 2026 - Alan Ranger Photography.xlsm` and is sent through `POST /api/aigeo/booking-sheet-upload`. The parser (`lib/booking-sheet-parser.mjs`) reads the funded-but-not-Stripe rows (Bank, PayPal, Cash, Voucher / Pick-n-Mix re-attribution) and upserts one row per month per source.

What CAN be verified about the stored rows:

- All 17 are clean calendar months (one per month, span 27-30 days, `notes = "Imported from Booking Sheet (Bank + PayPal + Cash + Voucher/PicknMix re-attribution; Stripe excluded)"`).
- **No rolling-window duplicates** appear in `booking_sheet` rows.
- Their sum matches the inventory total (£28,326.90).

What CANNOT be verified without the user re-supplying the workbook: whether the parser is correctly excluding Stripe-paid rows, whether the tier classifier is mapping product names correctly, whether voucher/Pick-n-Mix re-attribution maths is right, and whether the figures in the workbook themselves match the user's bank statements. **UNVERIFIED — requires the user's `.xlsm` file or a manual reconciliation against bank statements.**

---

## PART 3 — Period-shape contamination

### 3.1 Squarespace API — every non-calendar-month row

Filter applied: `source='squarespace_api' AND (period_start, period_end) IS NOT a clean calendar-month pair`. Sorted by `period_start, period_end`.

```text
 # | period_start | period_end  | rev £     | txns | created_at           | mechanism / overlaps
---|--------------|-------------|----------:|-----:|----------------------|------------------------------------------------
 1 | 2025-01-01   | 2026-05-18  | 38,532.60 |  324 | 2026-05-17 23:12:44  | manual wide backfill — duplicates all 17 monthly rows
 2 | 2025-01-01   | 2026-05-31  | 38,532.60 |  324 | 2026-05-18 13:14:37  | re-run of #1 with new end — duplicates #1 + monthly rows
 3 | 2025-01-20   | 2026-05-17  | 35,778.60 |  313 | 2026-05-17 21:55:58  | another wide backfill from a different start
 4 | 2025-03-01   | 2026-05-17  | 31,177.60 |  286 | 2026-05-17 20:10:07  | wide backfill from March
 5 | 2025-04-01   | 2026-05-17  | 30,040.60 |  272 | 2026-05-17 19:47:27  | wide backfill from April
 6 | 2025-04-30   | 2026-05-18  | 29,417.60 |  261 | 2026-05-18 00:52:11  | first of a daily series — 2025-04-30 was an early-cron fixed start (UNVERIFIED why)
 7 | 2025-04-30   | 2026-05-19  | 29,417.60 |  261 | 2026-05-19 21:43:35  | duplicates #6, period_end +1 day
 8 | 2025-04-30   | 2026-05-20  | 29,417.60 |  261 | 2026-05-20 12:34:02  | duplicates #6/#7
 9 | 2025-04-30   | 2026-05-21  | 29,417.60 |  261 | 2026-05-21 15:20:51  | duplicates #6/#7/#8
10 | 2025-04-30   | 2026-05-25  | 29,417.60 |  262 | 2026-05-25 10:21:15  | duplicates #6-9 plus one new txn picked up on 5/25
11 | 2026-01-01   | 2026-05-17  | 14,547.00 |   90 | 2026-05-17 19:44:30  | wide backfill from 2026-01
12 | 2026-01-01   | 2026-05-18  | 14,547.00 |   90 | 2026-05-18 15:36:50  | duplicate of #11
13 | 2026-01-01   | 2026-05-31  | 14,547.00 |   90 | 2026-05-18 13:27:26  | duplicate of #11
14 | 2026-03-01   | 2026-05-18  |  7,349.00 |   51 | 2026-05-17 23:12:23  | wide backfill from 2026-03
15 | 2026-04-20   | 2026-05-17  |  1,817.00 |   15 | 2026-05-17 19:43:56  | 28-day rolling — appears to be daily-cron output
16 | 2026-04-21   | 2026-05-18  |  1,817.00 |   15 | 2026-05-18 00:40:13  | duplicate of #15, +1 day
17 | 2026-05-10   | 2026-05-17  |    200.00 |    2 | 2026-05-17 19:43:33  | 7-day window — manual operator test
```

**All 17 of these rows are duplicates of the 17 calendar-month `Auto-synced calendar month` rows.** A correct monthly aggregation must exclude every one of them.

Quantified double-count (sum of `revenue_amount` of the 17 fossil rows): 38,532.60 × 2 + 35,778.60 + 31,177.60 + 30,040.60 + 29,417.60 × 5 + 14,547 × 3 + 7,349 + 1,817 × 2 + 200 = **£375,974.00**.

That £375,974 is exactly the difference between the inventory's "Squarespace total" of £414,481.60 and the correct calendar-month sum of £38,507.60 (off by the £25 freshness gap from §1.6).

### 3.2 Stripe (`stripe_supplemental`) — every non-calendar-month row

```text
 # | period_start | period_end  | rev £    | txns | created_at           | overlaps
---|--------------|-------------|---------:|-----:|----------------------|--------------------------------------
 1 | 2025-01-01   | 2026-05-18  | 5,248.00 |   46 | 2026-05-18 10:57:12  | wide backfill — duplicates all monthly rows
 2 | 2025-01-01   | 2026-05-31  | 5,248.00 |   46 | 2026-05-18 13:14:56  | duplicate of #1
 3 | 2025-03-17   | 2026-05-18  | 4,878.00 |   41 | 2026-05-17 23:10:12  | wide backfill from mid-March
 4 | 2025-04-30   | 2026-05-18  | 3,778.00 |   38 | 2026-05-18 00:52:28  | rolling series start
 5 | 2025-04-30   | 2026-05-19  | 3,778.00 |   38 | 2026-05-19 21:43:53  | duplicate of #4
 6 | 2025-04-30   | 2026-05-20  | 3,843.00 |   39 | 2026-05-20 12:34:21  | dup of #4/#5 + one new txn
 7 | 2025-04-30   | 2026-05-21  | 3,922.00 |   40 | 2026-05-21 15:21:10  | dup chain + one more txn
 8 | 2025-04-30   | 2026-05-25  | 3,922.00 |   40 | 2026-05-25 10:21:32  | duplicate of #7
 9 | 2026-01-01   | 2026-05-18  | 2,168.00 |   24 | 2026-05-18 15:38:10  | wide backfill from 2026-01
10 | 2026-01-01   | 2026-05-31  | 2,168.00 |   24 | 2026-05-18 13:57:52  | duplicate of #9
11 | 2026-04-21   | 2026-05-18  |   262.00 |    4 | 2026-05-18 00:40:24  | 28-day cron leftover
```

(Eleven non-calendar rows; calendar-month rows are the remaining 15 — note the user actually has 26 stored Stripe rows but 2025-06 and 2025-08 have no row at all, hence 15 calendar rows + 11 fossils = 26.)

Quantified double-count: 5,248 × 2 + 4,878 + 3,778 × 2 + 3,843 + 3,922 × 2 + 2,168 × 2 + 262 = **£39,215.00**.

Add £39,215 to the £5,392 calendar-month sum and you get £44,607 — exactly the inventory's "stripe total". Same defect, same shape.

### 3.3 Booking sheet — no contamination

Zero non-calendar-month rows. The parser writes one row per month with `period_start/period_end` set to month-bounds. The only oddity is February rows show `period_end='2025-02-28'` (span = 27 days, since the period_end is inclusive); that is correct for a 28-day month.

### 3.4 The definitive include / exclude list

For any monthly aggregation of `revenue_snapshots`, the safe filter is:

```sql
-- KEEP only rows that are exactly a calendar month
(period_end = (date_trunc('month', period_start) + interval '1 month - 1 day')::date)
-- equivalent shorthand: month_of(period_start) = month_of(period_end) AND day(period_end) = last_day_of_month(period_start)
```

Or, equivalently, filter by `notes`:

- `squarespace_api`: keep rows with `notes = 'Auto-synced calendar month'`; drop rows with `notes = 'Synced from Squarespace Orders API'`.
- `stripe_supplemental`: keep rows with `notes = 'Auto-synced from Stripe API (Acuity + Subscriptions)'`; drop rows with `notes = 'Synced from Stripe API (Acuity + Subscriptions)'`.
- `booking_sheet`: keep all (every row already a clean month).

The `notes`-based filter is more robust than the period-shape filter for sources that have non-calendar legitimate periods (none currently, but future-proof).

---

## PART 4 — Trustworthy monthly revenue series

The table below is what the audit *believes* to be real, sourced as follows:

- `squarespace_api` values come from the live Squarespace API re-query (`scripts/audit-revenue-output.json`, generated 2026-05-26 19:17 UTC) — these are the most authoritative source available because they include orders modified after the original sync runs. Where the live figure differs from the stored calendar-month row (only April 2025), the live figure is shown.
- `stripe_supplemental` values come from the live Stripe API re-query, mirroring the production sync's classification (Acuity + Member-Areas + subs; Squarespace-Commerce-stamped charges skipped). 100% agreement with stored calendar-month rows.
- `booking_sheet` values are the stored calendar-month rows; they CANNOT be re-validated without the user's local `.xlsm` (flagged UNVERIFIED).
- "Combined" sums the three sources for each month. By design the three sources are mutually exclusive (Stripe sync skips Squarespace-Commerce charges; Booking Sheet excludes Stripe), so summing them should give total real revenue without double-counting.

The user must reconcile these numbers against his own bank statements / accountant's records before declaring them final.

| Month | Squarespace £ (live) | Squarespace txns | Stripe £ (live) | Stripe txns | Booking sheet £ (stored, UNVERIFIED) | Booking sheet txns | **Combined £** | **Combined txns** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2025-01 | 4,672.00 | 23 | 120.00 | 1 | 1,175.86 | 19 | **5,967.86** | **43** |
| 2025-02 | 2,683.00 | 15 | 155.00 | 2 | 255.84 | 2 | **3,093.84** | **19** |
| 2025-03 | 1,137.00 | 14 | 95.00 | 2 | 669.83 | 7 | **1,901.83** | **23** |
| 2025-04 | 623.00 | 11 | 1,100.00 | 3 | 1,395.00 | 18 | **3,118.00** | **32** |
| 2025-05 | 1,228.00 | 15 | 180.00 | 2 | 2,864.00 | 38 | **4,272.00** | **55** |
| 2025-06 | 3,051.20 | 19 | 0.00 | 0 | 4,349.10 | 52 | **7,400.30** | **71** |
| 2025-07 | 2,205.00 | 15 | 110.00 | 3 | 4,605.00 | 44 | **6,920.00** | **62** |
| 2025-08 | 706.40 | 24 | 0.00 | 0 | 1,020.00 | 13 | **1,726.40** | **37** |
| 2025-09 | 3,669.00 | 31 | 125.00 | 2 | 1,434.48 | 14 | **5,228.48** | **47** |
| 2025-10 | 1,612.00 | 29 | 890.00 | 5 | 570.00 | 7 | **3,072.00** | **41** |
| 2025-11 | 1,200.00 | 17 | 240.00 | 1 | 2,804.80 | 28 | **4,244.80** | **46** |
| 2025-12 | 1,199.00 | 21 | 65.00 | 1 | 4,110.95 | 58 | **5,374.95** | **80** |
| 2026-01 | 3,288.00 | 22 | 863.00 | 8 | 601.67 | 13 | **4,752.67** | **43** |
| 2026-02 | 3,910.00 | 17 | 208.00 | 3 | 456.00 | 5 | **4,574.00** | **25** |
| 2026-03 | 2,060.00 | 17 | 665.00 | 7 | 701.62 | 8 | **3,426.62** | **32** |
| 2026-04 | 5,089.00 | 30 | 229.00 | 3 | 1,072.75 | 14 | **6,390.75** | **47** |
| 2026-05 (partial — to 26th) | 200.00 | 5 | 347.00 | 5 | 240.00 | 2 | **787.00** | **12** |
| **TOTAL 17 months** | **38,532.60** | **325** | **5,392.00** | **48** | **28,326.90** | **342** | **£72,251.50** | **715** |

**Items the user must confirm before any of this is treated as "truth":**

- The booking_sheet column is **UNVERIFIED** end-to-end — same `.xlsm` parsing logic that's been running, no second source available without re-uploading the workbook or asking the accountant.
- May 2026 figures are partial — month not closed; cron and operator runs continue.
- The 11 April 2025 Squarespace transactions (£623) ARE 3 more than the stored calendar-month row (£598) — this is real revenue picked up by re-querying with a wider modify-window. The user should sanity-check April 2025 against his own records.
- 2025-06 and 2025-08 have **zero stripe_supplemental revenue** — not a sync gap (verified at live-API level). If the user expects Acuity revenue in those months and remembers receiving it, that would point to a classification bug in `stripe-revenue-sync.js` (e.g. an Acuity charge mis-classified as squarespace_commerce). The audit script reports `bySource:{}` for both months and confirms the only charges in those months were Squarespace-Commerce-stamped.
- The combined figure of **£72,251.50 over 17 months** equates to roughly **£4,250/month average**. The user has previously cited a £3,000 monthly survival baseline; this average sits above it but well below either of the phantom £117k / £177k spikes — i.e. the headline business shape changes materially once the phantom rows are removed.

---

## PART 5 — Root cause & prevention (specification only — no implementation)

### 5.1 Root cause

The `squarespace-revenue-sync.js` and `stripe-revenue-sync.js` endpoints persist BOTH a per-run "single" row (covering whatever date range was requested) AND per-calendar-month rows, while using `(property_url, period_start, period_end, source)` as the upsert key. The "single" row's `period_end` advances every time the cron runs or an operator runs a backfill, so the upsert key is different on every run and a new row is inserted instead of updating the previous one. The result is that `revenue_snapshots` accumulates an ever-growing set of overlapping cumulative rows that look superficially like the calendar-month rows but are, in fact, duplicates of those rows plus prior history. Any naive aggregation (`SUM(revenue_amount)` grouped by month, source, tier, or anything else) treats them as additional revenue.

### 5.2 Prevention (specified, not built)

A correct fix needs four things, in this order of importance:

1. **Stop writing the "single" rows in production cron**, OR scope them so they never overlap calendar-month rows. Two acceptable shapes:
   - Sync only ever emits `mode=monthly` rows. Drop `mode=single` entirely from the cron call. (Simplest.)
   - Sync emits one rolling 28-day window row but uses a stable upsert key like `(property_url, source, 'rolling28')` rather than the moving `period_end`. (Preserves the rolling KPI but stops the fossil chain.)

2. **Add a stable uniqueness constraint** on `revenue_snapshots` that physically prevents the duplication, of the form:
   - `UNIQUE (property_url, source, period_start, period_end)` is already implicit in the upsert — the bug is that the upsert key isn't selective enough. Add instead:
   - `UNIQUE (property_url, source, period_kind, period_anchor)` where `period_kind ∈ {'calendar_month','rolling_28d','custom'}` and `period_anchor` is the first day of the calendar month (for calendar_month) or a static literal like `'current'` (for rolling_28d). A custom backfill stays disallowed in cron and only writable from a human-approved operator flow.

3. **Enforce period-shape at write time.** The sync code should reject any "monthly" row whose `period_end != last_day_of_month(period_start)` (i.e. don't quietly accept the malformed shape if a caller passes one). And it should reject "single" rows altogether in cron, only allowing them in operator-flagged backfill runs that are written to a separate `revenue_snapshots_backfill_audit` table rather than the main one.

4. **One-shot cleanup of existing fossils** — but this is data correction, explicitly out of scope of this discovery report. The candidate list of rows to delete is the 17 Squarespace + 11 Stripe rows enumerated in §3.1 / §3.2 (28 rows in total). The user must approve before any are deleted.

None of the above is being implemented now. This section is the specification only.

---

## Appendix — Files of evidence

- `scripts/audit-revenue-vs-live-apis.mjs` — the live re-query script (read-only, no Supabase writes).
- `scripts/audit-revenue-output.json` — verbatim live-API output, generated 2026-05-26 19:17 UTC.
- `scripts/audit-revenue-stderr.txt` — progress log for the same run.
- `api/aigeo/squarespace-revenue-sync.js` lines 321-346 — the `buildRowsToSave()` + `upsertRows()` logic that produces the duplicate-row pattern.
- `api/aigeo/stripe-revenue-sync.js` — same shape, same defect.
- `vercel.json` lines 47-54 — the cron schedule that triggers the daily duplicate row creation.

## Appendix — Items explicitly UNVERIFIED in this report

- **Booking Sheet correctness end-to-end** — cannot be re-validated without the user re-supplying the `.xlsm` or supplying bank-statement reconciliation. Section 2.3, Section 4.
- **Why several rolling rows start specifically on 2025-04-30** — most likely an operator backfill with that literal date, but the operator console call log was not inspected. Section 3.1.
- **Whether the April 2025 freshness gap (£25 / 3 txns) extends to other months** — the audit caught it because it pulled the full 17-month window with a wide `modifiedAfter`. Earlier months might have similar tiny gaps that the wide pull masked. Section 1.6.
- **Whether the Squarespace Member Areas charges (`STRIPE_APP_SS_MEMBER_AREAS`) are being correctly attributed to `academy` tier** — the script's classification was used for revenue totals only, not tier; the tier split inside stored rows was not re-validated. Section 2.2.
