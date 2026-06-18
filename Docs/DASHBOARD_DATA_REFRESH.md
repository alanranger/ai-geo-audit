# Dashboard data refresh policy

**Last updated:** 2026-06-12 (post request-storm audit)

The dashboard is a ~3.4MB monolith (`audit-dashboard.html`). Many tabs share the
same Supabase payloads (`get-latest-audit` ≈ 1.8MB, `get-audit-history` large).
Without a single refresh policy, each tab switch / render path fires its own
fetch and queues time out (522/521), which feels like “nothing refreshes” and
also hammers Supabase Nano.

## Layers (use in order)

| Layer | TTL | Purpose |
|-------|-----|---------|
| **localStorage** `last_audit_results` | Until audit save | Primary offline / fast paint |
| **`fetch` GET dedup** (head of HTML) | 120s | Collapse identical GET URLs |
| **`fetchLatestAuditFromSupabase` cache** | 120s | Per `(propertyUrl, minimal\|full)` |
| **`loadAuditResults` session cache** | 60s | Avoid repeat parse/fetch in one flow |
| **`__auditHistoryCache`** | 120s | Trend chart pillar history |
| **`__trendTimeseriesSession`** | 10 min | GSC timeseries for Score Trends |
| **`__optimisationTasksLoadedAt`** | 60s | Optimisation dashboard API (uses `__origFetch`, not global dedup) |
| **`isSupabaseDegraded()`** | 5 min after 522 | Stop upstream calls; use cache |

## When Supabase is called

### Audit payload (`get-latest-audit`)

- **Block (await)** only when localStorage is **empty** or caller passes `forceRefresh`.
- **Background** via `refreshAuditFromSupabaseInBackground()` when cache is
  **incomplete** OR **older than 15 minutes** (`AUDIT_CACHE_STALE_MS`).
- **Never** on every `renderDashboardTab()` or tab switch.

### GSC timeseries (Score Trends)

- **Use localStorage** `searchData.timeseries` when last date matches green banner
  (`window.lastGscTimeseriesDate`) or is within 2 days of today.
- **Fetch** `get-audit-history` when: post-audit force flag, empty cache, banner
  newer than cache, or session TTL expired.
- **Not** on every `displayDashboard()` / Overview visit.

### Optimisation tasks (`/api/optimisation/dashboard`)

- **60s session TTL** for normal loads (tab open, drawer, filters).
- **`forceRefresh: true`** only for “Update All Tasks”, bulk rebaseline, global run.
- **Not** in global GET dedup (auth headers per caller; dedup caused cached 500s).

### Tab switch

- UI switch is immediate; `ensurePanelRendered(panelId)` lazy-inits once per tab.
- At most **one background audit refresh** if audit cache is stale (>15 min).
- Does **not** call `renderDashboardTab()` from the switch handler (avoids loops).

## After GSC audit save

`bustAuditReadCaches()` clears dedup, session caches, sets `__forceFreshTrendFetch`,
and invalidates latest-audit cache. Next trend render may fetch once; then session
TTL applies.

## Anti-patterns (do not reintroduce)

1. `await fetchLatestAuditFromSupabase()` at the start of every tab render.
2. Cache-busting query params on every routine load (`&_t=` / `&_=`).
3. Tab switch → full audit fetch → `renderDashboardTab()` → optimisation load →
   `renderDashboardTab()` loop.
4. “Always fetch Supabase first” for timeseries when localStorage is already current.
5. Clearing in-memory task lists on transient 521 (keep cache; show banner).

## Verification

```bash
# Offline logic / parity scripts (from repo root)
node scripts/test-authority-trend-logic.mjs

# Live request counts (requires Playwright + admin session)
node scripts/diagnose-live-request-storm.mjs
node scripts/diagnose-tab-switch-storm.mjs
```

In DevTools Network, a cold load with warm localStorage should show **≤2**
`get-latest-audit` (minimal + optional full) and **0–1** `get-audit-history`
within the first minute—not dozens per tab click.

## Code anchors

- GET dedup: top of `audit-dashboard.html` (`installFetchDedup`)
- Policy helpers: `shouldRefreshAuditInBackground`, `AUDIT_CACHE_STALE_MS`
- Background refresh: `refreshAuditFromSupabaseInBackground`
- Trend timeseries: `fetchTrendTimeseriesFromSupabase`
- Dashboard tab: `renderDashboardTab` (cache-first)
- Optimisation load: `loadAllOptimisationTasks({ forceRefresh })`
