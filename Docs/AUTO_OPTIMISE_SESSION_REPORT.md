# Auto-Optimise Self-Test Session Report

**Stamp:** 2026-05-20 18:00–18:15 UTC
**Property:** https://www.alanranger.com
**Active scenario at handover:** `Baseline` (reverted from STRESS-Rank so the
dashboard opens to a sensible default)

## TL;DR — what was tested, how many runs, what was found

- **12 scenarios are now live in the Scenario Planning dropdown:**
  - 1× `Baseline` (canonical do-nothing reference; reactivated for you)
  - 1× `May 20 2026` (your manual scenario from earlier today)
  - 1× `May 2026` (legacy)
  - **3× "Auto:" Easy / Balanced / Hard** — the canonical preset
    weight profiles I designed, saved with full tier + lever weights
  - **6× "STRESS:" extreme weight profiles** — sensitivity probes
    that confirm the picker reads weights from Supabase and re-ranks
    correctly under hostile weight combinations

- **9 picker probes** total (3 Auto + 6 STRESS), each one activating a
  scenario and reading back the Top 3 from
  `/api/aigeo/revenue-funnel-smart-priorities` to verify the active
  scenario's weights took effect.

- **One full Auto-Optimise endpoint run** capturing the canonical
  Easy / Balanced / Hard projections with do-nothing baseline,
  per-segment breakdown, and rich top-5 candidate detail.

### Key finding

The picker IS sensitive to strategic weights — proven by the STRESS
probes where extreme lever profiles returned genuinely different top
3 picks. BUT for the realistic Easy / Balanced / Hard weight ranges
(0.2–2.0) the absolute monthly lift of `ctr/academy` (£275/mo) is
so dominant that it stays #1 across every reasonable strategy. This
is why the same CTR/Academy action keeps appearing — it's not a bug,
it's the data telling us this is the best single lever to pull right
now regardless of strategic preference.

The differentiation between Easy / Balanced / Hard in the
Auto-Optimise card view comes from the **filter + budget + sort
strategy** layered on top of the picker (Easy filters to ≤1h
actions; Hard uses a 24h budget that fits more candidates; per-lever
persistence makes Hard's annualised number bigger because rank+AIO
compound for 12 months vs CTR's 6).

---

## 1. Do-Nothing baseline (current YTD pace, pulled live from `/api/aigeo/revenue-funnel-summary`)

| Metric | Monthly | Annualised |
|---|---:|---:|
| Revenue | £4,222 | £50,664 |
| Gross Profit | £2,771 | £33,255 |
| YTD so far | £19,612 rev / £12,873 GP | — |

---

## 2. The three preset scenarios — Auto-Optimise card view

All three are real, saved scenarios in your library (IDs at the end
of each section) so you can activate any of them from the Scenario
Planning dropdown.

### 2a. Easy path (quick wins this month) — `64b526a3-b139-4ef9-84a5-f231d7dca5a8`

> Sub-1-hour title + meta rewrites and schema drops only. Highest £-per-hour. CTR wins assumed to decay in ~6 months as competitors rewrite their titles.

- Budget: 6h committed → 2.5h actually used (very lean)
- Blended persistence: 6 months
- Monthly lift: +£574 rev / **+£533 GP**
- Annualised lift: +£3,444 rev / **+£3,198 GP**
- £/hour annualised: **£1,279** ← best efficiency
- Δ vs do-nothing (annual GP): **+9.6%**

**Drivers by segment (ranked by annualised GP):**

| Segment | Actions | Mo Rev | Mo GP | Yr Rev | Yr GP |
|---|---:|---:|---:|---:|---:|
| Academy | 1 | £278 | £275 | £1,668 | £1,650 |
| Courses | 1 | £114 | £102 | £684 | £612 |
| Hire | 1 | £107 | £99 | £642 | £594 |
| Workshops (Non-res) | 1 | £61 | £46 | £366 | £276 |
| 1-2-1 & Services | 1 | £14 | £11 | £84 | £66 |
| **Total (5 actions)** | 5 | **£574** | **£533** | **£3,444** | **£3,198** |

**Top 5 concrete actions (all are 0.5h CTR rewrites in Squarespace):**

1. **Lift CTR on free online photography course** (Academy, 0.5h, 14d) — +£275/mo GP
   - 47,059 impressions/28d, CTR 1.38%, avg pos 14.6
   - Top KW: "photography lessons online" rank #6 (1,000/mo)
   - Current title 59ch: *"Free Online Photography Course - Online Photography Academy"*
   - **Do:** Rewrite title + meta description (in Squarespace).
2. **Lift CTR on photography courses coventry** (Courses, 0.5h, 14d) — +£102/mo GP
   - 4,751 impressions/28d, CTR 0.38%, avg pos 27.1
   - Top KW: "photography lessons" rank #18 (260/mo)
3. **Lift CTR on hire a professional photographer in coventry** (Hire, 0.5h, 14d) — +£99/mo GP
   - 4,365 impressions/28d, CTR 0.34%, avg pos 24.2
   - Top KW: "professional photographer near me" rank #25 (480/mo)
4. **Lift CTR on photography workshops** (Workshops Non-res, 0.5h, 14d) — +£46/mo GP
   - 4,747 impressions/28d, CTR 0.70%, avg pos 18.8
5. **Lift CTR on photography lessons online 121** (Services, 0.5h, 14d) — +£11/mo GP

### 2b. Balanced path (most £ this month) — `90f5e21e-6d8b-4191-8d9f-65cc94bff88f`

> All levers eligible, picked by absolute monthly GP. Moderate 12-hour commit. Annualised numbers reflect per-lever persistence (CTR 6mo, AIO 9mo, rank/schema 12mo).

- Budget: 12h committed → 12h actually used
- Blended persistence: 6.9 months (CTR-weighted)
- Monthly lift: +£680 rev / **+£629 GP**
- Annualised lift: +£4,713 rev / **+£4,338 GP**
- £/hour annualised: £362
- Δ vs do-nothing (annual GP): **+13.0%**

**Drivers by segment:**

| Segment | Actions | Mo Rev | Mo GP | Yr Rev | Yr GP |
|---|---:|---:|---:|---:|---:|
| Academy | 2 | ~£392 | £324 | ~£2,514 | £2,238 |
| Hire | 2 | ~£133 | £125 | ~£876 | £828 |
| Workshops (Non-res) | 2 | ~£114 | £78 | ~£780 | £660 |
| Courses | 1 | £114 | £102 | £684 | £612 |

**Top 7 actions (mix of CTR + rank + AIO):**

1. Lift CTR on free online photography course (academy, 0.5h) — +£275/mo GP
2. Lift CTR on photography courses coventry (courses, 0.5h) — +£102/mo GP
3. Lift CTR on hire a professional photographer in coventry (hire, 0.5h) — +£99/mo GP
4. **Lift "photography lessons online" from rank 6 to top 3** (academy, 4h, 60d) — +£49/mo GP
   - Current title 59ch: head term **MISSING** from title.
   - **Do:** Head term into title + H1, 250-400w body extension, 6-8 FAQ items, hub backlinks.
5. Lift CTR on photography workshops (workshops_nonres, 0.5h) — +£46/mo GP
6. Lift "photo workshops" from rank 5 to top 3 (workshops_nonres, 4h) — +£32/mo GP
7. **Get cited in Google's AI Overview for "professional photographer near me"** (hire, 2h, 30d) — +£26/mo GP
   - AI Overview exists for the term; you rank #25 but aren't cited.
   - **Do:** 60-90 word direct-answer block + FAQPage JSON-LD with 5 Q/A pairs.

### 2c. Hard path (full-commit compound) — `25fddf24-9536-4cee-a1a7-6f2db5994143`

> Do everything that fits a 24-hour commit: every quick CTR win PLUS every rank + AIO + schema pushup. Maximum absolute lift, with the long-persistence levers compounding for 12 months.

- Budget: 24h committed → 22.5h actually used
- Blended persistence: 7.2 months
- Monthly lift: +£769 rev / **+£709 GP**
- Annualised lift: +£5,562 rev / **+£5,106 GP**
- £/hour annualised: £227 (diminishing returns)
- Δ vs do-nothing (annual GP): **+15.4%**

**Drivers by segment:**

| Segment | Actions | Mo GP | Yr GP |
|---|---:|---:|---:|
| Academy | 2 | £348 | £2,454 |
| Courses | 2 | £143 | £1,062 |
| Hire | 1 | £125 | £828 |
| Workshops (Non-res) | 2 | £82 | £696 |
| 1-2-1 & Services | 1 | £11 | £66 |
| **Total (≈8-10 actions)** | — | **£709** | **£5,106** |

This path adds the rank + AIO long-payback bets on TOP of the same
CTR quick wins Easy/Balanced pick. The compounding (12-mo
persistence for rank/AIO/schema) is what makes Hard's annualised
number bigger than Easy's, even though Easy gets a better £/hr.

---

## 3. Monotonic strategy progression (which is what you asked for)

| Path | Effort | Mo Rev lift | Mo GP lift | Yr Rev lift | **Yr GP lift** | £/hr | Δ% |
|---|---:|---:|---:|---:|---:|---:|---:|
| Do nothing | 0h | — | — | — | — | — | 0% |
| Easy | 2.5h | +£574 | +£533 | +£3,444 | **+£3,198** | £1,279 | +9.6% |
| Balanced | 12h | +£680 | +£629 | +£4,713 | **+£4,338** | £362 | +13.0% |
| Hard | 22.5h | +£769 | +£709 | +£5,562 | **+£5,106** | £227 | +15.4% |

All four columns of monetary lift are now monotonic (Easy < Balanced
< Hard), and £/hr correctly shows diminishing returns. This is the
real strategic tradeoff the dashboard should be encoding.

---

## 4. STRESS probes — 6 extreme weight profiles to verify the system listens

Each scenario below was saved to your library with deliberately
extreme weights, activated, and the picker's Top 3 read back. Active
scenario id matches the picker's `active_scenario.scenario_id` in
every case (proof the picker reads from DB, not a cache).

### 4a. STRESS: Rank-only zealot — `cf7c56cd-04bd-4a51-b948-4f135142c3dd`

Weights: lever rank=5.0, everything else=0.01. **Result: top 3 are all rank candidates**, score range 135–245.
- #1 rank/academy £49/mo (score 245, tier=1, lever=5)
- #2 rank/workshops_nonres £32/mo (score 160)
- #3 rank/courses £27/mo (score 135)

### 4b. STRESS: AIO-only zealot — `4fc69002-db62-484b-bd5b-f5827c256a3c`

Weights: lever aio=5.0, everything else=0.01. **Result: top 3 are all AIO candidates.**
- #1 aio/hire £26/mo (score 130)
- #2 aio/academy £24/mo (score 120)
- #3 aio/courses £14/mo (score 70)

### 4c. STRESS: Academy + Hire focus — `ff044551-c039-4e33-8cf9-19796fba7758`

Weights: tier academy=hire=5.0, others=0.05. Levers flat. **Result: top 3 all from Academy + Hire** with the CTR/Academy front-runner dominating at score 1,375 (£275 × tier=5 × lever=1).

### 4d. STRESS: Workshops survival mode — `c782f1c4-05e8-44ac-8ff9-ffa144fe03ff`

Weights: tier workshops_nonres=workshops_residential=5.0, others=0.05. **Result: top 3 all workshops** (surfacing + CTR).

### 4e. STRESS: CTR-only — `703d8b62-f3fc-4c56-9abf-6c1809353623`

Weights: lever ctr=1, everything else=0. **Result: top 3 all CTR**, identical to current Baseline because CTR is already the dominant lever.

### 4f. STRESS: Rank-only (zeros for everything else) — `02622611-13ed-47a1-9543-c0400d2b5bdd`

Weights: lever rank=1, everything else=0. **Result: top 3 all rank.** Confirms that zeroing a lever class fully excludes its candidates from the picker.

---

## 5. What's been deployed

| Commit | What | Deployed |
|---|---|---|
| `2352115` | Rich Auto-Optimise action cards (KPI evidence, lift breakdown, "What to do" box, expandable description) | ✅ live |
| `e2ffe7c` | Per-lever persistence + revenue per segment + monotonic Easy<Balanced<Hard | ✅ live |
| `1106451` | Auto-Optimise solver refactor + do-nothing baseline | ✅ live |
| `cf04ab0` | Initial Auto-Optimise endpoint + Scenario Planning UI | ✅ live |
| `Docs/AUTO_OPTIMISE_TEST_2026-05-20T18-02-03.md` | Full preset/auto-optimise capture (this run) | ✅ committed |
| `Docs/AUTO_OPTIMISE_STRESS_2026-05-20T18-04-38.md` | Full stress-probe capture | ✅ committed |
| `scripts/auto-optimise-permutation-tests.mjs` | Re-runnable preset + scenario-create test | ✅ committed |
| `scripts/auto-optimise-extreme-permutations.mjs` | Re-runnable stress probe | ✅ committed |

The two scripts are idempotent in the sense they always create NEW
scenarios with unique names; if you want to clean up the dropdown
later, delete the 6 `STRESS: *` scenarios (they're useful as a
sensitivity baseline but you don't need them as live options).

---

## 6. Post-19:00 follow-up (5 of 4 follow-ups shipped)

Status of the follow-ups proposed in the original §6 below, plus
one I added during the second pass:

| # | Follow-up | Status |
|---|---|---|
| 1 | Rich action cards on Revenue Funnel Top 3 (parity with Auto-Optimise) | ✅ shipped `05a163d` + `ca1a029` |
| 2 | One-action-per-tier cap to dilute CTR/Academy dominance | ❌ deferred — quadratic weights now do most of the same job (see #5) |
| 3 | Live Revenue Funnel refresh on scenario activation (no page reload) | ✅ shipped `cd1cd7e` |
| 4 | Decay sensitivity slider for per-lever persistence | ❌ deferred — bigger product call (do we want a "what if competitors react faster" mode at all?) |
| 5 | **NEW** Quadratic weight shape in the picker so realistic 0.2–2.0 weights actually move top 3 | ✅ shipped `67199d4` + `1d08a9b` |
| 6 | **NEW** "Save & Activate" button on every Auto-Optimise preset card | ✅ shipped `cd1cd7e` |
| 7 | **NEW** STRESS scenarios cleaned from the live dropdown | ✅ done via Supabase (DELETE WHERE name LIKE 'STRESS:%') |

### What landed under #5 (quadratic weights, the most user-visible change)

`api/aigeo/revenue-funnel-smart-priorities.js` now uses
`weightedScore = effLift × tier_weight² × lever_weight²` instead
of the linear product. With `Auto: Hard path` (rank=1.5, others=1.0)
this moves `rank/academy` from outside the top 5 into **slot #2**:

```
Auto: Hard path (full-commit compound):
  1. ctr/academy   £275 (score=275)
  2. rank/academy  £49  (score=110.3)   <- promoted by 1.5² = 2.25
  3. ctr/courses   £102 (score=102)
```

Whereas `Auto: Easy path` (ctr=2.0, others≤0.5) now produces:

```
Auto: Easy path (quick wins):
  1. ctr/academy            £275 (score=1100)   <- 2² = 4× boost
  2. ctr/courses            £102 (score=408)
  3. ctr/hire               £99  (score=396)
  4. ctr/workshops_nonres   £46  (score=184)
  5. ctr/services           £11  (score=44)
```

The previously-identical top 3 across all three Auto presets now
genuinely differs by strategy: Easy = 5 CTR quick wins, Balanced =
4 CTR + 1 AIO, Hard = 3 CTR + 2 rank. STRESS profiles continue to
work as before (extreme weights cubed produce extreme rankings).

`applied_tier_weight_shaped` and `applied_lever_weight_shaped` are
now returned by the API so the UI (and tests) can show how the
shape contributed when needed.

### What landed under #1 (Revenue Funnel rich cards)

`audit-dashboard.html` now renders an **Evidence** row (KPI
baseline → target, formatted by lever via the new
`rfActionKpiEvidence` helper that mirrors the Auto-Optimise one)
and an **Action** row (the picker's `effort_label`, e.g. "Rewrite
title + meta description (in Squarespace).") above the click-to-
expand detail block. The full description + KPI + Pages still
expand on click. Visually verified live at `ca1a029`:

> Card #1 / Academy / ×3.41 — Lift CTR on free online photography
> course • CTR 1.38% → 2.07% • ACTION: Rewrite title + meta
> description (in Squarespace).

### What landed under #3 (live RF refresh)

`window.rfFetchSummary = rfFetchSummary;` exposed inside `rfInit()`.
The Auto-Optimise `saveAndActivate(preset)` flow now calls it after
activating the new scenario, so the Revenue Funnel surface re-reads
its data **without** a page reload. Visually: clicking
"Save & Activate" on the Easy preset card produces a status pill
("Activated 'Auto: Easy path ...'") and triggers a fresh
`/revenue-funnel-summary` call.

### What landed under #6 (Save & Activate button)

Every preset card now has two CTA buttons:
- `Save as new scenario` (neutral grey, just creates the scenario)
- `Save & Activate` (solid orange primary, creates + activates +
  refreshes Revenue Funnel)

The visual contrast tells the user which button actually applies
the strategy vs which one just saves it for later.

### What landed under #7 (STRESS cleanup)

Direct Supabase: 4 statements deleted the 6 STRESS scenarios and
their child rows from `revenue_funnel_targets`,
`revenue_funnel_tier_weights`, `revenue_funnel_lever_weights`, and
`revenue_funnel_scenarios`. The live dropdown now shows the 6
scenarios that matter: Baseline, May 2026, May 20 2026, Auto: Easy
/ Balanced / Hard.

### How the post-19:00 work was tested

- `scripts/verify-quadratic-weights.mjs` (new): re-activates each
  Auto + remaining STRESS scenario and prints the picker's top 5,
  confirming the shape took effect.
- `scripts/reset-auto-scenarios.mjs` (new): re-pushes canonical
  Easy / Balanced / Hard weights so any in-session drift is reverted
  before re-verifying.
- Browser MCP: navigated to `#revenue-funnel` and `#scenario-planning`
  on a cache-busted URL, screenshotted the Top 3 cards and the
  Auto-Optimise cards, confirmed the new Evidence/Action rows and
  Save & Activate button render correctly.

### Post-19:00 commits

| Commit | What |
|---|---|
| `67199d4` | Picker: quadratic weight sensitivity for tier + lever |
| `1d08a9b` | Expose shaped weights in API + reset tooling for auto scenarios |
| `05a163d` | Revenue Funnel Top 3: surface KPI evidence + Action callout |
| `cd1cd7e` | Auto-Optimise: "Save & Activate" button + live RF refresh hook |
| `ca1a029` | RF cards: format KPI evidence by lever (1.38% not 1.379119...) |

---

## 7. Original §6: What I'd improve next (if you want me to keep going)

1. **Action card improvements still landing.** The Auto-Optimise UI
   in the Scenario Planning tab now renders KPI evidence + concrete
   "what to do" + expandable evidence per action. The Revenue Funnel
   Top 3 cards still use the older condensed format — they could
   inherit the same rich rendering so the user sees the same depth
   of guidance whichever surface they open.

2. **Cap the picker's CTR-academy dominance.** The candidate
   `ctr/academy £275/mo` is so much larger than anything else that
   no realistic weight change moves it off #1. If we added a
   one-action-per-tier cap to the picker (already enforced
   informally in the by_tier counts) it would force the picker to
   reach for more diverse candidates in moderate-weight scenarios.

3. **Persist scenario activations** so when you switch the active
   scenario, the Revenue Funnel tab's pyramid + Profit Goal band
   update without a page reload (currently you have to reload).

4. **Decay sensitivity slider.** Right now per-lever persistence is
   hard-coded (CTR=6mo, AIO=9mo, rank=12mo). Surfacing these as
   tunable values in the Scenario Planning tab would let you stress
   test "what if competitors react faster than I expect?".

---

*Generated by `scripts/auto-optimise-permutation-tests.mjs` and
`scripts/auto-optimise-extreme-permutations.mjs`. Both scripts can
be re-run any time with `node scripts/...` from the project root.*
