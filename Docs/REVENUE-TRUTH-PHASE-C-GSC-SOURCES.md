# Revenue Truth — Phase C — GSC Data Sources

**Status:** C0 complete (2026-05-27). C1 (views) and C2 (analyser + UI) not started.
**Scope:** sources note for the GSC funnel overlay added to the Revenue Truth tab in Phase C. Phase A and Phase B layers are untouched. This document is the single source of truth for which GSC table to query, what scale CTR is stored at, what the join key is, and what is deliberately out of scope.

**British English. All money in GBP. All click/impression/CTR/position figures pasted from real SQL against Supabase project `igzvwbvgvmzvvzoclufx` (MCP `user-supabase-ai-chat`).**

---

## 1. TL;DR — which table to query

| If you want… | Read from… | Notes |
|---|---|---|
| **Per-(page, date) clicks, impressions, CTR, position** | `gsc_page_timeseries` | **AUTHORITATIVE. Use this.** |
| Property-level daily totals (no per-page dimension) | `gsc_timeseries` | Use only as a sanity-check basis for `SUM(gsc_page_timeseries)`. ±5% delta is expected. |
| Per-(page, query, date) — i.e. which keywords drove the clicks | `gsc_page_query_daily` | **Only one week populated (2026-05-18..24).** Full backfill deferred — see §6. |
| URL inspection state (indexed Y/N, coverage state) | `gsc_url_inspection_cache` | Unchanged by Phase C, unrelated to clicks/impressions. |
| Rolling 28-day per-page snapshots | `gsc_page_metrics_28d` | **DO NOT SUM** — windows overlap. Cross-reference only. Also contains ~10 contaminated `localhost` URLs. |

The authoritative `gsc_page_timeseries` was backfilled to the same 16.4-month window covered by `gsc_timeseries` (2025-01-13 → 2026-05-25) on 2026-05-27. Before C0 it covered ~5 months (2025-12-27 → 2026-05-17) and was filtered to a money-pages allowlist.

---

## 2. Coverage window and retention floor

- **GSC retention floor:** empirically determined to be **2025-01-13** (probed daily 2025-01-01 → 2025-01-14; 2025-01-13 is the earliest date returning rows). Anything earlier is permanently unavailable from the Google API.
- **GSC reporting lag:** 2 days. Today minus 2 is the latest day with `dataState: 'final'` data.
- **Phase C window:** **2025-01-13 → 2026-05-25** (498 days / 16.4 months at backfill time).
- The window is bounded by retention, not by Phase C choice. There is no way to extend the per-page series further back without paying for a third-party GSC archive.

---

## 3. `gsc_page_timeseries` — authoritative per-page source

### Schema

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | autogen PK |
| `property_url` | text | always `https://www.alanranger.com` (URL-prefix form) |
| `page_url` | text | **slug-only**, lowercased, no protocol, no domain, no query string, no fragment, no trailing slash. Example: `private-photography-lessons`, `academy/login`. |
| `date` | date | UTC day |
| `clicks` | int | GSC `clicks` |
| `impressions` | int | GSC `impressions` |
| `ctr` | numeric | **percentage (0..100)**, NOT fraction. Stored as `gsc.ctr * 100`. (Note: `gsc_page_query_daily` stores CTR as 0..1 fraction — scale differs between tables.) |
| `position` | numeric | nullable; `NULL` on zero-impression days |
| `created_at`, `updated_at` | timestamp | book-keeping |

**Uniqueness:** `UNIQUE (property_url, page_url, date)`. Idempotent upsert key.

### Normalisation function (must use this exact shape when joining)

```js
// Verbatim copy of api/cron/backfill-money-page-timeseries.js:10-21
function normalizeUrl(url) {
  if (!url) return '';
  let s = String(url).toLowerCase().trim();
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
  s = s.split('?')[0].split('#')[0];
  const parts = s.split('/');
  if (parts.length > 1) s = parts.slice(1).join('/');
  return s.replace(/^\/+/, '').replace(/\/+$/, '');
}
```

Apply this to `canonical_products.service_page_url` before joining. Verified: 16 of 17 distinct `service_page_url` values matched a slug in `gsc_page_timeseries`; only `fine-art-prints` has zero GSC impressions in the window (see Gate 1 V1.5).

### Coverage gap vs property totals (post-C0)

Per-month delta between `SUM(gsc_page_timeseries.clicks)` and `gsc_timeseries.clicks` over the same window (full backfilled period only):

| Year-Month | % missing (page-sum vs property total) |
|---|---:|
| 2025-02 | 3.0% |
| 2025-03 | 3.3% |
| 2025-04 | 2.6% |
| 2025-05 | 2.8% |
| 2025-06 | 3.0% |
| 2025-07 | 4.3% |
| 2025-08 | 4.3% |
| 2025-09 | 5.2% |
| 2025-10 | 4.5% |
| 2025-11 | 3.8% |
| 2025-12 | 3.7% |
| 2026-01 | 1.3% |
| 2026-02 | 0.4% |
| 2026-03 | 0.5% |
| 2026-04 | 1.3% |
| 2026-05 (partial) | −3.1% (page-sum exceeds property total — multi-page query attribution noise) |

Edge months:
- **2025-01:** 36.9% missing. This is solely because Jan 1–12 is outside the GSC retention floor (2025-01-13).
- **All other months in the window:** <5.2% delta, within documented GSC attribution noise (adding the `page` dimension drops a small fraction of clicks where Google can't attribute to a specific URL; the inverse occurs on impressions due to one-query→multi-page attribution).

The `±5%` band is the operational tolerance: any larger delta in future is a coverage incident worth investigating.

### Totals as of 2026-05-27

```sql
SELECT COUNT(*), MIN(date), MAX(date), COUNT(DISTINCT page_url), COUNT(DISTINCT date), SUM(clicks), SUM(impressions)
FROM gsc_page_timeseries WHERE property_url='https://www.alanranger.com';
```

- Rows: 165,942
- Earliest date: 2025-01-13
- Latest date: 2026-05-25
- Distinct pages: 952
- Distinct dates: 498
- Sum clicks: 107,668
- Sum impressions: 30,186,791

---

## 4. `gsc_timeseries` — property-level sanity-check basis

Daily totals at the property level, no per-page dimension. Coverage 2024-10-17 → 2026-05-24 (no retention floor because there is no page dimension; older data was ingested earlier and is retained as cache).

Use only to:
- Confirm `SUM(gsc_page_timeseries)` over any window is within ±5% of `SUM(gsc_timeseries)` for the same window.
- Probe property-level trends across the pre-retention window 2024-10 to 2025-01 if needed (no per-page breakdown available there).

Never use to drive per-page UI overlays — it has no page dimension.

---

## 5. `gsc_page_query_daily` — DEFERRED (one week only)

Per-(date, page_url, query). Schema created in Phase C / C0 migration `migrations/phase_c0_gsc_page_query_daily_20260527.sql`. Only one week (2026-05-18..24) was populated as a smoke test (94,974 rows).

**Full backfill was deferred indefinitely on 2026-05-27** for the following reason:

When the `query` dimension is added to a GSC `searchAnalytics.query` call, Google silently anonymises rows for queries that don't meet a per-user privacy threshold. The empirical loss for alanranger.com, week 2026-05-18..24 (per `scripts/_gsc-dimension-loss-probe.mjs`):

| API shape | Clicks returned |
|---|---:|
| `dimensions: []` (true totals) | 1,748 |
| `dimensions: ['date']` | 1,748 |
| `dimensions: ['date', 'page']` | 1,756 (+0.5% noise) |
| `dimensions: ['date', 'query']` | 674 (**−61%**) |
| `dimensions: ['date', 'page', 'query']` | 676 (**−61%**) |

So per-page click totals derived from `gsc_page_query_daily` would understate the truth by ~60%. Any month-on-month "decline" charted from such data would be indistinguishable from a real decline — exactly the kind of false signal the EVIDENCE-OR-SILENCE rule was set up to prevent.

If a future phase needs keyword breakdowns:
1. Continue using `gsc_page_timeseries` for per-page totals (clicks, impressions, CTR, position) and trend lines.
2. Use `gsc_page_query_daily` only for the "top keywords" expander, labelled explicitly: "Top queries by clicks above GSC's per-user privacy threshold; long-tail queries below the threshold are anonymised by Google and not shown here."
3. To run the full backfill, execute: `node scripts/gsc-c0-backfill-page-query-daily.mjs --force` (script exists, idempotent, ~6 minutes for the full window per V1.1 estimates).

---

## 6. `gsc_page_metrics_28d` — do not sum

Rolling 28-day snapshots, one row per (run_id, page_url). Naive sums across rows double-count by ~7× because adjacent snapshots overlap. Also contaminated with ~10 `localhost` rows that look like ingested debug-script output.

Retained for cross-reference only (e.g. to compare a single snapshot against the trailing-28-day sum from `gsc_page_timeseries`). Should not be referenced by any Phase C view, analyser, or UI.

---

## 7. `gsc_url_inspection_cache` — unrelated to clicks

Stores GSC URL Inspection API results (indexed? coverage state? page-fetch state?). One row per (property_key, url_key). Has no time dimension and no clicks/impressions. Mentioned only so future readers don't waste time investigating it for Phase C purposes — it is unrelated.

---

## 8. Backfill script

Location: `scripts/gsc-c0-backfill-page-daily.mjs`.

Behaviour:
- Reuses the existing OAuth refresh-token flow (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` in `.env.local`; same property identifier `https://www.alanranger.com` as every other GSC ingest in this repo).
- Weekly chunked. Each chunk inserts a `gsc_backfill_runs` row (status `running` → `completed` / `failed`), paginates the API, and batch-upserts on `(property_url, page_url, date)`.
- Skips chunks whose date range already has any row in `gsc_page_timeseries` for the property, unless `--force` is passed.
- Flags: `--from YYYY-MM-DD`, `--to YYYY-MM-DD`, `--force`, `--dry-run`.

Re-run to top up from the current latest backfilled date to yesterday-2:

```bash
node scripts/gsc-c0-backfill-page-daily.mjs
```

Re-run the entire window from scratch (e.g. to refresh stale data):

```bash
node scripts/gsc-c0-backfill-page-daily.mjs --force
```

There is no Vercel cron scheduling this script yet. Routine daily updates are still handled by the pre-existing `api/cron/backfill-money-page-timeseries.js` cron, which writes a filtered subset (~400 money pages) to the same table on a 28-day rolling window. The C0 backfill is additive over that cron — both write to the same `(property_url, page_url, date)` unique key, so the C0 rows fill in the long-tail pages that the cron's money-pages filter excludes.

---

## 9. Audit trail

- Migration: `migrations/phase_c0_gsc_page_query_daily_20260527.sql` (created `gsc_page_query_daily` and `gsc_backfill_runs`).
- Backfill runs logged in `gsc_backfill_runs` (73 completed, 0 failed, 237,677 rows upserted, 76 API calls as of 2026-05-27).
- Dimension-loss probe: `scripts/_gsc-dimension-loss-probe.mjs` (one-shot diagnostic, kept for re-running).
- Retention-floor probe: `scripts/_gsc-retention-probe.mjs`.
- Smoke test: `scripts/gsc-c0-smoke.mjs` (confirms OAuth, lists property forms, samples a few API calls).
- Verification numbers reproducible from queries in `Docs/REVENUE-TRUTH-PHASE-C-GSC-SOURCES.md` §3, §4 above and from `gsc_backfill_runs`.

---

## 10. What needs the user's confirmation before C1

> Pending decision at the time of writing (2026-05-27): user has approved C0.6 (this document). C1 (views: `gsc_monthly_by_page`, `gsc_keywords_by_page`, `revenue_gsc_joined`) is not yet approved to start. The C0.5 verification has been issued and accepted.
