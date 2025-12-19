# Optimisation Tracking Module — Implementation Status

## Completed Phases

### Phase 1 — Database Layer ✅ COMPLETE
**Date Completed**: 2025-12-18

**Deliverables**:
- ✅ `optimisation_tasks` table with full schema
- ✅ `optimisation_task_events` table for event tracking
- ✅ `optimisation_task_cycles` table for cycle management
- ✅ Helper functions: `arp_clean_url()`, `arp_keyword_key()`
- ✅ View: `vw_optimisation_task_status` for status aggregation
- ✅ Row Level Security (RLS) policies
- ✅ Unique partial index to prevent duplicate open tasks

**Migration**: `20251218_optimisation_tracking_phase1.sql`

---

### Phase 2 — UI Entry Point in Ranking & AI Module ✅ COMPLETE
**Date Completed**: 2025-12-18

**Deliverables**:
- ✅ Replaced "SERP Features" column with "Optimisation" column
- ✅ Status pills: `Not tracked` / `Planned` / `In progress` / `Monitoring` / `Done` / `Paused` / `Cancelled`
- ✅ Row actions: "Track" (for not tracked) / "Manage" (for tracked)
- ✅ "Track Keyword" modal for creating new tasks
- ✅ Consistent table styling with existing Ranking & AI module

---

### Phase 3 — Optimisation Tracking Module UI ✅ COMPLETE
**Date Completed**: 2025-12-19

**Deliverables**:
- ✅ New Optimisation Tracking panel/tab
- ✅ Summary cards: Active, Planned, In Progress, Monitoring, Done, Paused, Cancelled, Updated (30d)
- ✅ Filter bar: Status, Type, Keyword, URL, Optimisation status, Needs Update, Active Cycle Only, Overdue Cycle
- ✅ Main tasks table with columns: Keyword, URL, Type, Status, Cycle, Goal, Last Activity, Actions
- ✅ Task Details drawer/modal with:
  - Objective section (with edit capability)
  - Performance Snapshot (baseline vs latest metrics)
  - Measurement History (collapsible)
  - Timeline (events history)
  - Cycle Management (Complete/Archive/Start New Cycle)
  - Add Event form
  - Change Status dropdown

---

### Phase 4 — Tracking Metrics & Snapshots ✅ COMPLETE
**Date Completed**: 2025-12-19

**Deliverables**:
- ✅ Performance Snapshot showing baseline vs latest metrics:
  - Clicks (28d), Impressions (28d), CTR (28d)
  - Current Rank, Opportunity Score
  - AI Overview, AI Citations
  - Captured timestamps (UTC/GMT)
- ✅ Measurement History table showing last ~10 measurements with deltas
- ✅ "Add Measurement" button that captures current metrics from latest audit
- ✅ Automatic baseline capture when cycle starts
- ✅ Delta calculations between consecutive measurements

---

### Phase 5 — Objective Integrity + Auto-Status ✅ COMPLETE
**Date Completed**: 2025-12-19

**Deliverables**:
- ✅ Objective storage in `optimisation_task_cycles` table:
  - `objective` (jsonb) - Canonical objective schema
  - `objective_status` (text) - Computed status: `not_set`, `on_track`, `overdue`, `met`
  - `objective_progress` (jsonb) - Computed progress with baseline/latest/delta/target
  - `due_at` (timestamptz) - Calculated from start_date + timeframe_days
- ✅ Server-side objective evaluation (`lib/optimisation/evaluateObjective.js`)
- ✅ Objective schema validation (`lib/optimisation/objectiveSchema.js`)
- ✅ Auto-evaluation on measurement creation/update
- ✅ Goal status badges in table and modal
- ✅ Summary chips: Not set / On track / Overdue / Met

**Migration**: `20251219_phase5_objective_integrity.sql`

---

### Phase 5.6 — Read-only Share Mode ✅ COMPLETE
**Date Completed**: 2025-12-19

**Deliverables**:
- ✅ Share token generation endpoint (`/api/share/create`)
- ✅ Share token verification (`lib/api/requireShareReadOnly.js`)
- ✅ Combined admin/share auth wrapper (`lib/api/requireAdminOrShare.js`)
- ✅ Read-only GET endpoints for tasks
- ✅ Write endpoints reject share mode requests
- ✅ Frontend share mode detection (`?share=1&st=<TOKEN>`)
- ✅ Read-only UI: hidden/disabled mutation controls, "Shared view (read-only)" banner

---

### Phase 6 — Cycle Management + Measurement History ✅ COMPLETE
**Date Completed**: 2025-12-19

**Deliverables**:
- ✅ "Start New Cycle" functionality:
  - Increments cycle number per task
  - Sets baseline from latest audit or previous cycle's latest measurement
  - Clears latest measurement (new cycle starts clean)
  - Creates `cycle_start` timeline event
  - Sets cycle dates (start_date, due_at from objective timeframe)
- ✅ Cycle selector in Task Details modal
- ✅ Per-cycle objective storage and viewing
- ✅ Measurement history filtered by cycle
- ✅ Timeline events filtered by cycle
- ✅ Cycle-aware goal status calculation

**Migration**: `20251219_fix_measurement_dates.sql` (includes Phase 5/6 fields)

---

### Phase 7 — Cycle Completion + Reporting Consistency ✅ COMPLETE
**Date Completed**: 2025-12-19

**Deliverables**:
- ✅ "Complete Cycle" button (marks cycle as completed)
- ✅ "Archive Cycle" button (marks cycle as archived)
- ✅ Cycle status enum values: `completed`, `archived`
- ✅ Event types: `cycle_completed`, `cycle_archived`, `cycle_start`
- ✅ Timeline shows cycle completion/archival events
- ✅ Active Cycle Only filter
- ✅ Overdue Cycle filter
- ✅ Consistent objective status calculation across table, summary chips, and modal
- ✅ Buttons shown/hidden based on active cycle status

**Migrations**:
- `20251219_add_cycle_status_values.sql` (adds `completed`, `archived` to `optim_task_status` enum)
- `20251219_add_cycle_event_types.sql` (adds `cycle_completed`, `cycle_archived`, `cycle_start` to `optim_event_type` enum)

---

### Phase 8 — Progress/KPI Correctness + Formatting ✅ COMPLETE
**Date Completed**: 2025-12-19

**Deliverables**:
- ✅ Fixed double percentage multiplication bug (100% no longer shows as 10000%)
- ✅ KPI-specific formatting:
  - CTR: Deltas shown as percentage points (pp), e.g., "+0.20pp"
  - Rank: Lower is better (delta = baseline - latest)
  - AI Citations: Integer formatting
  - Impressions: Abbreviated as "k" when >= 1000
- ✅ Shared progress calculation helper (`computeGoalProgress()`)
- ✅ Progress display shows "Remaining: +X" instead of confusing double delta lines
- ✅ Consistent formatting across modal and table
- ✅ Proper target handling for percentage KPIs

**Files**:
- `lib/optimisation/goalProgress.js` (server-side helper)
- Client-side `KPI_DISPLAY_METADATA` and `computeGoalProgress()` in `audit-dashboard.html`

---

## Current Status

**All 8 phases are complete!** The Optimisation Tracking module is fully functional with:
- ✅ Complete database schema
- ✅ Full UI integration
- ✅ Cycle management
- ✅ Objective tracking with auto-status
- ✅ Share mode support
- ✅ Proper KPI formatting
- ✅ Measurement history
- ✅ Timeline events

---

### Phase 9 — Enhanced Objective Visibility & Analytics 🚧 IN PROGRESS
**Status**: Planning/Ready to implement

**Goal**: Make objectives visible and actionable at a glance, with RAG tiles, detailed table columns, sparklines, impact estimates, and time-based trends.

#### 1) KPI Tiles (RAG) That Reflect Objectives
**Deliverables**:
- [ ] Second row of tiles driven by task's Objective KPI and latest measurement deltas
- [ ] **CTR tasks tile**: On track / At risk / Overdue (RAG), plus net CTR delta across active CTR tasks
- [ ] **Rank tasks tile**: Count of tasks with rank improved / worsened / flat since baseline
- [ ] **AI tasks tile**: Count of pages with AI Overview on but citations = 0 (actionable "gap" tile)
- [ ] **Measurement freshness tile**: Tasks with last measurement > 30d or missing baseline/latest
- [ ] Each tile clickable to filter table

**Why it's better**: Tells you what's happening in the objectives, not just workflow state.

#### 2) Objective Progress Columns in Table
**Deliverables**:
- [ ] **Objective KPI column**: Display KPI type (e.g., CTR (28d), Rank, AI Citations)
- [ ] **Target column**: Direction + value (e.g., "Increase by +1.00pp", "Decrease to rank 5")
- [ ] **Baseline → Latest column**: Compact version showing baseline → latest values
- [ ] **Δ vs baseline column**: Formatted delta (e.g., "+0.12pp", "-3", "+2")
- [ ] **RAG progress column**: On track / At risk / Overdue status badge
- [ ] **Due in column**: Days remaining (e.g., "12d") or "Overdue 4d"
- [ ] **Last measured column**: Date + "Needs update" indicator if > 30d or missing

**Why it's better**: Stop opening modals just to understand progress - everything visible in table.

#### 3) Mini Sparklines
**Deliverables**:
- [ ] **Option A**: Per-task sparkline (tiny line) for objective KPI, last ~6–10 measurements
- [ ] **Option B**: Per-KPI trend (one sparkline per KPI tile)
- [ ] Using measurement history data
- [ ] Visual trend indicator showing if metric is moving up/down/flat

**Why it's better**: Makes dashboard feel "alive" and quickly answers "is this moving?"

#### 4) Estimated Impact Tiles
**Deliverables**:
- [ ] **CTR impact tile**: Estimated extra clicks available
  - Formula: `impressions_28d * (target_ctr - current_ctr)` summed across active CTR tasks
  - Shows potential value of completing CTR objectives
- [ ] **AI citation gap tile**: 
  - Count of tasks where AI Overview = On and AI Citations = 0
  - Optionally weighted by opportunity score
  - Shows actionable gap size

**Why it's better**: Extremely motivating and prioritises correctly - shows real business impact.

#### 5) Time-Based Charts
**Deliverables**:
- [ ] **Active objectives by KPI over time**: Stacked counts by week/month
  - Shows how many objectives are active for each KPI type over time
- [ ] **Net movement trend**: 
  - Median rank change for rank objectives
  - Average CTR change for CTR objectives
  - Only includes tasks with measurements in last 30 days
  - Shows overall progress trend

**Why it's better**: Simple, not clutter - gives high-level view of optimisation program health.

---

## Next Steps (Future Phases)

### Phase 10 — Advanced Reporting (Planned)
- Monthly rollup reports
- Win/loss tracking
- Regression detection
- Export capabilities (CSV)

### Phase 11 — Automation (Planned)
- Automated follow-up reminders
- Stale monitoring alerts
- Integration with other tracking systems

---

## Technical Architecture

### Database Tables
- `optimisation_tasks` - Main task storage
- `optimisation_task_cycles` - Cycle-level data (objectives, status, progress)
- `optimisation_task_events` - Timeline events (measurements, notes, cycle changes)

### Key Views
- `vw_optimisation_task_status` - Aggregated status view for table display
- `vw_optimisation_task_goal_status` - Goal status calculation (if exists)

### API Endpoints
- `GET /api/optimisation/tasks` - List tasks (supports share mode)
- `GET /api/optimisation/task/[id]` - Get task details (supports share mode)
- `POST /api/optimisation/task` - Create task (admin only)
- `PATCH /api/optimisation/task/[id]` - Update task (admin only)
- `DELETE /api/optimisation/task/[id]` - Delete task (admin only)
- `POST /api/optimisation/task/[id]/objective` - Update objective (admin only)
- `POST /api/optimisation/task/[id]/measurement` - Add measurement (admin only)
- `POST /api/optimisation/task/[id]/cycle` - Start new cycle (admin only)
- `POST /api/optimisation/task/[id]/cycle/complete` - Complete/archive cycle (admin only)
- `POST /api/optimisation/task/[id]/event` - Add event (admin only)
- `GET /api/optimisation/task/[id]/events` - Get events (supports share mode)
- `POST /api/share/create` - Generate share token (admin only)

### Authentication
- Admin mode: `x-arp-admin-key` header
- Share mode: `x-arp-share-token` header (read-only)
- Share tokens: HMAC-SHA256 signed, URL-safe Base64 encoding

---

## Data Model Summary

### Objective Schema (JSONB)
```json
{
  "title": "string",
  "kpi": "clicks_28d|impressions_28d|ctr_28d|current_rank|opportunity_score|ai_overview|ai_citations",
  "target": number|boolean,
  "target_type": "delta|absolute",
  "due_at": "ISO date string|null",
  "plan": "string|null"
}
```

### Progress Object (JSONB)
```json
{
  "baseline_value": number|null,
  "latest_value": number|null,
  "delta": number|null,
  "target": number,
  "target_type": "delta|absolute",
  "remaining_to_target": number|null
}
```

### Status Values
- `objective_status`: `not_set`, `on_track`, `overdue`, `met`
- `cycle_status`: `planned`, `in_progress`, `monitoring`, `done`, `paused`, `cancelled`, `completed`, `archived`
- `event_type`: `created`, `note`, `change_deployed`, `measurement`, `status_changed`, `cycle_start`, `cycle_completed`, `cycle_archived`

---

## Known Issues / Limitations

1. **CTR with baseline = 0**: Relative percentage increases are undefined. Currently shows as percentage points.
2. **Measurement idempotency**: 5-minute cooldown prevents duplicate measurements.
3. **Share tokens**: No expiration enforcement (relies on manual rotation of `ARP_SHARE_KEY`).

---

## Testing Checklist

- [x] Create task from Ranking & AI table
- [x] Set objective with KPI, target, timeframe
- [x] Add measurement (captures current metrics)
- [x] Start new cycle (increments number, sets baseline)
- [x] Complete cycle (marks as completed, creates event)
- [x] Archive cycle (marks as archived, creates event)
- [x] View cycle history (switch between cycles)
- [x] Share mode (read-only access)
- [x] Goal status calculation (on_track/overdue/met)
- [x] KPI formatting (CTR as pp, rank lower better, etc.)

