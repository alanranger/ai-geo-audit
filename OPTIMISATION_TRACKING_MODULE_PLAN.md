# Optimisation Tracking Module — Phased Implementation Plan

## Objective

Add an Optimisation Tracking capability that turns high-value keywords (from Ranking & AI) into trackable optimisation work items, with repeatable "change cycles" and clear monitoring status over time. This must integrate cleanly with existing keyword/ranking data, and reuse your established UI patterns (table styling, presets, filters, pills/badges, spacing).

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

### Phase 5 — Governance + Workflows (Make It Stick)

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
