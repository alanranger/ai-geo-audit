# Silent fault monitor

Catches faults that never throw an error: schema that disagrees with the rendered page, pages quietly noindexed or redirected, blocks that stopped rendering, tools running on dead keys, and Supabase data that silently fell out of sync. Approved 27 Oct 2026.

## When it runs

- **A step in the Full refresh**, immediately before `ceo_weekly_email`. The Monday cron (`api/cron/ceo-weekly-full-refresh.js`, step kind `silent_faults`) and the dashboard **Full refresh** button (`runGlobalStepSilentFaults`) run it identically. There is no separate cron.
- **Multi-tick:** each `POST /api/aigeo/silent-fault-monitor {action:'tick', runId}` renders pages for about 200 s, saves the cursor in `fault_monitor_runs`, and returns `done:false`. The cron carries `runId` in `progress.silent_faults`; the dashboard loops in `window.sfRunMonitor`.
- **Re-check this page now** (drawer button) → `{action:'recheck', url}`: same page checks plus that URL's D5/B3. Closes anything that now passes.
- **Run full check now** on the Silent faults section runs the same loop on demand.

## What it renders

Headless Chrome as Googlebot smartphone (`@sparticuz/chromium` on Vercel, Playwright/Chrome locally), `load` + 4 s. One request per page (status, redirect, `X-Robots-Tag` come from the navigation). Pages are paced 2.5 s apart; a 429 pauses 30 s and the page is retried once after 60 s, then recorded as **not checked**, never as a pass.

Plan per run (`lib/fault-monitor/plan.js`): every top-level money/landing page from `06-site-urls.csv`, plus one of 4 rotation slots of blog posts and deeper pages (FNV hash of the path mod 4 = London week number mod 4), so everything is rendered every 4 weeks. About 160 renders, ~25 min.

"The post's own text" = the rendered `article.BlogItem` minus injected UI (`INJECTED_UI_SELECTORS` in `lib/fault-monitor/monitor-config.js`), measured with the **vendored Schema Tools extractors** (`lib/fault-monitor/vendor/*.mjs`), so the monitor measures exactly as the generator does. Keep those copies in sync with Schema Tools.

## Checks

| Id | Fault when | Severity |
|---|---|---|
| A1 | BlogPosting `articleBody` < 80% of the post's words, or no BlogPosting | red |
| A2 | Neither the post's first 12 words are in the body's first 40, nor the body's first 12 in the post's first 40 | red |
| A3 | `articleBody` or `description` equals the headline, or the body is ≤ 12 words | red |
| A4 | Visible FAQs (question-style accordion labels or the Schema Tools extractor) ≠ FAQPage count; FAQPage missing with ≥ 3 visible; or < 50% of FAQPage questions appear on the page (stale/invisible FAQPage) | amber, red on money pages |
| A5 | Academy page lacks Course / CourseInstance / ≥ 2 Offers / AggregateRating, or review strip count ≠ schema count | red |
| A6 | > 1 FAQPage, or a HowTo repeated with the same `@id` | amber |
| B1 | `noindex` (meta or `X-Robots-Tag`) unless `page_indexability_policy` says intentional | red on money/landing, else amber |
| B2 | Canonical ≠ the page (www/slash normalised) on money/landing/blog pages | red |
| B3 | `gsc_url_inspection_cache` not indexed for a money/landing page (cache only, no API spend) | amber |
| B4 | 3xx to another page (not a planned `retired_redirect`) or 4xx/5xx | amber |
| C1 | A site block (`ar-*-wrap`, `ar-faq`, `ar-revs`, `article.BlogItem` …) that rendered before is gone, or a `[data-wm-plugin="load"]` loader is empty. First render sets the baseline; "Accept current layout" resets it | red on money pages, else amber |
| C2 | Squarespace error text on the page | red |
| C3 | Uncaught site-code JS errors, grouped per message with a page count (third-party noise filtered) | amber |
| D1 | The Supabase key in the live Schema Tools page is rejected | red |
| D2 | Last Schema Tools run report had Supabase errors or NOT-published posts (red) or errors (amber) | red/amber |
| D3 | No shared-resources sync heartbeat for 24 h, or the last one failed | amber |
| D4 | Config-integrity check 6 (09 export ≠ DB) | amber |
| D5 | Source CSV vs `csv_metadata` per type, live sitemap blog posts vs `csv_metadata`, and every `csv_metadata` URL vs `page_entities`: no row (red), row not refreshed by the last ingest (amber) | red/amber |
| D6 | Last chatbot ingest run report had any failed / skipped / not-written record | red |

Findings live in `fault_monitor_findings` keyed `check|url` (or `check|subject` for site-wide ones). A finding **opens** the first time it fails and **resolves** the first time it passes; site-wide checks resolve anything not re-found in a run. Pages not checked this run keep their open faults ("not re-checked in the last run").

## Run reports (D2, D3, D6)

`POST /api/aigeo/tool-run-report` (CORS open, server-side write to `tool_run_reports`):

- **Schema Tools** (`index.html` `postSchemaToolsRunReport`): blog bulk, single URL, blog index.
- **Chatbot ingest** (`public/bulk-simple.html` `postIngestRunReport`): bulk ingest and re-ingest. Failed, skipped and `store_entities_error` URLs count as failed. The endpoint also checks every "ok" URL has a `page_entities` row with `last_seen` since the run started; missing ones are added as failed (the ingest can return success without writing a row).
- **Shared-resources sync** (`scripts/auto-push.ps1` `Send-SyncHeartbeat`): every 10-minute run; rows older than 7 days are pruned.

## CEO brief

`lib/ceo-weekly/report.js` adds `metrics.silent_faults` (`loadFaultSummary`); `email.js` renders one red line under the header **only when red faults are open**, naming up to 3 (money-page faults first) and "+N more".

## Tables (migration `migrations/20261027_silent_fault_monitor.sql`)

`fault_monitor_runs`, `fault_monitor_findings`, `fault_monitor_page_baseline`, `tool_run_reports`. RLS on with no policies: service role only; nothing is readable with the publishable key.

## Tests

`node --test test/silent-fault-monitor.test.js` — fixtures from the 26–27 Oct finds (title-only bluebell body, dropped intro, Academy FAQ/Course, stale `/photography-workshops` FAQPage, invisible 10-basic FAQPage, lee-filter JPG redirect).
