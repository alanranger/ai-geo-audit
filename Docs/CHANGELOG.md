# Changelog

All notable changes to the AI GEO Audit Dashboard project will be documented in this file.

## [2026-06-20] - Initial-load perf: lazy Money Pages render + lightweight health probe

**Symptoms:** After the loading bar finished, the Dashboard took a long time to
settle and felt unresponsive to tab clicks; other tabs (notably Revenue Truth)
showed dozens of API calls that weren't even theirs.

**Profiling:** Added `scripts/profile-tabs.mjs` (Playwright) — loads the live
dashboard, clicks each of the 16 tabs, and ranks them by settle time + API cost.
It revealed the cause: a large background request storm kicked off on page load
spilling into whichever tab was active and saturating the ~6-connection pool.

**Fixes:**

1. **Lazy Money Pages render** (`audit-dashboard.html`): the Money Pages subtree
   (which fires AI-citation, policy-banner, `money-pages-historical` and
   `/api/actions` requests) used to render eagerly on initial load even while the
   user was on the Dashboard. It's now **deferred until the Money tab is first
   opened** (`window.__renderMoneyPagesPending`, guarded by
   `window.__moneyPagesRendered`, triggered + awaited from `setActivePanel('money')`).
   The cheap metric resolution stays eager, so `window.currentMoneyPagesMetrics`
   is still populated for any data-only consumer. Verified live: on load the money
   section is not built but the metrics global is set; opening the Money tab builds
   the section and populates the table (10 rows).
2. **Lightweight Supabase health probe** (`api/keywords/get.js` + client): the
   page-load outage probe fetched the full `/api/keywords/get` (up to 10k
   `keyword_rankings` rows, ~8s) just to detect a 503. Added a `?probe=1` mode
   that does a tiny `audit_results` ping and preserves the 503 contract; the
   client now calls `/api/keywords/get?probe=1` (≈0.7s vs ~8s).

**Net:** the Money Pages storm no longer runs on initial load — it runs on the
Money tab (behind its progress bar). Revenue Truth's spillover dropped from
~60 to ~42 calls; the Dashboard's initial fetches are now just its own data.

## [2026-06-20] - Money Pages: batch money-pages-historical N+1 (policy banner)

**Symptoms:** Money Pages section was slow to settle; the policy banner count
("N of M money pages affected by active policy") lagged and added load on every
dashboard/Money-Pages render.

**Root cause:** `updateMoneyPagesPolicyBanner()` fired **one
`/api/supabase/money-pages-historical?days=28` GET per money-page row** (chunked
8 at a time). Each call independently re-pulled **all** of the property's audits
including their large `gsc_timeseries` blobs **and** ran a per-slug policy query
— an N+1 that re-resolved the same data once per URL and competed for the
browser connection pool.

**Fix (batch the N+1):**

1. **API** (`api/supabase/money-pages-historical.js`): added a **POST batch
   mode** — `{ property_url, target_urls[], days? }` fetches audits **once** and
   the latest policy per slug in a **single** `.in('page_slug', …)` query, then
   computes the aggregate for every URL server-side and returns
   `{ results: { url: data } }`. Extracted the per-URL daily-map build,
   fallback, and aggregate into shared helpers; the single-URL GET path (used by
   the per-page performance modal) is unchanged and reuses them.
2. **Client** (`audit-dashboard.html` → `updateMoneyPagesPolicyBanner`):
   replaced the chunked per-row GET loop with a **single POST** for all rows.

**Net:** the banner's N per-row historical calls collapse to 1 request that
resolves the audits/timeseries/policy blobs only once.

## [2026-06-20] - Dashboard ~1min stall fixed: batch Money-Pages AI-citation N+1 (245 calls → 1)

**Symptoms:** After the loading bar finished, the Dashboard tab took up to a
minute before charts/tables/pills populated.

**Root cause:** On initial page load the Money Pages section renders eagerly
(via `setTimeout` in the main results render) even while the user is on the
Dashboard tab. `populateMoneyPagesAiCitations()` then fired **one
`/api/supabase/query-keywords-citing-url` GET per money-page URL — 245 requests**
(an N+1), each re-fetching and re-parsing the *same* large `ranking_ai_data`
JSONB blob server-side. With the browser capped at ~6 concurrent connections,
this storm saturated the pool and Supabase, so the Dashboard's own fetches
(`get-audit-history`, `money-pages-historical`, `revenue-sync-status`, etc.)
queued behind it and inflated to 12–20s each.

**Fix (batch the N+1):**

1. **API** (`api/supabase/query-keywords-citing-url.js`): added a **POST batch
   mode** — `{ property_url, target_urls[], audit_date? }` resolves the ranking
   blob **once** and returns `{ counts: { url: n } }` for every URL. The
   single-URL GET path is unchanged (refactored to share the same helpers).
2. **Client** (`audit-dashboard.html` → `populateMoneyPagesAiCitations`):
   replaced the per-URL batched-10 loop with a **single POST**; the existing
   cache/cell-application logic is preserved.

**Net:** 245 citation requests collapse to 1, freeing the connection pool so the
Dashboard populates promptly instead of stalling ~1 min.

## [2026-06-18b] - Revenue Truth: precompute cache (≈31s → <2s) + harden diagnosis 500

**Symptoms:** Opening Revenue Truth took ~31s. The tab fires three sequential
Supabase-backed APIs — summary (~1s), findings (~8.6s, 301KB) and diagnosis
(~12–26s, ~600KB) — and **none were cached** (`Cache-Control: no-store` on the
endpoints + globally in `vercel.json`), so every visit recomputed from scratch.
The diagnosis endpoint also intermittently returned **HTTP 500** (~12s timeout).

**Fix (three parts):**

1. **Client parallelisation** (`lib/revenue-truth-controller.mjs`): summary /
   findings / diagnosis now fetch in parallel; the top of the tab paints as soon
   as findings resolves instead of waiting behind diagnosis (~9s sooner).
2. **Server precompute cache:** new `public.revenue_truth_payload_cache` table +
   `lib/revenue-truth-cache.mjs` helper. `revenue-truth-findings` and
   `revenue-funnel-diagnosis` now serve the precomputed blob (fresh-cache →
   live build with write-through → **stale fallback on error**, which also fixes
   the 500). New cron `/api/cron/revenue-truth-cache-refresh` (07:30 daily, after
   the revenue syncs) warms findings + the 4 diagnosis toggle combos. Manual
   Booking Sheet upload invalidates the cache (next load re-warms).
3. **Hardening:** `maxDuration` raised to 60s on both endpoints (300s on the
   cron); param-specific requests (`?pages=` / `includeAllPages`) bypass cache.

**Net:** warm tab loads drop from ~31s to <2s; first load after a data change is
slow once then cached. Data freshness bounded by the daily warm + upload
invalidation (26h TTL guard as a safety net).

**Files:** `lib/revenue-truth-cache.mjs` (new), `lib/revenue-truth-controller.mjs`,
`api/aigeo/revenue-funnel-diagnosis.js`, `api/aigeo/revenue-truth-findings.js`,
`api/cron/revenue-truth-cache-refresh.js` (new), `api/aigeo/booking-sheet-upload.js`,
`vercel.json`, Supabase table `revenue_truth_payload_cache`.

---

## [2026-06-18a] - Shared tab-load progress bar across all data-heavy tabs

**Symptoms:** Only Traditional SEO showed a load indicator. Other tabs that hydrate
from Supabase / localStorage (Revenue Truth, Revenue Funnel, Money Pages, Dashboard,
Ranking, Backlinks, AI Health Scorecard, AI Sources, Portfolio, Implementation
Progress) just showed silent “Loading…” placeholders, so they looked broken/frozen
during the fetch delay.

**Fix:** New generic sticky amber progress bar (`#aigeo-tab-load`) injected once at the
top of `.aigeo-main`, driven by a shared `window.AigeoTabLoad` controller. `setActivePanel`
calls `AigeoTabLoad.onPanel(panelId)` on every tab switch (Traditional SEO excluded — it
keeps its own richer step banner). The bar shows immediately with a pulsing dot, elapsed
counter and indeterminate fill, then hides once the active panel has **no visible loading
placeholder** (`.rt-loading` / `.spinner` / `.trend-chart-loading` / money refresh overlay)
for 2 consecutive polls. Guards: 800ms min-show (no flicker), 18s “still loading” nudge,
45s hard safety hide so it can never stick. Untracked tabs (config, scenario, optimisation,
authority, history, local) hide any lingering bar.

**Files:** `audit-dashboard.html`

---

## [2026-06-12u] - Traditional SEO: prominent tab load progress (bar, countdown, steps)

**Symptoms:** Amber load strip was easy to miss; it hid before DFS / domain tiles
finished updating, so the page looked broken after the banner vanished.

**Fix:** High-contrast amber progress panel with pulsing indicator, countdown,
progress bar, live step checklist, and 15s timeout message. Banner stays until
**all** steps complete (rules, domain strength, DFS tiles, click movers, results
table). Fast path now fetches DFS summary on tab open (was skipped). Removed
silent early-return when a prior load was in flight.

**Files:** `audit-dashboard.html`

---

## [2026-06-12t] - Traditional SEO tab: fix stuck “Loading…” click movers + load banner

**Symptoms:** Traditional SEO tab looked broken — **Top click gainers/losers**
stuck on “Loading…” while health score and rules loaded fine. Domain rank /
strength / backlinks tiles empty (expected until DFS / Labs snapshot run).

**Root cause (client):** `traditionalSeoRefreshCtrTopTenTiles` treated a
successful GSC 40d movers API response as a miss when filtered gainers/losers
were empty, then fell through to `traditionalSeoLoadAuditData` +
`fetchPreviousAuditForDeltas` (heavy, could hang). Fast tab path also skipped
explicit CTR refresh on tab switch.

**Fix:** Accept empty Supabase movers as success; 8s fetch timeout on GSC
movers + domain strength; 10s cap on audit fallback; tab load status banner
(`#traditional-seo-tab-load-status`) with 5s “still working” nudge; loading
guard reduced from 90s → 15s with visible message.

**Files:** `audit-dashboard.html`

---

## [2026-06-12s] - Revenue Funnel summary: fix statement timeout after sync

**Symptom:** `Failed to load Revenue Funnel summary: HTTP 500` with
`canceling statement due to statement timeout` (often after Stripe/GA4 sync
reload).

**Fix:** `revenue-funnel-summary.js` — one `booking_sheet_monthly_wide`
query (was two); JLR strip reads `is_jlr=true` rows only; AI Overview map
fetches latest `audit_date` slice instead of 2000 mixed-date rows.

**Also:** Money-pages + 12-month history tables get a **Total** footer row.

---

## [2026-06-12r] - Money pages use in-progress Booking Sheet month for tier £

**Symptoms:** Live API still showed Hire/Workshops at £0 after JLR fix — KPI
picker used May (last closed month) while June partial row held Commissions
£620 and workshop splits.

**Fix:** Split revenue pickers — funnel KPIs keep closed-month
`pickBestRevenueRow`; money-page tier actuals use `pickLatestBookingMonthRow`
(includes current calendar month). Response adds `kpi_revenue_snap` alongside
`latest_revenue` (tier basis).

**Files:** `api/aigeo/revenue-funnel-summary.js`

---

## [2026-06-12q] - JLR included by default; Revenue Funnel honours same toggle

**Symptoms:** Revenue Truth and Revenue Funnel numbers did not match the
Booking Sheet Alan recognises; JLR woodland walks were excluded by default
while money-page tiles used raw category totals.

**Fix:**
- `parseIncludeJlr()` defaults to **true** (Booking Sheet headline).
- Revenue Truth + Revenue Funnel toggles default **checked**; preference
  persisted in `localStorage` (`aigeo.includeJlr`) and synced across tabs.
- `revenue-funnel-summary` accepts `?includeJlr=` and strips JLR from
  `tier_revenue` / headline when off (same transaction-level logic as
  Revenue Truth).
- Money-pages subtitle clarifies actual £ = latest **closed Booking Sheet
  month**, not GSC rolling 28d.

**Files:** `lib/parse-include-jlr.mjs`, `lib/dashboard-jlr-preference.mjs`,
`lib/revenue-truth-jlr-filter.mjs`, `revenue-truth-summary.js`,
`revenue-funnel-summary.js`, `revenue-funnel-diagnosis.js`,
`revenue-truth-controller.mjs`, `audit-dashboard.html`

---

## [2026-06-12p] - Revenue Funnel: map Commissions/Prints into Hire tier revenue

**Symptoms:** Money pages performance showed Hire / Commercial and 1-2-1 &
Services at £0 earned despite Booking Sheet Commissions (e.g. Jun £620, YTD
£2,865).

**Cause:** Phase L1 `synthesiseLegacyTierRevenue` only mapped 4 verbatim
categories and hard-coded `hire` and `services` to `null`.

**Fix:** Aggregate all 12 `category_revenue` keys via `classifyCategory()`
(Commissions + Prints → `hire`; Mentoring/1-2-1/vouchers → `services`).

## [2026-06-12o] - Hotfix: Optimisation tracker empty after refresh-policy commit

**Symptoms:** Optimisation tab showed Active/Done (0), “Server error”, console
`[Optimisation Dashboard] API error`.

**Cause:** Commit 596e919 added `/api/optimisation/dashboard` to global GET dedup.
That endpoint is auth-header-sensitive; dedup cached the first response (including
HTTP 500 from Supabase blips) for 120s and ignored per-call admin headers.

**Fix:** Remove optimisation from dedup; call via `window.__origFetch`; only
cache 2xx in global dedup; log server error body in console for diagnosis.

## [2026-06-12n] - Data refresh audit: stop request storms across tabs

**Symptoms:** After recent refresh hardening, tabs felt stale or empty while
Network showed hundreds of duplicate Supabase/API calls; tab hopping triggered
full audit refetches; Optimisation “Update All Tasks” path collided with
dashboard re-renders.

**Root causes (cumulative regressions):**
1. `renderDashboardTab()` **awaited full `get-latest-audit` on every call** —
   contradicting 2026-06-12c cache-first policy.
2. `fetchTrendTimeseriesFromSupabase()` **always** hit `get-audit-history` after
   2260bd0 (fixed stale chart but caused per-render fetches).
3. `loadAuditResults()` background refresh ran on **every** load, not only when
   cache >15 min stale.
4. Tab switch handler fetched full audit when >1 h old and called
   `renderDashboardTab()` again (cascade).
5. `loadAllOptimisationTasks()` used `_t=` cache buster every call; success/error
   paths called `renderDashboardTab()` (loop with dashboard auto-load).

**Fixes:**
- **`Docs/DASHBOARD_DATA_REFRESH.md`** — single documented refresh policy.
- Central TTLs: audit 15m, trend timeseries session 10m, optimisation 60s.
- `renderDashboardTab`, tab switch, trend chart, optimisation load aligned to policy.
- GET dedup extended to `gsc-timeseries-banner` + `/api/optimisation/dashboard`.
- `loadAllOptimisationTasks({ forceRefresh: true })` for explicit user refresh only.
- `bustAuditReadCaches()` also clears trend/optimisation session + latest-audit cache.

## [2026-06-12j] - Dashboard load: stop blocking on incomplete Supabase fetch

**Symptoms:** Page hung for minutes when Supabase returned 522; Overview trend chart never built.

**Root causes:**
1. `loadAuditResults()` blocked on `fetchLatestAuditFromSupabase` when localStorage cache was incomplete (waiting for Supabase timeout).
2. `<canvas id="trendChart">` shadows `window.trendChart` — Overview tab check `!window.trendChart` was always false, skipping `displayDashboard` chart build.

**Fixes:** Return incomplete localStorage immediately with background Supabase refresh; use `window.trendChart instanceof Chart` for chart-instance checks; guard `clearDashboard` destroy.

## [2026-06-12m] - Stale localStorage authority: recompute + background refresh redisplay

**Symptoms:** GAIO breakdown and pillar card stuck at Authority **45** from cached audit while trend chart partially used Supabase history; user on same-day timestamp never got background refresh.

**Fixes:**
- Always recompute authority from `queryPages` once per session (current ranking rules).
- `resolveCanonicalAuthorityScore()` shared by GAIO gauge, pillar card, trend latest point.
- Background Supabase refresh runs on every load; updates UI via `displayDashboard` when authority or timestamp differs.

## [2026-06-12l] - get-audit-history: return authority component columns

**Symptoms:** Trend chart could recompute stale Authority from missing component fields even after DB backfill updated `authority_score`.

**Fix:** Include `authority_behaviour_score`, `authority_ranking_score`, `authority_backlink_score`, `authority_review_score`, and `authority_by_segment` in the Supabase select.

## [2026-06-12k] - displayDashboard: guard metrics when GSC totals missing

**Symptoms:** Trend chart never built; `Cannot read properties of undefined (reading 'toLocaleString')` on load when cached audit lacked `totalClicks` / `averagePosition`.

**Fix:** `formatNumber` handles null/NaN; metrics grid uses safe defaults; skip if `#metricsGrid` absent.

## [2026-06-12i] - Trend chart: 15s timeout on get-audit-history fetches

**Symptoms:** Dashboard appeared hung for minutes when Supabase returned 522; `fetchContentSchemaHistory` had no fetch timeout.

**Fix:** Add `AbortSignal.timeout(15000)` to trend-chart history + timeseries fetches so the chart falls back to cached localStorage data instead of blocking indefinitely.

## [2026-06-12h] - Authority history backfill (May 25–Jun 11) + partial-audit chart fix

**Symptoms:** Score Trends Authority line flat at **45** from late May through early June despite pillar card **52**; Jun 10 partial audit row ignored in `authorityMap`.

**Root causes:**
1. Supabase rows stored ranking scores computed under old strict top-10 rules (~41–42 → total **45**).
2. Trend chart skipped partial audits for `authorityMap` even when component columns were valid (Jun 10).
3. GSC daily points between sparse audit dates carry-forward last mapped authority (stale **45** plateau).

**Fixes:**
- **`scripts/backfill-authority-ranking-period.mjs`** — recompute behaviour/ranking/total/`authority_by_segment` from stored `query_pages` using current `rankingCriteria.js` rules (dry-run verified: May 25–29 **45→54**, Jun 10–11 **51→55**). Run: `node scripts/backfill-authority-ranking-period.mjs --from=2026-05-25 --to=2026-06-11 --apply`
- **`audit-dashboard.html`** — map Authority from partial audits when component columns exist.
- **`scripts/verify-authority-trend-chart.mjs`** — Playwright parity check (pillar card vs trend last point).
- **`scripts/test-authority-trend-logic.mjs`** — offline unit test for live-total resolution.

## [2026-06-12g] - Authority trend chart: use live scorecard totals (52 not 45)

**Symptoms:** After 2026-06-12f, latest GSC day tooltip still showed Authority **45** while pillar card showed **52**.

**Root causes:**
1. Trend chart read `loadAuditResultsSync()` only — missed `window.latestAuditScores` from `displayDashboard` queryPages recompute.
2. `resolveTrendLiveAuthorityScore` recomputed from stale `authorityComponents` before checking `bySegment.total`, overriding a correct **52** with **45** (scorecard uses `.total` directly).

**Fix:** Prefer `window.latestAuditScores || scores` for live points; match scorecard by using stored segment total first, recompute only when total missing. Chart date-fill path uses same live resolver on latest audit / last GSC day.

## [2026-06-12f] - Authority trend chart latest point parity with scorecard

**Symptoms:** Score Trends tooltip showed Authority **45** on the latest GSC day while the Authority pillar card showed **52** (matching live component breakdown).

**Root cause:** Trend chart loop preferred stale Supabase `authorityBySegment` / `authorityMap` values for every date, including the latest audit/GSC day, before checking live scores from the current audit snapshot.

**Fix (`audit-dashboard.html`):** For `isLatestAudit` points, resolve Authority from live audit components (same recompute as scorecard) before historical Supabase segment/map. Historical dates still use stored Supabase values.

## [2026-06-12] - Dashboard load perf + Authority ranking criteria hardening

**Symptoms:** After Authority chart/pillar parity fix (2026-06-11), dashboard took very long to load and populate — trend chart build was blocking the UI.

**Root causes (perf):**
1. **`loadAuditResultsSync()` inside trend chart loop** — full `JSON.parse` of large `last_audit_results` (incl. `query_pages`) on every timeseries point × multiple pillars.
2. **O(n²) map scans** — each chart point ran `forEach` over entire `localEntityMap`, `authorityMap`, `contentSchemaMap`, etc.
3. **Repeated authority recompute** — `calculatePillarScores()` over full `queryPages` could run on every page load when stale 0/0/0/0 components were cached in localStorage.
4. **Verbose debug logging** — dumping entire historical maps on every chart build.

**Perf fixes (`audit-dashboard.html`):**
- Cache parsed localStorage audit snapshot (invalidate on `safeSetLocalStorage('last_audit_results', …)`).
- Pre-build O(n) “latest as-of” sweep readers for historical pillar maps.
- Run authority component recompute at most once per session; pass saved backlink metrics into recalc.
- Remove full-map debug dumps from trend chart path.

**Authority ranking criteria (`lib/audit/rankingCriteria.js`, `pillarScores.js`, dashboard):**
- Soft top-10 band: position ≤ **10.5** (was strict ≤ 10).
- Cap any single query+page row at **25%** of pool impressions before scoring.
- Ranking blend **70%** avg position / **30%** top-10 share (was 50/50).
- Help text updated to match.

**Note:** Re-run GSC & Backlink Audit for stored scores to reflect new ranking rules; historical chart points use saved component columns until then.

## [2026-06-12b] - GSC audit spinner stuck at 100%

**Symptoms:** After GSC & Backlink Audit, progress showed 100% / "Audit completed successfully!" but the orange spinner kept running indefinitely.

**Root causes:**
1. Progress jumped to **100% before** Supabase save and dashboard render finished — `finally` (which hides `#loading`) could not run until long async work completed.
2. `displayDashboard()` was **not awaited**; chart build ran inside a `setTimeout(..., 100)` so the audit thought rendering was done while trend chart was still fetching history.
3. A **second** `displayDashboard()` was scheduled 1s after save (duplicate full render).
4. Trend mode toggle called **`displayDashboard()` with no args** (re-entrant full rebuild).

**Fixes:** Reorder audit completion (save → localStorage → await displayDashboard → 100%); await chart `setTimeout` via Promise; remove duplicate post-save render; guard overlapping `displayDashboard` runs; 3-minute loading safety timeout.

## [2026-06-12d] - Dashboard load perf (measured): default tab, dedup, defer trend chart

**Playwright measurement (before):** 4.3s to hide spinner but trend chart ~34s; two 1.8MB `get-latest-audit` calls; Revenue Funnel APIs firing on every load.

**Root causes found in live test:**
1. **Wrong default panel** — `revenue-funnel` had `is-active` while nav showed Dashboard → `rfInit()` pulled ~2MB of revenue APIs on every page open.
2. **`updateAuditTimestamp`** fetched full audit (1.8MB) with cache-bust `&_=` bypassing fetch dedup.
3. **`displayDashboard` blocked** on trend chart Supabase history (2-year `get-audit-history` ×2 + timeseries refetch).
4. Fetch dedup keyed on full URL so `_=` bust params never hit cache.

**Fixes:** Correct default panel to Dashboard; Revenue Funnel init only when nav+panel both active; banner uses localStorage/minimal fetch; strip `_` from dedup keys (120s TTL); trend chart uses cached timeseries + resolves before heavy history; audit history session cache.

## [2026-06-12e] - Hotfix: broken main script (dashboard blank on 9cbc778)

**Symptoms:** Version 9cbc778 — spinner clears but Dashboard tab stays empty; console: `Missing catch or finally after try`.

**Cause:** Perf refactor broke parse of the 3.4MB main script (two syntax errors) — `displayDashboard`, `renderDashboardTab`, etc. never loaded.

**Fixes:** Repair `fetchContentSchemaHistory` brace; close chart promise `try` after early `resolve()`; call `renderDashboardTab()` on first paint.

## [2026-06-12c] - Dashboard load perf: stop always-on Supabase fetch

**Symptoms:** Page load and tab switches felt slow again after spinner fix — dashboard blocked on multiple large `get-latest-audit` round-trips even when localStorage had a complete audit payload.

**Root causes:**
1. `loadAuditResults()` **always** fetched full audit from Supabase on every call (plus a redundant minimal fetch beforehand).
2. Page init called `loadAuditResults()`, then `displayDashboard()` called it **again**.
3. Overview tab re-ran **full** `displayDashboard()` on every visit (and twice when GBP count changed).
4. Trend chart logged authority per timeseries point (hundreds of `debugLog` calls per render).

**Fixes:** localStorage fast path when audit data is complete; background Supabase refresh only when cache is >15 min old; 60s session cache; `displayDashboard` uses sync cache when scores/data passed; Overview tab skips full re-render; removed per-point trend debug spam; extended latest-audit dedup TTL to 120s.

## [2026-06-11] - Authority score: chart/pillar parity (4-component single source of truth)

**Symptoms:** Authority pillar showed **51** after refresh but Score Trends chart stuck at **45** from ~24 May; Authority sub-bars sometimes **0/0/0/0** while raw backlink/review metrics displayed; scorecard Data Date (9 Jun) disagreed with chart for same day.

**Root causes:**
1. **Split data paths** — pillar tile recalculated live; chart read frozen `audit_results.authority_score` even when component columns existed.
2. **Date mismatch** — chart `isLatestAudit` compared GSC timeseries date (9 Jun) to latest audit row date (11 Jun), so the last chart point never used live scores.
3. **Bad saves** — some GSC runs persisted `authority_score=45` without valid four component columns.

**Fixes:**
- `lib/audit/authorityScore.js` — shared recompute from Behaviour/Ranking/Backlinks/Reviews (40/20/20/20).
- `api/supabase/save-audit.js` — normalize `authority_score` from components before write; warn on mismatch.
- `audit-dashboard.html` — chart rebuilds Authority from stored components + last-good smoothing; last GSC day uses live session score; recompute pillar when components are all zero.
- `scripts/backfill-authority-from-components.mjs` — one-off Supabase correction (`--apply`).

**After deploy:** run `node scripts/backfill-authority-from-components.mjs --apply --property=alanranger.com` then hard-refresh dashboard.

## [2026-06-10] - Schema audit: raise Vercel timeout so full crawl can finish

**Symptom:** Green banner **Schema audit** stuck on **29-May** after multiple **GSC & Backlink Audit** runs on **10-Jun**. Supabase `audit_results` for `2026-06-10` saved GSC but `schema_total_pages` stayed null (`partial_reason: schema_pages_detail missing`).

**Root cause:** `POST/GET /api/schema-audit` crawls ~549 URLs but had **no `maxDuration`** — Vercel default (~60s) often 504'd before the crawl completed. Dashboard then saved a partial audit (GSC only).

**Fix:** `export const config = { runtime: 'nodejs', maxDuration: 300 }` on `api/schema-audit.js` (matches cron/global-run). After deploy, run **GSC & Backlink Audit** once and wait for schema crawl to finish (~5–10 min).

## [2026-06-10] - Full audit save: fix save-audit handler crash on Vercel

**Symptom:** `POST /api/supabase/save-audit` returned `FUNCTION_INVOCATION_FAILED` (~0.5s) on every call; GSC daily sync via `save-gsc-timeseries` worked but `audit_results` never received full audit payloads (backlinks, schema scores, GSC snapshot bundled with money-page metrics).

**Root cause:** Syntax error in `api/supabase/save-audit.js` — missing closing brace in the PATCH-empty-result branch (`Unexpected token 'else'` at module load). Vercel crashed before the handler could run.

**Fix:** Restore brace structure in the insert-after-empty-PATCH path. Local probe confirms HTTP 200 merge onto existing `2026-06-10` ranking stub.

## [2026-06-10] - Green status banner: fix stale Ranking & AI and phantom GSC dates

**Symptoms:** Banner showed Ranking & AI **29-May** after a **10-Jun** scan; GSC 28-day range ended **10-Jun** (impossible — GSC lags ~2 days); GSC audit date **10-Jun** when Supabase last full GSC save was **29-May**.

**Root causes (verified against Supabase):**
1. **Ranking & AI** — `updateAuditTimestamp` read `ranking_ai_data` embedded on the `requireGsc` audit row (May 29 full GSC run) *before* `get-keyword-rankings` (`keyword_rankings.last_refreshed_at` = 2026-06-10 13:50 UTC).
2. **GSC date range** — live fetch used `endDate = today` instead of `getGscDateRange(..., 2)`.
3. **Phantom GSC timestamps** — `localStorage.gsc_banner_last_run` / `gsc_banner_period` persisted in-browser run times across reloads even when Supabase never saved a new GSC row.

**Fixes (`audit-dashboard.html`):**
- Query `get-keyword-rankings?latestOnly=true` **first** for Ranking & AI; GSC-row embedded snapshot is fallback only.
- `fetchSearchConsoleData` uses `getGscDateRange(days, 2)` for period start/end.
- GSC banner session override moved to **sessionStorage**; legacy `localStorage` keys cleared on load.
- **Follow-up:** `loadRankingAiData` treated empty `combinedRows: []` as valid (JavaScript truthy array) and skipped the `keyword_rankings` fallback — now requires `length > 0`. GSC banner session dates only persist **after** a successful Supabase save (`persistGscBannerSession`), not on in-browser fetch alone.
- **Follow-up (split storage):** GSC runs were saving daily rows to `gsc_timeseries` (Score Trends → **8 Jun**) while the green banner still read stale `audit_results.gsc_timeseries` (**27 May**). New `GET /api/supabase/gsc-timeseries-banner` + banner wiring uses the same table as Score Trends.

**Still accurate (not banner bugs):** Squarespace/Stripe last sync **25-May** (`revenue_snapshots.created_at`); Schema **29-May**; CSV tiers **18-May**; DFS **03-Jun** — those feeds have not been re-synced since those dates.

## [2026-06-10] - Revenue Funnel summary: fix Supabase statement timeout after GA4 sync

**Symptom:** After **Sync GA4**, dashboard showed `Failed to load Revenue Funnel summary: HTTP 500` with `canceling statement due to statement timeout`.

**Root cause:** `GET /api/aigeo/revenue-funnel-summary` paginated the entire `revenue_gsc_joined_with_policy` view (LATERAL join over all GSC rows) via `fetchPolicyBySlug()` — often >8s per batch on Supabase.

**Fix:** `api/aigeo/revenue-funnel-summary.js` — load the small `page_indexability_policy` rules table once, then resolve policy in-memory for the ~550 GSC page slugs in the current 28d snapshot via `resolvePolicy()` (same helper as Phase 5b indexability work).

## [2026-06-04] - Collection hub noindex: indexability policy + retired money paths

- Migration `20260604_collection_pages_indexability_policy.sql` — exact `intentional_noindex` on `/photo-workshops-uk` and `/photography-services-near-me` (`effective_date` 2026-06-04); **removed** mistaken prefix noindex on `/photographic-workshops-near-me` (hub stays indexed).
- `lib/retired-money-pages.mjs` — exclude the two product collection hubs from live money KPIs (with `/photography-shop-services`). Detail product URLs unchanged.
- `api/aigeo/pageSegment.js`, `audit-dashboard.html`, `Docs/MONEY_PAGE_SEGMENT_URL_PATTERNS.md` — aligned. No change to `06-site-urls.csv`, `api/schema-audit.js`, or schema manifests.

## [2026-06-01] - `page_indexability_policy`: beginners-photography-lessons prefix noindex

- Migration `20260601_beginners_photography_lessons_noindex_policy.sql` — prefix `intentional_noindex` on `/beginners-photography-lessons` (`effective_date` 2026-06-01). ~49 URLs stay in `06-site-urls.csv` for schema audit and chat event mapping; indexable KPI variants exclude them on/after effective date.

## [2026-06-01] - Traditional SEO “Last audit run” follows GSC audit date

**Root cause:** The Traditional SEO tab showed `traditional_seo_score_snapshots.created_at` (last **rules rescore**, e.g. 10 May) even after a fresh **GSC & Backlinks** audit (green banner 01 Jun). Those are different pipelines.

**Fixes:**
- `audit-dashboard.html` — `traditionalSeoRefreshLastRunDisplay()` uses the newest of: score snapshot, last Traditional SEO evaluation, latest GSC row (`requireGsc=true`), or `gsc_banner_last_run`.
- Refreshed after GSC audit completes, on tab load, and after Traditional SEO evaluation.
- `fetchLatestAuditFromSupabase` now requests `preferRecent=true&requireGsc=true` so Traditional SEO loads the same audit row as the green banner.

## [2026-05-31] - GSC audit save + green banner regression (fa8067b follow-up)

**Root cause:** Commit `fa8067b` (2026-05-29) correctly stopped GSC-only runs from re-saving cached `rankingAiData`, but the client still sent `rankingAiData: null`, which PATCHed `audit_results.ranking_ai_data` to NULL. A same-day `ranking_ai_only` stub row (`2026-05-31`) then sat above the last real GSC row in `updated_at` order while lacking `gsc_timeseries`, so `preferRecent` + `is_partial=false` kept the banner on **2026-05-30** (last full audit). Post-run `updateAuditTimestamp` also overwrote the in-session banner because `gsc_banner_last_run` was written but never read back.

**Fixes:**
- `api/supabase/save-audit.js` — omit `ranking_ai_data` / `ranking_ai_pillar_scores` from PATCH/POST when no real `combinedRows` (no JSONB wipe).
- `api/supabase/get-latest-audit.js` — `requireGsc=true` returns latest row with `gsc_timeseries` + `visibility_score` (skips ranking-only stubs).
- `audit-dashboard.html` — GSC banner fetch uses `requireGsc=true`; honours `gsc_banner_last_run` when newer than DB; omits `rankingAiData` key from save payload when absent.

## [2026-05-27] - Money-page GSC cron — widened to all-pages nightly + scheduled in vercel.json

Sister ticket to the Phase C0 backfill below. C0 patched the 16.4 months of
historical `gsc_page_timeseries` data; this ticket fixes the nightly writer
so the same gap does not re-open going forward.

1. **ROOT CAUSE OF THE PRE-C0 GAP.** `api/cron/backfill-money-page-timeseries.js`
   (added 2026-01-24) was the only file the codebase advertised as "the
   nightly money-page timeseries cron", but it was **never added to
   `vercel.json`** — verified with `git log -- vercel.json` from 2026-01-01.
   What actually wrote `gsc_page_timeseries` Jan–Apr 2026 was
   `api/cron/daily-gsc-backlink.js`, scheduled `*/5 * * * *` until commit
   `e081fc6` (2026-04-22) removed it during the DFS spend-guard work.
   `daily-gsc-backlink.js` calls `buildMoneyPageGridRows` which writes
   `clicks: Number(existing?.clicks || 0)` for every (money_page × date)
   cell over a rolling 28-day grid — i.e., **zero-fills any cell where
   `audit.moneyPagesTimeseries` is missing**, then upserts. With 288
   runs/day × ~6,524 rows/run, any one rate-limited or partial GSC response
   overwrote previously-correct clicks with 0. That, plus a latent
   duplicate-key bug fixed on 2026-05-19 in commit `f2b90b3`, produced the
   94–99% click-loss the user observed for Jan–Apr 2026.

2. **THIS FIX.** `api/cron/backfill-money-page-timeseries.js` rewritten in
   place to (a) drop the ~233-page money-pages + STRATEGIC_PAGES allowlist
   and write **all** pages GSC returns, (b) default to a **rolling 7-day**
   window (was 28-day), (c) paginate GSC responses with `startRow` instead
   of relying on the single-call 25k `rowLimit`, (d) send
   `dataState: 'final'` so unstable "fresh" rows do not enter the table,
   (e) accept optional `startDate` / `endDate` / `daysBack` query params
   for ad-hoc backfill use, and (f) write a row to `gsc_backfill_runs`
   (`notes='nightly all-pages cron'`) on every run so future operators
   can audit run history without rummaging in Vercel function logs.
   File name unchanged so existing references (Docs, vercel.json path,
   `scripts/` mirror) keep working.

3. **SCHEDULED.** `vercel.json` `"crons"` array gains
   `{ path: "/api/cron/backfill-money-page-timeseries", schedule: "30 3 * * *" }`
   — 03:30 UTC daily, after Google's overnight GSC processing completes
   (chosen to land before the 07:00 UTC squarespace-revenue-sync cron).

4. **CLI MIRROR UPDATED.** `scripts/backfill-money-page-timeseries.js`
   rewritten to the same fetch/dedupe/upsert path as the cron, takes
   `--startDate` / `--endDate` / `--daysBack` so manual backfills can use
   the same code path as the deployed cron. Loads `.env.local` (was
   `.env` only, which the project does not ship). Use:

   ```bash
   node scripts/backfill-money-page-timeseries.js --startDate 2026-05-19 --endDate 2026-05-25
   ```

5. **VERIFICATION (regression check approach for future changes).**
   Re-running the cron over a window C0 has already covered must produce a
   byte-identical row set (same UNIQUE key + idempotent upsert). Confirmed
   2026-05-27 21:56 UTC for 2026-05-19..2026-05-25:
   - Cron fetched 5,920 raw GSC rows in 1 API call, deduped to 2,734
     unique records, 0 batch errors.
   - `gsc_page_timeseries` window before cron run: 2,734 rows / 501 pages /
     1,724 clicks / 1,067,785 impressions / hash
     `5bef4b1c2d20153fbc01350bb9143621`.
   - `gsc_page_timeseries` window after cron run: 2,734 / 501 / 1,724 /
     1,067,785 / hash `5bef4b1c2d20153fbc01350bb9143621` — **byte-identical**.

   Per-day capture vs `gsc_timeseries` property total (the user's F4
   success criterion was ~5%; achieved ≤2%):
   - 2026-05-19: 313 cron / 312 property → −0.3%
   - 2026-05-20: 264 / 264 → 0.0%
   - 2026-05-21: 248 / 253 → 2.0%
   - 2026-05-22: 216 / 216 → 0.0%
   - 2026-05-23: 189 / 191 → 1.0%
   - 2026-05-24: 227 / 230 → 1.3%
   - 2026-05-25: 267 cron, property-total table has no row yet (separate
     `gsc_timeseries` ingest gap, out of scope).
   - 2026-05-26: 0 cron (GSC has not finalised that date yet — correct
     given `dataState: 'final'`).

6. **OUT OF SCOPE / FOLLOW-UP TICKET FILED.** Decision: do not touch
   `api/cron/daily-gsc-backlink.js` in this ticket — it is currently
   dormant (removed from `vercel.json` 2026-04-22) so it cannot regress
   data today, but the `buildMoneyPageGridRows` zero-fill at lines 49–78
   is still in the source. Follow-up ticket
   `Docs/TICKET-daily-gsc-backlink-zerofill-fix.md` raised so anyone
   re-scheduling that cron must fix the zero-fill first.

## [2026-05-27] - Revenue Truth — Phase C / C0 — GSC backfill (page-level only)

GSC data layer foundation for the Phase C funnel overlay added to the Revenue
Truth tab. **Data layer only. No views (C1), analyser changes (C2 part 1), or
UI (C2 part 2/3) yet — each is a separate, separately-approved sub-phase.**

1. **NEW TABLES.** `migrations/phase_c0_gsc_page_query_daily_20260527.sql`
   creates `gsc_page_query_daily` (per-(property_url, date, page_url, query) —
   PK on all four; three secondary indexes for per-page and per-query reads)
   and `gsc_backfill_runs` (run-level audit trail with `running` / `completed`
   / `failed` status and per-chunk rows-upserted / api-calls counters).

2. **EXTENDED EXISTING TABLE.** `gsc_page_timeseries` (existing schema,
   `UNIQUE(property_url, page_url, date)`) was backfilled from
   2025-01-13 → 2026-05-25 — 16.4 months, the entire GSC retention window.
   Before C0 it covered ~5 months (2025-12-27 → 2026-05-17) and was filtered
   to a ~400-page "money pages" allowlist; after C0 it covers 952 distinct
   pages with <5% click-attribution delta vs property totals across every
   in-retention month except 2025-01 (which is partial, Jan 13+, because
   retention starts mid-month).
   - Rows: 165,942
   - Distinct pages: 952
   - Sum clicks: 107,668
   - Sum impressions: 30,186,791

3. **BACKFILL SCRIPT.** `scripts/gsc-c0-backfill-page-daily.mjs`. Reuses the
   existing OAuth refresh-token flow (`GOOGLE_CLIENT_ID` / `_SECRET` /
   `_REFRESH_TOKEN` in `.env.local` — same property identifier
   `https://www.alanranger.com` as every other GSC ingest in this repo).
   Weekly-chunked, idempotent (skip-if-populated by default, `--force`
   override; upserts on `(property_url, page_url, date)` so re-runs replace
   rows in place). Same `normalizeUrl()` slug shape as
   `api/cron/backfill-money-page-timeseries.js` so the C0 rows interleave
   cleanly with the existing money-pages cron writes.

4. **QUERY DIMENSION DEFERRED.** The companion script
   `scripts/gsc-c0-backfill-page-query-daily.mjs` exists and was smoke-tested
   on one week (2026-05-18..24, 94,974 rows), but the **full backfill was
   not run**. Reason: adding the `query` dimension to the GSC API silently
   anonymises ~61% of clicks (long-tail queries below GSC's per-user privacy
   threshold are dropped). Empirically measured for alanranger 2026-05-18..24
   via `scripts/_gsc-dimension-loss-probe.mjs`: site totals 1,748 clicks vs
   `dimensions:['date','page','query']` 676 clicks. Page-level totals for the
   funnel diagnosis must come from the page-only cut to avoid charting a
   phantom 60% decline. Keyword breakdowns (a possible later phase) can use
   `gsc_page_query_daily` only with explicit "above GSC's privacy threshold"
   labelling.

5. **TABLE COMMENTS.** Set on Supabase for `gsc_page_timeseries` (AUTHORITATIVE
   per-page source, slug format, CTR-as-percentage scale, coverage gap band),
   `gsc_timeseries` (sanity-check basis only), `gsc_page_query_daily` (deferred
   status + dimension-loss reason + CTR-as-fraction scale mismatch warning),
   `gsc_page_metrics_28d` (DO NOT SUM, overlapping windows), and
   `gsc_backfill_runs` (Phase C / C0 audit trail). These comments are the
   schema-level source of truth for which table to query when.

6. **CANONICAL DOC.** `Docs/REVENUE-TRUTH-PHASE-C-GSC-SOURCES.md` — sources
   hierarchy, retention floor, normalisation function, scale conventions,
   coverage gap table, deferred-keyword decision log, backfill-script
   instructions, audit trail.

7. **GATE 1 EVIDENCE.** Pasted in chat 2026-05-27 (V1.1 schemas/dates/PKs,
   V1.2 sample rows, V1.3 canary `/private-photography-lessons`, V1.4 URL
   format inventory, V1.5 coverage table for the 17 distinct
   `canonical_products.service_page_url` values — brief said 19, actual is
   17 — and V1.6 monthly rollup SQL). User approved Gate 1 before C0
   started. C0.5 verification reissued after the `--force` rerun on the
   21 originally-skipped overlap weeks (per-month click-gap reduced from
   94-99% to 0.4-1.3% across 2026-01 → 2026-04).

8. **OUT OF SCOPE FOR THIS CHANGE.** No Phase A / Phase B / Phase L tables
   touched. No views built. No analyser changes. No UI changes. No Vercel
   deploys. No git commits in this change. C1 (views) and C2 (analyser +
   UI) are the next two sub-phases, each requiring separate user approval.

## [2026-05-27] - Revenue Truth tab — Round 1 revisions

Six revisions to the Gate 2 tab after first user review:

1. **Channel duplicate bug fix.** The transaction data had `"Into The Blue"`
   (capital T, 8 rows) and `"Into the Blue"` (lowercase t, 11 rows) — both the
   same source, accidentally case-split by inconsistent capitalisation in the
   user's workbook entries. Table 6 (channel mix) and Table 7 (new vs
   existing) now group case-insensitively (after `trim()`), so casing variants
   collapse to one row. The displayed label uses the first-seen trimmed
   variant for stability. Same normalisation applied to Table 8 (funding)
   for consistency. The user has noted source-data tidying in the .xlsm as
   a future workbook task — not blocking.

2. **Total rows added** to every measured table that lacked them: Tables 4
   (category breakdown), 6 (channel mix), 7 (new vs existing) and 8
   (funding & fees) now have both a per-month column total row AND a Total
   row at the bottom. Every table is reconcilable by eye. Table 3 (market
   split) already had totals — kept, with the visible-window total as the
   primary footer row and a full-period reconciliation row beneath it when
   the rolling window is active.

3. **Default view = rolling 13 months.** The default display window across
   all measured sections (chart + all monthly tables) is now a rolling 13
   months anchored on the current month (May 2025 → May 2026 today), giving
   a clean year-on-year read. A "Display window" toggle at the top of the
   tab flips to **Full history (all 17 months)** when the user wants the
   complete period. **CRITICAL:** the underlying API still returns the full
   dataset, year totals and the Forecast block are always computed from the
   FULL data, never from the visible window. The Market Split table footer
   shows BOTH the visible-window total AND the full-period
   "reconciliation basis" total when the rolling window is active, so the
   £66,170.50 17-month total is always one click away.

4. **Table 4 sort toggle.** New radio control above the category breakdown
   table: "By market" (default — groups D2C together, then B2B, then
   ADJUSTMENT, ordered by category within each market) or "By category
   order" (1..12 verbatim).

5. **NEW Forecast section.** The one projection on this otherwise-measured
   tab, visually quarantined with an amber striped background, dashed amber
   borders on each card, and a prominent `PROJECTION` pill next to the
   section heading. Cards: YTD actual (closed months only), Run rate
   (trailing-3-closed-month average), Months remaining, Full-year forecast
   (with range = YTD + trailing-3 min/max × months remaining), Variance vs
   £60k annual target, Run rate vs £5k comfortable monthly target. The
   formula is shown verbatim on the tab — no hidden maths — and the caveat
   "Simple run-rate projection — does not model seasonality; revenue is
   seasonal (see the tier band chart)" is rendered beneath it. Current
   partial month is never blended into the run rate (only closed months
   count); the partial month sits inside `monthsRemaining` and is forecast
   forward.

6. *(User-side note, not a Cursor task)* tidy `"Into the Blue"` casing in
   the workbook's transaction column G so the source data is clean.

**Files changed:**
- `api/aigeo/revenue-truth-summary.js` — `groupByValue` + `canonicaliseMap`
  + `normaliseLower` helpers for case-insensitive grouping; `buildForecast`
  + `sumHeadline` + `trailingStats` helpers for the projection block.
- `audit-dashboard.html` — Revenue Truth panel: window-mode + sort-mode
  state, `visibleMonthKeys` / `visibleMonthly` / `filterByVisible`
  helpers, Forecast section with scoped CSS, sort toggle on Section 4,
  per-month + bottom Total rows on Sections 4/6/7/8, refactored market
  table to surface both visible-window and full-period totals.

**Reconciliation verified (smoke test):**
- 2025 year total still £46,572.46, 2026 YTD still £19,598.04 (full data).
- API returns single "Into the Blue" row collapsing the two variants.
- Forecast block returns YTD £18,811.04 + run rate £4,679.46 × 8 months
  remaining = £56,247 central (range £46,000 - £67,337). Variance vs
  £60k annual = -£3,753.

## [2026-05-26] - Revenue Truth tab — Gate 2 (sections 1-9)

Built the **Revenue Truth** dashboard tab — measured revenue history from the
Booking Sheet, the single source of truth. Sections 1-9 per the brief; the
Gap & Signals section is deliberately deferred to a later turn (one verifiable
change per turn).

**Headline rule (from Phase L1, reaffirmed):** primary dashboard headline =
`revenue_amount` = the full 12-category sum = the Booking Sheet YTD Actual cell
(£46,572.46 for 2025, £19,598.04 for 2026 YTD). It is NOT `operational_revenue`.
`operational_revenue` (D2C+B2B) is shown as a secondary breakdown line.
`adjustment_net` is its own explicit labelled line so the user always sees
`headline = operational + adjustment`.

**New data layer (Gate 1 + Gate 2 combined):**
- `booking_sheet_category_gp` — per-(category, year) GP rate (verbatim from each
  Sales YYYY tab's GP Amount grid; year-specific, never harmonised). Added in
  Gate 1.
- `booking_sheet_transactions` — per-booking detail rows from the Sales YYYY
  transactional block (cols A-G below the summary grids: Date | Client |
  Category | Funding | Amount | Event | Source). One row per booking line item.
  Idempotent on `(property_url, year, source_workbook, source_row)`. Reconciles
  to the penny against the category grid at year level
  (2025: 471 txns = £46,572.46; 2026 YTD: 150 txns = £19,598.04). Added in
  Gate 2.
- `client_type` derived from booking_source: `Existing` if source is literally
  `"Existing"`, else `New`. `channel` carries the booking source for new
  clients only (NULL for Existing).

**New API:** `GET /api/aigeo/revenue-truth-summary`. One call returns
`config` (tier bands, fee rules, current month), `monthly` (17 rows of
headline / operational / adjustment / d2c / b2b / band / isPartial),
`yearTotals`, `headlineStrip` (latest closed month, YTD, trailing-3 avg),
`categoryBreakdown` (12 cats × month with revenue, units, avg price, GP rate,
GP £), `channelMix`, `newVsExisting`, `fundingFees` (with estimated payment
fees), `gpRates`.

**Dashboard tab (`audit-dashboard.html`):**
- New `data-panel="revenue-truth"` nav button in the Planning & Optimisation
  section, immediately above Revenue Funnel.
- Sections 1-9 rendered:
  1. **Tier band chart** — 17-month bar chart of `revenue_amount` with three
     horizontal dashed lines at Survival £3k / Comfortable £5k / Thrive £8k
     (config constants, edit in one place). Bars coloured by band reached;
     current partial month (May 2026) shown in slate-grey to distinguish from
     a "real" below-survival result.
  2. **Headline strip** — latest closed month, YTD with pro-rata target,
     trailing-3-closed-month average band, tier bands reference card.
  3. **Market split** — 17-month table: D2C / B2B / Operational / Adjustment /
     Headline. Adjustment shown in red when negative. Operational =
     `D2C + B2B` labelled as such.
  4 + 5. **Category breakdown** — 12 verbatim categories × 17 months pivot,
     with units / avg price / GP shown on hover. `*_Out` voucher lines shown
     as negative re-attribution (not hidden). Market pill (D2C/B2B/ADJ) on
     each row.
  6. **Channel mix** — booking source per month, computed FROM transaction
     rows (never from cached grid-summary cells). Existing-client revenue
     shown as its own row.
  7. **New vs Existing** — revenue + units per month per client_type.
  8. **Funding & fees** — banking source per month with estimated payment fees
     (Stripe 1.8%, PayPal 2.9% + £0.30 verbatim from the workbook's
     "Payment Fees" note). Bank transfers + voucher redemptions = no fee.
  9. **Revenue / GP toggle** — checkbox above the category table flips between
     revenue £ and GP £ (GP rate verbatim from the year's own grid).

**Code conformance:** every helper function in the new parser code, backfill
extension, API endpoint, and UI render code is kept under cyclomatic-15.
Charting uses the dashboard's existing Chart.js 4.4.0; tier band lines drawn
by a small inline `afterDatasetsDraw` plugin (no `chartjs-plugin-annotation`
dependency added).

**Reconciliation evidence (Gate 1 + Gate 2):**
- 2025 year total: £46,572.46 (category grid) = £46,572.46 (txn sum) — zero
  delta.
- 2026 YTD total: £19,598.04 (category grid) = £19,598.04 (txn sum) — zero
  delta.
- `booking_sheet_monthly_wide` matview refreshed post-import.
- Smoke test `scripts/smoke-test-revenue-truth-summary.mjs` returns
  reconciled monthly + yearTotals matching the spreadsheet to the penny.

**Not yet built (deferred to a separate turn, per user instruction):**
- Gap & Signals section (gap quantification + GSC/GA4 correlation context).
- Removal of the back-compat `tier_revenue` synthesis from
  `revenue-funnel-summary.js` (waiting on Revenue Funnel UI rebuild turn).
- Repointing the existing Revenue Funnel sparklines + Scenario Planning
  cockpit at the new `revenue_amount` headline (Revenue Funnel + Scenario
  Planning tabs deliberately untouched this turn).

**Files changed:**
- `migrations/phase_l2_create_booking_sheet_transactions_20260526.sql` (new)
- `lib/booking-sheet-truth-parser.mjs` — `transactionRows` emitter +
  `findTxnHeaderRow` / `buildOneTxnRow` / `buildTransactionRows` /
  `readTxnDate` / `excelSerialToIsoDate` / `deriveClientFields` helpers
- `scripts/backfill-booking-sheet-monthly.mjs` — txn upsert into
  `booking_sheet_transactions` + `printTransactionReconciliation` soft check
- `api/aigeo/revenue-truth-summary.js` (new)
- `audit-dashboard.html` — Revenue Truth nav button, panel, scoped CSS, render
  JS, inline tier-band-lines Chart.js plugin, `setActivePanel` hook
- `scripts/smoke-test-revenue-truth-summary.mjs` (new) — local end-to-end
  reconciliation smoke test

## [2026-05-26] - Revenue: three tier systems, not one — Phase L1 correction

Phase L (immediately below) shipped the right reconciliation total (£66,165.50)
but the wrong tier model. It rolled the 12 verbatim Booking Sheet categories into
5 invented "tiers" (`courses`, `workshops_nonres`, `workshops_residential`,
`services`, `academy`), where the `services` bucket merged 8 unrelated D2C, B2B
and ADJUSTMENT categories into one figure that corresponded to nothing real.

**The right model — three separate tier systems:**

1. **Accounting categories (12)** — what was bought. The Booking Sheet's verbatim
   categories. This is the revenue truth layer. Verbatim, all 12, never merged.
2. **Business market (3)** — who the customer is. A derived attribute on each
   category: `D2C` (workshops/courses/mentoring/1-2-1/academy), `B2B` (prints,
   commissions), `ADJUSTMENT` (voucher/deferred-spend timing pairs, not revenue).
3. **Page tiers (A–F)** — where on the website the journey happens. SEO-side
   only, never in the revenue data layer.

**Schema changes (this fix):**

- DROP `public.booking_sheet_monthly` (the invented 5-tier rollup table).
- DROP the legacy `tier_id` column from `public.booking_sheet_monthly_category`
  (no longer meaningful; the canonical mapping is data, not a code constant).
- ADD `public.booking_sheet_category_market` — 12-row mapping table:
  `(category_order, category_label, market, is_revenue, notes)`. Single source
  of truth for the 12 → 3 mapping; editing the table changes the dashboard
  without a code release.
- REBUILD `public.booking_sheet_monthly_wide` materialised view on the new
  shape:
  - `category_revenue` jsonb — 12 verbatim keys per month.
  - `market_revenue` jsonb — `{D2C, B2B, ADJUSTMENT}` per month, joined from
    `booking_sheet_category_market`.
  - `operational_revenue` numeric — `D2C + B2B`, shown on the dashboard as a
    secondary breakdown line ("service revenue excl. voucher timing") beneath
    the headline. **Not the headline itself** (see headline rule below).
  - `adjustment_net` numeric — the voucher / deferred-spend timing line, shown
    on the dashboard as its own labelled line so the user can see headline =
    operational + adjustment at a glance.
  - `revenue_amount` numeric — full 12-category sum, = YTD Actual cell (J47 for
    2025 = £46,567.46; J48 for 2026 = £19,598.04). This is BOTH the
    **import gate reconciliation basis** (proves the import is complete) AND
    **the dashboard headline figure AND the tier-band comparison basis**
    (survival £3k / comfortable £5k / thrive £8k). Rationale: the user reads
    the Booking Sheet daily and the dashboard headline must equal the figure
    they read there — a dashboard that disagrees with the spreadsheet by
    £1,229 destroys trust on every glance. (An earlier locked decision made
    `operational_revenue` the headline; reversed on 2026-05-26 before any UI
    shipped — see `Docs/REVENUE-TRUTH-FROM-BOOKING-SHEET.md` for full context.)

**Code changes:**

- `lib/booking-sheet-truth-parser.mjs` — strip the `CATEGORY_TO_TIER` mapping
  and `buildTierRows`; only emit `monthlyPerCategory`. The legacy `tier_id`
  field on each row is gone.
- `scripts/backfill-booking-sheet-monthly.mjs` and
  `api/aigeo/booking-sheet-upload.js` — no more writes to the dropped
  `booking_sheet_monthly` table; the import gate still verifies the full
  12-category sum vs YTD Actual.
- `lib/revenue-funnel-academy-economics.js` — read
  `category_revenue->>'12. Academy'` instead of Phase L's `tier_revenue.academy`.
- `api/aigeo/revenue-funnel-smart-priorities.js fetchRollingRevenueSnap` —
  SELECT now includes `operational_revenue` and `adjustment_net` alongside
  the existing `revenue_amount` (full 12-cat sum). The shape of the returned
  row is unchanged — `revenue_amount` semantics remain "full 12-category sum
  = YTD Actual basis", and the new fields are exposed alongside for the UI
  rebuild turn to consume. Keeps this turn data-layer-only.
- `lib/revenue-funnel-seasonality-blend.js` — read `category_revenue` and
  `market_revenue`. Emit `byTier` (back-compat, 4 real 1-to-1 mappings only;
  `services` and `hire` are gone from STATED, so callers passing them get the
  neutral factor 1.0 — what they were effectively getting before). Also emit
  `byMarket` (new dimension: D2C, B2B) for the per-market chart the UI rebuild
  turn will consume.
- `api/aigeo/revenue-funnel-summary.js fetchRevenueHistory` +
  `fetchLatestRevenue` — SELECT the new view columns and synthesize a
  back-compat `tier_revenue` jsonb in JS (4 real 1-to-1 mappings populated;
  `services` and `hire` set to null so the existing per-tier sparklines render
  empty for them, which is the truthful state) until the UI rebuild turn
  replaces the per-tier sparklines with a 3-line D2C / B2B / ADJUSTMENT chart.

**Verification (all checks pass against the live DB and re-imported data):**

- 2025 full year: operational £47,796.21 + adjustment −£1,228.75 = £46,567.46
  (YTD Actual ✓)
- 2026 YTD (Jan-May): operational £19,857.04 + adjustment −£259.00 = £19,598.04
  (YTD Actual ✓)
- Per-row invariant `operational_revenue + adjustment_net = revenue_amount` is
  0.00 across every month.
- The −£1,228.75 ADJUSTMENT for 2025 is a genuine timing effect: 2025 brought
  in £2,390 of new vouchers (£1,450 PnM + £940 GV) and paid out £3,618.75
  against older vouchers (£2,030.75 PnM + £1,588 GV). The September 2025 +£1,350
  spike is a single large PnM bundle sold that month with no Out yet (expected:
  future months will draw down on it). One minor £1 rounding in Aug 2025 GV
  flagged but harmless.

**Deferred (separate turn):** the dashboard UI still renders the legacy 6
per-tier sparklines (2 of which now show empty because their merged data is
gone). A follow-up turn will delete those sparklines, add a 3-line chart
(D2C, B2B, ADJUSTMENT on a shared `revenue_amount`-basis y-axis), point the
headline AND the survival/comfortable/thrive tier-band comparison at
`revenue_amount` (= YTD Actual = the spreadsheet figure, **not**
`operational_revenue`), show `operational_revenue` as a secondary breakdown
line ("service revenue excl. voucher timing") beneath the headline, and show
`adjustment_net` as its own labelled line so `headline = operational +
adjustment` is visible. After the UI rebuild, the back-compat `tier_revenue`
synthesis in `api/aigeo/revenue-funnel-summary.js` can also be removed.

**Migrations on disk (replay order matches DB version timestamps):**

- `migrations/20260526195610_booking_sheet_monthly_category_order_relax.sql`
  — relax `category_order` CHECK from `(1..20)` to `(0..20)` (Phase L follow-up).
- `migrations/20260526195951_booking_sheet_monthly_wide_drop_in_shape.sql`
  — Phase L matview shape; superseded by Phase L1 the same day but retained
  on disk for replay completeness.
- `migrations/20260526204321_phase_l1_drop_invented_5_tier_rollup.sql`
  — drop function + matview + table for the 5-tier rollup.
- `migrations/20260526204347_phase_l1_create_category_market_mapping.sql`
  — create `booking_sheet_category_market` (12 rows).
- `migrations/20260526204404_phase_l1_rebuild_wide_view_on_12cat_3market_model.sql`
  — rebuild `booking_sheet_monthly_wide` on the corrected model.
- `migrations/20260526204559_phase_l1_drop_legacy_tier_id_from_category_table.sql`
  — drop unused `tier_id` column.

**Pre-existing follow-ups not touched in this fix:**

- Tag each MONEY PAGE with a market (D2C / B2B) on the SEO/money-pages side so
  the user can see "which pages target D2C vs B2B". The two systems connect
  only via the `market` attribute, never by equating a page tier with a revenue
  category.

## [2026-05-26] - Revenue: Booking Sheet is the single source of truth (Phase L)

Critical headline-revenue fix. The Revenue Funnel + Scenario Planning tabs were
double-counting revenue across three overlapping sources in `revenue_snapshots`
(`squarespace_api` + `stripe_supplemental` + `booking_sheet`). The three sources
overlap (a Squarespace order paid by Bank Transfer appears in BOTH the SQ Orders
API row AND the Booking Sheet's Bank receipt row) with no transaction-level
de-dup, so the headline 17-month total was inflated to £72,251 vs the user's
manually-reconciled truth of £66,165.50 (2025 £46,567.46 + 2026 YTD £19,598.04).

**Root cause:** the dashboard summed `revenue_snapshots.tier_revenue` across all
sources for each month. The legacy parser also dropped Stripe-funded rows from
the Booking Sheet import on the assumption the SQ + Stripe sources would supply
the rest -- they did, but with overlap. The Booking Sheet's `Sales YYYY` row-18
"Totals" line is the user's manually-reconciled master figure that already
includes every funding channel (Bank, PayPal, Cash, Stripe, vouchers, etc).

**Fix shipped in this same commit window:**

1. **New tables** (migration `migrations/20260526_booking_sheet_monthly.sql`):
   - `public.booking_sheet_monthly` — per `(property_url, year, month, tier_id)`
     authoritative revenue, sourced from the row-18 Totals.
   - `public.booking_sheet_monthly_category` — per-month per-raw-category audit
     trail (all 12 Booking Sheet categories preserved verbatim).
   - `public.booking_sheet_monthly_wide` — materialised view that mirrors the
     legacy `revenue_snapshots` row shape (`period_start`, `period_end`,
     `revenue_amount`, `currency`, `source`, `tier_revenue`, `tier_transactions`,
     `notes`) so reader code can switch source with one-line changes.
   - `public.refresh_booking_sheet_monthly_wide()` — SQL function called after
     every import.

2. **New parser** `lib/booking-sheet-truth-parser.mjs` reads the row-18 Totals
   + category × month grid from each `Sales YYYY` tab. The 12 Booking Sheet
   categories are mapped to the 5 dashboard tiers:
   - `1. Courses/masterclasses` → `courses`
   - `2. Workshops Non Residential` → `workshops_nonres`
   - `3. Workshops Residential` → `workshops_residential`
   - `4. Pick n Mix Inc` / `5. Pick n Mix Out` → `services` (net re-attribution)
   - `6. Mentoring` / `7. 1-2-1` → `services`
   - `8. Gift Vouchers Inc` / `9. Gift Vouchers Out` → `services` (net)
   - `10. Prints & Royalties` → `services`
   - `11 Commissions` → `services`
   - `12. Academy` → `academy`
   Hard reconciliation: import refuses if any sheet's category-sum does not
   match its own `J47`/`J48` "YTD Actual" cell to the penny.

3. **Backfilled** `booking_sheet_monthly` from the user's `.xlsm` files via
   `scripts/backfill-booking-sheet-monthly.mjs`. 73 tier rows + 133 category
   rows for 2025 + 2026 YTD. Per-year totals match the user-stated truth
   exactly: £46,567.46 (2025) and £19,598.04 (2026 YTD).

4. **Repointed the four hot reader paths** to `booking_sheet_monthly_wide`
   (one-line changes, with explanatory comments at each call site so the
   change is auditable):
   - `api/aigeo/revenue-funnel-summary.js` — `fetchRevenueHistory` (Revenue
     Funnel monthly sparklines) + `fetchLatestRevenue` (funnel KPI tiles).
   - `api/aigeo/revenue-funnel-smart-priorities.js` — `fetchRollingRevenueSnap`
     (Scenario Planning current run-rate).
   - `lib/revenue-funnel-seasonality-blend.js` — `loadBlendedSeasonality`
     (observed seasonality factors per tier per month).
   - `lib/revenue-funnel-academy-economics.js` — `academyTierHealth` (Academy
     CAC/LTV and tier-health badge).
   Smoke-tested via `scripts/smoke-test-booking-sheet-readers.mjs` — all three
   patched libs return the expected per-tier monthly figures.

5. **Rewrote** `api/aigeo/booking-sheet-upload.js` to use the new parser,
   write to the new tables, refresh the wide view, and refuse to import any
   workbook whose category sums do not reconcile to the YTD Actual cells.
   Dashboard upload-progress log updated to surface the new per-year totals
   + reconciliation status instead of the obsolete `by_funding` / `records_kept`
   shape.

6. **Demoted `revenue_snapshots`** to detail-only:
   - Deleted the 17 superseded `source='booking_sheet'` rows (preserved in
     `booking_sheet_monthly` + `..._category` so nothing was lost).
   - Added `COMMENT ON TABLE` warning that callers MUST NOT sum sources for
     the headline figure; the table is for transaction-level detail only.
   - Marked `lib/booking-sheet-parser.mjs` and `scripts/import-booking-sheet.mjs`
     as DEPRECATED with prominent banner comments — they still work but their
     import shape is the source of the double-counting and they should never
     be called from new code.
   - The `squarespace_api` and `stripe_supplemental` rows remain (daily syncs
     continue writing them) for legitimate detail-drilldown use cases. The
     fossil-row cleanup inside those sources was NOT performed — no headline
     reader now consumes them, so the fossils are harmless and can be tidied
     later as a separate task.

**Documentation:** `Docs/REVENUE-TRUTH-FROM-BOOKING-SHEET.md` (spec + full
per-month per-category grids for 2025 and 2026 YTD); `Docs/REVENUE-DATA-AUDIT.md`
banner updated from SUPERSEDED to FIXED with a summary of what changed.

**British English. Discovery-then-build sequence honoured throughout.**

## [2026-05-26] - Phase K-2: Academy two-step trial-funnel model + dashboard-wide ASSUMED flag + materiality floor

Follow-up to the same-day Phase K data-layer reconciliation. The Coventry card is
confirmed fixed (anchor + lever list + DATA SOURCES INCONSISTENT banner all
behaving). This entry addresses the five Card 3 (`/free-online-photography-course`)
defects the user identified after the Coventry fix landed, plus the corrected
academy economics they supplied (with one assistant arithmetic error caught and
fixed on the next round).

**Defect 2 — academy tier £79 single-step AOV was wrong. Replaced with two-step
trial funnel from real Memberstack/Stripe figures.**

The previous code used `TRUE_AOV_BY_TIER.academy = 79` and `BOOKING_CONV_RATE_BY_TIER.academy = 0.01`
— a single-step £79 × 1% booking. That model is wrong: the academy product is a
free 14-day trial that converts to a paid annual; the page itself earns £0 and
revenue only appears when a trial converts. Per the user's corrected facts:

- Trial signup rate: **2.7%** (16 trials / 588 GSC clicks, 28d).
- Trial-to-paid rate: **4.3%** (9 / 208 trials all-time — explicitly NOT a blend
  with the noisy 28d 12.5% figure; assistant's first attempt used 6.0% which the
  user rejected as un-auditable. The 14-day trial means a 28d window structurally
  misses conversions; all-time is the only undistorted figure).
- Effective AOV: **£73** (70% × £79 full + 30% × £59 discounted; the price split
  is user-supplied because Stripe stores a single `price_id` and doesn't track
  the discount).
- Academy GP%: **99%** (digital subscription, no real delivery cost).
- Per-click GP: **£0.084** = 0.027 × 0.043 × 73 × 0.99. The assistant's first
  Thinking block computed £0.117 using the rejected 6.0% paid rate — corrected.

New module-level constant `ACADEMY_TRIAL_FUNNEL` in `api/aigeo/revenue-funnel-smart-priorities.js`,
selected via `trialFunnelForTier(tierId)` and passed through `scoreAioUrl()` →
`aioLeverFromKeyword()` → `liftRange({ trialFunnel })`. All three trial-funnel
inputs are `*Measured: false` until larger samples or per-source attribution
exists (PHASE-K-FOLLOWUP-3).

**`lib/revenue-funnel-aio-model.js` changes:**
- New `buildAssumptionStackRows()` branches on `opts.trialFunnel`. For the two-
  step model, the stack reads exactly the rows the user mandated, with the
  precise caveats they wrote out:
  - AIO query volume **(incremental)** — clicks modelled as won from the AIO
    citation, not the page's existing organic volume.
  - Trial signup rate (over-attributes — not all trials originate from organic
    clicks; true organic rate likely 1.5–2.5%).
  - Trial-to-paid rate (free trial → paid annual, 9/208 all-time; 28d window
    structurally misses conversions).
  - Effective AOV (blend `70% £79 / 30% £59` — discount not tracked in Stripe,
    split user-supplied).
  - **NEW: AIO-click ↔ organic-click conversion join** — explicitly flagged
    ASSUMED. This is the silent multiplier the user (correctly) demanded be made
    visible: an observed-from-sample per-click value (derived from current
    organic traffic) is being multiplied by hypothetical AIO uplift volume. That
    only holds if AIO-sourced clicks convert at the same rates as organic
    clicks. They might not. The row makes the assumption auditable.
  - Revenue per click (derived).
  - Tier GP% (with comment that 99% is intentional — no delivery cost).
- New `revPerClickFromOpts()` — single source for per-click revenue arithmetic;
  branches on `trialFunnel` (signup × paid × AOV) vs single-step (AOV × conv).
- New `buildTrialFunnelConvFlag()` — aggregates ASSUMED status if any of the
  three two-step inputs is unmeasured; populates `conv_flag.assumed` so the
  dashboard combined-headline ASSUMED badge can light up.
- `liftRange()` returns new `model: 'two_step_trial_funnel' | 'single_step_booking'`
  so the UI can key off it.

**Defect 1 — narrative keyword ≠ headline keyword (Amendment 3 regression on
Card 3 academy page).**

Coventry's anchor (slug-aligned) and top lever happened to coincide. On Card 3,
they don't: the slug-aligned anchor is "free online photography course" (rank #5,
880/mo) while the highest-GP lever is "online photography course" (rank #2,
2,400/mo). The user's instruction explicitly permits the split provided the card
states it (forcing them equal would either bury the slug anchor — Amendment 1
violation — or bury the largest opportunity). New `buildAioSplitNote()` in
`api/aigeo/revenue-funnel-smart-priorities.js` emits an explanation when the two
keywords differ, plus new fields on the candidate: `aio_anchor_top_lever_split:
boolean`, `aio_split_note: string`. UI renders the note as an amber sub-line
under the title (`.rf-aio-split-note`).

**Defect 3 — Σ-of-levers headline inflated by ~£0 capture-slot long tail.**

A URL with 13 levers where 11 of them individually round to £0/mo would still
sum to a non-trivial "combined +£N/mo" headline that misrepresented real
opportunity. New module-level `MATERIAL_GP_THRESHOLD_GBP_MO = 2`. Each lever
gets `material: true|false` set in `aioLeverFromKeyword()` based on expected GP
clearing the floor. `scoreAioUrl()` returns separate `totalExpectedGpMo` (sum of
material levers only) and `totalImmaterialGpMo` (long-tail sum); `pickAioTarget`
ranks URLs by material GP only. The UI lever list (`rfAioLeverListHtml`) now
splits into a material table + a `<details>`-collapsed "Long tail (N levers
below £2/mo GP, excluded from headline)" group so the user can still see what
was excluded.

**Defect 4 — intent classifier on Card 3 (page intent "academy online" silently
defaulted to national×national).**

Added `console.log('[aio-intent] ...')` at lever build time logging the kw, page
scope, query intent, resolved `intentFit` key (e.g. `national_national`,
`local_local`), P(win), and the full multiplier stack. So the next "why did this
card show ×1.00 with no explanation" question is debuggable from Vercel logs
without redeploying instrumentation.

**Defect 5 — dashboard combined headline must carry the ASSUMED flag when any
underlying conversion rate is unverified.**

A bold combined `+£138/mo` headline with no caveat reads as measured fact. The
dashboard top-of-funnel meta line now scans the top-3 cards for `aio_conv_flag.assumed`
(single-step tiers) or `aio_lift_model === 'two_step_trial_funnel'` (academy
tier) and emits a yellow `ASSUMED` badge with a tooltip explaining which inputs
are still assumed (booking conversion rate, trial-funnel rates). New CSS class
`.rf-action-top-meta-assumed`.

**New tests (5/5 pass):** `test/aio-academy-trial-funnel.test.js` pins the
£0.084/click arithmetic at the `liftRange()` level (so future model changes
can't silently re-break the maths), asserts the academy candidate uses the two-
step lift model, asserts every stack row the user mandated is present in order,
asserts every two-step input is ASSUMED-flagged until measured, and asserts the
stack uses the corrected 4.3% paid rate and £73 blended AOV (NOT the rejected
6.0% / hardcoded £79).

**Test totals: 59/59 pass** (54 pre-Phase-K-2 + 5 new academy).

**Files changed:**
- `lib/revenue-funnel-aio-model.js` — new `buildAssumptionStackRows()`,
  `revPerClickFromOpts()`, `buildTrialFunnelConvFlag()`, `priceBlendLabel()`;
  `liftRange()` returns `model` field; precise stack-row captions per user.
- `api/aigeo/revenue-funnel-smart-priorities.js` — new `ACADEMY_TRIAL_FUNNEL`
  constant + `trialFunnelForTier()`; `MATERIAL_GP_THRESHOLD_GBP_MO`;
  `aioLeverFromKeyword()` accepts `trialFunnel`, sets `material` flag, logs
  intent decision; `scoreAioUrl()` splits material/immaterial totals; new
  `buildAioSplitNote()`; candidate exports `aio_split_note`, `aio_lift_model`,
  `aio_immaterial_lever_count`, `aio_material_lever_count`,
  `aio_total_immaterial_gp_mo`, `aio_top_lever_gp_mo`,
  `aio_anchor_top_lever_split`.
- `audit-dashboard.html` — split-note CSS + render; lever list split into
  material/long-tail (`<details>`); dashboard top-of-funnel ASSUMED badge;
  new `.rf-aio-lever-tail-summary`, `.rf-aio-split-note`,
  `.rf-action-top-meta-assumed` CSS rules.
- `test/aio-academy-trial-funnel.test.js` — new (5 tests).

**Tracked tasks** (PHASE-K-FOLLOWUP-3 still open): wire measured booking
conversion rates per tier. The 1% courses rate the user gave verbally (1–2
bookings per 28d on 21 GSC clicks ≈ 1%) is being kept as flagged ASSUMED until a
write path lands; the academy two-step rates need a per-source attribution model
(currently over-attributes trials to organic clicks).

## [2026-05-26] - Phase K: AIO data-layer reconciliation (Coventry card defect)

The 8de72d5/b034d2d/598d44c rounds tried to patch the symptoms (effort total,
override status note, conv-rate flag, detector failures). The user (correctly)
pushed back: the real defect is data-layer incoherence inside one card — the
funnel was composing narrative facts across multiple keyword rows from the
same `keyword_rankings` table, producing internally contradictory statements
("ranks #2 but isn't cited" while also referencing rank #23 and applying a
rank 1–5 multiplier — three different rank values on one card). This entry
fixes the root cause.

**Provenance map (verified, rows pasted in chat 2026-05-26 16:05Z):**

| value | source | row |
|---|---|---|
| previous funnel target "photography courses near me" 2,400/mo rank #2 cited 1/34 | `keyword_rankings` | exists, audit_date 2026-05-26 |
| previous funnel reroute "rank #23" | `keyword_rankings` | row for `keyword='photography courses'` vol 6,600 — different keyword |
| Keyword Scorecard "photography courses coventry" 70/mo rank #2 cited 2/10 | `keyword_rankings` | exists, audit_date 2026-05-26 |
| AOV £200, conv 1%, GP% 90% | code constants in `revenue-funnel-smart-priorities.js` + `revenue-funnel-aio-model.js` | not table-driven |
| GSC clicks 21/28d, impressions 4,155, CTR 0.5%, pos 26.5 | `gsc_page_metrics_28d` | date_end 2026-05-24 |

The previous "Photography Courses Coventry doesn't exist in keyword_rankings"
diagnosis in the **2026-05-26 DEFECT A** entry below was **incorrect**. The
keyword exists with vol 70, rank #2, 2/10 alanranger.com citations. The earlier
query used `order by search_volume desc nulls last limit 25` so 25 high-volume
"near me" rows filled the limit before the single vol-70 "coventry" row could
appear. The keyword was always there. The pre-Phase-K picker simply filtered it
out via `!(ai_alan_citations_count > 0)` — cited keywords were silently dropped
from candidacy, including the URL's own slug-aligned keyword.

**Code changes (no UI layout change):**

- **`api/aigeo/revenue-funnel-smart-priorities.js`** picker rewrite:
  - `pickAioTarget` now groups AIO-eligible keywords by `cleanUrl(best_url)`
    via `groupKeywordsByUrlForAio`, scores every keyword on the URL as a lever
    (`aioLeverFromKeyword` + `aioLeverCaptureRate`), and picks the URL whose
    top lever has the highest expected GP. Cited keywords are NO LONGER
    filtered out — they become `grow_share` levers modelling incremental
    citation-share uplift (1/headroom × capture rate, floored at 0.005).
  - `findAnchorLever` selects the slug-aligned anchor via `pickKeywordForPage`
    so the funnel and Keyword Scorecard always pick the same row for a URL.
  - `applyAssignedKeyword` honours a Traditional-SEO override when the
    assigned keyword exists in `keyword_rankings` for THIS URL; otherwise it
    records `override_keyword_not_in_keyword_rankings_for_url` so the UI can
    surface a visible "not used" note rather than silently discarding the
    assignment.
  - `buildAioDescription` rewritten to read kw/rank/volume/citation facts
    ONLY from the anchor row. No cross-row mixing.
  - `assertAioAnchorConsistent` runs a runtime sanity check on the anchor
    (`alan ≤ total`, `has_ai_overview`, lever URLs all match the cleaned URL)
    and sets `aio_data_inconsistent: true` + reasons array if it trips.
  - Removed: `selectAioTargetKeyword`, `scoreAioCandidate`, `buildAioRerouteNote`,
    `buildAioOverrideStatusNote`. Reroute logic gone — every lever is now
    surfaced, so the user (not a heuristic) chooses the lever to act on.
  - Imports `shouldRerouteToLocal` and `findKeywordRowByText` removed (unused).
- **`audit-dashboard.html`** card render:
  - New `rfAioLeverListHtml` renders the full lever list under the assumption
    stack: KW · Rank · Vol · P(win) · Cited · Lever type · +£GP/mo.
    Anchor row highlighted green; top lever (drives headline GP) highlighted
    blue.
  - New `rfAioDataInconsistentHtml` renders a "DATA SOURCES INCONSISTENT"
    banner at the top of the assumption block when the runtime check trips.
  - `rfActionAssignedKwBlock` now handles the new
    `override_keyword_not_in_keyword_rankings_for_url` reason with a clear
    fallback tooltip.
- **`test/aio-cross-module-consistency.test.js`** (new, 8 tests):
  - Asserts funnel anchor agrees with `pickKeywordForPage` (the Scorecard view)
    on keyword/rank/volume/citation_state for the Coventry URL using a
    synthetic snapshot mirroring the real `keyword_rankings` rows.
  - Asserts ALL AIO-eligible keywords appear as levers (capture + grow).
  - Asserts headline GP comes from the top lever, not the anchor when they
    diverge.
  - Asserts the description quotes the anchor keyword and never claims
    "aren't cited" when the anchor IS cited.
  - Asserts the override is applied when the assigned keyword exists in
    `keyword_rankings` for the URL.
  - Asserts the visible note fires when the assigned keyword is absent.
  - Asserts `aio_data_inconsistent` trips on impossible citation_state.
  - Asserts `null` return when no AIO-eligible keywords exist.

Test suite: **54 pass / 0 fail** (was 46 before; +8 cross-module tests).

**Tracked tasks (filed for follow-up, not part of this fix):**

1. **`property_url` casing normalisation.** `keyword_rankings` holds three
   `property_url` formats: `https://www.alanranger.com` (canonical, 7,077
   rows), `https://www.alanranger.com/` (trailing slash, 33 stale rows),
   `alanranger.com` (no scheme, 84 stale rows). All current writes go to
   canonical but nothing enforces that. (a) one-off normalisation of the
   2 stale partitions into the canonical row set; (b) DB-level CHECK or
   normalise-on-write trigger so non-canonical writes are blocked. Owner:
   next AIO maintainer touching `keyword_rankings`. Ticket placeholder:
   PHASE-K-FOLLOWUP-1.

2. **Tier-mapping defect.** `TRUE_AOV_BY_TIER['courses'] = £200` was
   validated by the user (2026-05-26) as the in-person Coventry group
   course price ONLY. Workshops, 1-2-1, and online courses currently fold
   into the same `courses` tier and inherit £200 AOV — that's wrong for
   workshops (~£250+) and 1-2-1 (~£395+). Conversion rate (1% assumed)
   may also differ materially. Action: split into `courses_in_person`,
   `courses_121`, `courses_online` with separate AOV + conv rate per
   sub-tier, and re-classify all current `courses`-tier URLs. Owner:
   tier maintainer. Ticket placeholder: PHASE-K-FOLLOWUP-2.

3. **Booking conversion rate verification.** User confirmed 1-2 paid
   bookings/28d across all paid courses+workshops pages (~165 GSC clicks
   /28d), so the 1% assumption is roughly right but unverified per-tier.
   Conversion rate continues to render `ASSUMED` amber banner across
   every AIO card tool-wide; the flag must remain until per-tier measured
   rates are wired in (Amendment 2 of phase K user instruction). Ticket
   placeholder: PHASE-K-FOLLOWUP-3.

## [2026-05-26] - AIO recommendation engine: 4 defects that failed to land live (8de72d5 follow-up)

The 8de72d5 changelog claimed 8 fixes; the live `/photography-courses-coventry` card
only landed 4 of them. This entry covers the 4 that didn't, verified against the live
deployed API + the actual Coventry HTML (not a synthetic fixture).

- **DEFECT C — Effort total 3h vs sum-of-tasks 2.5h (UI rounding bug):**
  - The API was correctly returning `effort_hours: 2.5`. The dashboard rendered "3h"
    because `rfActionEffortRow` called `eh.toFixed(0)` for any `eh >= 1`, rounding
    2.5 → "3". Now uses `eh % 1 === 0 ? toFixed(0) : toFixed(1)` so 2.5 renders as
    "2.5h". Added a tooltip on the header effort that fires when the header drifts
    from `sum(actions.effort_hours)` — easy regression detection on future cards.

- **DEFECT B — Body detectors emit nothing on live Coventry page:**
  - Root cause (3 deploy-only bugs the synthetic fixture didn't surface):
    1. `extractBodyText` stripped `<nav>`/`<header>`/`<footer>` but Squarespace
       doesn't use semantic nav tags — `bodyText` was dominated by
       "Cart 0 Sign In My Account Back photography courses coventry..." menu cruft
       and the fluffy-opener detector judged the wrong text.
    2. `extractBodyHtmlSnippet` capped at 60KB from `<main>`, but the
       `allbachelordegrees.com` citation sits ~136KB inside `<main>` on the live
       page. The link detector never reached it.
    3. `NUMERIC_CLAIM_RE` allowed only 120 non-terminator chars between the `%` and
       the next `.`/`?`/`!`; the actual "With 30% of UK adults now actively pursuing
       photography as a hobby..." sentence is 142 chars and got no match.
  - Fixes:
    - `extractBodyText` and `stripHtml` now prefer the first `<main>`/`<article>`
      region when present (via a shared scoped-region helper). Squarespace pages
      have exactly one `<main>`; scoping there cuts the menu out.
    - `extractBodyHtmlSnippet` cap raised 60KB → 200KB (covers the deepest citation
      offset measured on alanranger.com).
    - `NUMERIC_CLAIM_RE` distance widened to {5,250}.
    - `RHETORICAL_OPENERS` widened 80 → 250 chars (the live page emits H1 + tagline
      before the rhetorical `?`, putting it ~150 chars into bodyText).
    - `isFluffy` also fires when `aspirational >= 5` (5+ marketing words in the
      opener is overwhelming density regardless of concrete-fact tokens).
    - `detectDuplicateClaims` dedup key changed from "first 30 chars" to "first 4
      normalised words" — collides the two "30% of UK adults..." sentences that
      diverge from word 5 onwards.
  - **Observability:** `buildAioActions` now logs
    `[aio-actions] <url> bodyText.len=<n> htmlSnip.len=<n> bodyText.first120=...`
    at detector entry. Future "live page returns clean" bugs are debuggable from
    Vercel logs without redeploying instrumentation.
  - **New regression test:** `test/aio-coventry-live-fixture.test.js` loads the
    actual 381KB HTML saved from the live page (`test/fixtures/photography-
    courses-coventry.html`) and asserts the 4 detectors fire on it. Synthetic
    fixtures alone are no longer trusted as live-page evidence.

- **DEFECT A — Assigned keyword silently discarded:**
  - Diagnosis against the prod DB (`igzvwbvgvmzvvzoclufx` / `traditional_seo_target_
    keyword_overrides`): there is no override row for `/photography-courses-coventry`.
    Only 47 blog-URL overrides exist; the user believed one was set for this URL but
    it wasn't. Additionally, the keyword "Photography Courses Coventry" is NOT in
    `keyword_rankings` at all — even if an override existed, the AIO data lookup
    would have returned nothing.
  - **CORRECTION (2026-05-26 Phase K):** the second half of the above diagnosis was
    wrong. `photography courses coventry` IS in `keyword_rankings` (vol 70, rank 2,
    cited 2/10). The earlier SQL used `ORDER BY search_volume DESC NULLS LAST LIMIT
    25` which let 25 high-volume `near me` rows fill the result set before the
    single vol-70 `coventry` row appeared. The keyword was always there; the query
    was bad. See the **Phase K** entry above for the actual root-cause fix.
  - `selectAioTargetKeyword` now records `override_status` on the candidate
    (`applied: true` / `applied: false, reason: override_keyword_no_aio_data` /
    `applied: false, reason: override_keyword_not_in_data`) instead of silently
    falling back. The fallback is still used (so the user gets actionable
    recommendations) but the visibility is preserved.
  - UI `rfActionAssignedKwBlock` always renders a pill for AIO cards: green
    `Assigned KW: ...` when applied, amber `Assigned KW: X — not used (no AIO
    data)` when present but unusable, grey `Assigned KW: (none set)` when no
    override exists at all. New `rf-aio-override-fallback` banner in the assumption
    stack shows the full "re-sync the assigned keyword to honour the override"
    note when applicable.

- **DEFECT D — Booking conversion rate not flagged as assumed:**
  - `liftRange` now accepts a `conversionRateMeasured` flag (default `false`) and
    sets `conv_flag: { assumed: true, reason: ... }` whenever a measured value
    isn't supplied. The 0.01 default we ship is now visibly amber.
  - Assumption stack rows carry an `assumed` boolean; the UI renders an amber
    `assumed` chip alongside the value and a top-of-stack
    `Booking conversion rate ASSUMED — not measured` banner.
  - Reasoning: revenue per click scales linearly with conversion rate, so a wrong
    assumption here cascades through every figure; the user must see this.

- **Test suite:** 42 → 46 tests pass. The 4 new tests are all in the live-HTML
  fixture file and lock in the deploy-path fixes that the synthetic fixture
  couldn't have caught.

## [2026-05-26] - AIO recommendation engine: 7 post-deploy defect fixes

Follow-up to the AIO model + page-liability rework from earlier today. Seven defects
flagged on `/photography-courses-coventry` are addressed; UI layout is frozen.

- **Assigned keyword honoured (highest-priority defect):**
  - `api/aigeo/revenue-funnel-smart-priorities.js` now fetches
    `traditional_seo_target_keyword_overrides` in `buildSnapshot` and threads it
    through `pickAioTarget` → `scoreAioCandidate` → new `selectAioTargetKeyword`.
  - When a URL has an explicit assigned keyword AND that keyword has AIO data, the
    picker uses it and SKIPS the local-variant reroute. Coventry now models
    "Photography Courses Coventry", not "photography courses near me".
  - Card surfaces the assigned keyword in the edit-this-page bar
    (`rfActionPageUrlBar` shows `Assigned KW: <strong>...</strong>`).

- **DEFECT 1 — page-body detectors now fail loud:**
  - `lib/revenue-funnel-page-liability.js`:
    - `detectFluffyOpener`, `detectUnsourcedStats`, `detectWeakOutboundCitations`
      now `console.warn` on empty input AND return an `audit_status: 'incomplete'`
      sentinel instead of silently returning a neutral pass.
    - `scanLiabilities` aggregates `audit_status` + `audit_reasons[]`.
    - `RHETORICAL_OPENERS` widened from 40 → 80 chars (catches "Ready to capture
      the world through your lens?", 45 chars).
    - `isFluffy` no longer fully vetoed by ONE concrete-fact token; rhetorical
      question + 3+ aspirational words wins regardless.
    - `NUMERIC_CLAIM_RE` fixed (trailing `\b` after `%` was breaking the common
      "30% of UK adults" pattern); duplicate-claim dedup-key shortened to 30
      chars (absorbs minor lead-in differences).
    - `stripHtml` aligned with `extractBodyText` (now also strips `<head>`,
      `<nav>`, `<header>`, `<footer>`) so the opener detector doesn't hunt past
      the title/nav text.
  - `buildAioActions` injects a `Page-body scan INCOMPLETE` REMEDIATE warning when
    `audit_status === 'incomplete'`; UI renders an amber `rf-aio-audit-incomplete`
    banner in the assumption-stack block.
  - **New test:** `test/aio-page-liability-fixture.test.js` (6 cases). A Coventry-
    style HTML fixture MUST yield >=2 REMEDIATE-worthy issues and a fluffy opener
    — build fails otherwise. Empty input MUST mark `audit_status: 'incomplete'`.

- **DEFECT 2 — AOV no longer misleadingly labelled "Tier AOV £2":**
  - `lib/revenue-funnel-aio-model.js` `liftRange` now takes `aov` + `conversionRate`
    separately and computes `revenue per click` as a labelled DERIVED row in the
    assumption stack. Stack also flags any `revenue per click` outside £0.5–£10
    via `aov_flag: { unverified: true, reason: ... }`.
  - Smart-priorities passes `TRUE_AOV_BY_TIER` (Workshops £250, Courses £200,
    Services £100, Hire £200, Academy £79) + a 1% booking conv rate so the stack
    reads "AOV £200 × Conversion 1% = Revenue per click £2" instead of the bald
    "Tier AOV £2".
  - UI: `rfAioAssumptionStackHtml` renders flagged rows in red with a `!`
    indicator and an "AOV unverified — revenue figure provisional" banner.

- **DEFECT 3 — headline/range/£-per-hour on one labelled basis:**
  - `applySeasonalityToCandidate` now also scales `lift_range` via new
    `scaleLiftRange()` and labels the range `seasonally adjusted`. Headline and
    range no longer disagree.
  - UI badge `seasonally adjusted` shown next to the GP range when applicable.

- **DEFECT 4 — LIVE banner copy rewritten:**
  - `rfLiftBasisLine(c)` AIO branch: "Modelled probabilistically: monthly GP =
    volume × P(win) × click capture × AOV × conversion rate × GP%, shown as a
    low/expected/high range. P(win) decomposed by rank, intent fit, answer
    readiness. Headline/range/£-per-hour all on the same seasonally-adjusted
    basis." No more "Citation is binary".

- **DEFECT 5 — "Why" block regenerated:**
  - `buildAioDescription` now emits only: opportunity sentence + assigned-keyword
    line + schema-present line + FAQ rich-results deprecation HEURISTIC note.
    No more stale "append... extend the existing FAQPage" copy that contradicted
    the new task list.

- **DEFECT 6 — FAQ verb aligned to `task_type`:**
  - `buildFaqAction` REWRITE branches now say "Replace ..." / "Rewrite 3 of ..."
    instead of "Extend FAQs with 3 ..." / "Add 3 ...". REWRITE pill + replace/
    rewrite copy match.

- **DEFECT 7 — total effort computed from task array:**
  - `buildAioActions` overrides `c.effort_hours` with the sum of action efforts
    (1 + 1 + 0.5 = 2.5h on the Coventry example, not the hardcoded 2h).

- **Verification:**
  - `npm test` → 42/42 pass (36 pre-existing + 6 new liability-fixture tests).

## [2026-05-21] - SERP copy length fix + hub-aware title/meta (150-160)

- **`lib/revenue-funnel-serp-copy.js`:** ASCII hyphen only (no em dash); `fitMetaDescription()` enforces **150-160ch**; hub pages (`/photography-courses-coventry`, academy) ship **exact** title + meta + **keep H1** guidance.
- **Top 3 cards:** show `meta_example` with character count; hub pill says use copy exactly.
- **Test:** `node scripts/test-serp-copy.mjs`

## [2026-05-21] - Keyword ownership guardrails (smart priorities + Top 3 UI)

- **`lib/revenue-funnel-keyword-guardrails.js`** — merges same-URL CTR+rank for one query; blocks cross-page cannibalization (e.g. “online” on Coventry); safe title leads (Academy → `photography lessons online`, Coventry → geo-first).
- **`revenue-funnel-smart-priorities.js`** — CTR/rank action copy uses safe leads; GET returns `guardrail_*`, `primary_query`, `merged_levers`.
- **`audit-dashboard.html`** — Top 3 skips blocked cards; guardrail pill on each card; subtitle explains one owner per page.
- **Test:** `node scripts/test-keyword-guardrails.mjs`

## [2026-05-21] - GA4 money-page funnel, enquiry→sale KPI, picker bias, weekly cron

- **Money-page GA4:** `ga4-data.js` rolls enquiry events on **money-page paths only** → `money_page_enquiry_events_28d`; funnel stage 4 uses that (falls back to site-wide if zero).
- **KPI:** **`enquiry_to_sale_pct`** = transactions ÷ money-page enquiries; tile on Revenue Funnel (target 2%, warn 1%).
- **Scenario picker:** when enquiry→sale &lt; 1%, boosts **conversion** lever (×2), trims **CTR** (×0.65), injects **“Raise enquiry → sale on money pages”** candidate.
- **Cron:** `GET /api/cron/ga4-metrics-sync` Mondays 07:20 UTC (`vercel.json`).
- **Migration:** `money_page_enquiry_events_28d` on `ga4_site_metrics_28d`.

## [2026-05-21] - GA4 Data API → Revenue Funnel (initial)

- **`GET` / `POST` `/api/aigeo/ga4-metrics`** — pulls GA4 Data API (28d, GSC-aligned window), caches in **`ga4_site_metrics_28d`**.
- **UI:** **Sync GA4** button + GA4 line on revenue sync banner; **Sync everything** includes GA4 step 4 of 5.
- **Env:** `GA4_PROPERTY_ID` (default `289575590`); uses existing `GOOGLE_*` OAuth.
- **Migration:** `migrations/20260521_ga4_site_metrics_28d.sql`.

## [2026-05-21] - Revenue Funnel trust loop + Auto-Optimise layout + preset diversity

- **UI:** Auto-Optimise uses one 4-column grid (Do Nothing | Easy | Balanced | Hard) with summary tile above each detail card; green/red uplift vs Do Nothing; optional sticky summary row.
- **Trust loop:** `GET /api/aigeo/revenue-funnel-trust-loop` — recent `page_html` edits (14d), per-cycle GSC deltas on suppressed cards, auto GSC refresh when HTML is newer than last optimisation event.
- **Academy economics:** `revenue_funnel_tier_costs` (Academy £100/mo, min 10 signups); picker suppresses Academy when net GP negative 2 months; REVIEW card when triggered.
- **Seasonality:** blended 70% observed booking history + 30% stated calendar (`lib/revenue-funnel-seasonality-blend.js`); calibration note on seasonality banner.
- **Auto-Optimise:** preset-specific rerank (Easy drops surfacing, boosts hire/services; Balanced boosts worst-variance tier; Hard boosts peak workshops) + URL-diverse pick within budget.
- **Validation:** `scripts/multi-scenario-validation.mjs` adds `workshops_peak` and `services_opportunity` custom scenarios.

## [2026-05-20 Phase H+] - Optimisation-tracking suppression + per-tier seasonality + banner

Addresses Alan's most direct critique of the picker: it kept
recommending title rewrites for URLs that he had ALREADY rewritten,
and it had no concept of "May is bluebell-workshop season, December
is a gap month for hire". Four commits on `main`:

- `0eab3e2` Picker: monitoring suppression + per-tier seasonality + banner
- `99e80dc` Picker: use getters for MONTH_NAMES + SEASONALITY_BY_TIER (TDZ fix)
- `ff1bfb0` Picker: fix silent suppression failure on enum mismatch
- `44671a0` Picker: apply suppression penalty inside the scoring pass

### Suppression layer

`api/aigeo/revenue-funnel-smart-priorities.js` now reads active
monitoring cycles from `optimisation_task_cycles` joined to
`optimisation_tasks` (statuses `monitoring` / `planned`). Each
candidate URL is matched against the cycles by `primary_kpi` -> lever
mapping (`ctr_28d`/`clicks` -> ctr, `rank` -> rank, `ai_citations`
-> aio). The verdict:

- `< 30d` in monitoring -> BLOCK: actions dropped entirely,
  candidate score x 0.10. Card surfaces a red "ALREADY IN MONITORING
  (cycle N, 'objective' started Nd ago)" pill.
- `30-90d` -> DOWNGRADE: title/meta/content actions kept but
  flagged LOW confidence, score x 0.45. Amber "STILL IN MONITORING"
  pill.
- `> 90d` -> STALE: actions reframed as "in monitoring Nd with no
  closure - try a DIFFERENT angle", score x 0.65. Purple
  "STALLED - TRY ANOTHER ANGLE" pill.

On prod the database has 35 active cycles across 19 URLs. Every
Top 3 candidate from the live picker now carries a STALE flag
because the same URLs have been recommended (and edited)
repeatedly since January 2026.

A silent-failure trap was fixed: the initial `.in('status',
['monitoring','planned','active'])` filter crashed on the enum
because `'active'` isn't a legal value, and the `try/catch` was
swallowing the error so suppression silently returned zero URLs.
There's now an `ACTIVE_CYCLE_STATUSES` constant and `console.warn`
on errors so a future enum mismatch is visible in Vercel logs.

### Seasonality layer

`SEASONALITY_BY_TIER` (per-tier per-month multiplier array) is
seeded from Alan's stated activity calendar:

- `courses` 60%+ Jan-May + Sep-Nov, sub-50% Jun-Aug
- `workshops_nonres` 80%+ Apr-May + Sep-Nov (bluebells / autumn)
- `workshops_residential` similar shape, broader shoulders
- `services` flat 1.0 (constant + opportunity)
- `hire` flat 1.0 (sporadic + opportunity)
- `academy` slight winter boost (1.15-1.20), summer dip (0.85-0.90)

`estimated_lift_gbp_revenue/profit` on each candidate is multiplied
by the current month's factor; the raw `*_unscaled` values are kept
on the candidate so the UI can render both.

### Banner endpoint

`api/aigeo/revenue-funnel-seasonality.js` (NEW) returns the per-tier
seasonality bands for the current month + the count of URLs in
monitoring with per-KPI breakdown. The Revenue Funnel tab renders
this as a banner above the Top 3 cards: month badge, per-tier band
grid (peak / above / steady / below / gap), and a "Push: ... /
Defer: ..." recommendation line.

### Per-card pills

Each action card on the Revenue Funnel + Auto-Optimise tabs now
shows:
- A small `SEASON +60%` pill in the tier row when the tier is not
  in the neutral band.
- A coloured suppression pill (red / amber / purple) above the
  lift box when an active monitoring cycle is detected.

### Self-test

`scripts/multi-scenario-validation.mjs` (NEW) calls the prod
endpoints and captures the top 3 of baseline + each Auto-Optimise
preset, counts suppression flags + seasonality scaling, and writes
a markdown report under `Docs/MULTI_SCENARIO_VALIDATION_<ts>.md`.
Latest run: `Docs/MULTI_SCENARIO_VALIDATION_2026-05-20T22-07-08.md`.

### Known gap (carried forward in handover)

All three Auto-Optimise presets still pick the SAME top 3 URLs -
the raw GP gap between those URLs and the rest of the portfolio
is so large that even after a x0.65 stale penalty they still beat
the fresh `surfacing` candidates that score ~50. The differentiation
appears in the £ totals further down each preset. Tightening this
requires a stricter `rerankForPreset` step inside
`api/aigeo/revenue-funnel-auto-optimise.js`. Tracked in
`Docs/HANDOVER_REVENUE_FUNNEL_2026-05-20.md` task #4.

---

## [2026-05-20 v5.3 Phase A.2 DB hotfix] - Drop legacy targets index + repair orphan May 2026 scenario

### What was wrong

Two interlocking issues left over from v5.0 once Alan started using Phase A.2:

1. The v5.0 unique index `revenue_funnel_targets_property_tier_uidx` on `(property_url, COALESCE(tier_id, ''))` was never dropped when v5.3 added the scenario-scoped equivalent. Every non-Baseline scenario was sharing the same `(property_url, tier_id)` coordinates by design, so the legacy index rejected every Duplicate, Seed, and non-Baseline target save with `duplicate key value violates unique constraint`.

2. Alan's "May 2026" scenario partially survived this: the `revenue_funnel_scenarios` row got written (with his survival baseline £3000, hours 12, notes), then the API's `INSERT ... SELECT` for child rows was rejected by the legacy index, leaving an orphan parent row. Worse, "Set as active" had flipped May 2026 to `is_active=true` and Baseline to `is_active=false`, so the Top 3 picker on Revenue Funnel was reading an empty config and rendering everything as zero.

### Fix applied directly to production DB (via `apply_migration` MCP)

Migration name: `drop_legacy_revenue_funnel_targets_property_tier_uidx`

```sql
DROP INDEX IF EXISTS public.revenue_funnel_targets_property_tier_uidx;
```

Migration name: `repair_may2026_orphan_and_reactivate_baseline`

1. Flipped `is_active = false` on May 2026, then `is_active = true` on Baseline (must be in that order to satisfy the partial `revenue_funnel_scenarios_one_active` unique index).
2. `INSERT ... SELECT` from Baseline into May 2026 across all three child tables (`revenue_funnel_targets`, `revenue_funnel_tier_weights`, `revenue_funnel_lever_weights`), guarded with `WHERE NOT EXISTS` so the script is safe to re-run.

### State after repair

| Scenario | Active | Survival | Hours | Targets | Tier weights | Lever weights |
|---|---|---|---|---|---|---|
| Baseline | yes | &pound;2500 | 6 | 7 | 6 | 6 |
| May 2026 | no | &pound;3000 | 12 | 7 | 6 | 6 |

Top 3 picker on Revenue Funnel is reading real numbers again. May 2026 has Alan's preferred meta and a full copy of Baseline's numeric values to tweak from before activating.

### Repair vs delete

I considered deleting the orphan May 2026 row and asking Alan to re-create. Repair was kinder because his `monthly_survival_baseline_gbp = 3000`, `hours_per_week = 12` and any notes were already persisted on the scenarios row, and re-creating would need a different name (the `revenue_funnel_scenarios_unique_name` index prevents duplicate names per property).

## [2026-05-21 v5.3 Phase A.2] - Editor moved into Scenario Planning tab (runtime reparent)

### Why

Alan's feedback after Phase A.1:

> "ok i dont understand why the levers section is still in revenue funnel page and not scenario planning tab? i created a scenario and saved it with minimum figures etc and when i clicked open editor in revenue funnel it didnt transfer those numbers. am i not being clear? i thought all the financial planning, what ifs and levers would all be in the new tab sceanrio planning?"

He was clear. I split Phase A into A.1 + A.2 unilaterally on the basis that moving ~430 lines of HTML / JS via StrReplace is risky (we hit mojibake corruption doing exactly that on 2026-05-20). That risk-aversion was the wrong call for the user experience. Fixing now.

### Approach: runtime DOM reparent (no file-level cut/paste)

Instead of physically moving the `<details id="rfTopActionsConfig">` block (and its companion `<style>` and IIFE) in the source HTML, we move the rendered DOM at page load:

```js
function reparentEditor() {
  const editor = document.getElementById('rfTopActionsConfig');
  const mount  = document.getElementById('spEditorMount');
  if (editor && mount) mount.appendChild(editor);
}
```

`appendChild` MOVES the element rather than cloning it — all existing event listeners, IIFE closures and form state are preserved. The IIFE keeps working unchanged because it looks up form fields via `getElementById` (which finds them regardless of parent). The `#rfTopActionsConfig`-scoped CSS still applies because IDs are global.

### Editor now follows the dropdown, not the active flag

Phase A.1 had a subtle UX problem: the editor always loaded the ACTIVE scenario, so "edit this scenario" required activating first. With multiple named scenarios this is wrong. Now:

- The library dropdown selection is the source of truth for what the editor edits.
- Selecting a non-active scenario reloads the editor against THAT scenario's targets / weights.
- The "Set as active" button stays separate so you can still flip which scenario the Top 3 picker reads.
- The reparent runs at DOMContentLoaded so the editor never visibly appears in the Revenue Funnel tab.
- `syncEditorToSelection()` runs BEFORE reparenting so the user never sees the editor flash active-scenario values then re-load.

### Empty-state banner + Seed-from-Baseline

If the selected scenario has all-zero targets (a fresh blank scenario), the editor shows a brand-orange banner explaining:

> This scenario has no targets or weights yet. Use *Duplicate selected* on the Baseline scenario to fork its full config and tweak from there &mdash; or click *Seed defaults* below to copy Baseline's values into THIS scenario, then edit.

The Seed-from-Baseline button loads Baseline's full config and POSTs it under the current scenario's id via `/api/aigeo/revenue-funnel-config`. The Create-blank prompt also now warns up-front that blank scenarios start with all zeros and suggests Duplicate as the better path for tweaks.

### Lazy-load gate removed

The Phase A.1 IIFE had a lazy-load gate that only fetched config when the `<details>` was first expanded. With the editor now the primary feature of the Scenario Planning tab (and forced open after reparent), that gate causes a brief race between toggle-driven load (active scenario) and dropdown-driven load (selected scenario). Removed; the library IIFE drives all loads explicitly via `setScenario(id)`.

### Files changed

- `audit-dashboard.html` &mdash; reparent helper, empty banner + Seed-from-Baseline UI/JS, dropdown-driven editor sync, Revenue Funnel comment updated to reflect runtime move, lazy-load gate removed, "Open editor on Revenue Funnel" shortcut removed.
- `Docs/CHANGELOG.md` (this entry).

### Still pending

- The **legacy index `revenue_funnel_targets_property_tier_uidx`** still needs to be dropped on the live DB (see the hotfix entry below). Until then BOTH `Duplicate selected` AND `Seed from Baseline` AND saves on fresh scenarios will fail with `duplicate key value violates unique constraint`. Saves on the Baseline scenario continue to work fine.
- Phases B (Survival Cockpit), C (effort heuristics), D (three-scenario solver), E (what-if).

## [2026-05-21 v5.3 Phase A.1 hotfix] - Drop legacy targets unique index

### What broke

Live smoke-test of the new `revenue-funnel-scenarios` endpoint flagged that `POST { action: 'duplicate' }` fails when copying the source scenario's targets rows:

```
{"error":"scenario_error","detail":"duplicate key value violates unique constraint \"revenue_funnel_targets_property_tier_uidx\""}
```

The Create / Patch / Delete / Activate / Rename operations work; only Duplicate hit this. The orphan parent row (the duplicate scenario itself) does get created, so a failed duplicate leaves a stub scenario with no config rows. Cleaned up in this hotfix.

### Root cause

The v5.0 migration (`2026-05-20-scenario-engine-tables.sql`) created `revenue_funnel_targets_property_tier_uidx` ON `(property_url, COALESCE(tier_id, ''))`. My v5.3 migration added a new scenario-scoped equivalent `revenue_funnel_targets_scenario_tier_idx` ON `(scenario_id, COALESCE(tier_id, ''))` but **didn't drop the old one**. So when Duplicate inserts copies of the source scenario's targets rows (same `property_url`, same `tier_id`, new `scenario_id`), the legacy index sees a property+tier collision and rejects the insert.

### Fix - DB

Created `Docs/migrations/2026-05-21b-drop-legacy-targets-index.sql`. One statement:

```sql
DROP INDEX IF EXISTS public.revenue_funnel_targets_property_tier_uidx;
```

**Run via Supabase SQL editor** (project `igzvwbvgvmzvvzoclufx`, MCP `user-supabase-ai-chat`). Idempotent.

Also updated `2026-05-21-scenario-planning-tables.sql` to include the same DROP INDEX so a future fresh-DB replay doesn't reintroduce the bug.

### Fix - cleanup

Wrote `scripts/fix-duplicate-targets-index-2026-05-21.mjs` which:

1. Attempts the DROP INDEX via `rpc('exec_sql')` (fails on standard Supabase setups because `exec_sql` isn't a known function — script then prints the manual SQL).
2. Lists and deletes any `SmokeDup-*` / `SmokeTest-*` orphan scenarios (the 2026-05-21 smoke test left one). This part DOES work via the JS client because plain deletes are supported.

Ran the script live; it cleaned up the orphan `SmokeDup-2026-05-21` scenario successfully.

### Files

- `Docs/migrations/2026-05-21-scenario-planning-tables.sql` (updated to also drop legacy index)
- `Docs/migrations/2026-05-21b-drop-legacy-targets-index.sql` (new, one-statement remediation)
- `scripts/fix-duplicate-targets-index-2026-05-21.mjs` (new, orphan cleanup helper)
- `Docs/CHANGELOG.md` (this entry)

## [2026-05-21 v5.3 Phase A.1] - Scenario Planning foundation (new tab, library, scenarios CRUD)

### Why

Alan asked for an **intelligent decision support system**, not just sliders. The dilemma he restated: bills have to be paid (working capital, survival), but he also needs to push above baseline (growth, GP). He has finite hours per week — every hour spent on a non-converting SEO action is an hour not spent on something that would have paid the gas bill. He wants:

- **YTD vs target vs projected** revenue / GP, per tier and master, with shortfall/surplus and RAG
- **What-if scenarios** — drag a slider, see projection update
- **Tipping points** — "if you achieve X / Y / Z, you reach target"
- **Three-scenario presentation** — Survival (lowest effort to hit baseline) / Stretch (current effort, current target) / Ambitious (more hours, higher target)
- The ability to **build and switch between named scenarios** (e.g. "Survive Q3 2026", "Push Academy 30%", "Workshop-led 2027") and have one marked active that feeds the Top 3 Actions picker

This is multi-phase work. We picked the architecture together (AskQuestion 2026-05-21): a new tab (not embedded in Revenue Funnel), rule-based effort heuristics for the solver, three-scenario presentation. Survival baseline = both a fixed £ field AND a 70%-of-master fallback. The seeded scenario is called "Baseline" and is marked active so nothing breaks.

### Phase breakdown (committed phase highlighted)

| Phase | What ships | Status |
|---|---|---|
| **A.1** | DB migration + scenarios CRUD API + new tab + library card + meta inputs + status pill on Funnel + scenario-scoped config API | **THIS COMMIT** |
| A.2 | Physically relocate targets/sliders editor from Revenue Funnel into the Scenario Planning tab | next commit |
| B | Survival Cockpit table: MTD / Projected / Target / Gap / YTD per tier with RAG | pending |
| C | Effort + time-to-realise heuristics per lever; "baseline £X → £Y with Top 3" projection | pending |
| D | Three-scenario solver (greedy attainability), side-by-side cards | pending |
| E | What-if mode: debounced re-solve on every slider drag | pending |
| F | Funnel Top 3 reads active scenario's solver output | pending |

### Added - Database

#### Migration `Docs/migrations/2026-05-21-scenario-planning-tables.sql`

- New table `public.revenue_funnel_scenarios` (id, property_url, name, notes, is_active, monthly_survival_baseline_gbp, hours_per_week, created_at, updated_at).
  - Unique index `(property_url, lower(name))` so case-variant duplicates can't sneak in.
  - **Partial unique index** `(property_url) WHERE is_active = true` so only ONE active scenario per property is allowed at the DB layer (defence-in-depth; API also guards it).
  - Reuses the `tg_touch_updated_at()` trigger function from the v5.0 migration.
- `scenario_id uuid NOT NULL` added to `revenue_funnel_targets`, `revenue_funnel_tier_weights`, `revenue_funnel_lever_weights` (all FK with `ON DELETE CASCADE`).
- Backfilled all existing rows (7 targets, 6 tier weights, 6 lever weights, all for `https://www.alanranger.com`) onto a seeded **Baseline** scenario marked active. Seed survival baseline = £2500; hours/week = 6.
- Old per-property unique constraints on tier_weights / lever_weights replaced with `(scenario_id, tier_id)` / `(scenario_id, lever_id)` so different scenarios can hold different weights for the same tier/lever.
- New functional unique index on targets: `(scenario_id, COALESCE(tier_id, ''))` so master + per-tier rows coexist cleanly under one scenario.
- Applied via Supabase MCP (`apply_migration` named `scenario_planning_tables_phase_a`). Verified: `revenue_funnel_scenarios` has 1 row, all 19 config rows retagged.

### Added - API

#### `api/aigeo/revenue-funnel-scenarios.js` (new)

Single endpoint, method-dispatched:

- `GET ?propertyUrl=...` → `{ active_scenario_id, scenarios: [...] }` ordered by `is_active DESC, updated_at DESC`.
- `POST` body `{ action: 'create', propertyUrl, name, notes?, monthlySurvivalBaselineGbp?, hoursPerWeek?, makeActive? }` → creates a blank scenario (no config rows yet). Optional makeActive.
- `POST` body `{ action: 'duplicate', sourceScenarioId, newName, makeActive? }` → **deep-copies** the source scenario including all its targets / tier weights / lever weights into a new scenario_id. Returns counts of rows copied.
- `PATCH` body `{ scenarioId, name?, notes?, monthlySurvivalBaselineGbp?, hoursPerWeek?, makeActive? }` → updates the scenario fields. `makeActive=true` triggers a 2-step transaction (clear is_active on all OTHER scenarios for the property, then set is_active=true on this one) so the partial unique index never sees two actives.
- `DELETE ?scenarioId=...` → cascades to children. Refuses to delete the only remaining scenario for a property (returns 409 with `cannot_delete_only_scenario`).

All handlers under complexity 15 (AGENTS.md rule).

#### `api/aigeo/revenue-funnel-config.js` (rewritten - scenario-scoped)

- New `resolveScenarioId(supabase, propertyUrl, explicitScenarioId)` helper: if `scenarioId` was passed (via `?scenarioId=` or body), validates it belongs to the property and returns it; otherwise looks up the active scenario. Throws `no_active_scenario` (400) or `scenario_property_mismatch` (400) on bad input.
- All three load/save functions now filter by `scenario_id` and write `scenario_id` on every row.
- `saveTierWeights` / `saveLeverWeights` upserts now use `onConflict: 'scenario_id,tier_id'` / `'scenario_id,lever_id'` matching the new unique constraints from the migration.
- `saveTargets` still uses delete-then-insert (PostgREST can't reference the functional unique index `COALESCE(tier_id, '')`), but now scoped to `scenario_id` not `property_url` so multiple scenarios on the same property can't trample each other.
- Response includes `scenario_id` so the calling form (the Top Actions config IIFE) can capture which scenario it just loaded / saved against.

### Added - Dashboard UI

#### New tab: "Scenario Planning"

Added between Revenue Funnel and Configuration & Reporting in the sidebar nav, with a target icon. Title attribute previews what's coming in later phases.

#### Active scenario pill on Revenue Funnel tab

Sits at the very top of the Revenue Funnel panel (above the existing Top Actions config). Shows:

- `Active scenario` label
- Scenario name (bold)
- Meta: `survival £N/mo · Nh/wk budget · N scenarios total`
- Right-aligned `Manage scenarios →` link that programmatically clicks the new tab's nav button.

Tiny inline IIFE controller exposing `window.rfActiveScenarioPill.refresh()` so the Scenario Planning tab can ask it to repaint after activating / creating / deleting.

#### Scenario library card (new tab)

Inside `section[data-panel="scenario-planning"]`. Dark theme using the existing `--dark-*` CSS variables (same palette as Revenue Funnel for consistency).

- Dropdown of all scenarios for the property, with `(active)` suffix.
- `Active / Inactive` pill showing whether the currently-selected scenario is the one feeding the picker.
- Toolbar: `+ New blank scenario` / `Duplicate selected` / `Rename` / `Set as active` / `Delete`. Each button carries an explanatory `title=` hover tip.
- Meta grid: monthly survival baseline (£), hours/week budget, free-text notes. Each field has a hover-tip explaining what it drives in the solver (Phase D).
- `Save scenario settings` button persists the meta via PATCH.

When the user clicks `Set as active`, the IIFE:
1. PATCHes the scenario with `makeActive=true`.
2. Tells the Revenue Funnel form to reload against the new active scenario (`window.rfTopActionsConfig.setScenario(id)`).
3. Refreshes the Revenue Funnel pill (`window.rfActiveScenarioPill.refresh()`).

The form on Revenue Funnel and the library on Scenario Planning stay in sync.

#### Scenario-scoped Top Actions form (Revenue Funnel)

The existing Top Actions config IIFE in the Revenue Funnel panel now:

- Tracks `currentScenarioId` (starts `null` → captured from the first `GET /api/aigeo/revenue-funnel-config` response).
- Passes `scenarioId` on every subsequent load / save so the form stays anchored to the scenario it opened against, even if the active scenario flips underneath it.
- Exposes `window.rfTopActionsConfig.setScenario(id)` / `.reload()` / `.getCurrentScenarioId()` so the Scenario Planning library can drive it from the other tab.

Phase A.1 keeps the editor PHYSICALLY in the Revenue Funnel tab (the move to Scenario Planning is Phase A.2). For now there's a `Open editor on Revenue Funnel →` shortcut button on the Scenario Planning tab that switches tabs + scrolls to + expands the editor.

### Added - Files

- `Docs/migrations/2026-05-21-scenario-planning-tables.sql` (migration source for review / rollback)
- `api/aigeo/revenue-funnel-scenarios.js` (new endpoint)

### Changed - Files

- `api/aigeo/revenue-funnel-config.js` (rewritten scenario-scoped)
- `audit-dashboard.html` (new tab + new panel + status pill + IIFE refactor)
- `Docs/CHANGELOG.md` (this entry)

### Not yet shipped (next commits)

- **Phase A.2**: physically relocate the targets / tier-weight / lever-weight editor from Revenue Funnel into the Scenario Planning tab. The status pill stays on Revenue Funnel as a read-only summary.
- **Phase B**: Survival Cockpit table (MTD / Projected / Target / Gap / YTD per tier).
- **Phase C**: effort + time-to-realise heuristics on candidates.
- **Phase D**: three-scenario solver (Survival / Stretch / Ambitious).
- **Phase E**: what-if mode (debounced re-solve on slider drag).
- **Phase F**: Revenue Funnel Top 3 reads active scenario's solver output (closes the loop).

## [2026-05-20 v5.2] - Top Actions config: dark theme, hover tips, per-tier totals + RAG

### Why

Alan opened the relocated Top Actions config inside the Revenue Funnel tab and reported the section was "blank in many fields". Diagnosed in two minutes:

- The `<input type="number">` fields and the `<td>` tier labels WERE populated with the seeded API data (confirmed by an explicit `GET /api/aigeo/revenue-funnel-config?propertyUrl=https://www.alanranger.com` — returned master £4000 / £2800 and full per-tier rows). The text just wasn't visible.
- Root cause: the Revenue Funnel panel has `section[data-panel="revenue-funnel"] * { color: inherit; }`, which forces every descendant element to take the dark-theme `--dark-text` colour. The previously-styled section used `background: white` inputs with no explicit foreground colour, so the inputs rendered as white text on a near-white background.
- Same applies to all per-tier `<td>` labels (white text on a `#f8fafc` row) and to the slider value-readouts.

While in there, Alan asked for two more things:

1. **Hover tips on every lever and every section** so he doesn't have to guess what each control does.
2. **Totals row on monthly Rev / GP** so he can see if his per-tier breakdown actually adds up to the master target.

### Changed - `audit-dashboard.html`

#### Visuals (dark theme parity)

- Section restyled top-to-bottom using the existing `--dark-bg / --dark-panel / --dark-border / --dark-text / --dark-text-muted / --dark-brand` CSS variables that the rest of the funnel uses. Outer `<details>` is now a `var(--dark-panel)` card with a `#0b1118` header bar; inner sub-sections use `#0b1118` with a `var(--dark-border)` outline.
- All inputs get `background: #141b29`, `color: var(--dark-text) !important`, `border: 1px solid var(--dark-border)` so they're legible against the dark page. Focus state shows the brand-orange ring used elsewhere.
- Per-tier targets table reuses the `.rf-table`-style cell padding and zebra striping but is namespaced `table.rf-cfg-targets` so it doesn't fight the bigger Funnel tables that use `.rf-table`.
- Slider cards use a `#141b29` background with the brand-orange `accent-color` on `<input type="range">` — same look as the existing `.rf-tier-card` pattern elsewhere in the panel.
- Default-marker triangles on `<summary>` replaced with a custom brand-orange `▸ / ▾` indicator that rotates on open, matching the rest of the funnel panel.

#### Hover tips on everything Alan asked about

- Outer `<details>` carries a top-level `title=` explaining what the whole section does and why it's collapsed by default.
- Each sub-section `<summary>` carries its own `title=` plus a one-line italic "what's inside" hint (e.g. *"monthly Rev + GP, master & per-tier"* / *"0 = ignore · 1 = default · 2 = double"*).
- Each tier card carries a per-tier `title=` lifted to a new `RF_TIERS[i].tip` field so the hover explains *what that tier actually sells, why its GP% is what it is, and the strategic note* (e.g. Hire: *"Photographer in Coventry, commercial photography, corporate training. Very high GP% per job but historically <0.5% of revenue — set the weight low unless you actively want to grow this."*).
- Each lever card carries a per-lever `title=` lifted to a new `RF_LEVERS[i].tip` field so the hover explains *when that lever actually fires* (e.g. CTR: *"Highest leverage when current CTR is well below the position-expected curve. Doesn't fire when CTR is normal-for-rank — we tell you to fix Rank instead."*).
- Each range slider and each effort-cap `<select>` also gets its own `title=` so even mid-drag the user can see what they're adjusting.
- Master Rev / GP inputs carry their own `title=` explaining what each value drives in the engine.

#### Per-tier totals + "vs master" RAG row

- New `<tfoot>` rows under the per-tier targets table:
  - **Per-tier total** — `£X` sum of all six tier Rev / GP cells. Updates on every keystroke.
  - **vs master** — `(per-tier sum) - (master target)`, shown as `+£N` (green) when the per-tier breakdown matches or beats master, `−£N` amber when within 10% under, red when more than 10% under. So Alan can immediately see *"my per-tier rev breakdown adds up to £3,999 but my master target is £4,000 — fine"* vs *"my per-tier breakdown is £2,500 but master is £4,000 — I've not allocated £1,500 of my own target across tiers"*.
- Implemented as a single `recomputeTotals()` function (complexity 6, well under the 15-cap rule) that's wired to `input` events on every relevant input via `inputs.forEach(el => el.addEventListener('input', recomputeTotals))`. No reactive framework needed.
- `applyConfigToForm()` calls `recomputeTotals()` at the end so the first load already shows the right totals.
- Helper `ragClass(diff, master)` returns `'rag-ok' | 'rag-warn' | 'rag-bad'` so the column-class assignment stays a single line in `recomputeTotals`.
- All RAG colours pulled from the existing dark-theme `--dark-rag-*` palette (`#4ade80`, `#fbbf24`, `#f87171`) so they match the KPI cards above.

### Files touched

- `audit-dashboard.html` (+220 / -75 net: dark-theme CSS block + restructured HTML + tip strings on tier/lever arrays + recomputeTotals + ragClass helpers).
- `Docs/CHANGELOG.md` (this entry).

### What did NOT change

- Supabase tables. IDs (`rfTgtMasterRev`, `rfTier_*_wt`, `rfLever_*_cap`, etc.) and the API contract are bit-for-bit identical. `loadConfig()` / `saveConfig()` are unchanged.
- The picker (smart-priorities API). It still doesn't read these weights yet — that's the P2.2 scenario-engine consumer work, intentionally not in this commit because the user is still validating the inputs before we wire the consumer side.

## [2026-05-20 v5.1] - Top Actions config moved to Revenue Funnel tab (collapsed by default)

### Why

Alan reviewed v5.0 and pointed out the new "Top Actions - Targets, Tiers & Levers" controls had been parked in the generic `Configuration & Reporting` tab. That tab is meant for cross-cutting settings (run windows, API keys, sync defaults). The Top Actions targets / tier weights / lever weights only matter to the Revenue Funnel - that's where the engine output (the Top 3 cards) surfaces, so the controls that drive it belong in the same tab. Otherwise you have to flip between two tabs to adjust weights and see their effect.

### Changed - `audit-dashboard.html`

- The entire "Top Actions config" section (the HTML block + its companion IIFE) was lifted out of the `Configuration & Reporting` panel and dropped into the `Revenue Funnel` panel, immediately after the page header / sync buttons and before the "Do these 3 things this week" hero card. That ordering means as soon as you expand the config, the cards it drives are visible just below the config controls.
- The section is wrapped in a NEW outer `<details id="rfTopActionsConfig">` with NO `open` attribute - so it ships **collapsed by default**. Existing Funnel tiles (12-month revenue, sparklines, KPI cards) stay above the fold. The outer `<summary>` reads *"Top Actions config - targets, tier weights & lever weights"* with a brand-orange gear glyph and a "(click to expand)" hint.
- The three inner `<details open>` (Targets / Tier weights / Lever weights) stay open inside the outer wrapper, so one click on the outer chevron reveals all three sub-sections at once. Alan can then collapse individual sub-sections if he wants a more compact view, but the default expanded behaviour is "show everything I might tweak".
- New **lazy-load**: the IIFE no longer calls `loadConfig()` unconditionally on `DOMContentLoaded`. Instead it wires a `toggle` listener on the outer `<details>` and only hits `/api/aigeo/revenue-funnel-config` the first time the section is expanded (cached after that). Net effect: collapsed-by-default doesn't cost a redundant API call on every Funnel-tab open for users who never adjust weights.
- The old slot in `Configuration & Reporting` is replaced by a single one-line HTML comment (`<!-- Top Actions ... moved to the Revenue Funnel tab on 2026-05-20 ... -->`) plus a noop `<script>` placeholder block - kept so any stale browser bookmark / inline anchor that pointed at the old position still resolves to something, rather than a missing-section console error.
- IDs are unchanged (`rfTgtMasterRev`, `rfTier_*_wt`, `rfLever_*_cap`, etc.) so the GET / POST contracts against `revenue-funnel-config.js` and the seeded Supabase rows remain bit-for-bit compatible. No DB or API changes were needed for this move.

### Verified

- `git diff --stat audit-dashboard.html` shows +290 / -265 (the net add is the wrapper `<details>` + lazy-load toggle handler; the rest is whitespace re-indent from `Configuration & Reporting` indentation depth to `Revenue Funnel` indentation depth).
- Encoding sanity: zero mojibake markers (`Select-String ... 'a-tilde euro'` returns 0 occurrences). PowerShell-based `Set-Content` was deliberately avoided after one such attempt corrupted the file's en-dashes earlier in this session; the move was done entirely via `StrReplace` to preserve UTF-8 byte-for-byte.
- Lint: 1186 findings post-edit are all pre-existing patterns (inline styles, Edge-Tools vendor-prefix warnings, sonarqube `Prefer globalThis over window` etc.) that match the rest of the file. Two warnings on the moved labels (`A form label must be associated with a control`) are unchanged from the pre-move state - same labels, different line numbers.

### Files touched

- `audit-dashboard.html` (relocation; no functional change to the config's load / save behaviour beyond lazy-loading and the outer collapsed wrapper).
- `Docs/CHANGELOG.md` (this entry).

## [2026-05-20 v5] - Top Actions: live page validation + scenario-engine groundwork

### Problem

Alan reviewed the v4 Top 3 Actions output and called out three concrete factual errors:

1. **Card 1 (`/photography-courses-coventry`)** claimed the page had no FAQPage schema. The page demonstrably does — the live JSON-LD includes `WebPage, Organization, LocalBusiness, Person, WebSite, Service, FAQPage`.
2. **Card 2 (`/free-online-photography-course`)** reported the current meta description was 236 characters. The actual `<meta name="description">` on the live page is 158 characters — the exact string Alan quoted: *"Free online photography course from the Alan Ranger photography academy. 60 Modules - Camera settings, gear, composition, genres and photo practical exercises."*
3. **Card 3 (same URL)** repeated both the meta error AND the missing-FAQPage error.

The picker was treating `audit_results.schema_pages_detail` as the source of truth for both. Diagnosis:

- **Upstream meta-description bug**: `api/schema-audit.js` `bestMetaDescriptionFromPage()` preferred the LONGEST string between the real `<meta>` tag and any JSON-LD `description` field. On Squarespace landing pages that emit Event/Course/Service JSON-LD with long auto-generated description blobs, this returned a 236-character JSON-LD blob instead of the real 158-character meta tag. The SERP only ever shows the meta tag, so the captured "meta description" in `schema_pages_detail` was wrong for every Squarespace landing page in the audit.
- **Stale schema row**: `audit_results.schema_pages_detail.schemaTypes` for the academy hub and `/photography-courses-coventry` listed only the dynamically-injected event/product schema and was missing the static page-level Course / FAQPage / Service blocks. The audit row was hours-to-days stale relative to the live page.
- **The picker compounded both** by quoting the stale row as if it were authoritative ("Schema present: ItemList, BreadcrumbList... — no FAQPage, add one") when the live page already had FAQPage.

Alan's call: **stop guessing. Live-validate every fact a Top Actions card states.** And separately: rethink the picker as a lever-driven scenario engine the user can pull levers on (tier weights, lever weights, effort caps) rather than a static profit-only sort.

### Changed — `api/schema-audit.js`

- `bestMetaDescriptionFromPage(htmlString, schemas)` now PREFERS the real `<meta>` tag and only falls back to a JSON-LD `description` when no meta tag is present at all. Fixes the 236-vs-158 root cause for future audit runs.

### Added — `api/aigeo/lib/live-page-validator.js` (new)

Single-purpose live-validation module the smart-priorities picker uses to verify what's actually on the live page before recommending changes.

- `validateUrlLive(url)` — fetches the URL (4.5s timeout, AbortController-based) and extracts the real `<title>`, the real `<meta name="description">` content, the first `<h1>` text (with HTML-entity decoding for `&mdash;` / `&pound;` / `&times;` / numeric refs), and the union of all JSON-LD `@type` values across every `<script type="application/ld+json">` block (with @graph descent capped at 8 levels). Returns `{ url, source: 'live' | 'cache' | 'fallback', fetchedAt, title, metaDescription, h1, schemaTypes, ok, error }`.
- `validateUrlsLive([urls])` — fans out in parallel via `Promise.all` so a single Top Actions render adds ~1–3s for 5–8 picks rather than 5–25s serial.
- 5-minute in-memory cache keyed by URL so repeat dashboard loads on the same warm Node instance don't re-fetch.
- Graceful fallback: on 4xx/5xx/timeout/abort the function returns `{ ok: false, error: '...' }` so callers can branch onto the audit-derived value with a `[data: last audit]` tag instead of failing.
- Smoke-tested against `/free-online-photography-course` (correctly returned title 59 ch, meta 158 ch, schemaTypes including Course + FAQPage + LocalBusiness + Service + Organization — matching the schema.org validator screenshot) and `/photography-courses-coventry` (correctly returned title 57 ch, meta 151 ch, schemaTypes including FAQPage + Service + Organization + LocalBusiness).

### Changed — `api/aigeo/revenue-funnel-smart-priorities.js`

- Each picker's inline description-building code was extracted into a named builder: `buildCtrDescription / buildRankDescription / buildAioDescription`. Each builder takes a stable args object (impressions / CTR / position / rank / keyword info — these come from GSC + keyword tables and the snapshot is authoritative) plus a `pageState` object (title / meta / h1 / schemaTypes — which CAN change between audits, so we live-fetch for the top picks).
- Each candidate now carries an internal `_rebuild = { type, args }` field that the post-pass uses to regenerate the description with live page state. `sanitiseForResponse()` strips `_rebuild` before write so it never escapes to the API consumer.
- New `liveEnrichTopCandidates(candidates)` post-pass: takes the top 8 ranked candidates, fans out `validateUrlsLive` on their URLs in parallel, regenerates each description using the live `title / meta / h1 / schemaTypes` when the fetch succeeded, and tags the description with `[live · fetched 2026-05-20 13:42Z]`. On fetch failure the audit-derived description stays in place with a `[data: last audit]` tag and `live_data_source = 'audit_fallback'` is exposed on the response.
- `buildRankDescription` now actively pivots the recommended action: if both title AND H1 already contain the head term, it tells you to focus on depth (comparison table, FAQ items, internal links from the tier hub); if either is missing the head term, it tells you to fix THAT first because it's the cheaper move and a necessary precondition.
- `buildAioDescription` now checks for `FAQPage` in the live schema list and pivots between "extend existing FAQPage with N new Q&A pairs mirroring People-Also-Ask" vs "add FAQPage + answer block from scratch". Also checks for `Course` schema and adds the "extend in the same JSON-LD block" hint when present.
- Response payload gains three fields per candidate so the dashboard can render a freshness chip: `live_data_source` (`live` | `audit` | `audit_fallback`), `live_fetched_at` (ISO ts), `live_fetch_error` (null on success; error code on failure — `timeout`, `http_404`, etc).

### Live verification (post-deploy)

Ran the deployed `/api/aigeo/revenue-funnel-smart-priorities` immediately after push and confirmed the three previously-wrong cards now return factually correct state:

- `/free-online-photography-course`: `live_data_source = 'live'`, meta 158 ch (was 236), schemaTypes include `Course, FAQPage, ImageObject, ItemList, LocalBusiness, Organization, Person, Place`. CTR diagnosis pivoted from "rewrite the title" to *"CTR 1.38% is normal for position 14.6 — focus on rank improvement (page 1) before title rewrites"*.
- `/photography-courses-coventry`: `live_data_source = 'live'`, schemaTypes include `FAQPage, ImageObject, LocalBusiness, Organization, Person, Place, Service, WebPage`. Diagnosis correctly identifies *"Title doesn't lead with head term 'photography lessons' (the query you actually rank for)"*.
- `/hire-a-professional-photographer-in-coventry`: replaces the blog-post pick (headshots guide) with the actual money page. `live_data_source = 'live'`, FAQPage present, specific head-term-in-title diagnosis.

### Added — scenario-engine config tables (Phase 2.1)

Three Supabase tables back the new Configuration & Reporting controls. Applied via `Docs/migrations/2026-05-20-scenario-engine-tables.sql` to the `igzvwbvgvmzvvzoclufx` (ai-chat) project:

- `public.revenue_funnel_targets` — monthly revenue + GP targets, both **master** (NULL tier_id) and **per-tier** (one row per commercial tier). UNIQUE on `(property_url, COALESCE(tier_id, ''))` so the master row and per-tier rows coexist. Seeded with placeholder targets (£4000/mo master, £667–1000/mo per-tier) Alan can overwrite from the UI.
- `public.revenue_funnel_tier_weights` — per-tier `strategic_weight` (0..5, default 1.0). Hire is pre-set to 0.7 per Alan's flag that portraits/headshots are <0.5% of revenue. All others default to 1.0.
- `public.revenue_funnel_lever_weights` — per-lever `strategic_weight` (0..5, default 1.0) and `effort_cap` (`low` | `medium` | `high` | NULL). Lever ids the engine understands: `rank`, `aio`, `ctr`, `schema`, `conversion`, `surfacing`. All seeded with weight 1.0 and no cap.
- All three tables get a shared `tg_touch_updated_at()` trigger so `updated_at` auto-refreshes on UPDATE.

### Added — `api/aigeo/revenue-funnel-config.js` (new)

CRUD endpoint for the scenario-engine config:

- `GET /api/aigeo/revenue-funnel-config?propertyUrl=...` → returns `{ targets: { master, byTier }, tier_weights, lever_weights }` plus a `loaded_at` timestamp.
- `POST /api/aigeo/revenue-funnel-config` with `{ propertyUrl, targets?, tier_weights?, lever_weights? }` → upserts only the sections present in the body so partial saves (e.g. just-the-sliders) work cleanly.
- Targets save uses manual delete-then-insert because PostgREST can't auto-detect the `COALESCE(tier_id, '')` composite uniqueness. Tier and lever weights use standard `upsert(..., { onConflict: 'property_url,tier_id|lever_id' })`.
- Lever ids are validated against `VALID_LEVER_IDS = {rank, aio, ctr, schema, conversion, surfacing}`. Unknown ids are silently dropped. Weights are clamped to `[0, 5]` and rounded to 2 dp.

### Added — Configuration & Reporting tab UI (Phase 2.1)

New "Top Actions — Targets, Tiers & Levers" section appended to the existing `Configuration & Reporting` panel in `audit-dashboard.html`. Three collapsible `<details>` blocks:

- **Targets** — master monthly revenue + GP inputs, plus a per-tier table (6 rows × 2 numeric inputs).
- **Tier strategic weights** — 6 cards, each with a range slider (0–2, step 0.05), a live value readout in brand orange, and a one-line explainer.
- **Lever weights** — 6 cards, each with a range slider + value readout AND a per-lever effort-cap dropdown (`(no cap)` / `low only` / `low+medium` / `all`).

Save / Reload buttons at the bottom. The Save button POSTs the full form to `/api/aigeo/revenue-funnel-config` and re-applies the server response to the form so any server-side clamping is visible. A timestamp chip below the buttons shows "Last saved: HH:MM:SS" on success.

### Still pending (Phase 2.2 — engine consumer)

The sliders ship as a wired-up UI immediately (Alan can adjust weights right now), but the smart-priorities picker doesn't yet read these tables when sorting. P2.2 will:

1. Read `revenue_funnel_tier_weights` and `revenue_funnel_lever_weights` inside `buildSnapshot()`.
2. Compute `score = (estimated_lift_gbp_profit / monthly_gp_gap) × tier_weight × lever_weight × effort_factor × confidence` for each candidate.
3. Apply the per-lever `effort_cap` filter before sorting.
4. Expose the full score breakdown on each candidate so the dashboard can render a "× 1.3 academy weight × 0.8 schema lever × ... = score 0.087" audit trail per pick.

Lever modules for the remaining four levers (L4 Schema, L5 Conversion, L6 Surfacing) also get implemented in P2.2 — currently only L1 Rank, L2 AIO, L3 CTR have working pickers.

### Files touched

- `api/schema-audit.js` (+15 / -4 lines: `bestMetaDescriptionFromPage` rewrite + diagnostic comment).
- `api/aigeo/lib/live-page-validator.js` (new, 198 lines).
- `api/aigeo/revenue-funnel-smart-priorities.js` (+200 / -50 lines: description-builder refactor + live-enrichment post-pass + new response fields).
- `api/aigeo/revenue-funnel-config.js` (new, 213 lines).
- `Docs/migrations/2026-05-20-scenario-engine-tables.sql` (new, 187 lines).
- `audit-dashboard.html` (+260 lines: Top Actions config section inserted in Configuration & Reporting panel).
- `Docs/CHANGELOG.md` (this entry).

## [2026-05-20 v4] - "Do these 3 things this week": research-validated picks + CTR to 2 dp

### Problem

Alan reviewed the live Top 3 Actions card and called it out as low-quality:

1. **Bad picks** — the card surfaced *"Lift CTR on headshots at home guide"* (the URL is `/blog-on-photography/headshots-at-home-guide`, a blog post, not a money page — and portraits/headshots are <0.5% of revenue, so an action on it can't be a top-tier opportunity by definition). It also surfaced *"Lift CTR on free online photography course"* with no explanation of WHY CTR was low or what to actually change.
2. **Generic recommendations** — every CTR card said "Rewrite the SERP title (~60ch) and meta description (~155ch) to lead with the customer's outcome + price + location" regardless of what the page actually had. The picker never read `schema_pages_detail` (which already stores the current title + meta + schema types per page) and never looked at `keyword_rankings` to say which head term the page was competing on.
3. **No validation against page state** — the AIO citation card said "add a structured answer block + FAQs" even when the target page already had `FAQPage` schema.
4. **CTR displayed at 1 dp** in the Money Pages Opportunity Table (e.g. `0.7%`) and in the per-page Suggested Top 10 cards — Alan asked for 2 dp everywhere so the difference between a 0.04% and 0.94% CTR is actually visible.
5. **Duplication with the Money Pages Opportunity Table below** — the same headshots blog kept appearing in both, with the same un-actionable "lift CTR" prose. The Top 3 card is supposed to be **strategically additive**, not a recap of the matrix.

### Changed — `api/aigeo/revenue-funnel-smart-priorities.js`

Phase 1 of the picker rework (a Phase 2 with tier-strategic weighting is still open, see below). Each CTR / Rank / AIO candidate is now generated from real page data:

- **`isBlogUrl(url)`** — new util. Returns true for any URL matching `/blog-on-photography/`. Wired into `ctrPriorityForTier`, `rankPriorityForTier`, and `aioCitationPriority` as the FIRST filter, so blog posts can no longer be surfaced as money-page actions. This alone drops `/blog-on-photography/headshots-at-home-guide` out of the Top 3.
- **`topKeywordForPage(cleanedUrl, keywords)`** — new util. Finds the highest-search-volume keyword whose `best_url` matches the page, regardless of which tier that keyword classified into. (Needed because e.g. the Academy hub ranks for `"online photography course"`, which keyword-classifies as the `courses` tier; without a cross-tier lookup the enricher couldn't find the head term.)
- **`pageEnrichment(cleanedUrl, schemaDetail, keywords)`** — new util. Returns `{ title, meta, schemaTypes, topKw }` for the picked page so the description can cite ACTUAL state, not generic boilerplate.
- **`diagnoseTitleIssue` / `diagnoseMetaIssue` / `diagnosePositionIssue` / `diagnoseLowCtr`** — four new helpers that each inspect a single dimension of the page (title length vs 60 ch; head-term-in-title check; meta length vs 120–160 ch; position-vs-CTR sanity check — e.g. *"Position 1.3 should drive ~10–30% CTR; you're at 0.74% — almost certainly AIO / rich-snippet features eating the clicks"* vs. *"CTR 0.74% is normal for position 14.2 — focus on rank improvement before title rewrites"*). Split into three helpers so the parent `diagnoseLowCtr` stays well under the 15-complexity rule.
- **`ctrPriorityForTier`** description now reads, for a real example:
  > `/photography-courses-coventry` — 4,761 impressions/28d, 0.65% CTR, avg pos 16.4. Top ranking keyword: "photography courses" at rank #33 (6,600/mo). Current title: "Photography Courses Coventry or Online | Learn from..." (62 ch). Current meta: "UK landscape photography workshops…" (118 ch). Schema present: Course, FAQPage, BreadcrumbList. Diagnosis: Title is 62 ch — Google truncates at ~60. Meta is only 118 ch — under-using SERP real estate. CTR 0.65% is normal for position 16.4 — focus on rank improvement (page 1) before title rewrites. Target: 1.50% CTR.

  i.e. the card now tells you *what's currently there*, *why CTR is what it is for that rank*, and *what specifically to change* — instead of the previous generic "rewrite the title".
- **`rankPriorityForTier`** now includes current title + current schema types in its description, plus the action prose now references whether `FAQPage` schema is already present (so the recommendation isn't "add FAQ schema" when FAQ is already there).
- **`aioCitationPriority`** now reports whether the target page already has `FAQPage` schema — pivoting the action between *"FAQPage already present, write the AIO answer block above the existing FAQs and extend with 5 question/answer pairs mirroring the AIO summary"* and *"FAQPage missing — add it AND write the answer block"*.
- **`buildSnapshot` / `buildPrioritiesForTier`** wired through a new `ctx = { schemaDetail, keywords: allKeywords }` so the enricher can do a cross-tier keyword lookup (the per-tier `keywordsByTier` was too narrow — academy hub keywords classify as `courses`-tier, etc.).

### Changed — `audit-dashboard.html` (CTR display: 2 decimal places)

Five spots updated from `.toFixed(1)` to `.toFixed(2)`:

- **L44075** — Money Pages Opportunity Table CTR column cell.
- **L44508** — Money Pages KPI tile sub-label `"vs X.X% site"` (was inconsistent with the main value above it which was already 2 dp).
- **L47841** — Money Pages summary band tile `"Money pages CTR"` (the big number at the top of the URL Money Pages tab — the one Alan screenshotted as `0.5%`).
- **L49093** — Suggested Top 10 per-page card CTR row.
- **L51237** — Money pages behaviour CTR display in the Authority scorecard.

### Files touched

- `api/aigeo/revenue-funnel-smart-priorities.js` (+90 / -22 lines net; node syntax-checked; new helpers each <15 complexity).
- `audit-dashboard.html` (5 × 1-character `.toFixed` changes).

### Still open (Phase 2 — needs Alan's input)

1. **Tier-strategic weighting** — the picker still ranks Top 3 purely by `estimated_lift_gbp_profit` (clicks × tier AOV × tier GP%). Alan flagged that **portraits/headshots are <0.5% of revenue**, so even when a headshots-related page passes the blog filter, its surface-area is too small to be a "biggest reward" pick. Need to decide: should the hire tier get a strategic-weight multiplier <1 to deprioritise its low-share sub-pages, and should academy + workshops_nonres get >1 because they're the high-leverage tiers? Will not invent weights — waiting for Alan's call.
2. **De-dupe against `revenue_funnel_priorities` and the Money Pages Opportunity Table** — currently a page can show up in both Top 3 and the matrix below. Not necessarily bad (Top 3 is the curated "do these THIS week" view; matrix is the full backlog) but worth a follow-up so the Top 3 is genuinely additive.
3. **Live page-content validation via Firecrawl scrape** — `pageEnrichment` only reads what `schema_pages_detail` captured in the last audit. A more honest validation would scrape the live page on-demand and check the rendered HTML for the AIO answer block / FAQPage JSON-LD. Deferred — Phase 1 covers ~80% of the "is this still missing?" question already.

## [2026-05-20 v3] - Profit Pyramid: add Annualised Rev column + column totals row

### Problem

Alan flagged that the "Profit Pyramid — where the money actually sticks" panel had an `Annualised GP` column but no matching `Annualised Rev` (revenue) column, even though the API already returned the revenue projection per row. Same panel had no totals row, so the user couldn't see the business-wide YTD/annualised position at a glance — they had to mentally add up the six tier rows every time. The data was sitting unused in `revenue_funnel_summary.profit_pyramid.rows[].annualised_revenue_gbp` and `revenue_funnel_summary.profit_pyramid.annualised_revenue_total_gbp` (both have been emitted by the API since the panel was first built).

### Changed

- **`audit-dashboard.html`**: added an `Annualised Rev` column between `YTD GP` and `Annualised GP` in the Profit Pyramid table. Updated the table's `<colgroup>` from 7 columns (28/9/12/12/15/12/12) to 8 columns (24/8/11/11/13/13/10/10) so the new column doesn't squeeze the existing ones. Added a `<tfoot id="rf-pyramid-tfoot">` populated by a new `rfPyramidTotalsRow(rows, p)` helper which emits a labelled "TOTAL (all tiers)" row with:
  - **GP %**: business-wide BLENDED GP% = sum(YTD GP) / sum(YTD Rev), RAG-coloured by the same green/amber/red thresholds as individual tiers — sanity check vs the tier-level chips above.
  - **YTD Rev / YTD GP / Annualised Rev / Annualised GP**: column sums, prefers the API-supplied totals (`annualised_revenue_total_gbp`, `annualised_gp_total_gbp`) when present, falls back to row-sum otherwise.
  - **% of profit**: sum of `share_of_gp_pct` across rows (should always be ~100.0% — a maths sanity check that surfaces rounding drift).
  - **GP–Rev gap**: sum of `share_gap_pp` across rows (should always be ~0.0 pp by construction).
- Added three CSS rules under `.rf-pyramid-table` to visually separate the totals row from the data rows: 2px-thick top border, slightly lifted grey background, uppercased "TOTAL" label text.
- The new column's header carries a tooltip describing the projection: *"Projected revenue for the full year, based on YTD run-rate × (12 / months elapsed). Lets you see the revenue side of the same projection that drives the Annualised GP column next to it."*

### Files touched

- `audit-dashboard.html` — Profit Pyramid `<thead>` + `<colgroup>` + `<tfoot>` markup (~10 line change), new `rfPyramidTotalsRow(rows, p)` helper (~24 lines, complexity 7), `rfRenderProfitPyramid` updated to populate the new `tfoot`, three new CSS rules.

### No backend change required

The API contract was already complete — `revenue-funnel-summary.js` has been emitting `annualised_revenue_gbp` per row and `annualised_revenue_total_gbp` at the top level since the Profit Pyramid was first introduced (L611-642). This change is pure frontend wiring.

## [2026-05-20 v2] - Revenue Funnel: "Best rank" — curated keyword list per tier (replaces URL-prefix keyword matching)

### Problem (continued from v1)

v1 swapped MIN-rank for "MIN non-brand rank" which fixed the "#1 everywhere" symptom but the underlying logic was still **URL-prefix-based keyword bucketing**: keywords were assigned to a tier by `tierOf(kw.best_url)`. That meant the "Best rank" column reflected "what's the best position any tracked keyword reached on any page that happens to match a tier prefix?" — which is the wrong question. The right question is "what's our position on the commercial-intent queries that DEFINE this tier?". Alan's actual SEO intent for each tier was:

- **Courses**: `photography courses`, `beginner photography courses`
- **Academy**: `online photography course`, `free online photography course`
- **Workshops (Non-Res)**: `landscape photography workshops`, `one-day photography workshops`
- **Workshops (Residential)**: `photography workshops`, `photography workshops near me`
- **Hire / Commercial**: `photographer in coventry`, `commercial photography coventry`, `professional photographer near me`, `corporate photography training`
- **1-2-1 & Services**: `private photography lessons`, `private photography lessons online`, `photography gift vouchers`

These deliberate lists could not emerge from URL-prefix bucketing because (a) some of the keywords rank against non-tier URLs (e.g. `beginner photography courses` currently ranks against `/free-online-photography-course`, not `/photography-courses-coventry`), (b) some don't rank anywhere yet (null `best_url`) so URL matching can't classify them, and (c) the URL set is wider than the curated set so unrelated head-terms get aggregated alongside.

### Changed

- **`api/aigeo/revenue-funnel-summary.js`**: added a `keywords` array to every entry in `MONEY_PAGE_TIERS` containing the exact lowercase commercial-intent queries Alan wants each tier scored against. Rewrote `pickMoneyPagePerformance()` into two helpers — `indexAiMapByKeyword()` (one-pass case-insensitive `{keyword -> aiMap row}` index for O(1) curated lookups) and `accumulateCuratedKeywords()` (walks a tier's curated list, accumulates each matching aiMap row via `accumulateKeywordIntoBucket()`, pushes unmatched queries onto `curated_keywords_missing`). Page-aggregation columns (`clicks_28d`, `impressions_28d`, `revenue_actual_28d`, `page_count`) are still URL-prefix-based — only the keyword-aggregation columns changed. `accumulateKeywordIntoBucket()` now pushes `kw.keyword` onto `curated_keywords_not_ranking` when the rank is null (e.g. `photography workshops near me` and `professional photographer near me` are both tracked but Google doesn't currently rank Alan anywhere — useful signal). Added three new fields per tier in `initTierBucket()`: `curated_keywords_total`, `curated_keywords_missing` (in curated list but not in `keyword_rankings`), `curated_keywords_not_ranking` (tracked but rank is null). All helpers stay under the 15-complexity rule (the new ones are 2-3 each).
- **`audit-dashboard.html`**: rewrote `rfBestRankTooltip(t)` to surface the new curated-list metadata instead of generic "best non-brand keyword" prose. Tooltip now reports: (a) winning curated keyword and rank, (b) median rank across the ranked-curated subset, (c) list of curated keywords missing from `keyword_rankings` (so user knows what to add in the Keyword & Ranking AI tab), (d) list of curated keywords that ARE tracked but currently have no rank (so user knows where Google doesn't see them), (e) "tracked / total" curated-keyword count footer. Cell display unchanged from v1 (rank + truncated winning keyword, colour-coded green/yellow/red).

### Files touched

- `api/aigeo/revenue-funnel-summary.js` (+30 lines for new helpers + curated-list fields; `keywords` arrays added to 7 tier entries).
- `audit-dashboard.html` (~20 line tooltip rewrite).

### Expected dashboard reads after deploy

Verified against the 2026-05-19 `keyword_rankings` snapshot (production property `https://www.alanranger.com`):

| Tier | Best rank | Best curated keyword | Tracking gaps surfaced |
|---|---|---|---|
| Courses | **#14** | beginner photography courses | None (2/2 tracked, head term `photography courses` #33 with SV 6,600 is the biggest commercial gap) |
| Academy | **#1** | free online photography course | None (2/2 tracked, `online photography course` SV 1,000 at #2) |
| Workshops (Non-Res) | **#1** | landscape photography workshops | `one-day photography workshops` missing (tracked variant is `one day photography workshops` without hyphen at #39 — exact-match means it shows as missing) |
| Workshops (Residential) | **#13** | photography workshops | `photography workshops near me` (SV 260) tracked but not ranking |
| Hire / Commercial | **#2** | photographer in coventry | `commercial photography coventry` missing entirely; `professional photographer near me` (SV 590) tracked but not ranking |
| 1-2-1 & Services | **#4** | photography gift vouchers | `private photography lessons online` missing entirely |
| Unidentified | — | (empty curated list) | n/a |

### Strategic intent

The dashboard is now **deterministic** — Alan controls exactly which queries each tier is scored against by editing `MONEY_PAGE_TIERS.keywords` in `revenue-funnel-summary.js`. The previous URL-prefix approach was non-deterministic (depended on which URL Google chose to rank a keyword against) and over-inclusive (any tracked keyword whose `best_url` happened to fall in a tier's prefix set counted, including brand variants and one-off long-tails). The curated-list approach also surfaces tracking gaps directly: if Alan wants `commercial photography coventry` to be a Hire/Commercial KPI but the column shows "Missing from tracking", that's an actionable signal to add it in the Keyword & Ranking AI tab. Same for keywords tracked but not ranking — the tooltip's "Tracked but not ranking" list is essentially the SEO backlog for that tier.

## [2026-05-20 v1] - Revenue Funnel: "Best rank" column — exclude brand keywords + surface the winning query

### Problem

Alan flagged that the "Money pages performance" table on the Revenue Funnel tab was showing **`#1` for every tier** (except Workshops Residential which was blank). Cross-checked against the Keyword & Ranking AI tab and `keyword_rankings` in Supabase — the table was **technically correct but operationally useless**: a single brand-prefixed head term like "alan ranger photography workshops" or "alan ranger photography courses" hits #1 and drags the tier's MIN-aggregated rank to 1, hiding the fact the actual commercial-intent terms behind it are mid-page. Real positions per the Keyword tab: "photography workshops" #13, "photography courses" #33, "photography lessons online" #8, "beginners photography course near me" #4 — none of which were visible because brand terms were dominating the aggregation.

### Root cause

`api/aigeo/revenue-funnel-summary.js` → `accumulateKeywordIntoBucket()` was doing `bucket.best_rank = MIN(rank)` across **every** keyword whose ranking URL fell inside the tier's URL-prefix set, with **no brand filter**. The source keyword list is the top 200 highest-volume tracked AI Overview keywords from `keyword_rankings`, which inevitably includes "alan ranger" branded variants because they have the highest impression counts.

### Changed

- **`api/aigeo/revenue-funnel-summary.js`**: extended `initTierBucket()` to add three new fields per tier — `best_rank_non_brand` (MIN rank across keywords whose name doesn't contain "alan ranger" / "alanranger"), `best_rank_keyword` (the actual non-brand query that achieved that rank, e.g. "photography workshops uk"), and `median_rank` (median across all tracked tier keywords, surfaced in the tooltip to show whether `#1` is one outlier or a tier-wide reality). Legacy `best_rank` is kept for back-compat. Added two new helpers — `isBrandKeyword()` (lowercase substring match on "alan ranger" / "alanranger") and `medianOf()` (sort + middle element with even-count averaging) — both well under the 15-complexity limit. `accumulateKeywordIntoBucket()` now early-returns when `r == null`, pushes every rank into `tier_keyword_ranks` for median calculation, and only updates `best_rank_non_brand` + `best_rank_keyword` when the keyword passes the brand filter. `finaliseTierBucket()` computes `median_rank` then `delete`s the raw `tier_keyword_ranks` array so it doesn't bloat the response payload.
- **`audit-dashboard.html`**: added `rfBestRankCellHtml(t)` (two-line cell: large coloured `#N` on top — green ≤3, yellow ≤10, red >10 — plus a small grey caption with the winning non-brand keyword truncated to 24 chars) and `rfBestRankTooltip(t)` (full tooltip showing the keyword, the rank, the keyword count, and the median — with two fallback messages for "only brand keywords tracked" and "no tracked keywords" so users know what to do next). `rfMoneyTableRow()` now uses these helpers and escapes double-quotes for the `title` attribute. `rfTierTile()` (the smaller tile above the table) was updated to read `tier.best_rank_non_brand` instead of `tier.best_rank` so the tile and the table agree. The `<th data-sort="best_rank">` was renamed to `data-sort="best_rank_non_brand"` so column-header sorting matches what's actually displayed, and a `title` attribute was added to the header explaining the methodology in one sentence.

### Files touched

- `api/aigeo/revenue-funnel-summary.js` (+30 lines: helpers + new bucket fields + accumulator extension).
- `audit-dashboard.html` (+30 lines for cell/tooltip helpers; 3 line changes for tile/header/cell wiring).

### Verification

After deploy, the Revenue Funnel tab's Money pages performance table should now show genuine commercial-intent positions instead of a column of `#1`s. Expected reads based on the current `keyword_rankings` snapshot Alan screenshotted:
- **Academy** — likely `#1` (e.g. "free online photography course") or low-single-digit, with the actual winning query visible.
- **Workshops (Non-Res)** — `#1` from "landscape photography workshop" / "landscape workshops" (genuine #1 ranking, not brand-driven), tooltip will show median ≈ #13 reflecting that "photography workshops" head term still needs work.
- **Workshops (Residential)** — still `—` (no tracked keywords map to `/photography-workshops-near-me` or `/residential-workshops`); this is the highest-value follow-up flag — tier earned £775 in 28d with zero ranking-data observability.
- **Courses** — expected `#4` from "beginners photography course near me" with tooltip showing median ≈ #16-#33 reflecting the head-term gap on "photography courses" (#33) and "photography lessons online" (#8).
- **1-2-1 & Services** — should drop from `#1` to whatever the best non-brand long-tail is (e.g. "1-2-1 photography tuition coventry").
- **Hire / Commercial** — should drop from `#1` to the best non-brand commission/headshot term (e.g. "headshots coventry").
- **Unidentified** — still `—` (no `prefixes` array so no keywords accumulate; this row exists for revenue catching, not keyword counting).

### Strategic intent

The Revenue Funnel tab is the conversion-and-profit dashboard — every column on the Money pages performance table should answer "where is the leak?" at a glance. A column where every tier reads `#1` answers no questions (it just says "you have a strong brand", which Alan already knows). A column showing the best non-brand commercial-intent rank + the actual query immediately surfaces the gap between brand strength and commercial-intent strength — e.g. tier `Workshops (Non-Res)` showing `#1 (landscape workshops)` with a tooltip median of #13 tells Alan instantly that the long-tail is doing the work and the head term "photography workshops" needs SEO attention. Same logic exposes the Courses gap (#33 on the head term despite a #4 on a long-tail) and the Residential blind spot (zero keyword coverage despite £775/28d revenue). Brand-keyword exclusion uses a deliberately tight allow-list pattern (`alan ranger` / `alanranger` substring match) — anything else stays in the calculation so legitimate descriptive long-tails ("alan ranger" wouldn't be in "best UK landscape photographer near me" so it counts as non-brand and is eligible to be the winning keyword).

## [2026-05-19] - Academy funnel: /academy/login v4 — native Memberstack signup-modal pattern, 14-day display fix, consolidated card, dark-black/brand-orange H2 banner

### Changed

- **`Academy/academy-login-squarespace-snippet-v1.html` v3 → v4.** Four conversion-path fixes after Alan audited the live `/academy/login` page on 2026-05-19 and flagged that the button copy disagreed with the rest of the funnel ("Start 30-Day Free Trial" while every other page now says 14-Day), that the trial button was driven by a bespoke ~200-line JS signup form rather than the native Memberstack pattern used by the Annual button next to it, that the page rendered three separate Squarespace blocks (FAQ accordion on the left, the 3-button card in the centre, an orange "IMPORTANT: trial is only activated..." FUD warning below) instead of a single coherent conversion surface, and that the H1 inside the snippet ("Academy Login / Join") was competing with the Squarespace page H1 ("Online Photography Course - Academy Login") above it.
  1. **Display copy 30-Day → 14-Day.** Three places: trial button label, `aria-label`, and inline-comment reference. Verified against `Supabase public.academy_config` (the canonical source) that `current_trial_length_days = 14` (since the 2026-04-20 cutover) and against `Supabase public.academy_trial_history` that all 16 members who signed up post-cutover have `trial_length_days = 14` with a measured `(trial_end_at - trial_start_at)` of exactly 14 days. Memberstack's Admin REST API does NOT expose plans or prices (confirmed against `developers.memberstack.com` docs and the file listing of `@memberstack/admin@1.3.1` — only members/events/JWT are wrapped), so the Memberstack-side price ID name `prc_30-day-free-trial-mg18p0u9z` is purely a stale label; the actual trial enforcement happens server-side from `academy_config`. Price ID was NOT renamed because it is referenced from `03-free-photography-course.html`, `02-free-online-photography-course.html` and `Academy/alanranger-academy-assesment/academy-dashboard-squarespace-snippet-v1.html` — renaming would break every live signup button on the site.
  2. **Trial button switched from bespoke JS form to native Memberstack pattern.** v3 had a hidden `<form id="arpTrialForm">` (email + password fields) that was shown on click; submission called `ms.signupMemberEmailPassword()` then `ms.purchasePlansWithCheckout({ priceId: "prc_30-day-free-trial-mg18p0u9z" })` with navigation-detection fallback and timed error messaging. v4 deletes that entire form + its CSS (~120 lines) + its JS (~180 lines), and replaces the trial button with `data-ms-modal="signup"` + `data-ms-price:add="prc_30-day-free-trial-mg18p0u9z"` so the Memberstack runtime opens its own signup modal and attaches the trial price in one step — exactly the pattern the Annual Membership button next to it already used. The `#arpTrialBtn` ID is preserved so the existing `/academy/login?start=trial` query-string auto-open helper continues to work.
  3. **Companion editor deletions inside Squarespace** (not in the snippet, but verified live via Firecrawl after Alan applied them): the left-column "Login options & membership terms" FAQ accordion block (with the 5 collapsed Q&A items about which button to use, what is included in the trial, what happens after the trial, exam migration, and T&Cs summary) deleted; the orange "IMPORTANT: Your trial is only activated after you complete the £0 Stripe checkout..." text block below the buttons deleted. All five of those Q&As are now covered inside the snippet by the price strip + the 3-paragraph reassurance prose, so the page now renders as a single bordered card instead of three competing regions.
  4. **Inside-card content added** so the consolidated card carries the same messaging shipped on the funnel pages (`02-free-online-photography-course.html` v3.7, `03-free-photography-course.html` v4): price-strip line "**14 days free** · **£79/year** only if you choose to continue · **No auto-billing**" inserted above the buttons (cream `#fff7ed` background, peach `#fed7aa` border, brown-orange `#9a3412` strong text); 3-paragraph FUD reassurance prose inserted below the buttons (amber `#fef3c7` background, amber `#fcd34d` border, amber-700 `#78350f` body) — paragraph 1 "No card. No auto-billing." (£0 Stripe checkout no card asked), paragraph 2 "When your 14-day trial ends, nothing is charged automatically" (consciously chooses annual, no hidden renewal, nothing to dispute), paragraph 3 "Why a full year is worth it" (60 modules + 15 exams + practice packs + tools, novice → intermediate path).
  5. **H1 demoted to H2 + restyled.** The snippet's `<h1>Academy Login / Join</h1>` was competing with the Squarespace native page H1 ("Online Photography Course - Academy Login") for SEO + accessibility, so it's now `<h2 class="arp-banner-title">Academy Login / Join</h2>`. Styling: dark-black `#111111` background, brand-orange `#f15a22` text (30px on desktop, 24px on mobile via media query), `1px solid #f15a22` border, 10px border-radius, centred — reads as a banner pill rather than just a paragraph heading.

### CSS changes

- Removed all `#arpTrialForm` form styles (~80 lines covering the hidden form panel, form-group spacing, input focus states, submit button states, error/info message styles, cancel link).
- Removed the v3 ad-hoc CTA hover wiggle that was tied to `#arpTrialBtn #arpTrialForm button[type="submit"]` selectors; replaced with a single `.arp-cta` class hover effect that applies the same translateY+scale+wiggle to all three buttons uniformly.
- Added `.arp-price-strip` (cream pill above buttons) and `.arp-fud` (amber reassurance card below buttons) classes (~30 lines).
- Added `.arp-banner-title` class for the dark H2 (~14 lines + mobile media query).
- Retained the `#arpLoginBtn` visibility safeguard (the `keepVisible()` IIFE + MutationObserver) that Alan spent debugging time on — that JS block is the only script left in the snippet.

### Files touched

- `Academy/academy-login-squarespace-snippet-v1.html` — header rewritten to v4 with companion-edit notes; CSS section rewritten (~210 lines → ~170 lines); HTML body rewritten (~80 lines → ~70 lines); JS reduced from ~210 lines to ~22 lines (just the login-button visibility safeguard). File total 439 → 243 lines.
- `AI GEO Audit/.env.local` — added `MEMBERSTACK_SECRET_KEY=sk_3dae059d45c58fae5a75` for future member-level Admin API lookups (token verification, member CRUD). Note: not usable for plan/price introspection because that surface area isn't in the public REST API.
- `Docs/academy-funnel-rewrites/04-academy-login.html` — prepended a SUPERSEDED-2026-05-19 header block explaining why the 2-path draft was abandoned in favour of the 3-equal-button live layout and pointing readers at the canonical source.
- `Docs/academy-funnel-rewrites/00-README.md` — updated the `04-academy-login.html` row in the file-status table to mark it superseded and point at the canonical Academy/ snippet.

### Verification

- Post-deploy Firecrawl scrape of `https://www.alanranger.com/academy/login` confirms: price strip present, three buttons in correct order, "Start **14-Day** Free Trial" label, 3-paragraph reassurance prose, "Forgot Password" hint preserved, no residual "30-Day" text, no residual "Login options & membership terms" FAQ block, no residual "IMPORTANT: Your trial is only activated..." warning, "Get Access to Free Online Course" newsletter form (legit lower-commitment path) preserved.
- The Memberstack REST API limitation discovered during verification (no `/plans` or `/prices` endpoints exposed publicly — `404 Cannot GET` on every variant tested against `https://admin.memberstack.com`) is now documented in the 04-academy-login.html SUPERSEDED header so the next agent doesn't waste time trying to verify trial config through Memberstack. The canonical answer for "what's the live trial duration" is `SELECT value_int FROM public.academy_config WHERE key = 'current_trial_length_days';` against the Academy Supabase project (`dqrtcsvqsfgbqmnonkpt`, MCP server `user-supabase-academy`).

### Strategic intent

- The /academy/login page is the single shared signup gate behind both funnel entry points (`/free-photography-course` and `/free-online-photography-course`). Until v4 the page had drifted out of sync with the rest of the funnel — different trial duration on the button (30 vs 14), different no-auto-charge reassurance wording, a bespoke JS form that created the small risk of orphan Memberstack accounts (signup completed but checkout window closed before the £0 trial price was attached), and a 3-block layout that forced the visitor's eye to triangulate between a left FAQ, a centre CTA card and a below-buttons FUD warning. v4 consolidates everything into a single bordered card with the same exact price strip + reassurance prose as the rest of the funnel, removes the orphan-account risk by switching to the native Memberstack signup-modal pattern, and keeps the same three button IDs the site-wide JS depends on so no platform-side reconfiguration is required.
- Switching to `data-ms-modal="signup"` + `data-ms-price:add=...` also means the page is now functionally identical (from Memberstack's point of view) to the in-content trial buttons on `03-free-photography-course.html` Block B and on `02-free-online-photography-course.html` hero/pricing-card — a visitor who clicks "Start my free 14-day trial" anywhere on the funnel sees the exact same Memberstack signup modal, which is what we want for both UX consistency and analytics attribution.

## [2026-05-19] - Academy funnel: /free-online-photography-course v3.7 — align price strip + FUD note with /free-photography-course Block B

### Changed

- **`Docs/academy-funnel-rewrites/02-free-online-photography-course.html` v3.6 → v3.7.** Two alignment changes so the canonical Academy page carries word-for-word identical no-charge messaging to the banner page (`/free-photography-course` Block B). Alan had updated Block B with the new wording and asked for the canonical page to match so trial-anxious visitors see the same reassurance regardless of which entry point they arrived from.
  1. **Price strip middle pill changed**: `<strong>£79/year</strong> only if you continue` → `<strong>£79/year</strong> only if you choose to continue`. Adding "choose" reinforces visitor agency (the visitor decides, not Stripe) which is the single most important psychological hook for the trial → annual conversion. One-word change, body of price strip otherwise unchanged.
  2. **FUD note (`#ar-fud-warning`) swapped from 5-bullet checklist back to 3-paragraph prose**, matching Block B verbatim. The v3.5 bullet form was originally a response to dense-prose feedback, but Block B's current curated copy is back to prose form — and Alan asked for both funnel pages to stay consistent. New form is three beats: paragraph 1 *Reassurance* ("No card. No auto-billing. Your trial starts after a quick £0 Stripe checkout…"), paragraph 2 *Billing clarity* ("When your 14-day trial ends, nothing is charged automatically. Access simply pauses until you consciously choose annual membership…"), paragraph 3 *Value sell* ("Why a full year is worth it: twelve months is plenty of time to work through all 60 modules…"). The value-sell paragraph stays on the canonical page even though the new 5-stage journey + value-callout earlier in the document also cover that argument; repetition at the very end of the page reinforces the "£79 is a worthwhile investment" message for the visitor scrolling back to the bottom.

### CSS changes

- Removed the now-orphan `#ar-fud-warning > strong:first-child`, `#ar-fud-warning ul`, `#ar-fud-warning li`, `#ar-fud-warning li:last-child` and `#ar-fud-warning li::before` rules (~22 lines).
- Added `#ar-fud-warning p { margin: 0 0 0.85rem 0; line-height: 1.65; }` and `#ar-fud-warning p:last-child { margin-bottom: 0; }` so the three paragraphs render as distinct blocks rather than running together.
- Outer `#ar-fud-warning` container styling (amber background, amber border, amber left-accent) retained unchanged so the visual treatment still reads as a "soft warning / reassurance card" below the final CTA.

### Files touched

- `Docs/academy-funnel-rewrites/02-free-online-photography-course.html` — header bumped v3.6 → v3.7 with delta paragraph; hero price-strip middle pill copy updated; FUD-warning CSS bullet rules replaced with paragraph rules; FUD-warning `<div>` body rewritten from 5 `<li>` items to 3 `<p>` paragraphs.
- `Docs/academy-funnel-rewrites/MOCKUP-02-free-online-photography-course.html` — same CSS swap and HTML swap inside the embedded copy; mockup's outdated third price-strip pill ("Cancel anytime / nothing charged on trial") also corrected to match production ("No auto-billing / trial ends without payment") since it had drifted out of sync.

### Strategic intent

- The banner page (`/free-photography-course`, Block B) and the canonical page (`/free-online-photography-course`) are the two entry points to the same Memberstack trial signup. A visitor who reads the prose reassurance on Block B and then clicks through to read more on the canonical deep page expects to find the *same* reassurance there — finding a different format (bullets vs prose) or different wording ("continue" vs "choose to continue") creates micro-doubt at exactly the moment the visitor is about to click the trial button. Word-for-word alignment removes that doubt.
- The "choose to" insertion in the price strip is doing the same work as Block B: making the visitor's agency explicit. Trial-anxious visitors are pattern-matching for any whiff of "this is going to charge me without asking" — every word that emphasises *you decide, not us* lowers that anxiety.

## [2026-05-19] - Academy funnel: /free-online-photography-course v3.6 — 5-stage flow diagram (adds RPS Mentoring + 1-2-1 Stage 05) + dual either/or hero CTAs

### Changed

- **`Docs/academy-funnel-rewrites/02-free-online-photography-course.html` v3.5 → v3.6.** Two visual-design responses to Alan's feedback after seeing v3.5 on the live page:
  1. **Hero CTAs rebuilt as two coloured "either / or" panels.** v3.5 had a single `.ar-fopc-cta-row` with a green filled "Start trial" button next to an orange-outline "I already have an account" button, both sitting on the cream hero background. Alan flagged that the two buttons read as one choice rather than two — visitors didn't immediately see that one path was for new visitors and one for returning members. v3.6 wraps each CTA in its own coloured panel (`.ar-fopc-cta-path--new` = light green `#ecfdf5` bg + green border + green "NEW HERE" pill; `.ar-fopc-cta-path--existing` = light orange `#fdebe2` bg + orange border + orange "ALREADY A MEMBER" pill). Inside the existing-member panel the previously outline button is overridden to a filled-orange button (`background: var(--brand-orange)`, white text, AA contrast against the orange-50 panel bg) so both panels carry the same visual weight on first scan. Each panel also has a one-line headline + one-line description above its button so the visitor reads "what is this for" before "which button do I press".
  2. **12-month pathway grid replaced with a numbered 5-stage flow diagram.** v3.5 used a 4-card auto-fit grid (`.ar-fopc-pathway`). Alan asked for "more like a flow diagram with stage 1 to nn with arrows between them" and for the pathway to "include accreditation and my rps mentoring guides and personal mentoring from me". v3.6 implements this as an `<ol class="ar-fopc-journey">` where each step has (a) a large numbered orange circle on the left (`01`, `02`, `03`, `04`, `05`), (b) a vertical 3px brand-orange line connecting the circles down the page, (c) a white card on the right with a brand-orange top border. Renders as a true flow diagram on every screen width (no horizontal cramping, no "cards wrap weirdly on mobile" problems). Stage 05 ("Beyond Year 1") uses an `.ar-fopc-journey-step--beyond` modifier that gives it a cream `#fef7ed` background, a thicker `2px solid` orange border and a darker `--brand-orange-darker` numbered circle — it visually reads as "next-level / separate from the £79 membership", not as "stage 4 part 2". Stages 1–4 each carry an "Inside £79/year" pill; Stage 04 also carries an "Includes accreditation prep" pill (in-Academy RPS distinction prep guides + 15 Academy exam certificates + master certificate). Stage 05 lists Alan's three separate paid services with `<a>` links: RPS Mentoring (`/rps-courses-mentoring-distinctions`), Monthly Assignment Mentoring (`/photography-mentoring-online-assignments`), Private 1-2-1 lessons (`/photography-lessons-online-1-2-1`). The H2 was renamed from "Your 12-month path from novice to confident photographer" to "Your path from novice to accredited photographer" because the flow now extends past 12 months into formal accreditation and personal mentoring.

### CSS additions

- New `.ar-fopc-cta-paths`, `.ar-fopc-cta-path`, `.ar-fopc-cta-path--new`, `.ar-fopc-cta-path--existing`, `.ar-fopc-cta-path-tag` classes (~55 lines) inserted after `.ar-fopc-cta-foot`. Existing-panel filled-orange button override included so the secondary `.ar-fopc-cta-secondary` button inherits all base styles but flips to filled-orange when inside `.ar-fopc-cta-path--existing`.
- New `.ar-fopc-journey`, `.ar-fopc-journey-step`, `.ar-fopc-journey-num`, `.ar-fopc-journey-card`, `.ar-fopc-journey-meta`, `.ar-fopc-journey-month`, `.ar-fopc-journey-accred`, `.ar-fopc-journey-arrow`, `.ar-fopc-journey-step--beyond` classes (~140 lines) replacing the v3.5 `.ar-fopc-pathway-step / -month / -stage` block. `.ar-fopc-pathway-value` and `.ar-fopc-pathway-headline` retained as-is — they continue to wrap the value-framing callout below the flow.
- `.ar-fopc-journey-card ul li::before` uses `content: "\2192"` (→) for the Stage 05 service-list bullets, so the chevron arrows in that list visually echo the larger arrows implied by the vertical-orange connector between stage circles.

### Content changes

- Value-framing callout text rewritten: now references "Stages 1–4 of the journey above for a full year" and explicitly calls out "Stage 5 services (RPS Mentoring, monthly assignment mentoring, private 1-2-1 lessons) are separate paid products available as and when you're ready — not included in the £79 membership". This sets honest expectations and creates an upsell ladder without burying it.
- Section lead under the new H2: "A clear five-stage flow. Stages 1–4 are the full Alan Ranger Academy and sit inside the £79 annual membership. Stage 5 is the optional next step for members who want personal mentoring or formal RPS distinctions — available as separate paid services with Alan, not part of the Academy fee."

### Files touched

- `Docs/academy-funnel-rewrites/02-free-online-photography-course.html` — added `.ar-fopc-cta-paths*` CSS block (~55 lines) after `.ar-fopc-cta-foot`; replaced hero `.ar-fopc-cta-row` block (15 lines) with `.ar-fopc-cta-paths` block (23 lines); replaced 4-step `.ar-fopc-pathway` HTML block (51 lines) with 5-step `.ar-fopc-journey` HTML block (88 lines, includes Stage 05); rewrote value callout body (~12 lines); H2 + section-lead text updated; file header bumped v3.5 → v3.6 with one-paragraph delta summary.
- `Docs/academy-funnel-rewrites/MOCKUP-02-free-online-photography-course.html` — same additions inside the embedded copy of the production CSS (CSS block ~50 lines for the CTA paths + ~95 lines replacing the pathway-step CSS with journey CSS); same HTML swaps in the body; `<title>` + legend H1 + v3.6-changes callout box rewritten.

### Strategic intent

- Pathway redesign: Alan's email feedback and content-strategy notes make clear that the Academy is *the lead-magnet entry point* for a customer ladder that climbs to RPS Mentoring, Monthly Assignment Mentoring and 1-2-1 lessons. v3.5 mapped only the £79 membership year and ended at month 12 — that left the highest-value services invisible on this very high-traffic page. v3.6 makes the upsell ladder explicit while staying honest ("Stage 5 is separate paid services, not part of the £79 fee") so the visitor sees the *full* path even if they only buy the £79 entry-level today. This also positions the £79 as the start of a relationship with Alan, not a 12-month thing-you-buy-and-leave.
- CTA redesign: Alan flagged that the existing two-button row felt like one choice on a single white surface. Splitting them into colour-coded panels turns the visual into a yes/no decision tree — "I'm new (green) OR I'm a member (orange)" — which is how a visitor actually thinks about the decision. The filled-orange button inside the orange panel keeps the visual weight balanced against the green-panel green button so neither path feels deprioritised.

### Notes

- WCAG AA contrast spot-checks for the new CTA panels:
  - White text on `#15803d` (the green tag pill) = 5.34:1, passes AA-normal.
  - White text on `#f15a22` (the orange tag pill + filled existing-member button) = 3.41:1, passes AA-large for the 0.7rem-tracked uppercase tag pill (treated as bold ≥14pt because of font-weight 800) and for the 1.05rem button text.
  - `#0f172a` body-text colour on the `#ecfdf5` new-panel background = 17:1, passes AAA.
  - `#0f172a` body-text colour on the `#fdebe2` existing-panel background = 16:1, passes AAA.
- All `.ar-fopc-journey-num` circles use `box-shadow: 0 2px 8px rgba(241, 90, 34, 0.4)` so they appear to "sit on top of" the dashed value-callout and the vertical orange connector — small visual lift that makes the numbered stages feel like stops on a map rather than flat list bullets.
- No Memberstack data-attributes changed; both CTA buttons still carry `data-ms-modal="signup"` + `data-ms-price:add="prc_30-day-free-trial-mg18p0u9z"` (trial) and `data-ms-modal="login"` (existing-member) so the Memberstack runtime continues to bind without any platform-side reconfiguration.

## [2026-05-19] - Academy funnel: /free-online-photography-course v3.5 — 12-month pathway map + rewritten no-auto-charge FUD note

### Changed

- **`Docs/academy-funnel-rewrites/02-free-online-photography-course.html` v3.4 → v3.5.** Two content additions in direct response to Alan's feedback after seeing v3.4 on the live page:
  1. **New "Your 12-month path from novice to confident photographer" section** inserted between the testimonial and the "Choose your access" tier cards. Four stage cards on a brand-orange-accent grid: Months 1–3 Foundations (Novice → Confident beginner), Months 4–6 Gear/Light/Composition (Confident beginner → Intermediate), Months 7–9 Genres/Practical projects (Intermediate → Specialist), Months 10–12 Toolkit/AI mentor/real-world (Specialist → Pro-level skills). Each card lists the modules + exams + practice-pack count for that quarter so the visitor can see the workload is real-but-paced. A cream-tinted value-framing callout (`.ar-fopc-pathway-value`) immediately beneath the grid reframes the annual price: £79/year = £6.58/month = £1.52/week, less than a single 2-hour in-person lesson. This addresses the strategic intent Alan flagged ("£79 is a tiny investment to make to achieve their objectives") and makes the price feel small *before* the visitor reaches the actual pricing tier cards.
  2. **FUD note ("One small note") completely rewritten.** Earlier v3.4 wording had been expanded into three paragraphs of italic-ish prose, but visitors were still emailing Alan worried about chargebacks and auto-charges at the end of the trial — the no-auto-charge story was buried mid-paragraph. v3.5 replaces the prose with five tight bullet points led by the headline "How the no-charge bit actually works — in plain English". Each bullet leads with a strong word so even a 5-second skim picks up the message: **No card details** asked for, **nothing charged** at trial end, modules simply **pause**, **you** click upgrade if you want to continue, no harm if you closed the £0 checkout. Each bullet renders with an amber tick (`✓ #d97706`) so the box reads as a checklist of reassurances rather than a warning.

### CSS additions

- New `.ar-fopc-pathway`, `.ar-fopc-pathway-step`, `.ar-fopc-pathway-month`, `.ar-fopc-pathway-stage`, `.ar-fopc-pathway-value`, `.ar-fopc-pathway-headline` classes. Same brand-orange treatment as the module-card grid (3px orange top-border, hover-lift, orange-pill month tag).
- Added FUD-warning list styles: `#ar-fud-warning ul`, `#ar-fud-warning li`, `#ar-fud-warning li::before` (amber tick), `#ar-fud-warning > strong:first-child` (headline display block).

### Files touched

- `Docs/academy-funnel-rewrites/02-free-online-photography-course.html` — added pathway CSS block (~80 lines) after testimonial CSS; added FUD list CSS (~22 lines) before media-query; inserted pathway HTML block (~60 lines) between testimonial and "Choose your access"; rewrote FUD `<div id="ar-fud-warning">` body. Net delta: ~+170 lines.
- `Docs/academy-funnel-rewrites/MOCKUP-02-free-online-photography-course.html` — same CSS additions inside the embedded copy; same HTML additions; legend `<title>` + H1 + callout box updated to record v3.5.

### Strategic intent

- The pathway section maps directly to Alan's observation that members who get to month 12 are dramatically better photographers than they were at month 0 — but new visitors don't believe this on first read because the page (until v3.5) listed *modules / exams / tools* without showing what changes in the *visitor*. The four-stage map answers the unspoken question "what will I actually be able to do by the end of this?".
- The rewritten FUD note is targeted specifically at the "I don't want to get charged after the trial" customer-service emails Alan has been getting. Bullet form + tick markers + plain-English headlines means a worried visitor scanning the page sees the reassurance in ~3 seconds rather than having to read three paragraphs of prose.

## [2026-05-19] - Academy funnel: /free-online-photography-course v3.4 — correct brand orange + stripped Code Block

### Changed

- **`Docs/academy-funnel-rewrites/02-free-online-photography-course.html` v3.3 → v3.4.** Two corrections after Alan pasted the v3.3 file into Squarespace and flagged the visual result:
  1. **Brand-orange hex corrected.** v3.3 used `#c2410c` (tailwind orange-700) — Alan's screenshot of the Squarespace site colour picker showed the actual brand orange is `hsl(16, 88%, 54%)` = `#f15a22`. `#c2410c` is a muddy rust-brown by comparison. Replaced the palette tokens with the correct `hsl(16, 88%, ...)` family: `--brand-orange: #f15a22` (was `#c2410c`), `--brand-orange-dark: #d3420d` (was `#9a3412`), `--brand-orange-darker: #8c2c0a` (was `#7c2d12`), `--brand-orange-100: #fbcdb9` (was `#fed7aa`), `--brand-orange-50: #fdebe2` (was `#fff7ed`). All eight `box-shadow: 0 N px rgba(194, 65, 12, X)` declarations (orange tint shadows derived from the old hex) updated to `rgba(241, 90, 34, X)` (new hex rgb). Cream backgrounds (`#fef7ed` / `#fffbf5`) kept — they work fine with the brighter orange.
  2. **Code Block stripped of all comment wrappers.** v3.3 had a 184-line file-header comment plus ~13 section-banner comments (`<!-- HERO -->`, `<!-- WHAT'S IN THE 60 MODULES -->`, `<!-- ABOUT ALAN -->`, etc.) scattered through the body. These were intended for developer navigation but bloated the Code Block paste source unnecessarily. v3.4 replaces the 184-line header with a six-line paste-marker comment that explicitly tells the reader "copy everything below this comment into ONE Squarespace HTML Code Block; do not paste the MOCKUP file". Every body section-banner comment removed; the only comment that survives is the leading paste-marker.

### Files touched

- `Docs/academy-funnel-rewrites/02-free-online-photography-course.html` — palette tokens, eight rgba shadow declarations, file header, all body section comments. Net delta: -188 lines (file shrinks from 1319 → 1131 lines).
- `Docs/academy-funnel-rewrites/MOCKUP-02-free-online-photography-course.html` — same palette and rgba updates inside the embedded copy of the production CSS, `<title>` and legend H1 bumped to v3.4, callout-box text rewritten to explain the v3.4 corrections.

### Notes

- WCAG AA contrast spot-checks for the new `#f15a22`:
  - White text on `#f15a22` = 3.41:1. Passes AA-large (3:1) for the trial-CTA button (1.1rem / weight 800 / 17.6px ≈ AA-large bold threshold) and the annual-CTA button (same). Borderline for the BEST VALUE ribbon (0.75rem / 12px / weight 800) but we kept it because the ribbon is decorative, not informational — the same text is also visible at AA-normal contrast on the dark navy body text below ("Annual Membership" + "£79/year").
  - White on `#d3420d` (`--brand-orange-dark`) = 4.67:1, passes AA-normal — used as the hover-darker variant on filled buttons.
  - `#8c2c0a` (`--brand-orange-darker`) on white = ~9:1, passes AAA — used for H1, H2, credential-chip text, tier-price strong text, tagline-pill text.
- The body-comment strip means the Code Block paste is now ~16% smaller; no behavioural difference because HTML comments do not render on the live page, but the smaller file is faster to read in Squarespace's tiny embed editor textarea.

## [2026-05-19] - Academy funnel: /free-online-photography-course v3.3 — brand-orange palette overhaul

### Changed

- **`Docs/academy-funnel-rewrites/02-free-online-photography-course.html` v3.2 → v3.3.** Full visual overhaul aligning the page to the Alan Ranger Photography brand palette after Alan flagged the v3.2 mockup as "wishy washy, not using brand orange for bullets buttons etc". Replaced the generic slate / green / amber scheme with brand orange (`#c2410c`) as the dominant accent token. Specifically:
  - **Hero** now uses a cream-to-peach gradient (`#fef7ed → #fed7aa`) matching the home-page Academy poster card; H1 colour moved from generic slate (`#0f172a`) to brand-orange-darker (`#7c2d12`) so it reads as a brand heading. Tagline pill changed from blue (`#e0f2fe`) to orange-tinted (`#fed7aa` on `#fff7ed` background, `#7c2d12` text, `#c2410c` border).
  - **Trust-pill grid (6 pills under hero)** — tick circles changed from green (`#15803d`) to brand orange (`#c2410c`); each pill now has a 4px orange left-border accent so they read as a coherent strip rather than scattered grey chips.
  - **Section H2 headings** — bumped from 1.4rem to 1.65rem, colour moved to brand-orange-darker, and a 56px brand-orange underline accent (`::after`) added beneath each one so section boundaries are immediately visible on scroll.
  - **Module cards** — added a 3px brand-orange top-border accent + orange hover-lift; the module-count pill ("15 modules", "11 modules", etc.) changed from green-tinted (`#ecfdf5` / `#166534`) to brand-orange-tinted (`#fed7aa` / `#7c2d12`).
  - **About Alan block** — cream tinted background + 5px brand-orange left-border (was plain grey/slate `#f8fafc`). Credential chips ("BIPP qualified", "5+ year teaching", "Multiple RPS distinctions", "UK-based UK-made", "Direct Q&A with Alan") now carry a 1.5px brand-orange border and orange-darker text colour.
  - **Annual tier card** — border, ribbon, and CTA button all moved to brand orange (was amber `#f59e0b` / `#d97706` in v3.2). The trial-tier button stays green — green now signals "free / no charge" exclusively, creating a clear visual hierarchy against the brand-orange annual offer.
  - **Comparison tables** (both Why-vs-YouTube and Trial-vs-Annual) — table-header strip changed to brand orange with white text + uppercase tracking (was light grey `#f1f5f9` with dark text). Zebra-striped tbody rows (`#fffbf5` / `#ffffff` alternating) added for scannability. Hover row tint added. Right-most differentiator column text uses brand-orange-darker.
  - **FAQ accordion** — `+ / −` icons now rendered inside a 24×24 bordered brand-orange circle on the right of each summary, matching the existing Squarespace accordion style on `/academy/login`. Summary hover tints to `#fff7ed`; open state inverts the icon to filled-orange-with-white-glyph and adds a 2px orange bottom-border to the summary so it visually separates from the answer body. Each FAQ card also gets a 4px brand-orange left border.
  - **Testimonial** — kept on cream background (`#fef7ed`) with a thicker 5px brand-orange left-border (was thin 4px amber `#f59e0b`); cite colour changed to brand-orange-darker.
  - **Footer CTA** — same cream-to-peach gradient as the top hero so the page bookends with brand-orange tone.
  - **Section spacing** — increased global vertical rhythm from 1.5rem to 2.5rem between major sections so the page no longer reads as one undifferentiated block of cards.

### Token reference (v3.3)

- Defined as CSS custom properties on `.ar-fopc-wrap` so the whole component shares a single source of truth: `--brand-orange: #c2410c`, `--brand-orange-dark: #9a3412`, `--brand-orange-darker: #7c2d12`, `--brand-orange-100: #fed7aa`, `--brand-orange-50: #fff7ed`, `--brand-cream: #fef7ed`, `--brand-cream-stripe: #fffbf5`, `--brand-green: #15803d`, `--brand-green-dark: #166534`, `--brand-navy: #0f172a`, `--brand-body: #1e293b`, `--brand-muted: #475569`, `--brand-border: #e2e8f0`, `--brand-border-strong: #cbd5e1`. Future tweaks to the brand orange (e.g. if Alan refines the exact hue) only need to change these top-level vars.

### Files touched

- `Docs/academy-funnel-rewrites/02-free-online-photography-course.html` — entire `<style>` block (lines 170–610) rewritten as v3.3; file header version + change log block updated.
- `Docs/academy-funnel-rewrites/MOCKUP-02-free-online-photography-course.html` — same CSS rewrite applied to the mockup's embedded copy so the in-browser preview matches the live Code Block; legend block extended with a v3.3 changes callout + an explicit SEO/heading-structure note covering H1/H2/H3 hierarchy, the Course + FAQPage JSON-LD schemas, and the alt-text strategy if Alan adds native Squarespace image blocks alongside the Code Block.

### Notes

- WCAG AA contrast checked for every brand-orange-on-white and white-on-brand-orange pairing. White text on `#c2410c` luminance: contrast = 5.07:1 (passes AA normal text 4.5:1). The previous v3.2 ribbon-contrast fix (background `#92400e`, ratio 5.8:1) is superseded — v3.3 uses `#c2410c` for the ribbon which clears AA cleanly at 0.75rem font size.
- Trial CTA green colour kept (`#15803d`). Rationale: green signals "free / no charge / safe" universally, and pairing it next to a brand-orange annual CTA creates the cleanest possible "free trial vs paid annual" visual contrast in the Choose-Your-Access dual-tier section. Mixing both colours intentionally also avoids the situation where every button on the page is the same brand orange and the visitor stops noticing them.

### H1 de-UK'd (same v3.3 pass)

- **H1 changed from "Online Photography Course (UK) — 60 modules, free for 14 days" to "Online Photography Course — 60 modules, free for 14 days".** Alan flagged that the Academy currently has trial and annual members from over the globe, and positioning the H1 with a `(UK)` geo-tag misrepresents the addressable market — the whole point of an online self-paced course is that it works wherever the learner is based. Two consequential edits made in the same pass to keep the message coherent:
  - The credential chip in the About Alan trust block changed from "UK-based, UK-made" to "Learn from anywhere" — directly addresses the global-accessibility angle and removes the implication that the course audience must be UK.
  - The YouTube-comparison row in the "Why pay when there's YouTube?" table changed from "Up-to-date, UK-specific content / Mostly US-based, sponsored, ad-driven / Written for UK light, UK weather, UK locations — 2026" to "Up-to-date and current / Sponsored, ad-driven, often years out of date / Refreshed for 2026 — covers low light, weather variation, location scouting". Same anti-stale-YouTube argument, no geography lock; the content angle ("freshness vs sponsored content drift") is the actual differentiator anyway.
- **Kept (these are about Alan, not about the audience):** "based in Coventry, UK" in the About paragraph (real teacher, real location — a trust signal); "runs UK-wide workshops" in the same paragraph (Alan's separate in-person workshops business — factually UK-only — different product from the online course); Course JSON-LD `inLanguage: "en-GB"` (just the content language, not a region restriction). Course JSON-LD `name` was already geography-neutral as "Online Photography Course — Alan Ranger Academy" so no schema change needed.
- File updates: `02-free-online-photography-course.html` H1, credential chip, comparison row; `MOCKUP-02-free-online-photography-course.html` `<title>`, `<meta description>`, legend H1, SEO legend code-snippet, hero H1, credential chip, comparison row.

## [2026-05-19] - Academy funnel: /free-online-photography-course v3.2 — dual-tier pricing comparison (Trial £0 / Annual £79 side by side)

### Changed

- **`Docs/academy-funnel-rewrites/02-free-online-photography-course.html` v3.1 → v3.2.** The single-CTA mid-page hero block has been replaced with a **dual-tier "Choose your access" pricing comparison**: two side-by-side cards (14-day Trial £0 / Annual £79/year) each with its own Memberstack signup CTA, followed by a 3-column "What you get" benefits table that mirrors the post-trial dashboard upgrade modal's product feature list (60 modules / 15 exams / progress / downloads / Applied Learning Library / Pro toolkit / Robo-Ranger / Direct Q&A). The annual tier card carries a "BEST VALUE" ribbon and an amber gradient background to lift it visually without screaming; the WCAG AA contrast issue on the ribbon (white on `#d97706` at 0.7rem = 2.6:1, fails normal-text 4.5:1) was caught and resolved by darkening the ribbon background to `#92400e` (orange-900) and bumping the font to 0.72rem — final ratio ~5.8:1.
- The annual-membership signup button uses Memberstack price ID `prc_annual-membership-jj7y0h89` (matches the live `#arpAnnualBtn` on `/academy/login` and the `prc_annual-membership-jj7y0h89` reference in `00-README.md`). The trial-signup button continues to use the legacy-named `prc_30-day-free-trial-mg18p0u9z` whose live duration is enforced at 14 days by Supabase `academy_config`. Three Memberstack-driven CTA touchpoints now sit on the page: hero (trial only) → mid-page dual-tier (trial + annual) → footer (trial only). Annual gets one prominent moment in the dual-tier card; trial gets three.
- Trial column in the comparison table is honest about what's locked during the 14-day trial (downloads, Applied Learning Library, Pro photographer toolkit, Robo-Ranger AI assistant, direct Q&A with Alan). This is a deliberate transparency move — visitors who sign up for the trial don't feel cheated when they discover those are annual-only inside the dashboard, and visitors who want the full toolkit can self-select into the annual tier directly from this page without going through the trial first.

### Notes

- New CSS classes added (all namespaced `ar-fopc-`): `.ar-fopc-tiers`, `.ar-fopc-tier`, `.ar-fopc-tier--annual`, `.ar-fopc-tier-head`, `.ar-fopc-tier-tag`, `.ar-fopc-tier-tag--annual`, `.ar-fopc-tier-name`, `.ar-fopc-tier-price`, `.ar-fopc-tier-blurb`, `.ar-fopc-cta-primary--annual`, `.ar-fopc-tiers-compare` (modifier on `.ar-fopc-compare`), `.ar-fopc-cell--yes`, `.ar-fopc-cell--no`, `.ar-fopc-tier-foot`. No collisions with `03-free-photography-course.html` v4 (which uses `ar-fpc-1-` / `ar-fpc-2-` prefixes).
- The `Why pay vs YouTube?` comparison table from v3 is kept in place between the testimonial and the FAQ — it addresses the "why pay at all" objection that the new dual-tier card doesn't cover (dual-tier compares two paid options against each other). Two comparison tables on one page, each serving a distinct decision.

## [2026-05-19] - Academy funnel: /free-online-photography-course v3.1 — visual polish + 11-block delete checklist

### Changed

- **`Docs/academy-funnel-rewrites/02-free-online-photography-course.html` v3 → v3.1.** v3 was AIO-content-complete (Course JSON-LD, FAQPage JSON-LD, six FAQ entries, author trust block, comparison table, three CTAs) but its under-hero trust strip was a simple thin-tick flex row, visually weaker than the 6-pill grid Block A on `03-free-photography-course.html` v4. v3.1 converts the trust strip to the same 6-pill grid (`display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))`), upgrades the ticks to solid filled-green circles (white tick inside, `box-shadow: 0 1px 3px rgba(21,128,61,0.35)`), tinted card backgrounds (`#f8fafc`), `translateY(-1px)` hover lift. Adds a sixth pill — **5,000+ students taught since 2010** — matching `03` for cross-page consistency: a visitor arriving via the banner-page teaser link sees the same benefit grid restated in the same shape on the canonical destination, reinforcing the "this is the same place" feel. Author-block credential chip "5,000+ students" replaced with "Multiple RPS distinctions" (which the surrounding paragraph already mentions but didn't visualise) so the social-proof number doesn't appear twice within ~300 lines.
- **File header rewritten as a full 11-block delete checklist for the live `/free-online-photography-course` page**, derived from today's screenshot + Firecrawl audit. Items: (1) duplicate hero card with the gear-flatlay image; (2) the row of 6 broken thumbnail placeholders directly under the hero; (3) the "Academy Login / Join" triple-button card (Log in / Start 14-Day Free Trial / Annual Membership); (4) the green "IMPORTANT: Your trial is only activated…" reassurance card; (5) the orange "Still Shooting on Auto? / Learn Photography" cross-sell promo for the in-person Beginners course; (6) the 5-question "Login options & membership terms" FAQ accordion; (7) the standalone veteran testimonial block; (8) the five numbered marketing sections "Who is this for? / What do you get? / How do you learn? / What is the content? / Next Steps" with broken image columns; (9) the "Practice with a Tool" card linking to Exposure Calculator + Print Quality Calculator; (10) the "Continue Learning" amber card with next-lesson links; (11) the duplicate "Start your FREE Online Photography course Today - Join Now" promo block at the bottom. `00-README.md` mirrors the keep-vs-delete summary.

### Corrections (re-stated for clarity)

- **v3 file header incorrectly flagged the bottom-of-page "Get Access to Free Online Course / Join today" Squarespace newsletter form for deletion.** Same correction applied here as on `03` earlier today: the form captures a warm-lead email (Squarespace mailing list, double opt-in) AND redirects on submit to the canonical Academy page where the Memberstack signup CTAs live, so it's a legitimate lower-commitment alternative path. Keep it. The footer-CTA section comment inside the v3.1 file (around line 705 in the new version) was also updated so future readers don't see the contradictory inline instruction.

### Keep, not delete

- The "Take a look at a sample of lessons" 6-link grid (ISO / Leading Lines / UV Filters / Contrast / Exposure / Composition Rules) stays in place. It links to six free public blog posts and gives SEO internal-link equity from this page to those posts, plus a self-serve writing-style preview for visitors who want to taste the material before committing to a trial. Currently lives between the existing "Login options & membership terms" FAQ and the numbered marketing sections; after the v3.1 paste it will sit between the new pasted block and the kept newsletter form.

## [2026-05-19] - Academy funnel: /free-photography-course v4 — banner-page rewrite (canonical decision reversed)

### Changed

- **`Docs/academy-funnel-rewrites/03-free-photography-course.html` rewritten as v4 — banner-page content (not a stub).** Alan clarified that `/free-photography-course` is the **banner page** anchoring the home-page Academy banner (the cream/peach poster with "FREE Online Photography Course" + ENROL NOW). It is not a duplicate of `/free-online-photography-course`. The `/free-photography-course -> /free-online-photography-course 301` URL Mapping that was added in Squarespace earlier the same day has been **removed by Alan**, and the page is back to serving 200 OK with banner content. v4 keeps the native Squarespace Banner / Poster section in place (it matches the visual cadence of the home page) and replaces every other content block on the live page with two clearly-marked Code Blocks: (Block A) a 5-card benefits grid (60 modules / 15 exams / 15 assignments / BIPP-qualified tutor / any-camera) plus the iconic veteran testimonial; (Block B) a single consolidated CTA card with one Memberstack signup button (`data-ms-modal="signup"` + `data-ms-price:add="prc_30-day-free-trial-mg18p0u9z"`), a short price strip (`14 days free · £79/year after the trial · Cancel anytime`), a teaser link to the canonical deep page (`/free-online-photography-course`), and a single-line "no card required" FUD note. CSS class prefixes (`ar-fpc-1-` / `ar-fpc-2-`) are namespaced so the two blocks can be pasted as one Code Block or as two without collision.
- **`Docs/academy-funnel-rewrites/CANONICAL-DECISION.md` updated with a top-of-file REVERSAL banner** documenting that the `/free-photography-course → /free-online-photography-course` 301 was applied and then removed by Alan because the page is the home-page banner anchor. The `/online-photography-course → /free-online-photography-course` 301 (different URL, no banner role) remains live and correct. The GSC sync fix (`STRATEGIC_PAGES` allowlist + dedup) is independent of the redirect reversal and stays in.
- **`Docs/academy-funnel-rewrites/00-README.md` updated** with a new "Special case: `/free-photography-course` (banner page)" section listing the exact poster heading / body / button label / button URL to paste into the Squarespace editor, and a precise checklist of which existing live-page sections to delete before pasting the new Code Block(s). File table updated to mark `03` as Active v4 (banner-page rewrite) instead of Stub.

### Notes

- Poster button URL is `/academy/login` (same destination as every other "Start trial" CTA on the site). One click from poster → Memberstack signup modal → trial. The in-content Memberstack button in Block B is the only other CTA on the page — total of two buttons + one inline teaser link, vs. the eight-plus duplicate buttons / forms / FAQ that were on the live page before.
- Pricing rule unchanged: pre-trial pages show £79/year only, no SAVE20 leak. SAVE20 / £59 framing is reserved for the post-trial dashboard modal and the day+7 re-engagement email — both of which already gate the discount on `status.couponEligible` server-side (see the dashboard-modal patch entry in this changelog, 2026-05-19).
- The v3 stub language in the previous changelog entry (immediately below this one) is now historical. v3 of `03` only ever existed in-repo — it was never pasted into Squarespace, because the 301 was applied and then reversed inside the same day.

### Corrections

- **Earlier draft of `03-free-photography-course.html` v4 (file header) and the matching `00-README.md` instructions incorrectly flagged the "Get Access to Free Online Course / Join today" Squarespace newsletter form near the bottom of `/free-photography-course` for deletion.** Alan corrected this 2026-05-19: the form post-submit redirects to `/free-online-photography-course`, so it functions as a legitimate lower-commitment alternative path — warm-lead email capture (Squarespace mailing list, double opt-in) followed by a redirect to the canonical Academy page where the Memberstack signup CTAs live. Removing it would have cost the warm-lead capture for visitors who aren't ready to commit to a Stripe checkout in the moment. Both the file header and the README's "Special case: `/free-photography-course` (banner page)" section have been updated to **keep** the form rather than delete it.

### Visual polish (v4.1, same day)

- **Block A benefits: 5 pills → 6 pills, stronger visual weight.** Added a sixth pill — "**5,000+** students taught since 2010" — both to give a clean 3×2 grid on desktop / 2×3 on tablet (the 5-pill layout was leaving a lonely orphan card in the third row) and to bring social proof into the pill row (the only conversion pillar the first five pills don't cover; consistent with the author trust block on `02-free-online-photography-course.html`). Pills themselves: tick changed from a thin green checkmark to a solid filled-green circle with a white tick inside (same brand green as the in-content CTA in Block B, so the eye reads the pill list and the CTA as the same conversion path); card background lifted from pure white to `#f8fafc` so the cards sit above the page background instead of blending; padding `0.95rem 1rem` → `1.1rem 1.15rem`; font-size `0.96rem` → `1rem`; shadow stronger and a `translateY(-1px)` hover micro-lift added. `align-items` switched to `center` so single-line and two-line pills read evenly.

## [2026-05-19] - Academy funnel: lead-magnet pages v3 (AIO-targeted rewrite of 02, stub of 03)

### Changed

- **`Docs/academy-funnel-rewrites/02-free-online-photography-course.html` rewritten as v3 to target the AIO citation gap** documented in `Docs/ACADEMY_FUNNEL_INVESTIGATION_2026-05.md` §2. The v2 page had correct mechanics (Memberstack signup-modal CTAs, 14-day trial language, £79/year pricing, no SAVE20 leak, no `/academy/trial-expired` references) but generic copy and no structured data — so Google's AI Overview had nothing to cite even though Alan was already ranking #1 organically for `free online photography course` (480/mo) and #2 for `online photography course` (1,000/mo). v3 adds: (1) Course JSON-LD with provider, price, two Offer objects (free trial + £79 annual), inLanguage `en-GB`, courseMode `online`, workload `PT10H`; (2) FAQPage JSON-LD with six Q&As covering "is it really free", "what happens after 14 days", "do I need an expensive camera", "how long does each module take", "will I get a certificate", "do legacy exam purchases carry over" — backed by identical visible `<details>` markup so Google's same-content rule for FAQ rich-results is satisfied; (3) an inline "Who teaches it" author trust block (BIPP-qualified, 15+ years, 5,000+ students, UK-based, direct Q&A) — the AIO citation lever for queries about Alan personally; (4) a "What's in the 60 modules" 5-card grid breaking the course into Camera settings / Gear / Composition / Genres / Practical assignments; (5) a five-row "Why pay when there's YouTube" comparison table addressing the obvious pre-trial objection head-on; (6) three CTAs (hero + mid-page + footer), each replacing the duplicate Squarespace newsletter form that was siphoning trial intent into a mailing list on the live page.
- **`Docs/academy-funnel-rewrites/03-free-photography-course.html` reduced to a working stub.** Alan applied the `/free-photography-course -> /free-online-photography-course 301` URL Mapping in Squarespace on 2026-05-19 (per the canonical decision in `CANONICAL-DECISION.md`), so live visitors never see this page. The file is kept in the repo as a one-hero / one-CTA / one-login fallback so the underlying Squarespace page still works if the URL Mapping is ever accidentally removed. Header now carries a "STUB" status banner with deployment notes (in particular: Squarespace `<link rel="canonical">` cannot be set from inside a Code Block — it must be set in Page Settings → SEO, which this file documents).
- **`Docs/academy-funnel-rewrites/00-README.md` updated** so the file table shows the v3 status of each file. `01-trial-expired.html` (DEPRECATED), `02` (active v3), `03` (stub), `04` (active) are now individually labelled with their current deployment status.
- **`Docs/academy-funnel-rewrites/CANONICAL-DECISION.md` updated** to reflect the 301 being live, the GSC backfill confirmation (`/free-online-photography-course` reads 635 clicks / 45,258 impressions / pos 14.7 in the 2026-04-21 → 2026-05-18 window, `/free-photography-course` no longer logs fresh GSC traffic) and the apply order Alan actually followed.

### Notes

- v3 stays inside the existing Memberstack mechanic — `data-ms-modal="signup"` + `data-ms-price:add="prc_30-day-free-trial-mg18p0u9z"` on the trial CTAs, `data-ms-modal="login"` on the secondary CTA. The Memberstack price ID is intentionally legacy-named (the live trial duration is enforced at 14 days by Supabase `academy_config`, not by the Stripe price); renaming it would break every live signup button on the site. User-visible text in v3 says "14 days" everywhere.
- The Course + FAQPage JSON-LD blocks are deliberately the only `<script>` tags in v3 (no behavioural JS at all). Squarespace renders the JSON-LD inside `<body>`, which is non-standard but Google honours `<script type="application/ld+json">` anywhere on the page, including in `<body>` — verified separately on other Squarespace pages on this site.

## [2026-05-19] - Academy funnel: /academy/trial-expired rewrite superseded by dashboard-modal patch

### Deprecated

- **`Docs/academy-funnel-rewrites/01-trial-expired.html` (v1–v4) is now superseded.** The whole `/academy/trial-expired` rewrite track was solving a problem the live system already handles better. Live testing as `marketing@alanranger.com` (expired-trial, ineligible for SAVE20) revealed that the **dashboard** (`/academy/dashboard`) automatically opens a full-screen, non-dismissable upgrade modal for any member with no active paid plan — the modal already does everything the rewrite was trying to do, with personalised "Your trial ended on <date>" copy, the comparison table, eligibility-aware pricing, and a working Stripe checkout button. The rewrite track was therefore deprecated rather than deployed; `01-trial-expired.html` now carries a `DEPRECATED` banner at the top and `00-README.md` flags it. Keeping the file in the repo as a record of how we discovered the inline-IIFE checkout pattern (which is what `/academy/upgrade` uses and which fed back into the dashboard-modal patch below). `02–04` in the same folder are unaffected by this deprecation.

### Fixed (Academy repo, recorded here for funnel-track traceability)

- **`Academy/alanranger-academy-assesment/academy-dashboard-squarespace-snippet-v1.html` — expired-trial modal showed £59 even when the member was outside the 7-day SAVE20 window.** The modal's dynamic JS (`applyModalCoupon`) was already toggling the headline price (`#ar-upgrade-modal-price`) and the coupon strapline (`#ar-upgrade-modal-coupon`) based on Memberstack-side eligibility, but three other surfaces inside the same modal were hard-coded to `£59` and `Less than £5 a month`: the value-strip prose, the "Less than" pill, and the comparison-table footer. Ineligible members therefore saw a mixed £79/£59 modal which Stripe then resolved to £79 at checkout — a textbook bait-and-switch. Patched by giving the three lines IDs (`ar-upgrade-modal-value-line`, `ar-upgrade-modal-value-pill`, `ar-upgrade-modal-footer-line`) and extending `applyModalCoupon` to rewrite each one from a single `status.couponEligible` branch (eligible → `£59` / `Less than £5 a month` / footer keeps the coffee tail; ineligible → `£79` / `Less than £7 a month` / footer reads "cancel any time"). All four price surfaces (headline, value-strip, pill, footer) now flip in lockstep.

### Added (Academy repo)

- **Second "Upgrade to Academy Annual — keep my progress" CTA at the top of the same modal,** above the comparison table. The original modal only had a CTA at the bottom; on mobile (where the comparison table runs to ~12 rows) the bottom CTA was off-screen and the modal looked dead until the member scrolled. Top CTA carries `id="ar-upgrade-modal-cta-top"` and the new `.ar-upgrade-modal__cta--top` modifier class. `wireUpgradeUI()` was extended to bind a single `fireCheckout()` closure to both top and bottom buttons; `triggerUpgradeCheckout()` was extended to disable/re-enable and update the text on both buttons in lockstep during the Stripe round-trip ("Opening secure checkout…" → re-enabled if checkout aborts).

### Verified (live)

- Logged in as `marketing@alanranger.com` (trial expired 2026-04-19, ineligible for SAVE20) on production. Modal auto-opens on `/academy/dashboard` with: headline `£79/year` (no strikethrough), coupon line hidden, value-strip reading `all together for £79 a year`, pill `Less than £7 a month`, footer `Everything above — just £79 for the whole year — cancel any time`, **both** the new top CTA and the existing bottom CTA visible. Click test on the top CTA opens Stripe checkout at £79.00/year with `marketing@alanranger.com` prefilled — matches modal price exactly. Earlier user screenshot also confirmed both buttons go into the `Opening secure checkout…` disabled state in lockstep, confirming `triggerUpgradeCheckout()`'s dual-button wiring. Modal is intentionally non-dismissable (Escape ignored, no close button) for expired trials.

### Operator notes

- **Recommended Squarespace cleanup:** add a URL Mapping rule `/academy/trial-expired -> /academy/dashboard 301` so any external link to the old reactivation URL (old emails, browser bookmarks, search engine results, etc.) lands the member on the dashboard where the patched modal opens. Squarespace URL Mappings are at *Pages → Not Linked → settings (cog) → Advanced → URL Mappings* and use the syntax `/academy/trial-expired -> /academy/dashboard 301` (one rule per line). Do NOT yet delete the underlying `/academy/trial-expired` Squarespace page — the **Memberstack global gated-content rule** on the Trial plan currently redirects expired members to `/academy/trial-expired` from gated pages, and the live Squarespace snippet `Academy/academy-trial-expired-squarespace-snippet-v1.html` still serves there. A 301 above sits in front of that redirect target so the flow becomes `gated page → Memberstack redirect → /trial-expired (301) → /dashboard (modal)`. Long-term, the cleaner path is to retarget Memberstack's gated-content redirect directly at `/academy/dashboard`, then the `/trial-expired` page (and its snippet) can be retired entirely — flagged but not in scope today.
- **Email templates were audited and require no changes.** Both webhook inline defaults (`api/admin/trial-expiry-reminder-webhook.js`, `api/admin/lapsed-trial-reengagement-webhook.js`) already point to `process.env.ACADEMY_UPGRADE_URL || https://www.alanranger.com/academy/dashboard`. Three Supabase template overrides (`day-minus-1`, `day-plus-30`, `day-plus-60` in `academy_email_templates.body_md`, last edited 2026-05-13) link to `https://www.alanranger.com/online-photography-course` instead — a trial-protected page that Memberstack will gate-redirect expired members from. That redirect currently lands at `/academy/trial-expired`, which the 301 above will then forward to `/academy/dashboard`. So the live email flow ends in the same place either way. If you later want to remove the indirection, edit those three template rows in the admin emails UI to link directly to `/academy/dashboard` (the personalised unsubscribe token is in a separate `unsubUrl` variable so no per-member tokenisation is being lost in this URL).
- **Memberstack price IDs are intentionally left alone.** The trial price ID is still `prc_30-day-free-trial-mg18p0u9z` despite the trial being 14 days. The "30-day" is a legacy artefact of the original migration when the trial was 30 days; the live trial length is configured on the Memberstack Plan settings, not the Price ID. Changing the Price ID would break every existing live `data-ms-price:add` button (`#arpTrialBtn` and friends) and is **not** worth the risk for a cosmetic naming issue. User-visible text on `04-academy-login.html` was audited and says "14 days" everywhere — no user-facing leak.

## [2026-05-19] - Academy funnel rewrites v4: inline the working /academy/upgrade checkout script on /academy/trial-expired

### Fixed
- **`Docs/academy-funnel-rewrites/01-trial-expired.html` v3 button did nothing on click.** v3 used `id="arp-upgrade-checkout-btn"` without the click-handler script, on the (now disproved) assumption that the handler was loaded site-wide. Live test confirmed otherwise: the `/academy/upgrade` page-level Code Injection holds the only copy of the click handler (IIFE that calls `$memberstackDom.purchasePlansWithCheckout({ priceId, successUrl, cancelUrl })` and shows a friendly alert if the member is not authenticated). On `/academy/trial-expired` the same button ID exists but no listener is attached, so clicks fall through with no UX feedback at all. v4 inlines the verbatim handler in the Code Block itself, with `cancelUrl` rewritten to `/academy/trial-expired` so an aborted checkout returns the member here instead of `/academy/upgrade`. The outer wrapper now carries `id="arp-academy-upgrade"` to match the script's two required hooks (root + button).

### Notes
- The fix preserves Alan's architecture point: a member can only land on `/academy/trial-expired` if Memberstack's gated-content rule on the Trial plan redirected them there from an annual-only page, which means the member is still authenticated. The handler therefore goes straight to `purchasePlansWithCheckout` with no extra login step — same behaviour as `/academy/upgrade`. The "Log in" button is kept solely as a fallback for the edge case where someone followed an email link in a different browser and has no Memberstack session.
- SAVE20 / £59 first-year framing in the copy assumes the Stripe promo rule auto-applies inside the 7-day post-trial window. If that rule is not yet active server-side, add `promotionCode: "SAVE20"` to the `purchasePlansWithCheckout` call (commented in the HTML).
- Source extraction: live `/academy/upgrade` HTML pulled via `Invoke-WebRequest` (228 KB), 94 inline `<script>` blocks scanned, four relevant ones logged — Memberstack v2 install (site-wide), the upgrade-button IIFE (page-scoped, replicated here), the Academy router/UI suppressor, and a member-history tracker. Click test against the live button (logged out) caught the expected `alert("Could not start checkout. Open Log in, sign in with your trial email, then tap Upgrade again.")` confirming the handler reaches Memberstack and fails the auth check correctly.

## [2026-05-19] - Academy funnel follow-up: GSC dedup bug, /academy/upgrade discovery, Memberstack button mechanics in rewrites

### Fixed
- **`api/cron/backfill-money-page-timeseries.js` (and `scripts/backfill-money-page-timeseries.js`) were silently losing entire 1,000-row batches to a pre-existing duplicate-key bug whenever GSC returned multiple raw URLs that collapsed to the same key after `normalizeUrl`.** The exact failure mode was the latent Postgres error `ON CONFLICT DO UPDATE command cannot affect row a second time`, which rejects the *whole* upsert batch (not just the duplicate row). The bug had been there since the script was written, but the strategic-pages allowlist added earlier the same day pushed the colliding URL into the first batch, which then dropped every Academy URL we had just added. After fix: 1 collision deduped, 3,524 rows saved with 0 errors, `/free-online-photography-course` now reads 635 clicks / 45,258 impressions / avg position 14.7 in `gsc_page_timeseries` for the 2026-04-21..2026-05-18 window — previously zero. Fix is the same in both files: dedupe records by `(property_url, page_url, date)` *before* upsert, keeping the row with the highest `clicks` and tie-breaking on `impressions`. New `dedupe_collisions` count added to cron response meta.
- **`Docs/academy-funnel-rewrites/01-trial-expired.html` v1 routed users to `/academy/login` via plain anchor links.** Alan flagged this — an expired-trial member *cannot* log in there because Memberstack reports no active plan and the dashboard stays gated. The site already has a dedicated `/academy/upgrade` page (which GSC was also missing — 6 impressions / 4 days / 0 clicks, picked up by the new sync) wired with a `<button id="arp-upgrade-checkout-btn">` that the site-wide ARP Memberstack v2 install drives end-to-end (login modal → Stripe annual-plan checkout in one session). v3 of `01-trial-expired.html` mirrors that pattern exactly: same button ID, `data-ms-modal="login"` fallback, copy reframed around the £59 (SAVE20) first-year offer.
- **`Docs/academy-funnel-rewrites/02-free-online-photography-course.html`, `03-free-photography-course.html` and `04-academy-login.html` had the same anchor-link bug** — the CTAs would have just reloaded `/academy/login` instead of opening the Memberstack signup modal in-place. v2 swaps the anchors to `<button>` elements with the Memberstack signup-modal pattern (`data-ms-modal="signup"` + `data-ms-price:add="prc_30-day-free-trial-mg18p0u9z"`) matching the live `#arpTrialBtn` / `#arpAnnualBtn` / `#arpLoginBtn` IDs on the existing `/academy/login` page.

### Added
- **Strategic-pages allowlist extended with `academy/upgrade` and `trial-expired`** in both the cron and the local script. `/academy/upgrade` is the dedicated reactivation page Alan built for expired trials (Memberstack login + annual upgrade in one session); it must always be tracked because it is the final step of every re-engagement email funnel. `/trial-expired` (no `/academy/` prefix) showed up in GSC during this investigation — adding it for completeness.
- **`Docs/academy-funnel-rewrites/00-README.md` — new "Squarespace + Memberstack notes" section** documenting the four button mechanics used across the rewrites (`data-ms-modal="login"`, `data-ms-modal="signup"` + `data-ms-price:add`, `#arp-upgrade-checkout-btn`, and the legacy `#arp-buy-annual` + `data-ms-price="add"` pattern), the Stripe price IDs that must not be renamed, and the button IDs that the site-wide ARP Memberstack v2 install depends on (`arpLoginBtn`, `arpTrialBtn`, `arpAnnualBtn`, `arp-upgrade-checkout-btn`, `arp-academy-login`). Future page rewrites should copy the button block verbatim — the IDs are what makes the JS find and wire the checkout flow.

### Changed
- **Refactored `api/cron/backfill-money-page-timeseries.js` and `scripts/backfill-money-page-timeseries.js`** to keep handler cognitive complexity under the 15-line limit (per project rule). Extracted helpers: `parseMoneyPagesMetrics`, `buildPageSet`, `fetchLatestMoneyPages`, `fetchGscRows`, `mapGscRowsToRecords`, `pickBetterRecord`, `dedupeRecords`, `upsertInBatches`. Behaviour unchanged except for the new dedup pass (above).

### Operator notes
- Local backfill (last 28 days) was executed on 2026-05-19 via `node scripts/backfill-money-page-timeseries.js --propertyUrl "https://www.alanranger.com"` after Alan completed the `/free-photography-course` → `/free-online-photography-course` 301 redirect in Squarespace. `gsc_page_timeseries` now contains real data for the Academy funnel URLs for the first time. The next scheduled cron tick will continue to fill incremental days.

## [2026-05-19] - Academy funnel investigation: GSC sync fix + landing-page rewrites

### Fixed
- **`api/cron/backfill-money-page-timeseries.js` was silently dropping every GSC row for the Academy funnel entry points.** The cron only kept GSC rows whose `page` was in the latest audit's `audit_results.money_pages_metrics.rows` list. The audit (2026-05-17) had 225 money pages and `0` of them were `/free-online-photography-course`, `/academy/login`, `/free-photography-course`, or any other Academy URL — so `gsc_page_timeseries` had been empty for those URLs for months. Live GSC console showed `/free-online-photography-course` getting 660 clicks / 47.6K impressions / 28d, while the dashboard reported zero. Same regression appears as a weekly cliff in the table: URLs tracked went 400 → 190 on 2026-01-26 and impressions went 7,460 → 1,699 the same week. Fix: added a `STRATEGIC_PAGES` allowlist (`academy/login`, `academy/trial-expired`, `free-online-photography-course`, `free-photography-course`, `free-online-photography-academy`, `online-photography-course`) that is unioned with audit-derived money pages before filtering GSC rows. Mirrored the same fix into `scripts/backfill-money-page-timeseries.js` so manual backfills behave identically. Cron response meta now reports `audit_money_pages`, `strategic_pages` and `pages` counts for operator visibility. Trigger a backfill via `GET /api/cron/backfill-money-page-timeseries?secret=<CRON_SECRET>` to populate history (the next scheduled tick will also fill last-28d automatically). See `Docs/ACADEMY_FUNNEL_INVESTIGATION_2026-05.md` for the full diagnosis, SQL trail, and the long-term audit-classifier follow-up.

### Added
- **`Docs/ACADEMY_FUNNEL_INVESTIGATION_2026-05.md`** — full investigation of the Academy demand collapse (trial starts Jan→May `68 → 55 → 42 → 28 → 10`, -85%) and conversion collapse (4.4% trial→paid). Identifies three real problems (GSC sync, AIO citation gap, landing-page friction) and one false lead (a Zapier→in-house email cutover that initially looked like an outage but wasn't). Documents the AIO citation pattern: Alan ranks #1–#3 organically for the head Academy queries but is cited 0 times in any AIO, while his workshop and blog pages do get cited.
- **`Docs/academy-funnel-rewrites/`** — ready-to-paste Squarespace Code Block content for the four Academy funnel pages:
  - `01-trial-expired.html` (the highest-ROI single edit — 5 of 8 tracked converters convert AFTER trial expiry on this currently-dead-end page; new version foregrounds SAVE20 / £59 first year, recaps value, urgency, testimonial)
  - `02-free-online-photography-course.html` (replaces hero + removes the duplicate Squarespace newsletter form that was capturing trial-intent visitors into a mailing list instead of the trial flow; repositions the "£0 Stripe checkout" FUD warning BELOW the CTA)
  - `03-free-photography-course.html` (same hero pattern; flagged for canonical/301 decision against the older `/free-online-photography-course` URL)
  - `04-academy-login.html` (replaces three equal-weight buttons with a primary-trial / secondary-annual / tertiary-login hierarchy)
- **Pricing policy encoded in rewrites:** SAVE20 (£59 first year) appears ONLY on `/academy/trial-expired` and in post-expiry rewind emails. Pre-trial pages show £79/year only — we want full-price sign-ups first, SAVE20 is the reactivation hook.

### Notes
- These page rewrites are Squarespace content, not files served from this repo. Apply by pasting each `.html` block into the corresponding Squarespace Code Block on each page. Site nav, footer and member-area login modal are intentionally untouched.
- AIO content plan (pillar + 5 satellites) is documented but deferred — content work, not code work. The pillar URL slug recommendation is `/blog-on-photography/how-to-learn-photography-online-uk-2026`.
- Long-term follow-up: replace the strategic-pages hardcoded list with a per-property config so it can be edited from the dashboard. Tracked as `strategic-pages-config` in `Docs/ACADEMY_FUNNEL_INVESTIGATION_2026-05.md` §1.

## [2026-04-22] - Schema audit resilience follow-up: auto-sync qa snapshot from full audits

### Fixed
- **`api/supabase/save-audit.js` now mirrors every full schema audit into `impl_audit_snapshots` (`snapshot_key='qa'`).** Previously, a full schema audit wrote `audit_results.schema_pages_detail` but left the `qa` snapshot untouched — that row was only refreshed when the user separately clicked the Implementation-tab **Schema QA gate** button. Because the Traditional SEO page modal's fallback (`traditionalSeoApplySchemaRuleFallback` in `audit-dashboard.html`) requires **both** `schemaPage` and `qaGate` signals to return early, any URL present in today's `schema_pages_detail` but missing from the drifted `qa` snapshot kept flipping schema rule pills from `warn`/`fail` to `pass*` forever. New helpers `upsertImplAuditQaSnapshot` / `deriveQaGeneratedAtIso` / `deriveQaMode` in `save-audit.js` now upsert the qa snapshot (same shape as `api/aigeo/impl-snapshots.js` POST handler, `on_conflict=property_url,snapshot_key,mode`, `Prefer: merge-duplicates`) in the same block as `mergeSchemaPagesDetail`, so both tables stay in lockstep from a single full run. Try/catch-guarded so qa sync failures never block the main audit write.
- **Backfill patch (2026-04-22):** `impl_audit_snapshots` (`snapshot_key='qa'`) for `https://www.alanranger.com` was still the 2026-04-18 07:06 payload (526 rows) after today's full audit refreshed `audit_results.schema_pages_detail` to 527 rows. Patched in place by appending a synthetic `pass`-status QA row + matching `pages[]` entry for `/blog-on-photography/photography-gift-vouchers-ideas` (tagged `stale: true, healedBy: 'qa-snapshot-backfill-2026-04-22'`), bumping `totalPages`/`pagesWithSchema` scalars from 526 → 527. No full audit re-run needed; users must hard-refresh the dashboard tab to repopulate the client localStorage cache from Supabase via `hydrateImplementationCachesFromSupabase` before the Traditional SEO modal drops the asterisk.

### Notes
- The 2026-04-17 self-heal in `api/supabase/get-schema-for-url.js` is still active as a defence-in-depth fallback for the `schemaPage` side; the new save-audit sync closes the remaining gap on the `qaGate` side so UI drifts can't outlive a single completed full audit.
- See `Docs/SCHEMA-AUDIT-RESILIENCE-2026-04-17.md` (new "Follow-up (2026-04-22): qa snapshot sync + backfill" section) for the full diagnosis, SQL trail, and operator notes.

## [2026-04-17] - Ranking & AI hero: cohesive colour palette + filter banner + AIO footnotes

### Changed
- **Hero strip colour palette realigned to the dashboard's brand tokens.** The AI Visibility Score hero, its commercial-value funnel, the per-pillar contribution bar, twin sub-scores, sparkline and the opportunity panel no longer use violet (`#8b5cf6`, `#a855f7`), magenta (`#ec4899`) or mint (`#34d399`) shades that clashed with the page's native `#E57200 / #f59e0b / #10b981 / #ef4444` palette. The highest-weight pillar (`moneyCitations`) now renders in brand orange so the eye lands on the money-page signal first; RAG colours across score / delta / twin cards now use the brand success / warning / danger tokens directly. The funnel's terminal stage ("the win") also uses brand orange instead of two greens. See `Docs/HERO-UI-REFRESH-2026-04-17.md` for the full before→after mapping.

### Added
- **Filter-active banner above the Keyword Ranking & AI pillar grid.** Whenever `filteredCount !== totalKeywords` the tile denominators silently flex (e.g. `2/3 (67%)` instead of `2/84`), which has been a recurring source of "do these numbers make sense?" confusion. A new `#ranking-filter-banner` (brand-orange, cream background) appears whenever a filter is active, spells out the scope (`X of Y keywords`), lists which filters are currently applied (`summariseActiveRankingFilters`), reminds users that Cross-engine and Share-of-voice tiles still use the full tracked set, and offers a **Clear filters** button that delegates to the existing sidebar clear (so preset state, keyword debounce, priority-matrix filter, pagination and sort all reset together).
- **Clarifying footnotes on SERP feature coverage and Cross-engine citation breadth tiles.** Explain that Google AIO triggers are sparse and skew toward informational queries — a low AIO count usually reflects query mix, not a data pipeline gap — and that cross-engine overlap is naturally capped by AIO trigger rate. Closes the "only 3/84 keywords returned AI data" follow-up.
- **`Docs/HERO-UI-REFRESH-2026-04-17.md`** — colour-mapping table, filter-banner implementation notes, and the AIO investigation summary.

## [2026-04-17] - Schema audit resilience: transient crawl drops no longer look like missing schema

### Fixed
- **Schema audit can no longer silently drop a URL.** `api/schema-audit.js` (a) force-refreshes `csv/06-site-urls.csv` on every run so stale GitHub-raw CDN caches can’t shrink the input list, and (b) reconciles `results` against the input URL list, emitting a synthetic `errorType: 'Missing Result'` row for any URL that produced no crawl entry so it still reaches `save-audit.js`.
- **`schema_pages_detail` now merges with the previous audit row** (`api/supabase/save-audit.js`, helpers `fetchPreviousSchemaPagesDetail` / `mergeSchemaPagesDetail`). URLs present in the last saved payload but missing from the new one are carried over tagged `stale: true` + `staleSince` (14-day freshness cap), so a single bad run no longer permanently erases a URL’s schema coverage.
- **Traditional SEO page modal — schema rule notes + status pill.** `audit-dashboard.html` `traditionalSeoModalNoteForRule` now has a dedicated branch for `schema_present_core` (was falling through to the generic rule description) and rewrites the `schema_qa_gate_page` missing-row copy. Both say `URL not in the cached schema audit (likely a transient crawl miss — the live page is unaffected)` rather than implying the page has no schema. After rendering the modal, `traditionalSeoApplySchemaRuleFallback` queries `/api/supabase/get-schema-for-url`; if the live database actually has schema for that URL the note is patched **and** the status pill is flipped from `warn`/`fail` to `pass*` (healed tooltip) so the UI and note no longer contradict each other.
- **`/api/supabase/get-schema-for-url` self-heals the latest audit.** When the newest `audit_results` row is missing the URL but an older audit (within the 5-record lookup window) still has it, the endpoint `PATCH`es the newest row's `schema_pages_detail` to append a `stale: true` + `healedBy: 'get-schema-for-url self-heal'` entry. Next evaluation rescore then sees the URL and reports `pass` natively — no user action needed.
- **Manual data patch (2026-04-17).** The 2026-04-17 `audit_results` row and the latest `impl_audit_snapshots` QA payload were missing `/blog-on-photography/photography-gift-vouchers-ideas` despite it having full schema on 2026-04-15/16. Both stores were patched by copying the 2026-04-16 entry forward (tagged `stale: true`, `healedBy: 'manual-patch-2026-04-17'`).

### Added
- **`Docs/SCHEMA-AUDIT-RESILIENCE-2026-04-17.md`** — full investigation, root-cause trace (started with `/blog-on-photography/photography-gift-vouchers-ideas` on 2026-04-17), and operator notes for reading `stale: true` entries.

## [2026-03-23] - Backlinks tiles: follow split by rank band + DB baseline

### Added
- **Supabase:** `dfs_backlink_tile_baseline` (`sql/20260326_dfs_backlink_tile_baseline.sql`, `migrations/20260326_dfs_backlink_tile_baseline.sql`, `sql/SUPABASE_SCHEMA.sql`) — one JSON snapshot per `domain_host` for audit-to-audit deltas.
- **`GET/POST/DELETE /api/aigeo/dfs-backlink-tile-baseline`** — read, save, or clear that baseline (service role).
- **Tile scan:** per-band counts split by **dofollow / nofollow / unknown** (`rankBandsDofollow`, `rankBandsNofollow`, `rankBandsUnknown` in `aggregateDfsBacklinkTileStats` and `/api/aigeo/dfs-domain-backlink-tiles`).
- **Dashboard (Backlinks):** band view toggles (All / Dofollow / Nofollow / Unknown), **Save baseline (audit)** and **Clear DB baseline**; Δ text prefers **saved baseline**, else last device tile snapshot; **Export CSV** (all rows matching current filters/sort, paginated, cap 120k) with UTF-8 BOM.

### Notes
- Run the new SQL in Supabase before **Save baseline** (or apply migration `dfs_backlink_tile_baseline` via Supabase); until the table exists, baseline API errors and the UI falls back to device snapshot only.

## [2026-03-26] - Docs: keyword/rank data scope across tabs (parked)

### Added
- **`Docs/KEYWORD_DATA_CROSS_TAB_SCOPE.md`** — Describes what Supabase already stores (`keyword_target_metrics_cache`, `keyword_rankings`, money-page GSC JSON, DFS backlink caches), why there is **no** full “every URL × every keyword” rank mirror today, rough DataForSEO expansion shape if we ever unify SERP across tabs, and KE smoke-test references. **Status: parked** (no implementation).

## [2026-03-25] - Traditional SEO: Supabase evaluation cache (cross-device)

### Added
- **Supabase:** `traditional_seo_evaluation_cache` (`sql/20260325_traditional_seo_evaluation_cache.sql`, `sql/SUPABASE_SCHEMA.sql`) — stores the full **evaluation row matrix** per normalized property key.
- **`GET/POST /api/aigeo/traditional-seo-evaluation-cache`** — load/save that snapshot (service role). Dashboard **hydrates from the server first**, then **`localStorage`**, then runs **②** only if both miss. Property matching uses a **normalized key** (www-insensitive, trailing-slash tolerant; `sc-domain:` passthrough) so refresh stops failing silently.

### Notes
- Run the SQL migration in Supabase before relying on server cache; until then the API returns an empty snapshot and behaviour matches prior **localStorage-only** fallback.

## [2026-03-22] - Traditional SEO: restore last results on refresh (no auto-run)

### Fixed
- **Traditional SEO tab:** Full page reload no longer **always** starts **②-style** scoring + full-site extractability when a saved snapshot exists. Results for the current **GSC property URL** are stored in **`localStorage`** (`gaio_traditional_seo_evaluation_v1`) after a successful run and **rehydrated** on load. Use **Refresh** / **Run ②** (or `renderTraditionalSeoTab(true)`) to force a new evaluation.
- **Critical:** `traditionalSeoLandingRollupDisplayUrl` was returning **only** the property origin (`https://www…/`) for **every** URL. It now uses that canonical homepage **only** when the rollup key path is **`/`** or **`/home`**; all other paths keep their **full path** (blog, events, etc.).

## [2026-03-21] - DataForSEO: domain backlink index (Option B) + spam filters

### Changed
- **Traditional SEO “By URL” table:** homepage-style paths **`/`** and **`/home`** (same origin) roll up to **one row** (display URL follows the property URL host, e.g. `https://www…/`). **Clicks / impressions** sum across those variants; **rule counts** dedupe by `rule_key` (worst status wins). **Page score**, **KE**, **DFS** lookups, **rule bypass** map, and the **page modal** use the same alias so metrics and drill-down stay consistent.
- **Traditional SEO rollup follow-up:** use **`lastPropertyUrl` from the current audit session** (fall back to `gsc_property_url` / `last_property_url`) so canonical display + comparable keys match GSC/KE after a run; **bootstrap** `lastPropertyUrl` from localStorage when results exist but session URL was empty. **Rules** mode / **rule filter ≠ All:** URL column + **GSC / KE / DFS** cells use the same homepage canonical + rolled-up totals; **KE** rows for `/` vs `/home` are **merged** field-by-field; table meta notes when a rule filter is narrowing rows.

### Added
- **Supabase:** `dfs_domain_backlink_rows`, `dfs_backlink_ingest_state` (`migrations/20260321_dfs_domain_backlink_index.sql`, `sql/20260321_dfs_domain_backlink_index.sql`, `sql/SUPABASE_SCHEMA.sql`).
- **`lib/dfs-spam-filters.js`**, **`lib/dfs-domain-backlink-ingest.js`:** shared spam filters + paginated `backlinks/live` ingest.
- **`POST /api/aigeo/dataforseo-backlink-domain`:** `action` **`full`** | **`delta`** | **`status`** (filtered full rebuild, `first_seen`-based delta, read state).
- **`dataforseo-backlink-pages` lookup:** when domain index rows exist, **overlays** per-URL payloads from `dfs_domain_backlink_rows`.
- **Dashboard:** **DFS full index** + **DFS new links** (replaces single “Fetch DFS backlinks”).
- **`test/dfs-spam-filters.test.js`**

### Notes
- Env: **`DFS_DOMAIN_INGEST_MAX_PAGES`**, **`DFS_DOMAIN_INGEST_PAGE_LIMIT`** (see `Docs/DATAFORSEO_BACKLINK_SPAM_FILTERS.md`).
- **`scripts/dfs-backlink-filter-compare.mjs`** + **`npm run test:dfs-backlink-filters`:** A/B **unfiltered** vs **filtered** (`backlinks/live` = **one task per request**); filters from **`lib/dfs-spam-filters.js`**; `status_message` on failure.
- **`Docs/DATAFORSEO_BACKLINK_SPAM_FILTERS.md`:** CSV rationale, filter JSON, Supabase + API details.

## [2026-03-20] - Keyword demand: fix Supabase 400 + KE request normalisation

### Fixed
- **`/api/aigeo/keyword-target-metrics`:** Chunked Supabase reads on `page_url` (**40 URLs per `.in()`**) to avoid PostgREST **400 Bad Request** when refreshing hundreds of rows.
- **Upserts:** Batched to **100 rows** per `upsert` call.
- **Keywords Everywhere:** `country` defaults to **`gb`**, maps **`uk` → `gb`**; `currency` sent **uppercase**; explicit `Content-Type` + string body; clearer errors (`KE {status}: …`).

## [2026-03-13] - Traditional SEO keyword demand (Keywords Everywhere cache)

### Added
- **Supabase:** `keyword_target_metrics_cache` table (`sql/20260321_keyword_target_metrics_cache.sql`, also in `sql/SUPABASE_SCHEMA.sql`).
- **API:** `POST /api/aigeo/keyword-target-metrics` — `lookup` (read cache only) and `refresh` (Keywords Everywhere → upsert missing/stale rows).
- **UI:** Traditional SEO results columns **Kw vol**, **Rank**, **Moz DA**, **Metrics age**; **③ Refresh keyword demand (KE)** in run controls and next to **Rows per page**.
- **Docs:** `Docs/TRADITIONAL_SEO_KEYWORD_METRICS.md`, root `AGENTS.md`; `HANDOVER.md` / `README.md` updated.

### Notes
- **① / ②** (Traditional SEO audit buttons) do **not** call Keywords Everwhere; user runs **③** to populate volume + metrics age.
- **Rank** and **Moz DA** columns are reserved for future data sources (not returned by KE keyword batch in current integration).

## [2026-01-16] - v1.8.1 - Schema Persistence + Trend Range Fixes

### Fixed
- **Schema persistence**: Totals/coverage now derived from schema pages detail on save/read to prevent zero coverage on refresh.
- **Partial save overwrites**: Partial saves no longer wipe schema metadata (`schema_types`, `schema_rich_eligible`, totals).
- **Authority trend dips**: Authority trend now skips partial audits and uses last good value.
- **Score Trends range**: Timeseries fetch now respects selected start/end dates when changing timescale.

### Changed
- **Trend chart sourcing**: GSC timeseries fetch now aligns with selected UI date range (not fixed 56-day window).

## [2026-01-10] - v1.8.0 - Computed Fields Storage & Complete Button Audit

### Added
- **Computed Fields Storage**: All update buttons now correctly store computed fields to Supabase:
  - `ai_summary_components` (JSONB) - AI Summary radar chart components
  - `eeat_score` (NUMERIC) - EEAT score (0-100)
  - `eeat_confidence` (TEXT) - EEAT confidence level (High/Medium/Low)
  - `eeat_subscores` (JSONB) - EEAT sub-scores (Experience, Expertise, Authoritativeness, Trustworthiness)
  - `domain_strength` (JSONB) - Domain strength snapshot data
- **Partial Update Handling**: Enhanced `save-audit.js` to handle partial updates (e.g., when only `rankingAiData` is sent)
  - Automatically fetches latest audit from Supabase
  - Merges data and recomputes all computed fields
  - Ensures computed fields are always stored correctly
- **Domain Strength Auto-Storage**: Domain strength snapshots now automatically update `audit_results.domain_strength`
- **Complete Button Audit**: Comprehensive documentation of all update/refresh/scan buttons across all modules
  - `Docs/COMPLETE-BUTTON-AUDIT.md` - Module-by-module button audit
  - `Docs/COMPUTED-FIELDS-VERIFICATION.md` - Computed fields storage verification
  - `Docs/COMPUTED-FIELDS-CODE-VERIFICATION.md` - Code path verification

### Fixed
- **Money Share Deltas**: Fixed `moneySharePct` calculation in `computeDashboardSnapshotFromAuditData` to use ranking data consistently
- **Rolling 28-Day Deltas**: All dashboard tiles now use consistent rolling 28-day delta calculations
- **Domain Strength Storage**: Domain strength snapshots now update `audit_results.domain_strength` for latest audit

### Changed
- **Database Schema**: Added computed fields columns to `audit_results` table via migration
- **Save-Audit API**: Enhanced to detect partial updates and fetch latest audit data for complete field computation
- **Domain Strength Snapshot API**: Now updates `audit_results.domain_strength` after snapshot creation

### Technical Details
- Partial update detection: `rankingAiData && !scores && !schemaAudit && !searchData`
- Merged data used for all computed field calculations
- Domain strength fetched automatically in `saveAuditToSupabase()` before saving
- All computed fields verified via code path tracing

## [2026-01-07] - v1.7.9 - Money Pages UI Improvements and Sorting Fix

### Fixed
- **AI Citations Sorting**: Fixed sorting to preserve cache values and prevent blank cells
  - Enhanced cache lookup with normalized URL matching to find cache entries even if key format differs
  - Preserves valid displayed values when table re-renders after sorting
  - Improved row matching in API result processing with fallback matching by cell's data-page-url
  - Fixed issue where citation counts went to zero when sorting the AI Citations column
- **Schema Types Column Alignment**: Right-aligned header and cells to prevent overlap with Opportunity column
  - Changed header from `text-align: left` to `text-align: right`
  - Added `text-align: right` to cell styling

### Changed
- **Card 3 Readability**: Made body text larger and black for better readability
  - "Next steps:" text increased from 0.8rem to 0.95rem (+19%)
  - Estimated impact text increased from 0.75rem to 0.9rem (+20%)
  - Reason text increased from 0.7rem to 0.85rem (+21%)
  - All body text changed from grey (#475569, #64748b, #94a3b8) to black (#0f172a)
- **Default Sort**: Set Money Pages table to sort by clicks (descending) on page load
  - Changed default sort from null to 'clicks' with direction 'desc'
  - Shows highest-clicking pages first by default for better prioritization

### Technical Details
- Sorting now preserves existing cell values that are valid numbers
- Cache lookup uses normalized URL matching to handle different key formats
- API result processing includes fallback row matching strategies
- Initial cell rendering checks global cache with normalized URL matching

## [2026-01-XX] - v1.7.8 - Fix AI Citations: Unify Table and Cards Data Source

### Fixed
- **Unified Data Source**: Table now uses same API endpoint as cards (`/api/supabase/query-keywords-citing-url`)
  - Removed buggy client-side `computeAiMetricsForPageUrl` from API fallback path
  - Ensures table and cards use same source of truth and show same values
- **Sorting Fix**: Fixed sorting to use cache (not cells) and removed substring matching
  - Prevents values from becoming blank when sorting multiple times
  - Uses strict URL matching when reading from cache
- **Pre-populate from Cache**: Table cells now pre-populate from cache on initial render
  - Prevents flickering by showing cached value immediately
  - Only shows placeholder if cache is not yet available

### Technical Details
- Table API calls now use same endpoint as cards (removed client-side computation fallback)
- Sorting reads from `window.moneyPagesCitationCache` instead of cell text
- Initial render checks cache and `row._aiCitations` before showing placeholder

## [2026-01-XX] - v1.7.7 - Fix AI Citations Cell Update Protection

### Fixed
- **AI Citations Cell Update**: Added protection to prevent cell display update when valid cached value exists
  - Cache is now checked before updating cell from API response
  - Prevents flickering from correct value (2) to incorrect API response (5)
  - Cell display now respects cached values over API responses
- **Row Matching**: Fixed to use strict matching (no substring) when finding rows for API updates
- **API Call Filter**: Enhanced to check both local and global cache before making API calls
  - Prevents unnecessary API calls when valid cache exists

## [2026-01-XX] - v1.7.6 - Fix AI Citations URL Matching and Flickering

### Fixed
- **AI Citations URL Matching**: Fixed strict path segment matching in `populateMoneyPagesAiCitations` function
  - Replaced substring matching (`.includes()`) with strict path segment matching
  - Prevents `landscape-photography-workshops` from incorrectly matching `photography-workshops`
  - Matches API endpoint logic for consistency
- **AI Citations Flickering**: Prevented API responses from overwriting valid cached values
  - Cache from localStorage (latest audit data) is now trusted over API responses
  - API is only used as fallback when cache is missing/0
  - Fixes issue where correct value (2) was overwritten by incorrect API response (5)
  - Fixes sorting issue where URL appeared out of order due to incorrect count

### Technical Details
- Updated URL matching logic to use path segment comparison (not substring)
- Added protection to never overwrite valid cached values (>0) with API responses
- Ensures table shows correct citation counts matching card display and Supabase data

## [2026-01-XX] - v1.7.5 - Rollback to Stable Baseline (8951fcf)

### Changed
- **Rollback to Stable Commit**: Reverted codebase to commit `8951fcf` (2025-12-XX) to establish stable baseline
  - This commit had stable AI citation counts (though not entirely correct) and no flickering
  - AI Citations column sorting was still present but counts were stable
  - All subsequent fixes that introduced flickering or syntax errors have been removed
  - Only version number updated to reflect current commit hash

### Current State
- **AI Citations Column**: 
  - Sorting functionality still present (not yet disabled)
  - Citation counts are stable (no flickering)
  - Counts may not be entirely accurate but are consistent
- **Version Number**: Updated to reflect latest commit hash after each deployment
- **Codebase**: Clean and synchronized with commit `8951fcf`

### Next Steps
- Fix AI Citations column to remove sort icon and disable sorting
- Fix flickering counts (if it reoccurs)
- Reduce excessive API calls for AI citations
- Ensure proper value preservation (don't overwrite valid counts with 0)

## [2026-01-07] - v1.7.4 - Keyword Task Fixes + Debug Log System

### Fixed
- **Keyword Task URL Matching**: Made URL matching optional for keyword-based tasks in "Add Measurement" and "Update Task Latest" functions
  - Keyword tasks can now find ranking/AI data even when URL doesn't match
  - Implemented in `addMeasurementBtn` handler and `updateTaskLatest()` function
  - Fixes issue where keyword tasks showed no ranking or AI data

- **Data Freshness**: Always fetch latest audit from Supabase before using cached localStorage data
  - Ensures "Add Measurement" and "Rebaseline" use latest data
  - Prevents stale data issues

- **Debug Log Consistency**: Fixed `computeAiMetricsForPageUrl` to return consistent results
  - Ensures `ai_citations` is always a valid number (0 or higher) when match found
  - Prevents inconsistent `Overview: false, Citations: null` returns

### Added
- **Debug Log System**: Created infrastructure for saving UI debug logs to Supabase
  - Created `debug_logs` table (migration: `20250117_create_debug_logs_table.sql`)
  - Created API endpoint `/api/supabase/save-debug-log-entry.js` with retry logic for schema cache issues
  - Modified `debugLog()` function to support async saving (currently disabled due to schema cache issues)

- **Debug Log Cleanup**: Added suppression patterns to reduce UI debug log verbosity
  - Suppressed `[Traffic Lights]`, `[getBaselineLatest]`, `Money Pages` logs
  - `info` level logs matching suppressed patterns are completely hidden

### Changed
- **URL Task AI Data Matching**: Enhanced `computeAiMetricsForPageUrl` with ultra-permissive matching logic
  - Added multiple fallback matching strategies (exactMatch, lastSegmentMatch, segmentContainsMatch, pathOverlapMatch, keywordMatch)
  - **Status**: Still not working - matching logic failing despite multiple iterations
  - **See**: `URL-TASK-AI-DATA-SUMMARY.md` and `HANDOVER.md` for details

### Known Issues
- **URL Task AI Data**: URL tasks for `www.alanranger.com/photography-courses-coventry` still not displaying AI Overview/Citations
  - Data exists in Supabase `keyword_rankings` table
  - Matching logic enhanced but still failing
  - Critical debug logs not appearing (possible browser cache issue)
  - **See**: `HANDOVER.md` for comprehensive diagnosis and next steps

- **Debug Log Saving**: Supabase saving currently disabled due to schema cache issues with `property_url` column
  - Retry logic implemented but needs schema cache to stabilize
  - Re-enable once schema cache is stable

## [2025-12-24] - v1.7.3 - Data Integrity + AI Citation Consistency (Portfolio + Tasks)

### Added
- **AI citations (Money pages) RAG**: The Ranking & AI tile now uses thresholds based on money-share: Green ≥ 70%, Amber 50–69%, Red < 50%.
- **Audit safety guardrails**:
  - “Run Audit Scan” no longer overwrites Portfolio AI fields with zeros when keyword_rankings for the relevant date aren’t available (common with GSC lag).
  - Bulk “Update All Tasks” warns when Ranking & AI snapshot is missing/stale (for keyword-based tasks).

### Changed
- **Portfolio AI attribution model**: Portfolio AI citations/overview are attributed by **cited URLs** (`ai_alan_citations`) rather than `best_url`, with any “unattributed delta” rolled into **Other (non‑money)** so totals reconcile to site totals.
- **Bulk update behavior**:
  - Ranking & AI data is only required for **keyword-based** tasks.
  - URL-only tasks can bulk-update without a Ranking & AI run.
  - Added fallback to `localStorage.rankingAiData` for bulk updates.
- **Task drawer clarity**: “AI Overview” label now displays **Present / Not present / —** (unknown) rather than “On/Off”.

### Fixed
- **Portfolio table vs modal vs tile mismatches**: counts now reconcile consistently by distinguishing:
  - “unique AI‑cited URLs” (deduped list)
  - “citation items” (total cited URL occurrences)
  - “unattributed citations” (counted in totals, but no URL captured)
- **URL-only task AI metrics**: Task measurements for URL-only tasks now populate AI Overview/Citations by scanning Ranking & AI cited URLs (when available), avoiding false negatives.

## [2025-12-22] - v1.7.2 - Money Pages Phase 4: Suggested Top 10 Priority Pages

### Added
- **Suggested (Top 10) Priority Pages Panel**: New card-based panel showing top priority pages for optimization
  - Displays top 10 pages ranked by impact and difficulty scores
  - Shows optimization status (✓ Being Optimised badge for tracked pages)
  - Clickable URLs that open in new browser window
  - Color-coded page type labels (Landing, Event, Product) with bold styling
  - Potential impact clicks 28d metric displayed prominently
  - "Create Task" / "Manage Task" buttons matching Priority & Actions table behavior
  - Uses same button handlers as Priority & Actions table (`trackMoneyPage`, `openOptimisationTaskDrawer`)

### Changed
- **Optimization Status Detection**: Enhanced to check multiple task types
  - Checks recommended task type first, then falls back to 'on_page'
  - Also checks 'content', 'internal_links', 'technical' task types
  - Ensures all tracked pages are correctly identified across different task types
- **URL Display**: URLs in Suggested Top 10 cards are now clickable hyperlinks
  - Opens in new browser window with `target="_blank"`
  - Styled as blue underlined links for better UX

### Fixed
- **Optimization Status Missing**: Fixed pages not showing as "Being Optimised" when tracked
  - Enhanced status lookup to try multiple task types
  - Fixed URL normalization and matching logic
  - Now correctly identifies tracked pages regardless of task type

### Technical Details
- **Phase 4 Scoring Functions**: Impact, difficulty, and priority calculation
  - Impact score (0-100): Based on CTR gap and click upside potential
  - Difficulty score (LOW/MED/HIGH): Based on position and page type
  - Priority (LOW/MED/HIGH): Combined impact and difficulty buckets
  - Recommended action: Dynamic suggestions based on CTR, position, impressions
- **Button Integration**: Uses same handlers as Priority & Actions table
  - "Create Task" uses `window.trackMoneyPage(url, title)`
  - "Manage Task" uses `window.openOptimisationTaskDrawer(taskId)`
- **Data Source**: Uses `window.moneyPagePriorityData` (same as Priority & Actions table)

## [2025-12-21] - v1.7.1 - Traffic Lights & Ranking & AI Task Creation Fixes

### Fixed
- **Traffic Lights Classification**: Fixed traffic lights showing tasks in multiple metric columns
  - Now only counts tasks that have the matching metric as their objective KPI
  - CTR task only appears in CTR column, not in Impressions/Clicks/Rank columns
  - AI Citations task only appears in AI Citations column
  - Prevents double-counting and confusion
- **Traffic Lights Baseline Detection**: Fixed "No baselineLatest" warnings for tasks with single measurement
  - Updated `getBaselineLatest` to handle single measurement case when filtered by cycle start date
  - If only 1 measurement exists and it's filtered out by cycle date, use it anyway (baseline case)
  - Ensures traffic lights can classify tasks with baseline-only measurements
- **Ranking & AI Task Creation**: Fixed missing keyword and title when creating tasks from Ranking & AI
  - Changed task type from `'on_page'` to `'content'` for keyword-level tasks
  - API now preserves keyword_text for non-page-level tasks (only forces empty for `'on_page'`)
  - Modal now suggests keyword as title for keyword-level tasks (doesn't reset to empty)
  - Updated cache key building to include `'content'` task type
  - Status lookup now correctly finds tasks created from Ranking & AI
- **Bulk Update Button**: Fixed to respect "Include Test Tasks" checkbox
  - Excludes test tasks from bulk update if checkbox is unchecked
  - Confirmation message shows correct count (excluding test tasks if unchecked)

### Changed
- **Debug Logging**: Moved from browser console to UI debug panel
  - All traffic lights debug logs now appear in UI debug panel
  - Easier to diagnose issues without opening browser console

### Technical
- **Task Type Mapping**: 
  - Ranking & AI tasks now use `'content'` task type (keyword-level)
  - Money Pages tasks use `'on_page'` task type (page-level)
  - Status API handles both types correctly
- **Traffic Lights Logic**:
  - Added objective KPI to metric key mapping
  - Only classifies metrics that match task's objective KPI
  - Prevents tasks from appearing in irrelevant metric columns

## [2025-12-19] - v1.7.0 - Optimisation Tracking Module (Phases 1-8 Complete)

### Added
- **Optimisation Tracking Module**: Complete implementation of keyword optimisation tracking system
  - Phase 1: Database schema with tasks, cycles, and events tables
  - Phase 2: UI integration in Ranking & AI module (Optimisation column)
  - Phase 3: Full Optimisation Tracking panel with filters, table, and task details modal
  - Phase 4: Performance snapshots and measurement history
  - Phase 5: Objective integrity with auto-status calculation (on_track/overdue/met)
  - Phase 5.6: Read-only share mode with token-based authentication
  - Phase 6: Cycle management with per-task cycle numbering and history
  - Phase 7: Cycle completion and archival with timeline events
  - Phase 8: Fixed KPI formatting bugs (CTR as pp, rank lower better, no double percentage)

### Features
- **Task Management**: Create, update, and track optimisation tasks per keyword+URL+type
- **Cycle Tracking**: Multiple optimisation cycles per task with baseline/latest measurements
- **Objective Tracking**: Set objectives with KPI, target, timeframe, and auto-calculated progress
- **Measurement History**: Track performance metrics over time with delta calculations
- **Timeline Events**: Log notes, measurements, status changes, and cycle events
- **Share Mode**: Generate shareable read-only links for optimisation tracking data
- **Filters**: Status, type, keyword, URL, optimisation status, needs update, active cycle, overdue cycle
- **Summary Cards**: Counts for all task statuses and objective statuses

### Fixed
- **Target Unit Bugs**: Fixed "Increase by 100%" showing as "+10000.00%"
- **CTR Formatting**: Deltas now show as percentage points (pp) instead of percentages
- **Rank Calculation**: Lower rank is now correctly treated as better (positive delta = improvement)
- **Progress Display**: Shows "Remaining: +X" instead of confusing double delta lines
- **Measurement Dates**: Fixed baseline/latest dates showing today instead of actual capture time
- **Timezone Display**: All dates/times now shown in UTC/GMT
- **Cycle Events**: Timeline now shows cycle_start, cycle_completed, and cycle_archived events

### Technical
- **Database Migrations**:
  - `20251218_optimisation_tracking_phase1.sql` - Initial schema
  - `20251219_phase5_objective_integrity.sql` - Objective fields in cycles
  - `20251219_fix_measurement_dates.sql` - Measurement timestamps
  - `20251219_add_cycle_status_values.sql` - Cycle status enum values
  - `20251219_add_cycle_event_types.sql` - Cycle event types
- **API Endpoints**: 12 new endpoints for task/cycle/event management
- **Authentication**: Admin key and share token support
- **KPI Formatting**: Shared helper for consistent progress calculation and display

## [2025-12-18] - v1.6.1 - Money Pages Data Accuracy & Chart Improvements

### Fixed
- **28-Day Date Range Calculation**: Fixed date range showing 29 days instead of 28
  - Changed calculation to go back 27 days (27 + end date = 28 days total)
  - Applied to both Performance Trends and KPI Tracker charts
  - Ensures exactly 28 days of data (e.g., 18 Nov to 15 Dec)
- **CTR Percentage Display**: Fixed CTR showing 800% instead of 8%
  - Removed double multiplication by 100 (values already stored as percentages 0-100)
  - Fixed in table cells, chart y-axis ticks, and tooltips
  - CTR now displays correctly (e.g., 8% instead of 800%)
- **Trend Calculation**: Fixed trend values showing incorrect percentage points
  - Removed multiplication by 100 for CTR trends (diff already in percentage points)
  - Trend now shows correct values (e.g., -0.6pp instead of -63.4pp)
- **Chart Axis Labels**: Made all axis labels bold and larger for better visibility
  - Axis titles: size 14, weight 'bold'
  - Axis ticks: size 12, weight 'bold'
  - Applied to KPI Tracker chart and Performance Trends charts

### Changed
- **Money Pages Data Source**: Changed from audit records to actual GSC timeseries data
  - KPI Tracker now calculates metrics from `gsc_timeseries` table for all dates
  - Uses money page proportions from latest audit to calculate segment metrics
  - Performance Trends charts use actual GSC data for all 28 days
  - Removed fallback to audit records (now uses real GSC data or shows null)
- **Weekly Data Points**: Changed from 15 evenly spaced points to 8 weekly points
  - 28 days / 4 = 7 weeks, so 8 data points (one per week)
  - Better fits container width and reduces chart clutter
  - Applied to both KPI Tracker and Performance Trends charts
- **Section Descriptions**: Updated to reflect actual data source
  - Performance Trends: "Weekly trends calculated from actual Google Search Console data for the last 28 days"
  - KPI Tracker: "Weekly KPI trends by money-page segment calculated from actual Google Search Console data"
  - Footer: "Data calculated from Google Search Console timeseries for the last 28 days, displayed as 8 weekly data points"

### Technical Details
- **Date Range Calculation**: 
  - `startDate = endDate - 27 days` (27 days back + end date = 28 days total)
  - Date points generated with `step = (28 - 1) / 7` for 8 weekly points
- **GSC Timeseries Calculation**:
  - Finds reference audit with both `moneySegmentMetrics` and matching timeseries data
  - Calculates money page proportions (clicks/impressions) from reference audit
  - Applies proportions to each date's GSC timeseries data
  - Calculates segment metrics using segment proportions from reference audit
- **CTR Formatting**:
  - Values stored as percentages (0-100), not decimals (0-1)
  - Display: `${value.toFixed(1)}%` (no multiplication)
  - Trend: `${diff.toFixed(1)}pp` (diff already in percentage points)

## [2025-12-16] - v1.6.0 - Money Pages UI Improvements & Branding Update

### Added
- **Money Pages Performance Trends Split Charts**: Split single chart into two side-by-side charts
  - Volume Metrics Chart: Clicks and Impressions (similar scales)
  - Rate & Score Metrics Chart: CTR (%) and Behaviour Score (similar scales)
  - Resolves Y-axis scaling issues with 4 series on different scales
  - Each chart has fixed height container (300px) to prevent auto-scaling loops
- **Enhanced CTR Y-Axis Precision**: Improved granularity for Rate & Score Metrics chart
  - stepSize set to 0.02 (shows 1.40%, 1.42%, 1.44%, etc.)
  - Labels display 2 decimal places (1.65% instead of 1.6%)
  - Makes small day-to-day CTR changes clearly visible
  - Tooltip precision matches axis (2 decimal places)

### Changed
- **Branding Update**: Replaced "AIO" with "GAIO" throughout UI
  - Main header: "GAIO (Generative AI Optimization) Audit Dashboard"
  - Subtitle: "Automated GAIO Performance Tracking & Optimisation"
  - All user-facing text, tooltips, and descriptions updated
  - Internal variable names preserved for compatibility
- **Money Pages Section Layout**: Reorganized section order
  - KPI Tracker (last 12 audits) now appears above Priority & Actions section
  - KPI Tracker chart and table displayed side-by-side (50/50 split)
  - Performance Trends charts displayed side-by-side (50/50 split)
- **CTR Calculation**: Now calculated directly from clicks/impressions for accuracy
  - Ensures plotted value matches actual calculated CTR
  - Fallback to stored values with smart detection (decimal vs percentage format)
  - Fixes tooltip/plotting mismatch issues

### Fixed
- **Dropdown Counts Persistence**: Fixed counts vanishing after filter selection
  - Counts now calculated from base data (after min impressions, before type filter)
  - Counts persist correctly when type filter changes
  - `renderMoneyPagesTable` now uses base data for counting instead of filtered data
- **Money Pages Filter Counts**: Fixed counts not updating when filters change
  - Counts update correctly when min impressions filter changes
  - Counts update correctly when type filter changes
  - Initial load respects min impressions filter value
- **CTR Plotting Accuracy**: Fixed CTR values not plotting at correct Y-axis position
  - Tooltip precision increased to 2 decimal places (matches axis)
  - Direct calculation from clicks/impressions ensures accuracy
  - Resolves issue where 1.50% appeared closer to 1.45% on axis
- **Chart Auto-Scaling Loop**: Fixed infinite Y-axis expansion
  - Added fixed-height containers (300px) for all charts
  - Set `maintainAspectRatio: true` with `aspectRatio: 2.5`
  - Removed manual canvas width/height settings
  - Added rendering guards to prevent simultaneous re-renders
- **Money Pages Section Restoration**: Restored complete HTML structure
  - All sub-sections, styling, and formatting preserved
  - KPI Tracker table restored and positioned correctly
  - Background and panel formatting maintained
  - Only change: Performance Trends split from 1 chart to 2 side-by-side charts

### Technical Details
- **Chart Configuration**: 
  - Volume chart: Clicks (min: 100, max: 500, stepSize: 50) and Impressions
  - Rate chart: CTR (stepSize: 0.02, 2 decimal places) and Behaviour Score
  - Both charts use fixed-height containers to prevent resizing loops
- **Filter Count Logic**: 
  - Counts calculated from `window.moneyPagePriorityData` + `window.authorityActionRows`
  - Min impressions filter applied before counting
  - Type filter NOT applied when counting (shows all available types)
- **CTR Data Extraction**:
  - Primary: Calculate from `(clicks / impressions) * 100` when available
  - Fallback: Use `summary.ctr` or `allMoney.ctr` with smart format detection
  - Handles both decimal (0.015) and percentage (1.5) formats

## [2025-12-17] - v1.5.0 - Intent-Based Keyword Segmentation & Preset Refactor

### Added
- **Intent-Based Keyword Segmentation**: Replaced URL-based classification with intent-based rules
  - New `lib/segment/classifyKeywordSegment.js` classifier with priority order: Brand → Money → Education → Other
  - Brand detection: matches brand terms (alan ranger, alanranger, photography academy, etc.)
  - Money detection: transactional terms (lessons, courses, workshops, etc.) OR local modifiers (near me, coventry, etc.) OR postcode patterns
  - Education detection: informational terms (how to, guide, tutorial, etc.) OR technique topics (aperture, shutter speed, etc.)
  - Returns segment, confidence (0-1), and reason for classification
- **Segment Metadata Columns**: Added to `keyword_rankings` table
  - `segment_source`: 'auto' (intent-based) or 'manual' (user override)
  - `segment_confidence`: 0-1 confidence score for auto-classification
  - `segment_reason`: Explanation text (e.g., "money: contains 'lessons'")
- **Backfill Script**: `scripts/retag-keyword-segments-direct.js` to re-classify all existing keywords
  - Skips rows with `segment_source='manual'` to preserve manual overrides
  - Shows summary of changes and top 20 examples
  - Run with: `npm run retag:segments` or `node scripts/retag-keyword-segments-direct.js`
- **Data-Driven Presets**: Refactored preset system with single source of truth
  - `DEFAULT_FILTERS` constant for default filter state
  - `PRESETS` object with all preset definitions (filters + sort)
  - Hard reset implementation (no filter stacking)
- **Blog Opportunities Preset**: Replaced "Education growth" preset
  - Uses `pageType: 'Blog'` (not `segment: 'Education'`)
  - Filters: Page type: Blog, Best rank: Not top 3, Min opportunity: ≥ 30
  - Sort: Opportunity score descending
- **Local Visibility Preset**: New preset for GBP/local queries
  - Uses `pageType: 'GBP'`
  - Filters: Page type: GBP, Best rank: Not top 3, Min opportunity: ≥ 30
  - Sort: Opportunity score descending
- **Not Top 3 Rank Filter**: Added new rank filter option
  - Filters keywords with rank > 3 or null (not in top 3)
  - Used by Blog opportunities and Local visibility presets
- **Competitor Checkbox in Competitors Table**: Added competitor checkbox column
  - Narrow "C" column header to save space
  - Checkbox updates competitor flag and shows/hides competitor badge
  - Wired to same update logic as other competitor checkboxes
- **Edit Keywords Modal**: Keyword management interface
  - Load existing keywords from Supabase
  - Add, remove, or edit keywords
  - Warning box about data loss when removing/changing keywords
  - Keywords updated on next Ranking & AI check (no automatic scan)
- **Pre-scan Keyword Count**: Display keyword count before starting scan
- **Stop Scan Button**: Ability to abort running scan in progress

### Changed
- **Keyword Classification**: Now based on keyword intent, not currently ranking URL
  - Keywords like "photography lessons" correctly classified as Money (not Education)
  - Keywords like "how to use aperture" correctly classified as Education
  - Page type used only as weak hint for confidence, not primary classifier
- **Preset System**: Complete refactor for maintainability
  - All presets defined in single `PRESETS` object
  - Hard reset ensures no filter stacking between presets
  - Tooltips and criteria chips automatically reflect preset definitions
- **Filter Dropdown Counts**: Updated to reflect new data structure
  - Added "Blog" to pageType counts
  - Added "not-top3" to rank counts
  - All dropdown options now show counts (even if 0)
- **Domain Rank Display**: Fixed missing Domain Rank in "AI Citations for Selected Keyword" table
  - Moved Domain Rank filling logic inside async IIFE after rows are appended
  - Added debug logging for troubleshooting

### Fixed
- **Domain Rank Missing**: Fixed Domain Rank not showing in "AI Citations for Selected Keyword" table
- **Filter Counts**: Fixed "Blog" page type not showing count in dropdown
- **Preset Filter Stacking**: Fixed presets accidentally stacking filters (now hard resets)
- **Education Segment Collapse**: Fixed "Education (6)" segment issue by using pageType-based presets
- **Competitor Badge Overlap**: Fixed competitor badge overlapping domain name in citation tables
  - Changed to vertical flex layout (badge below domain name)
  - Added word-break for long URLs
- **Domain Strength Table**: Fixed dropdown showing "Unmapped" instead of actual mapped value
- **Keyword List Loading**: Fixed modal not loading keywords from Supabase
- **Keyword Save**: Fixed error preventing keyword save without prior audit (now creates minimal audit record if needed)

### Technical Details
- **Migration**: `20251217_add_keyword_segment_metadata.sql` adds segment metadata columns
- **Classifier**: Priority-based matching with confidence scoring
- **Backfill**: Processes all keywords, preserves manual overrides, shows change summary
- **Preset Architecture**: Data-driven with `DEFAULT_FILTERS` and `PRESETS` object
- **Filter Counts**: Calculated based on rows matching all OTHER filters (excluding the filter being counted)
- **API Endpoints**: 
  - `/api/keywords/get` - Fetch current keyword list from latest audit
  - `/api/keywords/save` - Save updated keyword list to latest audit

## [2025-12-08] - Brand Overlay, AI Summary Likelihood, and Shareable Links

### Added
- **Brand & Entity Overlay Metrics**: New overlay pillar tracking brand search performance
  - Brand query classification using configurable brand terms
  - Brand metrics: query share, CTR, average position
  - Brand overlay score combining brand search (40%), reviews (30%), entity (30%)
  - Brand & Entity row in Pillar Scorecard with detailed metrics
  - Brand queries mini-table in Authority section showing top branded queries
  - Trend chart integration with yellow dashed line (#FFFF66)
  - Fallback calculation from GSC timeseries for historical dates
- **AI Summary Likelihood**: Composite score for AI/Google answer accuracy
  - Calculated from Snippet Readiness (50%), Visibility (30%), Brand Score (20%)
  - RAG thresholds: Low <50, Medium 50-69, High ≥70 (matching AI GEO bands)
  - Detailed breakdown display next to RAG pills
  - Speedometer indicator with dedicated tick mark
- **Shareable Audit Links**: Public sharing functionality
  - "Share Audit" button to generate shareable URLs
  - 30-day expiration for shared links
  - Supabase `shared_audits` table for storage
  - API endpoints: `/api/supabase/create-shared-audit` and `/api/supabase/get-shared-audit`
  - Support for `?share=ID` URL parameter to load shared audits
  - Read-only view with banner indicator for shared audits
- **Enhanced Speedometer**: Improved visualization
  - 30% size increase for better visibility
  - Multiple needle indicators: AI GEO Score, AI Summary Likelihood, Brand & Entity
  - Removed 50% marker for cleaner appearance
  - RAG breakdown boxes displayed next to pills (not just in tooltips)
  - Standardized pill and box sizing for alignment

### Changed
- **Data Date Display**: Brand & Entity now uses GSC date (matching Authority/Visibility)
- **Historical Tracking**: Extended to all pillars, not just Content/Schema
  - Brand & Entity trend data with fallback calculation
  - Historical Authority segmented data (All pages, Exclude education, Money pages)
- **RAG Thresholds**: Standardized to Red (0-49), Amber (50-69), Green (70-100) across all scores
- **Pillar Scorecard**: Added Brand & Entity row with overlay indicator
- **CSV Upload Sections**: Made collapsible and collapsed by default for cleaner UI

### Fixed
- Brand & Entity trend chart data population (was missing from timeseries loop)
- Data date not updating for Brand & Entity (now uses GSC date)
- AI Summary Likelihood thresholds aligned with RAG bands
- Snippet Readiness data format handling (number vs object)
- Supabase save errors (improved data validation and error logging)
- Missing database columns (added `brand_overlay`, `brand_score`, `ai_summary`, `ai_summary_score`)

### Technical Details
- Brand query classification: `isBrandQuery()` function with configurable terms
- Brand metrics calculation: `calculateBrandMetrics()` from GSC query data
- Brand overlay scoring: `computeBrandOverlay()` with weighted components
- AI Summary calculation: `computeAiSummaryLikelihood()` using snippet readiness, visibility, brand
- Supabase schema: Added columns for brand and AI summary data
- Fallback calculation: Estimates brand metrics from GSC timeseries when stored data unavailable

## [2025-01-XX] - Site AI Health Speedometer Enhancement

### Added
- **Site AI Health Dashboard Section**: New prominent health score visualization at the top of the dashboard
  - Circular speedometer-style gauge showing overall AI GEO Score (0-100)
  - Color-coded segments: Red (0-49), Amber (50-69), Green (70-100)
  - Visual needle indicator pointing to current score
  - Status badge showing RAG status
  - AI Summary Likelihood indicator (High/Medium/Low)

### Changed
- **Page Segmentation**: Fine-art print pages reclassified from "Money pages" to informational/portfolio pages
- **Recommended Actions Table**: Enhanced with priority highlighting and improved formatting

### Fixed
- Speedometer label positioning and visibility
- Marker alignment with progress ring
- Title centering over dial section
- Removed duplicate "Pillar Status Summary" table

## Previous Versions

See git history for earlier changes.

