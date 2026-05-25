# Runs cheatsheet — what each button does

**Last updated:** 2026-05-20  
**Authoritative step list (code):** `audit-dashboard.html` → `globalRunStepCatalog()`  
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

The green **status bar** at the top shows **per-feed** freshness (GSC audit, Ranking & AI, Squarespace, Stripe, GA4, etc.).  
**Last global run** on the Dashboard is only the last time you clicked Quick / Standard / Full — it does not replace those feed timestamps.

---

## Dashboard tiers (the three yellow buttons)

### Quick (~1 min, no DataForSEO spend)

Use for: “Is everything basically alive?” before a meeting.

| Runs | Does **not** run |
|------|------------------|
| Sync CSV | Ranking & AI (84 keywords — costs DFS) |
| GSC & Backlink audit (backlinks = **cached** read, not full DFS re-index) | Traditional SEO rescoring |
| Squarespace + Stripe revenue (**last 28 days**) | Keywords Everywhere top-up |
| Revenue Funnel summary + trust loop | Auto-Optimise scenarios |
| Scenario cockpit refresh (charts only) | GA4 sync |
| Reload Money Pages view | Domain Strength |
| Update all optimisation tasks | DFS backlink **full** index |
| | GSC URL Inspection refresh |
| | Trad SEO full HTML extractability |
| | Booking Sheet upload |

---

### Standard run (~4–6 min, small DFS spend)

Use for: **weekly** refresh.

Everything in **Quick**, plus:

| Also runs | Still does **not** run |
|-----------|------------------------|
| Ranking & AI scan (84 keywords) | GA4 sync |
| Traditional SEO rescore (cached extractability) | 13-month revenue (still 28d) |
| Keywords Everywhere top-up (stale rows only) | DFS backlink full index |
| Revenue Funnel seasonality bands | Domain Strength |
| **Run Auto-Optimise** (Easy / Medium / Hard paths) | GSC URL Inspection |
| | Trad SEO full HTML refetch |
| | Booking Sheet upload |

---

### Full refresh (15+ min, significant DFS + GSC quota)

Use for: **monthly** deep refresh. Confirms before starting.

Everything in **Standard**, plus:

| Also runs | Still manual only |
|-----------|-------------------|
| Squarespace + Stripe (**last 13 months**) | Booking Sheet `.xlsm` (file picker) |
| GA4 enquiry metrics (28d) | Revenue Funnel “Sync everything” if you want one-click Booking+GA4 without Full |
| DFS backlink **full** index | Per-tab one-off buttons (Backlinks fetch, Trad SEO page tools, etc.) |
| Domain Strength snapshot (all batches) | Portfolio monthly snapshot (cron only today) |
| Traditional SEO **full** extractability (HTML refetch per URL) | |
| GSC URL Inspection refresh | |

---

## Revenue Funnel vs Dashboard

| Action | Where | What |
|--------|-------|------|
| **Quick / Standard / Full** | Dashboard | RF summary, trust loop, seasonality (Standard+), Auto-Optimise (Standard+), GA4 (Full only), revenue 28d or 13mo |
| **Sync everything & refresh page** | Revenue Funnel | Booking Sheet (optional) + Squarespace + Stripe + **GA4** + reload tables — **independent** of Dashboard tier |
| **Sync GA4** | Revenue Funnel | GA4 only, then reload funnel |

If you ran **Standard** today but not **Full**, GA4 and 13-month revenue may still be stale until you run **Full** or use Revenue Funnel sync buttons.

---

## Nightly cron (unattended)

Roughly: CSV sync → GSC audit → Ranking & AI → Domain Strength → tasks → portfolio snapshot.  
**Not the same** as any single Dashboard tier — see `api/cron/global-run.js` and **Configuration → Audit Coverage Map → Cron Jobs**.

---

## Failure behaviour

Steps are **isolated**: if Ranking & AI fails, task updates and Revenue Funnel refresh can still complete.  
Dependent steps show **Skipped** (e.g. Money Pages if GSC audit failed).

After any tier finishes, open the run modal summary for **Done / Failed / Skipped** per step.

---

## Doc map for agents

1. **This file** — plain English for Alan  
2. **`GLOBAL-RUN.md`** — tier matrix, dependencies, code entry points  
3. **`ALL-AUDIT-SCAN-PROCESSES.md`** — what each underlying API/process does  
4. **`CHANGELOG.md`** — what changed when  
