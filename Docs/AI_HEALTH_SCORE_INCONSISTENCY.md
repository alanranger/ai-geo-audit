# AI Health Scorecard: Authority/Visibility Inconsistency

**Date**: 2026-01-19  
**Status**: OPEN  
**Owner**: Alan / Next chat

---

## Summary
Authority and Visibility values are inconsistent within the **AI Health (Overview)** module and between the **Overview** and **Dashboard** modules. Some components show **52/74** while others show **50/75** for the same date range.

This is not a display-only bug. The UI currently mixes two different data sources for the same fields.

---

## Observed Mismatch
**Same module (Overview / AI Health Scorecard):**
- Pillar cards, radar, snippet readiness show: **Authority 52 / Visibility 74**
- Score Trends tooltip and Pillar Scorecard table show: **Authority 50 / Visibility 75**

**Dashboard module (AI Health / AI Summary tiles):**
- Values can differ from Overview depending on which override path was used.

---

## Root Cause (Data Source Split)
Two distinct sources are used for Authority/Visibility:

1) **Audit snapshot scores** (`savedAudit.scores`)
- Calculated during the audit run.
- Used by Pillar cards, Radar, Snippet Readiness.
- Produces **52 / 74**.

2) **Trend / GSC timeseries values** (`authorityMap`, `authorityBySegmentMap`, `visibilityMap`)
- Derived from GSC timeseries and last GSC date.
- Used by Score Trends tooltip and Pillar Scorecard.
- Produces **50 / 75**.

These two are not guaranteed to match because:
- Authority is computed from segmented GSC query data vs. audit snapshot aggregation.
- Visibility uses a different date or rounding when sourced from timeseries.
- Timeseries last date can lag the audit snapshot by 1–2 days.

---

## Where Each Source Is Used
**Audit snapshot (52 / 74):**
- Pillar cards (`displayDashboard` -> `getOrderedPillars(scores)`)
- Radar chart (Overview)
- Snippet Readiness gauge

**Trend series (50 / 75):**
- Score Trends chart tooltip (timeseries arrays)
- Pillar Scorecard table (overrides via `getLatestGscPillarOverrides()`)

---

## Impact
- Users see two conflicting values for the same pillars.
- Dashboards cannot be trusted for comparisons.
- Makes deltas and narrative insights misleading.

---

## Decision Required (Single Source of Truth)
Pick **one** and use it everywhere:

**Option A — Audit Snapshot (recommended by user):**
- Use `savedAudit.scores` as the definitive Authority/Visibility for Overview + Dashboard.
- Trend chart should use these values for the last point (or explicitly label as timeseries).

**Option B — Trend / GSC Timeseries:**
- Use `authorityBySegmentMap` and `visibilityMap` values everywhere.
- Ignore audit snapshot for these two pillars.

---

## Required Fix (high level)
1) Decide the single source of truth.
2) Remove the other override path.
3) Make all Overview + Dashboard components read from the same source.
4) Update any labels to reflect the chosen source (audit vs timeseries).

---

## Handover Notes
- Several attempted patches tried to sync values post-load; these did not resolve the core mismatch.
- The issue will persist until one source is chosen and enforced across all render paths.
- Do not add more partial overrides; remove one path completely.
