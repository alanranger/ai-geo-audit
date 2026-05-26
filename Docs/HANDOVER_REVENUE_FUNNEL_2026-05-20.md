# Revenue Funnel + Scenario Planning - Session handover

> **⚠️ Read first (added 2026-05-26):** The revenue **data layer** was rebuilt
> by Phase L + L1 on 2026-05-26 after this handover was written. The picker
> and Auto-Optimise pass described here still work — but **stop reading
> `revenue_snapshots` for headline revenue** (it was a double-counted sum of
> three overlapping sources). All headline revenue now reads
> `public.booking_sheet_monthly_wide` (operational_revenue = D2C + B2B;
> adjustment_net = voucher timing line; revenue_amount = full 12-cat sum =
> YTD Actual reconciliation basis). The 6-tier scenario-picker concepts
> (`courses`, `workshops_nonres`, `workshops_residential`, `services`,
> `hire`, `academy`) survive as picker focus areas, but `services` and
> `hire` no longer correspond to any real Booking Sheet category — they're
> opportunity-zone scenario concepts only. The `tier_revenue` jsonb returned
> by `revenue-funnel-summary.js` is now synthesised for back-compat (4 real
> mappings, `services` + `hire` = null) until the UI rebuild turn deletes the
> 6 per-tier sparklines and replaces them with a 3-line D2C/B2B/ADJUSTMENT
> chart. **Read `Docs/REVENUE-TRUTH-FROM-BOOKING-SHEET.md` and
> `Docs/AGENT_ONBOARDING.md` §0 + §4b before touching anything that reads or
> writes revenue.**
>
> ---

**Last touched**: 2026-05-20 ~23:15 UTC+1 (revenue data layer rebuilt 2026-05-26 — see banner above)
**Last commit on `main`**: `44671a0` ("Picker: apply suppression penalty inside the scoring pass") at session end; subsequent: `6faa5f1` (Phase L); Phase L1 uncommitted at time of writing
**Branch / repo**: `ai-geo-audit` / `main` (Vercel auto-deploys from `main`)
**Owner waiting on this**: Alan - he closed the thread for handover, so the NEXT agent should read this file first before touching anything in Revenue Funnel or Scenario Planning.

---

## TL;DR for the next agent

The picker (`api/aigeo/revenue-funnel-smart-priorities.js`) and the
Auto-Optimise pass (`api/aigeo/revenue-funnel-auto-optimise.js`) now
have THREE new layers on top of the page-aware action plans Alan
asked for last session:

1. **Optimisation-tracking suppression** - the picker reads active
   monitoring cycles from `optimisation_task_cycles` + `optimisation_tasks`
   and downgrades/blocks/marks-as-stale any candidate whose URL is
   already being worked on. Verified: 35 cycles -> 19 URLs in
   monitoring on prod. Picker scoring penalty is x0.10 / x0.45 / x0.65.
2. **Seasonality scaling** - per-tier per-month multipliers seeded
   from Alan's stated activity calendar. Workshops May = x1.60,
   Courses Jun-Aug = ~x0.40, Hire/Services = flat 1.0 (opportunity
   zones), Academy = winter boost. Applied to `estimated_lift_gbp_*`.
3. **Seasonality + monitoring banner** - new endpoint
   `/api/aigeo/revenue-funnel-seasonality` renders a banner above
   the Top 3 cards with the per-tier bands and the count of URLs
   already in monitoring (with per-KPI breakdown).

A self-test script is in `scripts/multi-scenario-validation.mjs` -
run `node scripts/multi-scenario-validation.mjs` to hit prod, capture
the top 3 from baseline + each Auto-Optimise preset, and write a
markdown report into `Docs/MULTI_SCENARIO_VALIDATION_<ts>.md`.

---

## OPEN TASKS (priority order - Alan flagged these in his last message)

### 1. Summary-tile layout for Auto-Optimise [HIGH - visual fix]

**What Alan said**: "surely these 4 tiles should be separate and
not squeezed on the right of a table or container?? show them
separately above each scenario as separate tiles as summary
tiles ... why am I telling you this when it's obvious"

**Where**: `audit-dashboard.html` - Auto-Optimise section in
the Scenario Planning tab. The four summary tiles
(`DO NOTHING / EASY / BALANCED / HARD`) currently wrap to a
second row when the container is narrow, with the HARD tile
dropping below.

**What to ship**:
- Lay them out as **4 separate summary tiles in a single row** at
  the top of the Auto-Optimise section, each tile sitting ABOVE
  its corresponding scenario card column so the user reads
  `summary -> detailed actions` top-to-bottom in one column.
- The uplift number on each tile (Monthly GP delta vs Do Nothing)
  must be colour-coded **green for positive** uplift, **red for
  zero or negative**. Currently it's just text.
- The Annual delta should also be colour-coded the same way.
- Sticky-top behaviour optional but nice - the summary row could
  stick to the top of the scroll area so the user always sees
  the comparison while reading the detailed action cards below.

### 2. Acknowledge + track changes Alan has ALREADY made [HIGH - trust]

**What Alan said**: "we did a day and a half of new re-writes to
pages and CTAs this week so are you tracking and taking those
changes into account or relying on past data, this is my point...
I make your recommended changes and you don't acknowledge them or
track them to see OVER TIME if they push the needle, then
re-optimise again with latest data and evidence - so we go round
in circles"

**Where**: 
- `page_html` table has `fetched_at` per page snapshot.
- `optimisation_task_cycles.start_date` already tracks when each
  cycle began.
- GSC data in `gsc_page_metrics_28d` + `gsc_page_timeseries`.

**What to ship** (in priority order):

**a. "Recently edited - well done" positive ack panel**
Use `page_html.fetched_at` (or a new `page_edits` table that hooks
into Alan's Squarespace edits) to detect pages modified in the
last 7-14 days. Show a panel near the top of Revenue Funnel:
"You edited 6 pages this week: /free-online-photography-course,
/photography-courses-coventry, ..." with a 14-day CTR delta per
URL pulled from `gsc_page_timeseries`. This is the missing
positive feedback loop.

**b. "Did the previous change move the needle?" - per-cycle
delta on suppressed cards**
On every suppressed/stale card, show the GSC delta from
`cycle.start_date` to today:
- CTR delta (vs `optimisation_task_events.gsc_ctr` baseline event)
- Clicks delta
- Position delta
- If delta is positive, recolour the suppression pill from PURPLE
  to GREEN with text "+0.4% CTR since change - working, hold
  steady". If delta is negative or flat, keep the existing
  STALE pill with the "try a different angle" framing.

**c. Auto-refresh GSC after any edit detected**
When a `page_html.fetched_at` is newer than the latest
`optimisation_task_events.event_at` for that URL, queue a fresh
GSC pull for that page so the next picker run reads
post-rewrite data, not pre-rewrite data. This is what stops
the "going in circles" loop.

### 3. Academy economics flag [HIGH - business]

**What Alan said**: "academy should be producing at least 10
signups a month - 10 x £79/£59 if offer included - else why
keep it live? The cost is DB, subscription cost for Memberstack
plus Supabase plus Squarespace email campaigns - so over $100
a month but not making any return despite all the content
written which is another cost to use AI to generate"

**Where**:
- Academy revenue is captured in `revenue_snapshots.tier_revenue['academy']`.
- Academy operating cost is currently NOT modeled anywhere.

**What to ship**:
- Add a `revenue_funnel_tier_costs` table (or extend
  `revenue_funnel_targets`) with a per-tier fixed monthly cost
  field. Seed Academy at **£100/mo** (Memberstack + Supabase +
  Squarespace email + AI content amortised) so the GP-per-tier
  math actually subtracts these.
- Define the Academy MINIMUM signup target as **10 paid signups
  per month** (annual: £79; with offer: £59). Below this the
  tier should show a red "UNDER MINIMUM" badge in the profit
  pyramid and Revenue Funnel header.
- When Academy GP is < £0 for 2 consecutive months, the picker
  should AUTOMATICALLY suppress `academy/*` candidates and
  surface a single "REVIEW: keep Academy alive?" card with the
  trailing 90d cost vs revenue so Alan can decide whether to
  freeze or kill the tier.
- The summary tiles in Auto-Optimise need a "After fixed cost"
  GP figure as well as the gross figure so the £ deltas are
  honest (currently they ignore the £100/mo Academy floor).

### 4. Preset diversity follow-up [MEDIUM - already noted]

**What's broken**: all three Auto-Optimise presets (Easy /
Balanced / Hard) currently pick the SAME top-3 URLs
(`/free-online-photography-course`, `/photography-courses-coventry`,
`/hire-a-professional-photographer-in-coventry`) just with different
total £. Even after the suppression x0.65 stale penalty those three
beat the fresh `surfacing` candidates at score ~50.

**What to ship**: Inside `rerankForPreset` in
`api/aigeo/revenue-funnel-auto-optimise.js`:
- Easy: drop the `surfacing` lever entirely, prefer hire + services
  (cheap wins, no rewrite cost).
- Balanced: target tier mix matches the current profit-gap-by-tier
  proportions - i.e. if courses is most under-target this month,
  weight courses candidates more.
- Hard: aggressively boost workshops_nonres + workshops_residential
  during their peak months (Apr-May + Sep-Nov) so the seasonality
  layer actually drives differentiation.
- Make the divergence visible in the validation script - the
  presets should pick at least 1 URL each that the other two
  don't pick.

### 5. Data-driven seasonality [MEDIUM - already noted]

**What's currently shipped**: static `SEASONALITY_BY_TIER` arrays
hardcoded from Alan's stated activity bar. Workshops May=1.60,
Courses Jun-Aug=0.40, etc.

**What Alan asked for**: "you should know this from impressions,
CTR, booking sheet, Squarespace and Stripe orders already
historically"

**What to ship**:
- Query `revenue_snapshots.tier_revenue` grouped by
  `EXTRACT(MONTH FROM period_start)` across 2024-2026, normalised
  by total per year, to derive observed per-tier seasonality.
- For tiers with <12 months of data (Academy is new), fall back
  to the hardcoded multiplier.
- Blend observed and stated: `0.7 * observed + 0.3 * stated` so
  Alan's experience-based intuition still has a vote.
- Persist the result to a `revenue_funnel_seasonality` table so
  the seasonality endpoint reads from there instead of the
  hardcoded array. Provide a refresh API/button.
- Add a small "Seasonality calibration: 18 months of data, blended
  with stated activity bar" note on the banner so Alan can see
  it's data-grounded.

### 6. Continue self-testing across more scenario weight permutations [LOW - hygiene]

The current `scripts/multi-scenario-validation.mjs` only tests
the 3 Auto-Optimise presets + baseline. Extend it to also test
2 custom weight permutations (e.g. workshops-peak boost,
services-opportunity boost) and verify each one diverges from
the others by at least 1 URL in the Top 3.

---

## What was shipped tonight (2026-05-20 session)

| Commit  | Title |
|---------|-------|
| `0eab3e2` | Picker: monitoring suppression + per-tier seasonality + banner |
| `99e80dc` | Picker: use getters for MONTH_NAMES + SEASONALITY_BY_TIER (TDZ fix) |
| `ff1bfb0` | Picker: fix silent suppression failure on enum mismatch |
| `44671a0` | Picker: apply suppression penalty inside the scoring pass |

### Files touched

- `api/aigeo/revenue-funnel-smart-priorities.js` - added
  `fetchActiveOptimisationCycles`, `buildSuppressionMap`,
  `findSuppressionFor`, `suppressionVerdict`,
  `applySuppressionToActions`, `applySuppressionPenaltyToCandidate`,
  `SEASONALITY_BY_TIER`, `seasonalityFor`, `seasonalityBandFor`,
  `applySeasonalityToCandidate`, refactored `liveEnrichTopCandidates`
  to use `enrichOneCandidate`. Suppression map and monthIdx are
  now passed via a `ctx` object.
- `api/aigeo/revenue-funnel-auto-optimise.js` - wired suppression
  map through `runAllPresets` and the enrichment pass.
- `api/aigeo/revenue-funnel-seasonality.js` - NEW endpoint that
  returns the per-tier seasonality bands for the current month
  plus the count of URLs in monitoring with per-KPI breakdown.
- `audit-dashboard.html` - added suppression pill (red/amber/purple),
  seasonality pill (per-card), and the seasonality+monitoring banner
  above the Top 3 cards, plus the `rfFetchSeasonality()` init hook.
- `scripts/multi-scenario-validation.mjs` - NEW self-test script.

### Validation evidence

Latest report: `Docs/MULTI_SCENARIO_VALIDATION_2026-05-20T22-07-08.md`

Key findings on prod after the deploy:
- May (current month): workshops_nonres + workshops_residential
  in PEAK x1.60; courses ABOVE x1.10; services + hire flat x1.00;
  academy BELOW x0.90.
- 19 URLs in active monitoring (5x ctr_28d, 6x ai_citations,
  4x clicks, 1x rank, 3x other).
- Top 3 from baseline all carry STALE flags (in monitoring
  129d / 148d / 131d).
- Every Auto-Optimise preset surfaces 5 suppressed candidates
  in its top 8 picks.

---

## Where to look in the code

- Suppression model: `api/aigeo/revenue-funnel-smart-priorities.js`
  search for `ACTIVE_CYCLE_STATUSES`, `KPI_TO_LEVERS`,
  `SUPPRESSION_WINDOW_DAYS`, `SUPPRESSION_SCORE_FACTOR`.
- Seasonality model: same file, search for
  `SEASONALITY_BY_TIER`.
- Banner endpoint: `api/aigeo/revenue-funnel-seasonality.js`.
- Banner UI: `audit-dashboard.html` search for
  `rf-seasonality-banner`, `rfFetchSeasonality`.
- Suppression pill UI: `audit-dashboard.html` search for
  `rfSuppressionPill`, `rf-action-suppression`.
- Seasonality pill UI: search for `rfSeasonalityPill`,
  `rf-action-season`.

---

## Known pitfalls for the next agent

1. **`__INTERNAL` exports use getters** for `MONTH_NAMES` and
   `SEASONALITY_BY_TIER` because they're declared further down in
   the file. Don't change to bare references or you'll get
   `Cannot access X before initialization`.

2. **`optim_task_status` enum** has only `monitoring` and `planned`
   as live values (plus `completed` / `cancelled` / `done` for
   closure). Don't add other strings to `ACTIVE_CYCLE_STATUSES` -
   the query crashes silently and turns the whole suppression
   layer off.

3. **`liveEnrichTopCandidates` only runs on the top N candidates**.
   If you need suppression to affect deeper candidates, apply
   it in `buildAllPriorities` (already done) NOT in the live-enrich
   pass.

4. **Auto-Optimise re-runs `buildAllPriorities` per preset** so
   the suppression map must be passed through `runAllPresets` ->
   `buildAllPriorities(snapshot, weights, suppressionMap)`. The
   second arg ordering matters.

5. **Vercel needs `git push origin main`** to deploy. If the user
   reports the latest fix isn't visible, check `git log -1`
   matches what's expected and that the push succeeded - the
   PowerShell wrapper sometimes prints the success message via
   stderr which Cursor renders as a red error block.

---

## How to verify everything works end-to-end

```bash
# 1. Re-run the validation script
node scripts/multi-scenario-validation.mjs

# 2. Smoke test the seasonality endpoint
curl "https://ai-geo-audit.vercel.app/api/aigeo/revenue-funnel-seasonality?propertyUrl=https%3A%2F%2Fwww.alanranger.com"

# 3. Smoke test the picker - top 3 should all carry suppression
curl "https://ai-geo-audit.vercel.app/api/aigeo/revenue-funnel-smart-priorities?propertyUrl=https%3A%2F%2Fwww.alanranger.com" | jq '.candidates[0:3] | .[] | {url: .pages_affected[0], supp: .suppression.severity, season: .seasonality_factor}'

# 4. Spot-check the Revenue Funnel tab in the live dashboard.
# Expected: seasonality banner shows "May 2026 / 19 URLs in monitoring",
# Top 3 cards all show purple STALLED pill, each card has a SEASON +X%
# pill in the tier row when its tier isn't in the neutral band.
```

---

## Quick reference for the user-facing language

When talking to Alan, use HIS terminology:
- "Lever" not "feature" or "knob"
- "Tier" (academy / courses / workshops_nonres / workshops_residential / services / hire) - these are commercial segments
- "Money pages" - the tier hubs (e.g. `/free-online-photography-course`)
- "GP" - gross profit
- "AOV" - average order value
- "Stale" / "in monitoring" / "try a different angle" - matches
  what the UI now says on suppression pills
- "PEAK / GAP / shoulder month" - matches the seasonality bands

Alan responds badly to:
- Engineer-jargon explanations of changes ("refactored", "DRY")
- Promises without proof
- The same recommendation card reappearing without acknowledging
  he already did the work (THIS is what we just fixed)
- Generic copy like "Rewrite the title + meta description" with
  no page-specific evidence (also what we fixed in phase H)

Alan responds well to:
- Concrete data evidence ("129d in monitoring, CTR moved +0.0%")
- Per-page specifics (what's already in the H1, what's in the
  meta description, what the current CTR is)
- Honest disclaimers about modelling basis (`rf-action-basis`
  lines on each card)
- Showing the work in markdown reports under `Docs/`
