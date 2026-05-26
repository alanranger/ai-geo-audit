# AI GEO Audit - Agent onboarding (soup to nuts)

**Read this entire file before touching any code.** It's the single
source of truth for what this project is, what it's for, what data
lives where, how it ships, and what the user expects from you.

If you only have time for ONE read, this is it. Other docs go deeper
on individual features; this one orients you.

**Last updated**: 2026-05-26 (Phase L1 session — revenue data-layer
correction; UI rebuild deferred to a follow-up turn).
**Last commit on `main`**: run `git log --oneline -1` - should be
`6faa5f1` (Phase L) or later. Phase L1 is uncommitted at time of
writing — verify before assuming it's deployed.

---

## 0. Revenue data is now Booking-Sheet-sourced (Phase L + L1, 2026-05-26)

**Critical context for anyone touching revenue, Scenario Planning, or the
Revenue Funnel tab — read this BEFORE the rest of the doc.**

The Revenue Funnel + Scenario Planning tabs previously summed three
overlapping sources in `revenue_snapshots` (`squarespace_api` +
`stripe_supplemental` + `booking_sheet`) and produced a double-counted
17-month total of £72,251.50 vs the user's manually-reconciled truth of
£66,165.50. **Phase L (2026-05-26)** killed that model:

- `revenue_snapshots` is now **detail-only** (transaction-level SQ + Stripe
  data — never additive for headline revenue).
- The user's local Booking Sheet (`.xlsm`) is the **single source of truth**
  for total revenue. The "YTD Actual" cell in each `Sales YYYY` tab is the
  reconciliation basis.

**Phase L1 (same day) corrected Phase L's tier model.** Phase L initially
rolled the 12 verbatim Booking Sheet categories into 5 invented "tiers"
(courses / workshops_nonres / workshops_residential / services / academy),
where `services` merged 8 unrelated D2C, B2B and ADJUSTMENT lines into one
bucket. That rollup is gone. The right model is **three separate tier systems
that must never be conflated**:

1. **Accounting categories (12)** — verbatim Booking Sheet categories.
   Revenue truth layer. Stored in `public.booking_sheet_monthly_category`.
   Never merged. Surfaced as the `category_revenue` jsonb on each row of
   `public.booking_sheet_monthly_wide`.
2. **Business market (3)** — derived attribute per category:
   - **D2C** — `1. Courses/masterclasses`, `2. Workshops Non Residential`,
     `3. Workshops Residential`, `6. Mentoring`, `7. 1-2-1`, `12. Academy`
   - **B2B** — `10. Prints & Royalties`, `11 Commissions`
   - **ADJUSTMENT** — `4. Pick n Mix Inc`, `5. Pick n Mix Out`,
     `8. Gift Vouchers Inc`, `9. Gift Vouchers Out`. **Not revenue** —
     deferred-spend accounting plumbing (advance voucher booked Inc, later
     credited Out against the D2C category it's spent on). Always shown as
     its own labelled line, never silently in or out of the headline.

   Mapping lives as DATA in `public.booking_sheet_category_market` (12 rows
   — editing the table changes the dashboard without a code release), joined
   by the wide view to expose `market_revenue` jsonb per month.
3. **Page tiers (A–F: Landing / Product / Event / Blog / Academy / Unmapped)**
   — SEO/money-pages classification, where on the website the journey
   happens. **Stays out of the revenue data layer entirely.** The two
   systems meet only via the `market` attribute on money pages (a separate
   follow-up not done yet).

**Headline rules (locked by Alan 2026-05-26 — REVISED):**

- **Primary headline** = `revenue_amount` = **full 12-category sum** =
  **the spreadsheet YTD Actual cell** (J47 for 2025 = £46,567.46;
  J48 for 2026 = £19,598.04). The dashboard headline MUST equal the
  figure the user reads on the Booking Sheet — anything else destroys
  trust on every glance.
- **Tier-band comparison** (survival £3k / comfortable £5k / thrive £8k)
  is also against `revenue_amount`, so "which tier am I in" matches the
  spreadsheet.
- **Secondary breakdown line** = `operational_revenue` = D2C + B2B,
  labelled "service revenue (excl. voucher timing)". Shown beneath the
  headline as a breakdown, not as the headline.
- **ADJUSTMENT** = `adjustment_net`, shown as its own visible labelled
  line ("voucher / deferred-spend timing: −£1,228.75") so the user can
  see headline = operational + adjustment at a glance.
- **Import gate** verifies `SUM(12 categories) === YTD Actual` to the
  penny. Because the headline IS `revenue_amount` (the gate's basis),
  the on-screen number and the gate number are the same number.

> _An earlier locked draft made `operational_revenue` the headline — that
> was reversed on 2026-05-26 before any UI shipped. The user reads the
> Booking Sheet daily; the dashboard headline must equal the spreadsheet
> figure (which is `revenue_amount`). Data layer doesn't change — only
> which field the UI reads for the headline + tier-band comparison._

**The legacy 6-tier names (`courses`, `workshops_nonres`,
`workshops_residential`, `services`, `hire`, `academy`)** survive as a
**scenario-planning / picker concept** — categories Alan focuses effort on,
where `services` and `hire` are explicitly flagged as opportunity zones.
They are NOT revenue categories. The 4 that 1-to-1 map to real Booking
Sheet categories (courses, workshops_nonres, workshops_residential, academy)
are kept as back-compat aliases in `lib/revenue-funnel-seasonality-blend.js`
and `api/aigeo/revenue-funnel-summary.js`; `services` and `hire` resolve to
null/neutral. The UI rebuild turn following Phase L1 will delete the 6
per-tier sparklines and replace them with a 3-line D2C/B2B/ADJUSTMENT chart.

**Full detail:** `Docs/REVENUE-TRUTH-FROM-BOOKING-SHEET.md`. CHANGELOG entry
for 2026-05-26 covers the schema migrations, parser rewrite, and 5 reader
path updates.

---

## 1. Who Alan is + the business mission

Alan Ranger is a Coventry-based photography educator and commercial
photographer who runs his entire business through one Squarespace
site (`alanranger.com`) plus a Memberstack-gated digital academy.
He is a sole trader; cash through the door is working capital that
keeps the wheels turning.

He hired you - the AI GEO Audit dashboard - to stop him going round
in circles. Specifically:

> "I want to work out how I can maximise my effort and focus to
> bring in revenue ... and then I want the levers and weights that
> provide more than the baseline survival stretch each month, YTD
> and annual ... I want intelligent tracking, monitoring, and
> recommending of what tactical and strategic actions and levers to
> pull so my work is targeted, focused and tracked for results."

His own description of the dashboard's purpose:

> "I want something I can pull levers on that runs scenario-based
> algorithms that give me prioritised actions that can deliver
> objectives ... I want to do 'what if' scenarios with the levers
> and objectives for revenue and GP and how I survive in an
> increasingly competitive market."

### Success looks like

- Monthly GP target hit (see `revenue_funnel_targets` for the current
  number; survival baseline he typed in May 2026 = £3,000/mo).
- Top 3 actions on the dashboard are SPECIFIC, page-aware,
  acknowledge work he's already done, and explain WHY they will move
  the needle - not generic "rewrite the title" copy.
- A loop that closes: he does the work, the dashboard reads the
  post-edit GSC data, suppresses the recommendation, shows the
  CTR/clicks delta, and only re-recommends when there's a genuinely
  new angle worth trying.

### Commercial tiers (the picker model — read §0 first for context)

These are the segments **the Scenario Planning picker** sorts everything
into. Tier IDs are how the picker code refers to them; GP% is hard-coded
in `audit-dashboard.html` under `rfActionGpPct`. **These tiers are not
revenue categories** — for the verbatim 12-category revenue truth see §0
and `Docs/REVENUE-TRUTH-FROM-BOOKING-SHEET.md`. The 4 with a Booking
Sheet 1-to-1 mapping (`courses`, `workshops_nonres`, `workshops_residential`,
`academy`) carry real observed revenue; `services` and `hire` are
opportunity-zone scenario concepts only — no Booking Sheet category maps
to them.

| Tier ID                 | What it is                                | GP%   | Seasonality (current model)               | Maps to Booking Sheet category? |
|-------------------------|-------------------------------------------|-------|--------------------------------------------|---|
| `academy`               | Memberstack-gated digital academy. £79/yr or £59 with offer. Lead magnet = free 14-day trial of `/free-online-photography-course` | 99%  | Slight winter boost (1.15-1.20), summer dip (0.85-0.90) | ✅ `12. Academy` (D2C) |
| `courses`               | Beginner photography courses, evening classes, mostly Coventry catchment                | 90%   | 60%+ Jan-May + Sep-Nov, sub-50% Jun-Aug   | ✅ `1. Courses/masterclasses` (D2C) |
| `workshops_nonres`      | 1-day landscape photography workshops                 | 75%   | 80%+ Apr-May + Sep-Nov (bluebells, autumn) | ✅ `2. Workshops Non Residential` (D2C) |
| `workshops_residential` | Multi-day residential workshops (highest AOV ~£775+)  | 35%   | Same shape as nonres, broader shoulders   | ✅ `3. Workshops Residential` (D2C) |
| `services`              | 1-2-1 private lessons (in-person + Zoom), gift vouchers, RPS mentoring | 78% | Flat 1.0 - constant + OPPORTUNITY zone | ❌ Conceptual only — overlaps multiple real categories (Mentoring + 1-2-1 + Gift Voucher Inc/Out) which are reported separately under D2C / ADJUSTMENT |
| `hire`                  | Commercial photographer hire (Coventry), corporate training, real estate, product shoots | 92% | Flat 1.0 - sporadic + OPPORTUNITY zone | ❌ Conceptual only — closest real categories are `10. Prints & Royalties` + `11 Commissions` (both B2B) |

**OPPORTUNITY zones**: Alan has explicitly flagged `services` and
`hire` as under-utilised - high margin, low volume, year-round, but
not currently throwing off enough revenue. Your recommendations
should look for ways to grow these without cannibalising the seasonal
workshops/courses revenue.

### Costs Alan is paying (model these)

- Memberstack subscription (Academy membership gating)
- Supabase (this project + the Academy project)
- Squarespace + email campaigns
- AI content generation costs (he uses LLMs to write Academy modules)

Estimated Academy fixed cost: **~£100/mo**. He needs at least
**10 paid signups/month** at £79 (or £59 with offer) to justify
keeping Academy live. This is captured as task #5 in the open
task list - the tier-cost model isn't built yet.

---

## 2. Architecture overview

**One repo, one Vercel deployment, two Supabase projects.**

### Repo

- GitHub: `alanranger/ai-geo-audit`
- Local: `G:\Dropbox\alan ranger photography\Website Code\AI GEO Audit`
- Branch: `main` (Vercel auto-deploys from here)
- Workspace is inside Dropbox so file changes sync to Alan's other
  machines, but **Vercel only sees what's pushed to `main`**.

### Deploy

- **Hosting**: Vercel project `ai-geo-audit`
- **Production URL**: `https://ai-geo-audit.vercel.app`
- **Deploy trigger**: `git push origin main`
- **Build time**: 60-90 seconds typically. If a deploy seems stuck
  past ~5 minutes, check Vercel dashboard.
- **PowerShell quirk**: `git push` writes its success message to
  stderr, so Cursor renders it as red. Look for `main -> main` in
  the output to confirm success regardless of colour.

### Supabase projects

| Project ID            | MCP server          | Purpose                                                 |
|-----------------------|---------------------|---------------------------------------------------------|
| `igzvwbvgvmzvvzoclufx` | `user-supabase-ai-chat` | **THIS dashboard's database.** Use this for all Revenue Funnel, Scenario Planning, GSC, schema audit, optimisation tracking work. |
| `dqrtcsvqsfgbqmnonkpt` | `user-supabase-academy` | Separate Academy app database. Do NOT confuse with the dashboard's project. |

The dashboard uses `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
env vars (set in Vercel and in `.env.local`).

### File layout

```
ai-geo-audit/
  audit-dashboard.html              <- THE main UI (very large, 90k+ lines).
                                        All Revenue Funnel + Scenario Planning
                                        markup, CSS, and client JS lives here.
  audit-dashboard-latest.html       <- redirect stub to audit-dashboard.html
                                        with a cache-buster
  api/aigeo/                        <- Vercel serverless functions (1:1 with URLs).
    revenue-funnel-smart-priorities.js   The picker - candidates, scoring,
                                          suppression, seasonality, live enrich.
    revenue-funnel-auto-optimise.js      Easy/Balanced/Hard preset engine.
    revenue-funnel-summary.js            YTD / target / profit-pyramid endpoint.
    revenue-funnel-scenarios.js          CRUD for saved scenarios.
    revenue-funnel-config.js             Tier + lever weight CRUD.
    revenue-funnel-seasonality.js        NEW (tonight) - per-tier band banner data.
    revenue-funnel-targets.js            Target CRUD per scenario.
    keyword-target-metrics.js            Traditional SEO / Keywords Everywhere.
    dfs-domain-backlink-tiles.js         DataForSEO backlink aggregates.
    ... (other endpoints exist - see api/aigeo/ for the full list)
  Docs/                             <- All markdown. THIS file lives here.
    AGENT_ONBOARDING.md             <- you are here
    HANDOVER_REVENUE_FUNNEL_2026-05-20.md   <- current open tasks + pitfalls
    CHANGELOG.md                    <- chronological history
    TRADITIONAL_SEO_KEYWORD_METRICS.md
    TRADITIONAL_SEO_BACKLINKS_DFS.md
    DATAFORSEO_BACKLINK_SPAM_FILTERS.md
    MULTI_SCENARIO_VALIDATION_*.md  <- output from the self-test script
    ... (other feature specs)
  scripts/                          <- Node helpers (test, verify, reset).
    multi-scenario-validation.mjs   <- run this to verify suppression + season
    auto-optimise-permutation-tests.mjs
    reset-auto-scenarios.mjs
    verify-quadratic-weights.mjs
  migrations/                       <- SQL migrations - do NOT move these
  sql/                              <- Ad-hoc query SQL
  public/                           <- Static assets (disavow.txt etc)
  AGENTS.md                         <- workspace-level rules (root)
  HANDOVER.md                       <- entry-point doc (root) - LINKS HERE
  README.md                         <- entry-point doc (root)
```

### Main UI in `audit-dashboard.html`

It's a single-page app with tabs (Schema Audit, Traditional SEO,
Revenue Funnel, Scenario Planning, Backlinks, Optimisation
Tracking, etc.). Each tab is an `.aigeo-panel[data-panel="..."]`.

Key panels you'll touch:

- `data-panel="revenue-funnel"` - the home tab. Seasonality banner,
  Top 3 cards, profit pyramid, revenue history, tier matrices.
- `data-panel="scenario-planning"` - the levers tab. Auto-Optimise
  presets (Do Nothing / Easy / Balanced / Hard summary tiles +
  detailed action cards), scenario library, workflow guide,
  recommendation panel.

Init hooks per tab:

- `rfInit()` - boots Revenue Funnel: calls `rfFetchSummary()` +
  `rfFetchSeasonality()`. Re-runnable via `window.rfFetchSummary`.
- The Scenario Planning tab calls `spRenderRecommendation()` after
  Auto-Optimise results render.

---

## 3. Database tables you'll touch most often

All in the dashboard's project (`igzvwbvgvmzvvzoclufx`).

### Revenue Funnel + Scenario Planning

| Table                              | Rows | Purpose                                            |
|------------------------------------|------|----------------------------------------------------|
| `revenue_funnel_scenarios`         | ~7   | Saved scenarios (Baseline, Auto: Easy/Balanced/Hard, May 2026, etc). `is_active` is mutually exclusive (partial unique index). |
| `revenue_funnel_tier_weights`      | 42   | Per-scenario picker-tier weight (0-5). 6 picker tiers × 7 scenarios. (These are scenario-planning tier IDs, not revenue categories — see §0.) |
| `revenue_funnel_lever_weights`     | 42   | Per-scenario lever weight (0-5). 6 levers × 7 scenarios. |
| `revenue_funnel_targets`           | 21   | Monthly + annual rev/GP targets per scenario per tier. |
| `revenue_funnel_priorities`        | 21   | Persisted Top N picker output. |
| **`booking_sheet_monthly_category`** | 204 | **CANONICAL REVENUE TRUTH (Phase L1).** Verbatim 12 Booking Sheet categories × 17 months. PK `(property_url, year, month, category_label)`. Written by `lib/booking-sheet-truth-parser.mjs` via `api/aigeo/booking-sheet-upload.js` (import gate refuses to write if `SUM(12 categories) !== YTD Actual cell`). |
| **`booking_sheet_category_market`**  | 12  | **Mapping of the 12 categories to 3 markets (D2C / B2B / ADJUSTMENT).** `is_revenue` flag distinguishes real revenue (D2C+B2B) from ADJUSTMENT (voucher Inc/Out plumbing). Edit this table to change market classification without a code release. |
| **`booking_sheet_monthly_wide`** (matview) | 17 | **Dashboard-shaped read view.** Built on `booking_sheet_monthly_category` joined to `booking_sheet_category_market`. Exposes per-month `category_revenue` jsonb (12 keys), `market_revenue` jsonb (D2C/B2B/ADJUSTMENT), `d2c_revenue`, `b2b_revenue`, `operational_revenue` (= D2C + B2B, the "service revenue excl. voucher timing" breakdown line), `adjustment_net` (voucher timing line), **`revenue_amount` (full 12-cat sum = YTD Actual = the dashboard headline AND tier-band comparison basis)**. Refresh via `public.refresh_booking_sheet_monthly_wide()`. **All Revenue Funnel + Scenario Planning headline reads go through this view.** |
| `revenue_snapshots`                | 72   | **DETAIL ONLY (post-Phase L).** Per-source monthly rows from Squarespace API + Stripe + (legacy) Booking Sheet importer with `tier_revenue` jsonb. **Never sum these — the sources overlap.** SQ + Stripe rows continue to populate via daily cron jobs as transaction-level detail (order ids, product names, charge ids, customer email, AOV) for drilldowns and conversion analysis. The 17 legacy `source='booking_sheet'` rows were deleted in Phase L. A `COMMENT ON TABLE` warning is in place. |

### Optimisation tracking (suppression source)

| Table                              | Rows | Purpose                                            |
|------------------------------------|------|----------------------------------------------------|
| `optimisation_tasks`               | ~1+  | One task per URL+keyword Alan is actively optimising. Status enum `optim_task_status` = monitoring / planned / completed / cancelled. |
| `optimisation_task_cycles`         | 66   | One row per optimise-monitor-evaluate cycle per task. Has `primary_kpi`, `start_date`, `objective_title`. |
| `optimisation_task_events`         | 315  | GSC snapshot events recorded against each cycle (clicks/impressions/CTR/position over time). |
| `content_improvement_tracking`     | 25   | Older tracking table - mostly legacy, only 25 rows. |

**Critical**: the `optim_task_status` enum has ONLY `monitoring` and
`planned` as in-flight values. If you `.in('status', [...])` with any
other string, the whole query crashes silently. See pitfall #2 below.

### GSC + content

| Table                              | Rows    | Purpose                                            |
|------------------------------------|---------|----------------------------------------------------|
| `gsc_page_metrics_28d`             | 56,655  | Per-(url,query) 28-day GSC aggregates - the data behind every CTR/clicks/position number you see. |
| `gsc_page_timeseries`              | 30,238  | Daily per-URL GSC timeseries - used for change-over-time deltas. |
| `gsc_timeseries`                   | 579     | Property-level GSC timeseries cache. |
| `gsc_url_inspection_cache`         | 550     | GSC URL Inspection results keyed by Traditional SEO signal map keys. |
| `keyword_rankings`                 | 6,858   | Per-keyword rank position + search volume + AI citations, time-stamped. |
| `page_html`                        | 2,172   | Raw HTML snapshots of every audited URL with `fetched_at`. Use this to detect recent edits. |
| `page_chunks`                      | 2,376   | Page content broken into chunks. |
| `page_entities`                    | 783     | Schema entities per page. |

### Traditional SEO + backlinks

| Table                              | Purpose                                            |
|------------------------------------|----------------------------------------------------|
| `keyword_target_metrics_cache`     | Keywords Everywhere search volume cache (see `Docs/TRADITIONAL_SEO_KEYWORD_METRICS.md`) |
| `ke_domain_metrics_cache`          | Keywords Everywhere domain-level cache |
| `dfs_domain_backlink_rows`         | DataForSEO per-edge backlink rows (1,626 rows) |
| `dfs_backlink_baseline_edges`      | Baseline snapshot for delta tracking (1,625 rows) |
| `dfs_backlink_tile_baseline`       | Tile-level backlink baseline |

### Domain authority + audit history

| Table                              | Rows  | Purpose |
|------------------------------------|-------|---------|
| `domain_strength_snapshots`        | 2,692 | DA/PA history |
| `domain_strength_domains`          | 27    | List of tracked competitor + own domains |
| `audit_results`                    | 8     | Schema audit pillar score history |
| `regression_test_runs`             | 3,908 | Q&A regression test history (this is for the Chat AI bot, NOT this dashboard - same DB though) |

---

## 4. Phase H+ work shipped 2026-05-20 (what just landed)

Four commits on `main`:

| Commit  | What |
|---------|------|
| `0eab3e2` | Suppression + seasonality + banner |
| `99e80dc` | TDZ fix - `MONTH_NAMES` getter |
| `ff1bfb0` | Fix silent suppression failure on enum mismatch |
| `44671a0` | Apply suppression penalty inside scoring pass |
| `c0ff606` | Docs handover + this onboarding |

The picker (`api/aigeo/revenue-funnel-smart-priorities.js`) now does
three things it didn't do before:

1. **Reads active monitoring cycles** from `optimisation_task_cycles`
   + `optimisation_tasks` (35 cycles -> 19 URLs in monitoring on
   prod right now). Matches each candidate's URL+lever to active
   cycles via the `KPI_TO_LEVERS` map. Verdict:
   - `<30d` -> BLOCK actions, score x 0.10, red "ALREADY IN MONITORING" pill
   - `30-90d` -> DOWNGRADE confidence, score x 0.45, amber pill
   - `>90d` -> STALE "try a different angle", score x 0.65, purple pill
2. **Scales `estimated_lift_gbp_*`** by a per-tier per-month
   multiplier from `SEASONALITY_BY_TIER`. May = workshops PEAK x1.60,
   courses ABOVE x1.10, hire/services flat 1.0, academy x0.90.
   Raw unscaled values are preserved.
3. **Exposes a banner endpoint** `/api/aigeo/revenue-funnel-seasonality`
   that returns per-tier bands + monitoring counts. Revenue Funnel
   renders this above the Top 3 cards.

Read `Docs/HANDOVER_REVENUE_FUNNEL_2026-05-20.md` for the file-by-file
change map.

---

## 4b. Phase L + L1 work shipped 2026-05-26 (revenue data layer rebuild)

**Phase L** — Booking Sheet is the single source of truth for revenue.
**Phase L1** (same day) — three tier systems, not one (corrects Phase L's
invented 5-tier rollup). See §0 for the conceptual model.

Commits:

| Commit  | What |
|---------|------|
| `6faa5f1` | Phase L: schema + parser + 4 reader paths + import gate (Booking Sheet truth) |
| _uncommitted_ | Phase L1: drop invented 5-tier rollup, add 12-cat→3-market mapping table, rebuild wide view, sync readers, update docs |

What landed:

1. **New schema** — `public.booking_sheet_monthly_category` (12-cat truth),
   `public.booking_sheet_category_market` (12→3 market mapping as data),
   `public.booking_sheet_monthly_wide` matview (dashboard read shape).
   Migrations under `migrations/20260526_phase_l1_*.sql` and
   `migrations/20260526_booking_sheet_monthly.sql`. Old Phase-L
   `booking_sheet_monthly` table dropped — the invented 5-tier rollup is gone.
2. **New parser** — `lib/booking-sheet-truth-parser.mjs` reads the row-18
   "Totals" line from each `Sales YYYY` tab directly (no funding filter).
   Old `lib/booking-sheet-parser.mjs` deprecated.
3. **New backfill** — `scripts/backfill-booking-sheet-monthly.mjs` (replaces
   `scripts/import-booking-sheet.mjs`). Calls `refresh_booking_sheet_monthly_wide()`.
4. **New importer endpoint** — `api/aigeo/booking-sheet-upload.js` rewritten.
   Hard import gate: refuses to write unless `SUM(12 categories) === YTD
   Actual cell` (J47 for 2025, J48 for 2026) to the penny.
5. **Five reader paths repointed** (all read `booking_sheet_monthly_wide`):
   - `api/aigeo/revenue-funnel-summary.js` — `fetchRevenueHistory` +
     `fetchLatestRevenue`. Selects new fields; synthesises a
     back-compatible `tier_revenue` jsonb (4 valid 1-to-1 mappings;
     `services` + `hire` = null) so the existing UI keeps rendering until
     the UI-rebuild turn.
   - `api/aigeo/revenue-funnel-smart-priorities.js` — `fetchRollingRevenueSnap`.
     Exposes `operational_revenue`, `adjustment_net`, `market_revenue`,
     `category_revenue`. `revenue_amount` keeps its "full 12-cat sum"
     semantics, matching `revenue-funnel-summary.js`.
   - `lib/revenue-funnel-seasonality-blend.js` — observed factors by tier
     (back-compat: 4 valid mappings) AND by market (D2C / B2B as new
     dimension). `factorFromBlendByMarket()` is the new entry point;
     `factorFromBlend()` returns 1.0 for `services` / `hire`.
   - `lib/revenue-funnel-academy-economics.js` — reads `category_revenue['12. Academy']`
     directly (clean, no shim).
6. **Smoke-test** — `scripts/smoke-test-booking-sheet-readers.mjs` (7
   reconciliation checks, all green at 2026-05-26 session end).
7. **Reconciliation** — 17-month total £66,165.50 matches user-stated truth
   to the penny (2025 = £46,567.46; 2026 YTD = £19,598.04). Replaces the
   double-counted £72,251.50 the old 3-source sum produced.

**Open follow-up for the UI rebuild turn (not done yet):**

- Delete the 6 per-tier sparklines from `audit-dashboard.html` (two of
  them — `services`, `hire` — currently render empty because the back-compat
  synthesis returns null for them, which is the honest interim state).
- Add a 3-line operational chart (D2C / B2B / ADJUSTMENT) on a shared
  operational-basis y-axis.
- Relabel the headline: primary = `revenue_amount` (= full 12-cat sum = the
  spreadsheet YTD Actual cell, so the dashboard headline equals the figure the
  user reads on the Booking Sheet). Secondary breakdown beneath = `operational_revenue`
  (D2C+B2B) labelled "service revenue (excl. voucher timing)". Show
  `adjustment_net` as its own explicit labelled line. Tier-band comparison
  (£3k/£5k/£8k) also uses `revenue_amount`.
- Once the UI is rebuilt, remove the back-compat `tier_revenue` synthesis
  from `api/aigeo/revenue-funnel-summary.js`.

**Detail:** `Docs/REVENUE-TRUTH-FROM-BOOKING-SHEET.md` (full spec, including
the row-level audit of the −£1,228.75 ADJUSTMENT figure for 2025).
`Docs/CHANGELOG.md` 2026-05-26 entry (full file-by-file map).

---

## 5. The 8 open tasks (priority order)

Alan flagged all of these at session end. Work them in this order.

1. **[HIGH/visual] Summary tile layout**
   Auto-Optimise Do Nothing / Easy / Balanced / Hard tiles currently
   wrap with Hard dropping to a second row. Lay them out as 4
   separate tiles in a single row above each scenario column.
   Colour-code Monthly GP + Annual GP uplift **green for positive,
   red for zero/negative**.

2. **[HIGH/trust] "Recently edited - well done" panel**
   Detect pages Alan edited in the last 7-14 days via
   `page_html.fetched_at` + `optimisation_task_events`. Surface
   them with 14-day CTR/clicks/position delta. THIS is the missing
   positive-feedback loop he called out.

3. **[HIGH/trust] Per-cycle GSC delta on suppressed cards**
   On every suppressed card, show the actual movement since
   `cycle.start_date`. Flip the pill to **GREEN** when delta is
   positive ("working, hold steady"); keep PURPLE/STALE only when
   flat or negative.

4. **[HIGH/trust] Auto-refresh GSC after an edit**
   When `page_html.fetched_at` is newer than the latest
   `optimisation_task_events.event_at` for a URL, queue a fresh
   GSC pull so the next picker run reads POST-rewrite data.

5. **[HIGH/business] Academy economics**
   Per-tier fixed-cost field (seed Academy at £100/mo). Define
   Academy minimum target = 10 paid signups/mo. Red "UNDER
   MINIMUM" badge when below. Auto-suppress `academy/*` candidates
   when Academy GP < £0 for 2 consecutive months and surface a
   "REVIEW: keep Academy alive?" card.

6. **[MEDIUM] Preset diversity**
   Stricter `rerankForPreset` so Easy/Balanced/Hard each pick at
   least 1 unique top-3 URL.

7. **[DONE in Phase L1] Data-driven seasonality**
   _Implemented._ `lib/revenue-funnel-seasonality-blend.js` now derives
   observed factors from `booking_sheet_monthly_wide.category_revenue` AND
   `market_revenue` (D2C/B2B as new dimension), blended with stated factors.
   `revenue_snapshots.tier_revenue` is no longer used — the source moved
   to the Booking Sheet truth layer.

8. **[LOW] Extend validation script**
   Add 2 custom weight permutations to `multi-scenario-validation.mjs`.

### Phase K follow-up tasks (2026-05-26, NOT blocking current work)

These came out of the AIO data-layer reconciliation. See **Docs/CHANGELOG.md
[2026-05-26] Phase K** for the full context.

9. **[MEDIUM/data] PHASE-K-FOLLOWUP-1: `property_url` casing normalisation**
   `keyword_rankings` holds three `property_url` formats:
   `https://www.alanranger.com` (canonical, 7,077 rows),
   `https://www.alanranger.com/` (33 stale rows),
   `alanranger.com` (84 stale rows). All current writes go to canonical
   but nothing enforces that.
   (a) one-off normalisation of the 2 stale partitions; (b) DB-level CHECK
   constraint or normalise-on-write trigger blocking non-canonical inserts.

10. **[MEDIUM/business] PHASE-K-FOLLOWUP-2: Tier-mapping defect**
    `TRUE_AOV_BY_TIER['courses'] = £200` was confirmed by Alan to be the
    in-person Coventry group-course price ONLY. Workshops (~£250+) and
    1-2-1 (~£395+) currently fold into the same `courses` tier and inherit
    £200 AOV — wrong. Action: split into `courses_in_person`,
    `courses_121`, `courses_online` with separate AOV + conv rate per
    sub-tier; re-classify current `courses`-tier URLs accordingly.

11. **[MEDIUM/trust] PHASE-K-FOLLOWUP-3: Booking conversion rate per tier**
    Conversion rate (1% assumed) was validated by Alan as roughly right
    across all paid courses+workshops (1-2 bookings/28d on ~165 paid
    clicks/28d) but it is unverified PER-TIER. Per-tier measured rates
    needed before the funnel headline GP figures can drop their
    `ASSUMED` flag.

---

## 6. Hard rules (no exceptions)

- **Never exceed 15 cyclomatic complexity** per function. This is
  a workspace rule from Alan.
- **Vercel deploys from `git push origin main`.** Code that isn't
  pushed isn't live. Always confirm `git log -1` after pushing.
- **Only commit when Alan asks.** Same for `git push`. If you
  introduce work mid-session, leave it staged but uncommitted
  unless he explicitly says "commit + push".
- **`optim_task_status` enum** = only `monitoring` / `planned` are
  in-flight. Do not add other strings to `ACTIVE_CYCLE_STATUSES`.
- **`__INTERNAL` exports use getters** for `MONTH_NAMES` +
  `SEASONALITY_BY_TIER` because they're declared further down in
  the file. Don't "fix" to bare references - TDZ error.
- **Supabase project IDs**: `igzvwbvgvmzvvzoclufx` is THIS dashboard.
  `dqrtcsvqsfgbqmnonkpt` is the separate Academy app. Don't cross
  them.
- **Never** put files in repo root if they belong elsewhere - new
  docs go in `Docs/`, new scripts go in `scripts/`.
- **No `console.log` in production code.** Use `console.warn` /
  `console.error` only for failures that genuinely need surfacing
  in Vercel logs.
- Use the `user-supabase-ai-chat` MCP for any Supabase read/write -
  the postgres MCP errors with `password authentication failed` and
  isn't worth fighting.

---

## 7. How to talk to Alan

He's a sole-trader business owner, not an engineer. He has been
through several iterations of agents writing "generic crap" at him
and he calls it out fast.

**Use his terminology**:
- "Lever" not "feature" / "knob" / "parameter"
- "Tier" not "segment" / "category"
- "Money pages" not "landing pages"
- "GP" / "gross profit" not "margin"
- "Stale / in monitoring / try a different angle" - matches the
  suppression UI we just shipped
- "Peak / gap / shoulder month" - matches seasonality bands

**He responds badly to**:
- Engineer jargon ("refactored", "DRY", "abstracted")
- Promises without proof
- Generic copy like "rewrite the title + meta description" with
  no page-specific evidence (this is what phase H + H+ just fixed)
- The same recommendation card reappearing without acknowledging
  he already did the work
- Saying you'll do something then leaving it for "next session"

**He responds well to**:
- Concrete evidence ("129d in monitoring, CTR moved +0.0%")
- Per-page specifics (what's in the H1, meta description, current
  CTR, current rank, what cycle is active)
- Honest disclaimers (`rfLiftBasisLine` on each card explains how
  projected lift is modelled)
- Showing the work via markdown reports in `Docs/`
- One visible win delivered fast, then deeper work

---

## 8. Verification commands

Run these BEFORE you start coding to confirm everything is in the
state this doc describes.

```bash
# 1. Confirm you're on the right commit
git log --oneline -5
# Expect c0ff606 or later at HEAD

# 2. Run the self-test against prod
node scripts/multi-scenario-validation.mjs
# Expect: 19 URLs in monitoring, May = peak workshops, every Top 3
# carries a STALE pill. Report writes to Docs/MULTI_SCENARIO_VALIDATION_<ts>.md

# 3. Smoke test the seasonality endpoint
curl "https://ai-geo-audit.vercel.app/api/aigeo/revenue-funnel-seasonality?propertyUrl=https%3A%2F%2Fwww.alanranger.com"
# Expect 200 with tier_bands array + monitoring.urls_in_monitoring >= 19

# 4. Spot-check the picker - Top 3 should all carry suppression
curl "https://ai-geo-audit.vercel.app/api/aigeo/revenue-funnel-smart-priorities?propertyUrl=https%3A%2F%2Fwww.alanranger.com" | jq '.candidates[0:3] | .[] | {url: .pages_affected[0], supp: .suppression.severity, season: .seasonality_factor}'

# 5. Open the live dashboard
# https://ai-geo-audit.vercel.app/audit-dashboard.html
# Revenue Funnel tab should show:
#  - May 2026 seasonality banner above Top 3
#  - All Top 3 cards with purple STALLED pill
#  - SEASON +X% pill in the tier row when not neutral band
```

---

## 9. Where to go next

After you've read this file:

1. Read **`Docs/HANDOVER_REVENUE_FUNNEL_2026-05-20.md`** for the
   detailed task list and file-by-file pitfalls.
2. Read the top entry of **`Docs/CHANGELOG.md`** (Phase H+) for the
   commit-level history of tonight's work.
3. Run the verification commands in section 8 above.
4. Start on task 1 (summary tile layout).
5. Before writing code, propose your fix to Alan with a snippet of
   the broken markup so he can confirm direction.

Other docs worth knowing about (read on demand, not upfront):

- `Docs/RUNS-CHEATSHEET.md` - plain English: Dashboard Quick / Standard / Full, what each excludes, RF vs Dashboard, cron vs buttons
- `Docs/GLOBAL-RUN.md` - tier matrix + `globalRunStepCatalog()` code map
- `Docs/ALL-AUDIT-SCAN-PROCESSES.md` - what each underlying audit API does (superseded for "one button runs all")
- `Docs/TRADITIONAL_SEO_KEYWORD_METRICS.md` - Keywords Everywhere
  cache + Traditional SEO column feature
- `Docs/TRADITIONAL_SEO_BACKLINKS_DFS.md` - DataForSEO backlinks
  + disavow workflow
- `Docs/DATAFORSEO_BACKLINK_SPAM_FILTERS.md` - spam filter rules
  for backlink ingestion
- `Docs/AUTO_OPTIMISE_SESSION_REPORT.md` - earlier session's
  Auto-Optimise self-test results

---

**You are now onboarded. Don't write code until you've finished
reading this file, the Revenue Funnel handover, and run the
verification commands.**
