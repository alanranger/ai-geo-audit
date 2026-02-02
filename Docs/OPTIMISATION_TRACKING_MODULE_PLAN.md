# Optimisation Tracking Module — Phased Implementation Plan

## Objective

Add an Optimisation Tracking capability that turns high-value keywords (from Ranking & AI) into trackable optimisation work items, with repeatable "change cycles" and clear monitoring status over time. This must integrate cleanly with existing keyword/ranking data, and reuse your established UI patterns (table styling, presets, filters, pills/badges, spacing).

## 2026-02-01 Clarification (Plain English)

- **URL task metrics** should use **page‑level totals** (all queries for the page).
- **Keyword task metrics** should use **query‑level totals** (one keyword only).
- These are different slices of GSC and are **not expected to match**.
- Baseline/latest are **snapshots captured at the time** of Add Measurement/Rebaseline and are **not recalculated** later.

## Primary Outcomes

### From the Ranking & AI keyword table:
- See whether a keyword+URL is already being optimised (status)
- Add it to tracking in one click
- Log subsequent optimisation changes (2nd/3rd/4th cycles) without creating duplicate tasks

### In the new module:
- Manage backlog/in-progress/monitoring/done
- Log changes as discrete events
- View simple performance deltas since the latest change
- Identify "follow-up due" items (monitoring window elapsed or regressions)

## Non-Negotiables

1. **Consistent UI formatting**: Table/pills/pagination/presets/filter bar must match the existing "Keyword rankings & AI usage" table styling and interaction patterns.

2. **No duplicate task spam**: One open task per (keyword, cleaned target URL, task_type). Subsequent work on the same item is handled via events (change logs), not new tasks.

---

## Phased Delivery Plan

### Phase 0 — Design Lock + Plumbing Decisions (Foundation)

**Goal**: Define schema + linking rules + UI entry points.

**Tasks**:
- [ ] Confirm linking key: `(keyword_id or keyword_text) + target_url_clean + task_type`
- [ ] Define status lifecycle: `backlog → in_progress → monitoring → done` + computed `follow_up_due`
- [ ] Define monitoring windows: e.g. 28d quick check, 90d main check
- [ ] Decide where to store "cleaned URL": ensure it matches your existing URL normaliser logic (no `?srsltid` etc.)

**Deliverables**:
- [ ] DB tables + indexes
- [ ] Helper functions: URL cleaning, task upsert, event insert
- [ ] View/RPC plan for "status per keyword row"

---

### Phase 1 — Database Layer (Supabase)

**Goal**: Create robust task+event storage and a status view.

**Create**:

#### `optimisation_tasks`
- `id` (uuid)
- `keyword_id` (or keyword string)
- `keyword_text` (optional)
- `target_url_clean`
- `task_type`
- `status`
- `priority` (optional)
- `notes`
- `created_at`
- `updated_at`

#### `optimisation_events`
- `id`
- `task_id`
- `event_date`
- `event_type`
- `change_summary`
- `before_snapshot` (optional)
- `after_snapshot` (optional)

#### Index/Constraint:
- Unique partial index to prevent duplicates for open tasks:
  - Unique on `(keyword_id, target_url_clean, task_type)` where `status != 'done'` (or use `is_open`)

#### View (or RPC) `vw_keyword_optimisation_status`
- Returns latest task status, latest event date, cycle count, follow-up due flag per `(keyword_id, target_url_clean, task_type)`.

**Deliverables**:
- [x] SQL migration scripts
- [x] One query endpoint the UI can call efficiently

---

### Phase 2 — UI Entry Point in Ranking & AI Module (Replace SERP Features Column)

**Goal**: Replace the final "SERP features" column with "Optimisation".

**Column shows a pill**: `Not tracked` / `Backlog` / `In progress` / `Monitoring` / `Follow-up due` / `Done`

**Tiny metadata**: Last change, Cycles

**Row actions**:
- Not tracked: "Add"
- Tracked: "Open" + "Log change"

**Must reuse existing table components/styles**:
- Same header row typography, spacing, pagination, hover states, badge styles
- No new visual language

**Deliverables**:
- [x] Table column swap + actions wired to Supabase
- [x] URL cleaning applied consistently before linking/creating tasks

---

### Phase 3 — New Optimisation Tracking Page/Module (Core Management UI)

**Goal**: A dedicated module to manage tasks and log events.

**UI sections**:

#### Top summary cards (same card styling as elsewhere):
- Backlog count
- In progress count
- Monitoring count
- Follow-up due count

#### Preset buttons (matching preset chips in Ranking & AI):
- High-impact money
- AI Overview not cited
- Follow-up due
- Monitoring
- Backlog
- Done

#### Main tasks table (same table styling as Keyword rankings table):
- Keyword
- Target URL
- Task type
- Status
- Priority
- Last change
- Cycles
- Owner (optional)
- Next review date
- Actions

#### Task detail drawer/modal (same modal styling patterns used elsewhere):
- Timeline of events
- Add event ("Log change")
- Notes
- Set status
- Set monitoring window / next review date

**Deliverables**:
- [ ] New route/page + data fetch
- [ ] CRUD for tasks + events
- [ ] Consistent filters/presets UX

---

### Phase 4 — Tracking Metrics & Snapshots (Lightweight, Actionable)

**Goal**: Show whether changes are working.

**For each task, compute deltas since the latest event date**:
- **GSC**: clicks, impressions, CTR, avg position (same window as your global `GSC_WINDOW_DAYS`)
- **Rank**: DataForSEO current rank delta (if available)
- **Optional**: AI citations delta (if you store it by run)

**Implementation approach**:
- Store lightweight "snapshot at event time" OR compute from stored daily/weekly aggregates if you already have them.
- Display as small "delta pills" and a simple sparkline if you already use Chart.js sparklines elsewhere.

**Deliverables**:
- [ ] Delta computation + display
- [ ] Follow-up due rule: if window elapsed and deltas not improved → flag

---

### Phase 5 — Objective Integrity + Auto-Status ✅ COMPLETE
**Date Completed**: 2025-12-19

**Goal**: Make objectives structurally consistent, validated on write, and auto-evaluated (status + progress) whenever a measurement is created/updated.

**Deliverables**:
- [x] Objective storage in `optimisation_task_cycles` (jsonb)
- [x] Server-side objective evaluation (`evaluateObjective.js`)
- [x] Auto-status calculation: `not_set`, `on_track`, `overdue`, `met`
- [x] Auto-progress calculation with baseline/latest/delta/target
- [x] Goal status badges in table and modal
- [x] Summary chips: Not set / On track / Overdue / Met

---

### Phase 5.6 — Read-only Share Mode ✅ COMPLETE
**Date Completed**: 2025-12-19

**Goal**: Enable read-only sharing of optimisation tracking data via secure tokens.

**Deliverables**:
- [x] Share token generation endpoint
- [x] Share token verification
- [x] Read-only GET endpoints
- [x] Write endpoints reject share mode
- [x] Frontend share mode UI

---

### Phase 6 — Cycle Management + Measurement History ✅ COMPLETE
**Date Completed**: 2025-12-19

**Goal**: Make cycles repeatable with proper history tracking.

**Deliverables**:
- [x] "Start New Cycle" functionality
- [x] Per-task cycle numbering
- [x] Cycle selector in Task Details
- [x] Measurement history per cycle
- [x] Timeline events per cycle

---

### Phase 7 — Cycle Completion + Reporting Consistency ✅ COMPLETE
**Date Completed**: 2025-12-19

**Goal**: Make cycles behave like proper time-boxed experiments.

**Deliverables**:
- [x] Complete Cycle button
- [x] Archive Cycle button
- [x] Cycle status enum values (completed, archived)
- [x] Cycle event types (cycle_completed, cycle_archived, cycle_start)
- [x] Active Cycle Only filter
- [x] Overdue Cycle filter
- [x] Consistent objective status across all views

---

### Phase 8 — Progress/KPI Correctness + Formatting ✅ COMPLETE
**Date Completed**: 2025-12-19

**Goal**: Fix KPI/target math (especially percent KPIs), and make Goal/Progress display consistent.

**Deliverables**:
- [x] Fixed double percentage multiplication bug (100% → 10000%)
- [x] CTR deltas shown as percentage points (pp)
- [x] Rank treats lower as better
- [x] AI citations as integers
- [x] Shared progress calculation helper
- [x] "Remaining to target" display instead of confusing delta lines

---

### Phase 9 — Enhanced Objective Visibility & Analytics 🚧 IN PROGRESS

**Goal**: Make objectives visible and actionable at a glance, with RAG tiles, detailed table columns, sparklines, impact estimates, and time-based trends.

**Tasks**:
- [ ] Add second row of KPI tiles (RAG) that reflect objectives
- [ ] Add objective progress columns to table (KPI, Target, Baseline→Latest, Δ, RAG, Due in, Last measured)
- [ ] Add mini sparklines (per-task or per-KPI)
- [ ] Add estimated impact tiles (CTR clicks, AI citation gap)
- [ ] Add time-based charts (active objectives by KPI, net movement trends)

**Deliverables**:
- [ ] KPI tiles showing objective-based metrics (CTR, Rank, AI, Freshness)
- [ ] Detailed progress columns in table (no need to open modal)
- [ ] Visual trend indicators (sparklines)
- [ ] Impact estimates (motivational and prioritising)
- [ ] Historical trend charts

---

### Phase 10 — Advanced Reporting (Planned)

**Goal**: Prevent drift and make it operational.

**Tasks**:
- [ ] Add "stale monitoring" alerts
- [ ] Add export (CSV) of tasks
- [ ] Optional: monthly rollup table for tasks touched / wins / regressions

**Deliverables**:
- [ ] Automated "Follow-up due" calculation
- [ ] Basic reporting hooks for your monthly optimisation tracking

---

## Implementation Order (Recommended for Cursor)

1. **Phase 1 (DB)** and **Phase 2 (status column integration)** first — you'll immediately see value inside Ranking & AI.
2. **Phase 3 (new module UI)** once linking is proven.
3. **Phase 4/5** after the workflow feels right.

---

## Success Criteria (What "Phase Complete" Means)

- [x] Ranking & AI table shows Optimisation status for every row and can Add/Open/Log change reliably.
- [x] No duplicate tasks created for the same (keyword, cleaned URL, type) while open.
- [x] New Optimisation module can filter/preset and show tasks with consistent UI styling.
- [x] Logging a second/third change increments cycles and resets monitoring baseline.
- [x] Objectives are tracked per cycle with auto-calculated status and progress.
- [x] Cycles can be completed/archived with proper timeline events.
- [x] KPI formatting is correct (CTR as pp, rank lower better, no double percentage bugs).
- [x] Share mode provides read-only access to optimisation tracking data.

## Implementation Status

**All Phases 1-8 are COMPLETE!** ✅

See `OPTIMISATION_TRACKING_PHASES_COMPLETE.md` for detailed status of each phase.

---

## Technical Notes

### URL Cleaning
- Must match existing URL normaliser logic
- Remove query parameters like `?srsltid`
- Ensure consistent format for linking

### Status Lifecycle
```
backlog → in_progress → monitoring → done
                              ↓
                        follow_up_due (computed)
```

### Monitoring Windows
- Quick check: 28 days
- Main check: 90 days

### Task Uniqueness
- One open task per: `(keyword_id, target_url_clean, task_type)`
- Subsequent work = events, not new tasks
- Only when status != 'done' (or is_open = true)

---

## Integration Points

### Existing Systems
- Keyword rankings table (Ranking & AI module)
- GSC data (clicks, impressions, CTR, position)
- DataForSEO rank data
- AI citation tracking (if available)
- URL normaliser logic

### UI Components to Reuse
- Table styling (headers, rows, pagination)
- Pill/badge components
- Preset filter chips
- Modal/drawer patterns
- Summary card components
- Filter bar components

---

## Future Considerations

- Monthly optimisation tracking reports
- Automated regression detection
- Integration with other tracking systems
- Performance trend analysis
- Team collaboration features (owner assignment)
