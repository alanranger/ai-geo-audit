# TICKET: Remove zero-fill regression risk from `daily-gsc-backlink.js`

**Filed:** 2026-05-27 (parallel to the money-pages cron all-pages rewrite)
**State:** OPEN. Cron is currently dormant (removed from `vercel.json`
2026-04-22, commit `e081fc6`), so this does **not** corrupt data today,
but the bug is still in the source and will regress `gsc_page_timeseries`
again if anyone re-schedules the cron without addressing it first.

## What is broken

`api/cron/daily-gsc-backlink.js` lines 49–78 (`buildMoneyPageGridRows`)
produces one record per (money_page × date) cell over a rolling 28-day
window and zero-fills every cell that has no entry in
`audit.moneyPagesTimeseries`:

```49:78:api/cron/daily-gsc-backlink.js
const buildMoneyPageGridRows = ({ propertyUrl, moneyPages, timeseries, days }) => {
  const pageSet = new Set(moneyPages.map((row) => normalizeUrl(row?.url || row)).filter(Boolean));
  if (pageSet.size === 0) return [];
  const { endDate } = buildRollingDateRange(days);
  const dateSeries = buildDateSeries(endDate, days);
  const pageMap = new Map();
  (timeseries || []).forEach((row) => {
    const pageKey = normalizeUrl(row.page || row.url || '');
    if (!pageKey) return;
    if (!pageMap.has(pageKey)) pageMap.set(pageKey, new Map());
    pageMap.get(pageKey).set(row.date, row);
  });
  const records = [];
  pageSet.forEach((pageKey) => {
    const perDate = pageMap.get(pageKey) || new Map();
    dateSeries.forEach((date) => {
      const existing = perDate.get(date);
      records.push({
        propertyUrl,
        page: pageKey,
        date,
        clicks: Number(existing?.clicks || 0),
        impressions: Number(existing?.impressions || 0),
        ctr: Number(existing?.ctr || 0),
        position: existing?.position ?? null
      });
    });
  });
  return records;
};
```

The records are then upserted via `/api/supabase/save-gsc-page-timeseries`
(see `daily-gsc-backlink.js` lines 235–246) which performs a
`(property_url, page_url, date)` upsert with `ignoreDuplicates: false` —
so missing-data cells **overwrite** previously-correct `clicks` /
`impressions` with `0`.

## Why it was catastrophic at runtime

Until 2026-04-22 this cron was scheduled `*/5 * * * *` in `vercel.json`
(see commit `e081fc6~1:vercel.json`). 288 runs/day × ~6,524 rows/run =
~1.9M upserts/day. Any single run where the upstream
`audit.moneyPagesTimeseries` was rate-limited / partial / GSC-anonymised
silently zeroed every affected cell. That is the actual mechanism behind
the 94–99% click-loss the user observed for Jan–Apr 2026 in
`gsc_page_timeseries` (Phase C0 verification).

## Why it is dormant today

`audit_cron_schedule.gsc_backlinks.last_run_at = 2026-04-22 15:10:31` and
the path is no longer in `vercel.json`. Manual hits via
`/api/cron/global-run` are also gated — `forceChildren = false` was hard-
coded in the same 2026-04-22 commit.

## Required fix (scope of this ticket — do not start work without re-
quoting this section)

Either:
- **Option A (preferred):** Replace `buildMoneyPageGridRows` with a
  "GSC-only" build — drop the date-series scaffold, return one record per
  (page, date) **only** for rows actually present in
  `audit.moneyPagesTimeseries`. Missing cells must NOT appear in the upsert
  batch. Idempotent upsert preserves whatever the all-pages cron wrote on
  prior nights.
- **Option B:** Stop calling `/api/supabase/save-gsc-page-timeseries` from
  this cron entirely. The all-pages cron at
  `/api/cron/backfill-money-page-timeseries` (added 2026-05-27, scheduled
  `30 3 * * *`) is now the canonical writer of `gsc_page_timeseries`. The
  audit-side timeseries computation in `runFullAudit` should remain (still
  needed for the dashboard's in-audit per-page rendering), but should not
  also be writing to the shared timeseries table.

## Verification expected when this ticket is picked up

1. Snapshot `gsc_page_timeseries` for a 7-day window (page-level
   `(date, page_url, clicks, impressions, ctr, position)` row hash via
   `MD5(string_agg(... ORDER BY date, page_url))` — see
   `Docs/CHANGELOG.md` 2026-05-27 money-page cron entry for the exact SQL).
2. Manually invoke `/api/cron/daily-gsc-backlink?force=1` against a
   property where the audit's `moneyPagesTimeseries` is known partial
   (easy to simulate by killing one GSC fetch in `gsc-page-timeseries.js`).
3. Re-snapshot. Pre-fix the row hash changes (clicks zeroed for missing
   pages). Post-fix the row hash must be unchanged.

## Related
- `Docs/CHANGELOG.md` 2026-05-27 — money-page cron all-pages rewrite
  (this ticket's parent).
- Commit `e081fc6` 2026-04-22 — DFS spend-guard, which removed
  `daily-gsc-backlink` from `vercel.json`.
- Commit `f2b90b3` 2026-05-19 — dedup-bug fix on the sibling money-pages
  cron (separate latent issue).
