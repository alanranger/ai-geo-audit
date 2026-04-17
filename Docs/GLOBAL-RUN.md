# Global Run — tiered refresh architecture

**Last updated:** 2026-04-17
**Status:** Live. Supersedes the "Run All Audits & Updates" documentation in `Docs/ALL-AUDIT-SCAN-PROCESSES.md`.

---

## Why tiered runs

The original single "Run All Audits & Updates" button:

- Ran a fixed subset of audits (Sync CSV → GSC audit → Ranking & AI → Money Pages reload → Domain Strength → Update Tasks).
- **Silently excluded** significant audit surfaces added later:
  Traditional SEO rescoring, Keywords Everywhere demand top-up, DataForSEO backlink full/delta ingest, GSC URL Inspection refresh, Traditional SEO content-extractability refresh, citation-consistency checks, mentions ingestion, monthly portfolio snapshot.
- Stopped dead on the first failed step, even when later steps were independent.
- Re-ran the expensive Domain Strength snapshot every time, which is wasteful for a weekly health check and under-scoped for a monthly deep refresh.

The dashboard now exposes **three tiers** so each run matches its purpose, cost, and expected cadence.

---

## Tier matrix

| Step key | Label | Quick | Standard | Full | Depends on |
|---|---|:---:|:---:|:---:|---|
| `sync_csv` | Sync CSV (portfolio + keyword seed) | ✓ | ✓ | ✓ | — |
| `audit_scan` | GSC & Backlink Audit (reads cached backlinks) | ✓ | ✓ | ✓ | — |
| `ranking_ai` | Ranking & AI scan (84 keywords, DFS SERP + AI engines) |  | ✓ | ✓ | — |
| `money_pages` | Reload Money Pages view from Supabase | ✓ | ✓ | ✓ | `audit_scan` |
| `trad_seo_rescore` | Traditional SEO rescore (uses cached extractability) |  | ✓ |  | `audit_scan` |
| `trad_seo_full` | Traditional SEO + full extractability refresh (per-URL HTML refetch) |  |  | ✓ | `audit_scan` |
| `ke_topup` | Keywords Everywhere top-up for stale / missing rows only |  | ✓ | ✓ | — |
| `dfs_full_index` | DataForSEO backlink full index |  |  | ✓ | — |
| `gsc_url_inspection` | Google Search Console URL Inspection refresh |  |  | ✓ | `audit_scan` |
| `domain_strength` | Domain Strength snapshot — loops all remaining batches |  |  | ✓ | — |
| `update_tasks` | Update all tasks with latest measurements | ✓ | ✓ | ✓ | `audit_scan` |

A ✓ means the step runs in that tier. A blank means it is intentionally **not** run.

### Step counts

- **Quick**: 5 steps (~30–60 s, no DataForSEO spend)
- **Standard**: 8 steps (~3–5 min, small DataForSEO spend on Ranking & AI + KE top-up)
- **Full**: 11 steps (15+ min, significant DataForSEO credit burn + GSC URL Inspection quota)

### Cost expectations

- **Quick** re-reads Supabase caches and GSC; it never calls DataForSEO.
- **Standard** reuses cached extractability / DFS backlink rows but refreshes live DFS SERP + AI engine data for all 84 tracked keywords, plus a cache-aware KE top-up.
- **Full** re-indexes the backlink profile (`dfs_full_index`), re-fetches every evaluation URL's HTML for extractability scoring, burns through the GSC URL Inspection quota, and runs the Domain Strength batcher until its queue is empty. It prompts the user to confirm before starting.

---

## UI

Dashboard header now shows three buttons:

1. **Quick** — `dashboard-run-quick-btn`
2. **Standard run** — `dashboard-run-all-btn` *(kept the legacy id so older links / rules still resolve)*
3. **Full refresh** — `dashboard-run-full-btn`

Each button calls `window.runDashboardGlobalRun(tier)` with `'quick' | 'standard' | 'full'`. The Full button fires a `window.confirm` dialog before starting.

The modal title (`#dashboardRunTitle`) shows the selected tier while the run is in flight. The final summary line reports `done / failed / skipped` counts next to the wall-clock elapsed time. Skipped steps render in slate (`#94a3b8`) alongside the Done / Running / Failed colours that already existed.

---

## Failure isolation

The legacy runner broke out of the loop on the first exception. That is almost always wrong when the remaining steps are independent (for example, `ranking_ai` failing because DataForSEO rate-limited us should **not** stop the KE top-up or the task-measurement update).

New behaviour:

1. Each step declares `dependsOn: string[]` in `globalRunStepCatalog()`.
2. If any of its declared dependencies have failed this run, the step is marked **Skipped** with an explanatory `errorMessage` (`Skipped — <dep> failed`).
3. If its dependencies are fine but the runner itself throws, the step is marked **Failed**, the error is recorded, and execution continues with the next step.
4. `postGlobalRunRefresh` always runs at the end so the dashboard still recomputes composite scores, reloads tasks, and saves a run record — with status `partial` when any step failed.

Dependency rules encoded today (in `audit-dashboard.html`, search for `globalRunStepCatalog`):

- `money_pages` → `audit_scan` (reload needs the latest `audit_results` row)
- `trad_seo_rescore` → `audit_scan` (needs fresh GSC metrics)
- `trad_seo_full` → `audit_scan` (same, plus triggers extractability refetch)
- `gsc_url_inspection` → `audit_scan` (needs the URL list in `audit_results`)
- `update_tasks` → `audit_scan` (measurement metrics come from the latest audit + fresh keyword_rankings)

Everything else is independent so it can fail in isolation.

---

## Entry points (code map)

File: `audit-dashboard.html`

- `globalRunStepCatalog()` — single source of truth for step key / label / tiers / dependsOn / runner.
- `runGlobalStepSyncCsv`, `runGlobalStepAuditScan`, `runGlobalStepRankingAi`, `runGlobalStepMoneyPages`, `runGlobalStepTradSeoRescore`, `runGlobalStepTradSeoFull`, `runGlobalStepKeTopup`, `runGlobalStepDfsFullIndex`, `runGlobalStepGscUrlInspection`, `runGlobalStepDomainStrength`, `runGlobalStepUpdateTasks` — one runner per step. Kept small so each stays under the 15-complexity ceiling.
- `stepShouldSkipDueToFailedDeps(stepDef, failedKeys)` — returns the list of failed deps for a step, or `null` if it can run.
- `executeGlobalRunStep(stepDef, stepState, failedKeys, stepStartTime)` — wraps a single runner call and records `Done` / `Failed` / `Skipped`.
- `runAllGlobalRunSteps(stepDefs, steps, failedKeys)` — the loop that hosts the per-step UI timer.
- `executeGlobalRunTier(stepDefs, tierLabel, startIso)` — sets up the modal, runs the loop, finalises the UI, and calls `postGlobalRunRefresh`.
- `runDashboardGlobalRun(tier)` — public entry point called by the three buttons.
- `buildGlobalRunSummaryHtml(steps, failedKeys)` — composes the final summary shown inside the modal.
- `postGlobalRunRefresh(steps, failedKeys, startIso)` — reloads tasks, recomputes dashboard snapshot, re-renders Dashboard / Ranking & AI / Money Pages tabs, and calls `updateAuditTimestamp`.

---

## Cron relationship

File: `api/cron/global-run.js`

The nightly cron already runs a narrow set of steps roughly equivalent to a **Standard** run minus Traditional SEO / KE: `sync_csv`, GSC audit, Ranking & AI, Domain Strength, bulk task update, portfolio snapshot.

Recommended policy, documented here so nobody has to reverse-engineer the cron:

- **Cron (nightly)** stays as-is — it does the heavy "keep things current" work that is safe to run unattended.
- **Quick** is for ad-hoc health checks from the UI. It does **not** call DataForSEO, so it is safe to click at any time.
- **Standard** is for weekly deliberate refreshes where you accept a small DFS spend.
- **Full** is for monthly deep refreshes and is explicit about consuming DFS / GSC quota.

If the cron behaviour ever drifts, update both `api/cron/global-run.js` *and* this doc so the matrix stays honest.

---

## Known gaps (future work)

- **Per-step "last ran" timestamps in the dashboard header.** The next iteration should add a freshness panel so the user can see, at a glance, when each audit kind was last updated. Candidate endpoint: a single `GET /api/supabase/audit-freshness?propertyUrl=…` aggregating max timestamps from `audit_results`, `keyword_rankings`, `dfs_domain_backlink_rows`, `domain_strength_snapshots`, `keyword_target_metrics_cache`, `traditional_seo_evaluation_cache`, `gsc_url_inspection_cache`.
- **Smart-delta Ranking & AI in Quick.** Today `ranking_ai` always re-runs the full 84 keywords; Quick therefore excludes it rather than pay the DFS cost. A future "changed-keywords only" mode (re-use the per-keyword refresh from the keyword table) would let Quick include a cheap ranking refresh.
- **Mentions / citation-consistency / implementation snapshots.** These APIs still have no button at all; they are currently only refreshed by their own widgets. If they become part of the "refresh everything" expectation, add new catalog entries rather than shoe-horning them into an existing runner.
- **Portfolio snapshot on demand.** Cron runs `monthly-portfolio-snapshot`; the UI has no equivalent button. If users want to trigger it mid-month, add it as a new step in the Full tier.
