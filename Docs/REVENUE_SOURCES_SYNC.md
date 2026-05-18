# Revenue tracking — how the 3 sources stay in sync

The Revenue Funnel page combines revenue from **three independent feeds** into
a single per-month total. They never overlap because each one is restricted
to streams the others cannot see.

## The three feeds

| # | Source | What it captures | How often | Where it runs |
|---|---|---|---|---|
| 1 | `squarespace_api` | **Squarespace Commerce orders only** — workshops, courses, vouchers, prints. Paid via Stripe, PayPal, or Apple Pay *at Squarespace checkout*. | Daily 07:00 UTC | Vercel cron (`/api/aigeo/squarespace-revenue-sync`) |
| 2 | `stripe_supplemental` | **Stripe charges NOT routed through Squarespace** — Acuity Scheduling (1-2-1 lessons, mentoring), Squarespace Member Areas subscriptions, ad-hoc Stripe invoices. | Daily 07:10 UTC | Vercel cron (`/api/aigeo/stripe-revenue-sync`) |
| 3 | `booking_sheet` | **Direct Bank + Cash deposits** entered in the live Booking Sheet (`G:\Dropbox\1. Bookings\Booking Sheet YYYY - Alan Ranger Photography.xlsm`). JLR contract, Artfully Walls, Into The Blue, Pure Photo, etc. | Manual, after you edit the sheet | Local Node script (`node scripts/import-booking-sheet.mjs`) |

All three write to the same Supabase table (`public.revenue_snapshots`) but
each writes only rows with its own `source` value. The unique constraint is
`(property_url, period_start, period_end, source)` so the same month can
hold one row per source without collisions.

## How double-counting is prevented

- **Stripe sync skips Squarespace Commerce**. Every Stripe charge is
  inspected and, if it carries the Squarespace application ID or has
  `metadata.orderId` / `metadata.websiteId`, it is **deliberately dropped**
  (`reason = squarespace_commerce_handled_elsewhere`). Result: feed #1
  and feed #2 never overlap.
- **Booking Sheet importer ignores Funding = Stripe**. Those rows are
  already covered by feeds #1 and #2.
- **Booking Sheet importer ignores Funding = PayPal by default**.
  Cross-checking 2025 totals showed your spreadsheet's "PayPal" entries
  match Squarespace API's PayPal-at-checkout orders almost exactly.
  Run with `--include-paypal` if you have direct PayPal invoices that
  bypass Squarespace.
- **Booking Sheet importer ignores `Funding = PicknMix`** (since 2026-05-18).
  Squarespace orders that redeem a Pick n Mix plan come through the SQ
  Orders API as 100%-discount orders with a `PICKNMIX` promo code, and
  `squarespace-revenue-sync.js` now splits them into the correct workshop
  tiers + a `services` debit deterministically. Including the spreadsheet's
  manual `PicknMix Out` / `PicknMix In` rows here as well would double-
  count the reallocation. (See `splitPickNMixRedemption` in
  `api/aigeo/squarespace-revenue-sync.js`.)
- **Booking Sheet importer still INCLUDES `Funding = Gift Voucher Out`**.
  These rows model voucher-redemption debits and credits between tiers
  (e.g. -£100 from the `services` voucher pool plus +£100 to a workshop
  tier when a customer pays with a £100 voucher). The SQ Orders API
  cannot see this debit/credit pattern, so the spreadsheet remains the
  source of truth here.

## Product → tier classification

The `commercial-tier.js` classifier consults `lib/product-tier-map.js`
first, which builds a lookup from two Supabase tables in the AI-chat
project:

- `csv_metadata` (workshop_products + course_products rows) drives most
  classifications from the products' own categories — e.g. anything
  tagged `- weekend residential photo workshops` lands in
  `workshops_residential`.
- `product_tier_override` provides manual overrides keyed on any one of
  three lookup keys:
  - `url_slug` — exact path match (use for products with a stable URL).
  - `product_id` — Squarespace product GUID match (use for SQ Commerce
    Orders line items, which return blank `productUrl`, so url_slug
    matching is impossible).
  - `title_prefix` — lowercased `titlePrefix()` match (use for products
    whose name is stable but URL/ID are not — e.g. custom one-off
    commission lines, academy/services add-ons).

Each row's `tier_id` wins over the csv_metadata classification. Add new
rows directly in Supabase; the in-process cache refreshes every 5 min.

## How the dashboard merges them

`api/aigeo/revenue-funnel-summary.js` reads every row from
`revenue_snapshots` for `https://www.alanranger.com`, groups them by
`(period_start → period_end)`, then for each group sums:

- `revenue_amount`
- `transactions`
- `tier_revenue` (workshops / courses / services / hire / academy / other)
- `tier_transactions`

The merged row also exposes `source_breakdown`, used by the
**"Revenue by source per month"** panel on the Revenue Funnel page so
you can see exactly how each month was assembled.

## What happens when you edit the Booking Sheet

1. You add or change a row in `Booking Sheet 2026 - Alan Ranger Photography.xlsm`
   (e.g. enter a new JLR invoice for £1,500 in June 2026).
2. Run:
   ```powershell
   cd "G:\Dropbox\alan ranger photography\Website Code\AI GEO Audit"
   node scripts/import-booking-sheet.mjs --dry-run    # preview
   node scripts/import-booking-sheet.mjs              # write
   ```
3. The importer:
   - Re-reads the entire `Sales 2025` and `Sales 2026` tabs (whatever the
     current year + previous year are).
   - Re-aggregates every Bank/Cash row into monthly totals per tier.
   - Upserts the affected months. `upsert ... onConflict: source` REPLACES
     the prior `booking_sheet` row for that month — so duplicate runs are
     safe and edits/deletions in Excel are picked up correctly.
4. Reload the Revenue Funnel page. The new total appears within seconds
   (no caching beyond a normal Vercel response).

## What happens when Stripe/Squarespace charge new transactions

1. Customer pays.
2. The two daily cron jobs run at 07:00 UTC and 07:10 UTC and pull the
   last 28 days (default window).
3. Their rows REPLACE their own previous rows for the same window
   (`onConflict: source`).
4. Dashboard reflects the new totals on next page load.

## Conflict scenarios (and what happens)

| Scenario | What the dashboard shows | What to do |
|---|---|---|
| Stripe charge created at 07:01 UTC | Picked up the next day (cron at 07:00 will miss it by 1 minute). | Nothing — it'll catch up in 24h. |
| Same charge appears in both Stripe and Squarespace (which always happens for SS Commerce orders) | Counted **once** — Stripe sync skips SS Commerce charges by design. | Nothing. |
| You manually enter a Stripe charge in the Booking Sheet | **Double-counted.** | Either delete the Excel row OR change its Funding to "Stripe" (which the importer ignores). |
| You delete a row from the Booking Sheet | Removed from the dashboard on next manual import run. | Re-run `node scripts/import-booking-sheet.mjs`. |
| You discover the Bank/Cash 2025 totals don't match my Excel screenshot | They should match to the penny — cross-check `revenue_snapshots` rows with `source='booking_sheet'`. | Open an issue. |

## Year rollover

The Booking Sheet importer auto-detects the current year — it tries
`Booking Sheet {current_year} ...xlsm` first, then walks back up to 3
prior years. When you open `Booking Sheet 2027 - Alan Ranger Photography.xlsm`
on 1 Jan 2027, no code change is required.

## Backfill / one-off corrections

- **Squarespace**: `POST /api/aigeo/squarespace-revenue-sync` with a wide
  body window (e.g. `period_start = "2025-01-01"`, `period_end = "2026-12-31"`).
- **Stripe**: `POST /api/aigeo/stripe-revenue-sync` with the same shape.
- **Booking Sheet**: `node scripts/import-booking-sheet.mjs --year 2025,2026`
  (or just `--year 2025,2026,2024` to go further back).

All three are safe to re-run — they upsert by `(property_url, period_start, period_end, source)`.
