# AI GEO Audit — notes for AI coding agents

## Read first (in this order — DO NOT skip)

1. **`Docs/AGENT_ONBOARDING.md`** — **the soup-to-nuts brief.** Business mission, commercial tiers + GP%, Vercel + Supabase setup, repo layout, key DB tables, current open task list, hard rules, communication rules, and verification commands. **Read this in full before touching code.**
2. **`Docs/REVENUE-TRUTH-FROM-BOOKING-SHEET.md`** — **the single source of truth for revenue data.** 12 verbatim Booking Sheet categories + 3 derived markets (D2C / B2B / ADJUSTMENT). Operational headline = D2C + B2B. ADJUSTMENT (voucher timing) shown as its own line, never silently in headline. Phase L1 (2026-05-26) replaced the old 5-tier rollup; the 12-cat truth lives in `public.booking_sheet_monthly_category`, the category → market mapping in `public.booking_sheet_category_market`, and the dashboard reads from `public.booking_sheet_monthly_wide`.
3. **`Docs/HANDOVER_REVENUE_FUNNEL_2026-05-20.md`** — file-by-file pitfalls + open task list for the Revenue Funnel / Scenario Planning Phase H+ work (suppression + seasonality). Note: revenue data layer has since been rebuilt by Phase L + L1 — see item 2 above before touching anything that reads revenue.
4. **`Docs/CHANGELOG.md`** — chronological history. Read the top entry first.
5. **`HANDOVER.md`** (root) — entry-point only; links here.
6. **`Docs/TRADITIONAL_SEO_KEYWORD_METRICS.md`** — Traditional SEO **③** Keywords Everywhere cache, API, DB, deploy pitfalls.
7. **`Docs/TRADITIONAL_SEO_BACKLINKS_DFS.md`** — Backlinks product spec: DFS summary tile, per-URL modal, disavow toggle, explicit fetch (no auto-spend on load).
8. **`Docs/DATAFORSEO_BACKLINK_SPAM_FILTERS.md`** — Spam URL filters, domain index tables, **`POST /api/aigeo/dataforseo-backlink-domain`** (`full` / `delta` / `status`), `npm run test:dfs-backlink-filters`.
9. **Backlinks tab tile aggregates:** **`GET /api/aigeo/dfs-domain-backlink-tiles`**; audit baseline **`GET` / `POST` / `DELETE /api/aigeo/dfs-backlink-tile-baseline`** + Supabase **`dfs_backlink_tile_baseline`** (see **`Docs/CHANGELOG.md` 2026-03-23**).

## Export for Claude (Google Drive snapshot)

When Alan says **"export to google"**, **"export for claude"**, or similar — run from repo root:

```bash
npm run export:claude
```

Aliases: `npm run export:google`, `npm run snapshot:dashboard` (same command).

- **Script:** `scripts/snapshot-dashboard-to-drive.mjs` — headless Chromium loads live Vercel dashboard, expands Revenue Truth UI, inlines CSS, writes standalone HTML locally (no Drive API; Google Drive Desktop syncs).
- **Output folder:** `C:/Users/alan/Google Drive/Claude shared resources`
- **Stable path for Claude:** `LIVE-DASHBOARD-SNAPSHOT-revenue-truth-LATEST.html` (also writes timestamped copy).
- **First-time on a machine:** `npm install` then `npx playwright install chromium`
- **All tabs:** `node scripts/snapshot-dashboard-to-drive.mjs --tab=all`

## Critical gotchas

- **Vercel deploys from Git.** If the user only edits files in Dropbox, **nothing reaches production** until `git commit` + `git push` to `main` (repo: `ai-geo-audit`).
- **Supabase project:** production dashboard uses **`igzvwbvgvmzvvzoclufx`** (MCP: `user-supabase-ai-chat`). Do not confuse with **`user-supabase-academy`** (`dqrtcsvqsfgbqmnonkpt`).
- **API routes:** files under `api/` map 1:1 to URLs — do not rename without updating callers.
- **Main UI:** `audit-dashboard.html` (very large). `audit-dashboard-latest.html` is a **redirect stub** to `audit-dashboard.html` with a cache-buster.
- **Revenue data has ONE source: the Booking Sheet.** Never sum `revenue_snapshots.source IN (squarespace_api, stripe_supplemental, booking_sheet)` — those overlap and produce double-counted totals (the bug Phase L fixed). All headline revenue reads `public.booking_sheet_monthly_wide`. SQ + Stripe API rows in `revenue_snapshots` are transaction-level **detail only**, never additive. See `Docs/REVENUE-TRUTH-FROM-BOOKING-SHEET.md`.
- **There are THREE separate tier systems, do not conflate.** (1) Accounting categories (12 verbatim Booking Sheet categories — revenue truth). (2) Business market (3 derived: D2C / B2B / ADJUSTMENT). (3) Page tiers (A-F: Landing / Product / Event / Blog / Academy / Unmapped — SEO/money-pages side only, never in revenue data layer). The legacy 6-tier picker model (`courses`, `workshops_nonres`, `workshops_residential`, `services`, `hire`, `academy`) lives on as a **scenario-planning concept** for where Alan focuses effort, NOT as a revenue category. `services` and `hire` in particular are not real revenue lines — they're opportunity-zone scenario tiers.

## Traditional SEO keyword columns (short)

- **① / ②** = audit scoring only.  
- **③** = keyword **volume** + **metrics age** via KE → `keyword_target_metrics_cache`.  
- **Pg bl:** disavow in `public/` (`disavow-alanranger-com.txt` + long-name copy); modal loads **`/api/aigeo/disavow-list`** (SPA rewrite used to serve HTML for `.txt` URLs). **`DISAVOW_FILE_PATH`** overrides server read path.  
- **Rank / Moz DA** columns = placeholders until another source writes those fields.
- If **③** failed with **Bad Request**, older builds hit PostgREST limits on huge `.in('page_url', …)` filters — fixed by **chunking reads** in `api/aigeo/keyword-target-metrics.js` (see `Docs/CHANGELOG.md` **2026-03-20**).

## Where to put new docs

- Feature/spec write-ups → **`Docs/`**  
- Root **`README.md` / `HANDOVER.md`** only for entry points (per project conventions in `HANDOVER.md`).
