# Schema audit resilience (2026-04-17)

## Problem

A URL (`https://www.alanranger.com/blog-on-photography/photography-gift-vouchers-ideas`) that demonstrably had schema on the live site kept showing warnings in the Traditional SEO page modal:

> No Schema QA row for this URL in the cached schema/Implementation payload — run ① or refresh the schema audit, then ② Score Traditional SEO.

## Investigation

- The URL was present in the canonical `csv/06-site-urls.csv` (fetched from GitHub raw).
- The URL was present in `audit_results.schema_pages_detail` on 2026-04-15 and 2026-04-16.
- On 2026-04-17 the URL was missing from `schema_pages_detail` and `impl_audit_snapshots.qa`, even though the audit processed 526 pages (= canonical CSV size).
- The URL had GSC impressions in `gsc_page_metrics_28d` — it’s real content, not a stub.

**Root cause**: a transient crawl miss. Either GitHub served a slightly older cached CSV, or one URL’s crawl promise resolved without a result row. The schema audit had no safety net, so the URL silently vanished from that run’s payload. Subsequent writes to `audit_results` replaced `schema_pages_detail` wholesale, permanently overwriting the previously-good row for that URL until the next run.

The user then saw a warning in the UI that _looked like_ a page-level schema failure, rather than a data-coverage gap.

## Fix (three layers of defence)

1. **Crawler — force-refresh the canonical CSV** (`api/schema-audit.js` → `parseCsvUrls`). Always pass `forceRefresh: true` to `fetchCanonicalSiteUrlList`; the fetch is cheap and avoids stale GitHub-raw CDN caches feeding us yesterday’s URL list.

2. **Crawler — guarantee every input URL has a row in `pages[]`** (`api/schema-audit.js`, right before the `pages` array is sent to `save-audit.js`). We reconcile `results` against the input `urls` list; any URL that produced no crawl entry gets a synthetic row with `errorType: 'Missing Result'`. `save-audit.js` already stores these, so the next modal render has something to display (and operators can see which URLs failed rather than having them disappear).

3. **Save-audit — merge `schema_pages_detail` with the previous run** (`api/supabase/save-audit.js`, new helpers `fetchPreviousSchemaPagesDetail` / `previousEntryIsStillUseful` / `mergeSchemaPagesDetail`, called once per full schema save). For every URL missing from the new payload we carry over the most-recent previous entry that had `hasSchema: true` or non-empty `schemaTypes`, tagged `stale: true` with a `staleSince` timestamp. Entries older than 14 days are not carried over, so genuinely-removed URLs expire naturally.

## UX (dashboard)

`audit-dashboard.html`:

- `traditionalSeoModalNoteForRule` now has a dedicated branch for `schema_present_core` (previously fell through to the generic rule description) and rewrites the "missing QA row" note for `schema_qa_gate_page`. Both say something like:

  > URL not in the cached schema audit (likely a transient crawl miss — the live page is unaffected). Click Re-audit page above, or refresh the schema audit to re-evaluate.

- After the modal table is rendered we call `traditionalSeoApplySchemaRuleFallback(target, hits)`. When a schema rule is warn/fail **and** the URL has no `schemaPage`/`qaGate` signal, it calls `fetchSchemaCoverageViaApi(target)` (hits `/api/supabase/get-schema-for-url`, which searches the full Supabase JSONB — including merged entries from the save-audit helper above). If the URL does have schema according to the live database, the note cell is patched with a "Live schema lookup found N type(s): …" summary so the user isn’t left staring at a warning that contradicts reality.

## Touched files

- `api/schema-audit.js` — force-refresh CSV; defensive `pages[]` reconciliation.
- `api/supabase/save-audit.js` — `schema_pages_detail` merge with 14-day freshness cap.
- `audit-dashboard.html`
  - `traditionalSeoModalNoteForRule` — clearer schema rule notes.
  - `traditionalSeoApplySchemaRuleFallback` — new per-URL API fallback.
  - Modal rendering — adds `data-rule-key` on rows and `traditional-seo-rule-note` class on note cells so the fallback can patch the DOM.

## Operational notes

- If a URL keeps showing "URL not in the cached schema audit" even after a fresh full audit, check `impl_audit_snapshots.payload.qaGate.results` for that URL and look at `audit_results.schema_pages_detail` for the same property. If the new payload has fewer URLs than the previous one, the crawler genuinely lost them — inspect Vercel logs for `schema-audit` warnings like `⚠️ schema-audit: N input URL(s) produced no crawl result`.
- `stale: true` entries in `schema_pages_detail` are a signal that a URL dropped out. They will self-correct on the next full audit that successfully crawls the URL (the new entry replaces the stale one).
- The merge helper is skipped for partial saves (ranking-only, query-pages-only, etc.) so it never interferes with non-schema writes.
