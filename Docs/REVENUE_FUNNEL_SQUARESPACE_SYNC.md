# Revenue Funnel — Squarespace API integration

> **⚠️ READ THIS FIRST (2026-05-26 — Phase L + L1).** The headline Revenue
> Funnel reads no longer come from `revenue_snapshots`. The Booking Sheet
> (`Sales YYYY` row 18 "Totals" line) is the single source of truth — see
> `Docs/REVENUE-TRUTH-FROM-BOOKING-SHEET.md`. The Squarespace sync described
> below STILL RUNS as a daily cron and continues to write to
> `revenue_snapshots` for **transaction-level detail only** (order IDs,
> product names, customer email, AOV, refunds — useful for drilldowns and
> conversion analysis). It is no longer summed into the headline. The
> "Revenue per 1k impressions" KPI and the Click→Sale conversion tiles now
> source their revenue figure from `public.booking_sheet_monthly_wide`
> (operational_revenue = D2C + B2B) and the click/impression detail from
> the existing GSC + SQ rows. The cron is kept so the SQ side stays warm
> for the future "Where did the bookings come from?" drilldown.
>
> ---

The Revenue Funnel tab (rendered in `audit-dashboard.html`) populates its
"Revenue per 1k impressions" KPI, the bottom of the funnel (Clicks → Sales)
and the "Sales / Click → Sale conversion" tiles from the
`revenue_snapshots` table. Two write paths exist:

| Source           | Code path                                                | Trigger                                    |
| ---------------- | -------------------------------------------------------- | ------------------------------------------ |
| `manual`         | `api/aigeo/revenue-snapshot.js`                          | Manual entry form (fallback)               |
| `squarespace_api`| `api/aigeo/squarespace-revenue-sync.js`                  | Daily Vercel cron + on-demand UI button    |

## Endpoint

`POST /api/aigeo/squarespace-revenue-sync` (also `GET` for cron / shared-token)

Body / query:

```json
{
  "propertyUrl": "https://www.alanranger.com",
  "period_start": "2026-04-19",
  "period_end":   "2026-05-17",
  "modes":        "single,monthly",
  "includeCancelled": "0"
}
```

- `single`   — upserts ONE row covering the supplied window (matches the
  rolling 28-day GSC snapshot used elsewhere in the funnel).
- `monthly`  — upserts one row per calendar month touched by the range so
  month-over-month sparklines remain accurate even when the window moves.
- Orders are filtered server-side via `modifiedAfter` / `modifiedBefore` then
  re-bucketed in code by `createdOn` (placement date, the semantically
  correct revenue date).
- `testmode` orders are excluded. `CANCELED` orders are excluded by default
  (set `includeCancelled=1` to include them).
- Each row writes `revenue_amount = grandTotal - refundedTotal`.

## Required environment variables (Vercel project `ai-geo-audit`)

| Variable                  | Required | Notes                                                              |
| ------------------------- | -------- | ------------------------------------------------------------------ |
| `SQUARESPACE_API_KEY`     | yes      | Squarespace Developer area → API Keys. Production-only is fine.    |
| `SQUARESPACE_USER_AGENT`  | no       | Defaults to `AlanRanger-AIGEOAudit/1.0 (revenue-funnel-sync)`.     |
| `SQUARESPACE_SYNC_TOKEN`  | no       | If set, required as `?token=` for `GET` calls not from Vercel cron.|
| `SUPABASE_URL`            | yes      | Already configured for other AI GEO Audit APIs.                    |
| `SUPABASE_SERVICE_ROLE_KEY` | yes    | Already configured for other AI GEO Audit APIs.                    |

Setup steps:

1. **Vercel → Project `ai-geo-audit` → Settings → Environment Variables**
2. Add `SQUARESPACE_API_KEY` for Production (and Preview if you want sync to
   work on preview deploys). Paste the raw key value, no `Bearer` prefix.
3. Redeploy or push any commit — Vercel only injects env vars on next build.

> Security note: the key was shared in chat during the original handover.
> Rotate it after the first successful production sync: Squarespace →
> Developer → API Keys → **Regenerate**, then update the Vercel env var.

## Cron

Registered in `vercel.json`:

```json
{ "path": "/api/aigeo/squarespace-revenue-sync", "schedule": "0 7 * * *" }
```

Runs daily at **07:00 UTC** (08:00 BST UK / 07:00 GMT UK). Why 07:00 UTC?

- It's after midnight UK, so the prior day is "closed" from a UK
  business-day perspective.
- It gives Squarespace several hours to settle any late-evening orders
  (auth → capture → fulfilled).
- It lands before the user typically opens the dashboard in the morning.

Vercel cron runs **in Vercel's cloud**, not on your local machine — so it
will fire at 07:00 UTC regardless of whether your computer is on.
The handler treats the `x-vercel-cron: 1` header as authorised. Default
window is today UTC - 27 days through today UTC, mode = `single,monthly`.

If a particular night's cron run fails or is throttled, the next morning's
run still fixes it because each row is keyed on
`(property_url, period_start, period_end, source)` — upserts not inserts.
You can also hit **Sync now** from the dashboard at any time.

## On-demand sync (UI)

Revenue Funnel tab → "Revenue snapshot" section → **Sync from Squarespace**
form. Pick a date range, click **Sync now**. The response shows total orders
fetched, orders in window, gross revenue (net of refunds), and how many
calendar-month rows were upserted. The funnel tiles re-fetch automatically.

## Upsert / dedupe

`revenue_snapshots` has a unique index on
`(property_url, period_start, period_end, source)`. The sync uses
`onConflict` against this index so re-running for the same window simply
overwrites the prior numbers (no duplicate rows).

## Troubleshooting

| Symptom                                            | Fix                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `configuration_error` + `missing: SQUARESPACE_API_KEY` | Add the env var in Vercel and redeploy.                                          |
| `squarespace_http_401`                             | Key invalid / revoked / not enabled for `commerce.orders.read`. Regenerate in Squarespace. |
| `squarespace_http_429`                             | Rate limit. Reduce the date range or wait. Cron is once/day so this is rare manually.|
| Sync OK but funnel still shows £0                  | Hit the Refresh button on the Revenue Funnel tab; latest snapshot is cached client-side. |

## Source ordering in the funnel

`revenue-funnel-summary.js` picks the latest snapshot by `period_end DESC`.
If both `manual` and `squarespace_api` snapshots exist for overlapping
windows, the most recent `period_end` wins. To make the API source
authoritative, prefer it in the query — see `fetchLatestRevenue()` in
`api/aigeo/revenue-funnel-summary.js` (currently latest-wins regardless of
source, which is the desired behaviour now that daily sync is in place).
