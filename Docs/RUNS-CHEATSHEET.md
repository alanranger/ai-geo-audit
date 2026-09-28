# Runs cheatsheet — what each button does

**Last updated:** 2026-09-28  
**Authoritative step list (code):** `audit-dashboard.html` → `globalRunStepCatalog()`  
**Monday overnight:** same Full keys via `lib/ceo-weekly/dashboard-full-catalog.js`  
**Full architecture:** [`GLOBAL-RUN.md`](./GLOBAL-RUN.md)  
**Per-process deep dives:** [`ALL-AUDIT-SCAN-PROCESSES.md`](./ALL-AUDIT-SCAN-PROCESSES.md) (individual audits; superseded for “one button runs everything”)

---

## Where to look in the UI

| What you want | Where |
|---------------|--------|
| **Run something** | **Dashboard** tab → **Quick** / **Standard run** / **Full refresh** |
| **What each tier includes** | Dashboard → expand **“What each tier runs”** (same data as this doc) |
| **When you last ran each tier** | Under each button on Dashboard (**Last: …**) + green status bar dates |
| **Which cron touches which data** | **Configuration & Reporting** → Audit Coverage Map |
| **Revenue-only full sync** | **Revenue Funnel** → **Sync everything & refresh page** (Booking Sheet + 13mo + GA4) |

The green **status bar** at the top shows **per-feed** freshness (GSC audit, Ranking & AI, Squarespace, Stripe, GA4, Schema audit, etc.).  
**Last global run** on the Dashboard is only the last time you clicked Quick / Standard / Full — it does not replace those feed timestamps.

---

## Dashboard tiers (the three yellow buttons)

### Quick (~1 min, no DataForSEO spend)

Use for: “Is everything basically alive?” before a meeting.

| Runs | Does **not** run |
|------|------------------|
| Sync CSV | Ranking & AI |
| GSC & Backlink audit (backlinks = **cached** read, not full DFS re-index) | Traditional SEO |
| Squarespace + Stripe revenue (**last 28 days**) | Keywords Everywhere top-up |
| Revenue Funnel summary + trust loop | Auto-Optimise scenarios |
| Scenario cockpit refresh (charts only) | GA4 sync |
| Reload Money Pages view | Domain Strength / DFS full index |
| Update all optimisation tasks | Schema QA / citation / mentions |
| | GSC URL Inspection / Booking Sheet |

---

### Standard run (~4–6 min, small DFS spend)

Use for: **weekly** light refresh from the UI.

Everything in **Quick**, plus:

| Also runs | Still does **not** run |
|-----------|------------------------|
| Ranking & AI scan | GA4 sync / 13-month revenue |
| Traditional SEO rescore (cached extractability) | DFS backlink full index |
| Keywords Everywhere top-up (stale rows only) | Domain Strength / GSC URL Inspection |
| Revenue Funnel seasonality bands | Schema QA / citation / mentions |
| **Run Auto-Optimise** | Trad SEO full HTML refetch |
| Acquisition channels | Booking Sheet upload |

---

### Full refresh (30+ min, significant DFS + GSC quota)

Use for: **deep refresh** (Dashboard button **or** Monday overnight cron). Confirms before starting in the UI.

Everything in **Standard**, plus:

| Also runs | Still manual / separate |
|-----------|-------------------------|
| **Schema QA gate (whole site)** | Booking Sheet `.xlsm` |
| Squarespace + Stripe (**last 13 months**) | Implementation tech/local/service sample widgets |
| GA4 enquiry metrics (28d) | Portfolio monthly snapshot (cron-only today) |
| DFS backlink **full** index | |
| Domain Strength snapshot (all batches) | |
| Traditional SEO **full** extractability (+ Schema QA statuses in eval cache overnight) | |
| GSC URL Inspection refresh | |
| Citation consistency + mentions baseline | |
| CEO weekly HTML email (end of run) | |

---

## Revenue Funnel vs Dashboard

| Action | Where | What |
|--------|-------|------|
| **Quick / Standard / Full** | Dashboard | RF summary, trust loop, seasonality (Standard+), Auto-Optimise (Standard+), GA4 (Full only), revenue 28d or 13mo |
| **Sync everything & refresh page** | Revenue Funnel | Booking Sheet (optional) + Squarespace + Stripe + **GA4** + reload tables — **independent** of Dashboard tier |
| **Sync GA4** | Revenue Funnel | GA4 only, then reload funnel |

If you ran **Standard** today but not **Full**, GA4, Schema QA, and 13-month revenue may still be stale until you run **Full** or use the dedicated tab buttons.

---

## Nightly / Monday cron

- **Monday overnight** `ceo-weekly-full-refresh` = Dashboard **Full** step keys (server runners).
- Other nightly jobs (citation, mentions, GSC) may still run on their own schedules — Full now also covers citation/mentions so Monday is not blind to them.

---

## Failure behaviour

Steps are **isolated**: if Ranking & AI fails, task updates and Revenue Funnel refresh can still complete.  
Dependent steps show **Skipped** (e.g. Money Pages if GSC audit failed; Trad SEO full if Schema QA failed).

After any tier finishes, open the run modal summary for **Done / Failed / Skipped** per step.

**Unattended runs:** Quick / Standard / Full set `window._dashboardGlobalRunActive` so the run does **not** stop for post-audit or post–Ranking & AI `confirm()` dialogs, the schema completion modal, or the admin-key prompt (update-tasks still runs at the end if configured). The **one** confirm before **Full** (cost warning) still appears at the start.

---

## Doc map for agents

1. **This file** — plain English for Alan  
2. **`GLOBAL-RUN.md`** — tier matrix, dependencies, code entry points, remaining gaps  
3. **`ALL-AUDIT-SCAN-PROCESSES.md`** — what each underlying API/process does  
4. **`CHANGELOG.md`** — what changed when  
