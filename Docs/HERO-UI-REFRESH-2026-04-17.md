# Ranking & AI hero UI refresh — 2026-04-17

Three related fixes, all triggered by the user's question
"do these numbers make sense to you?" and the follow-up
"these colour combinations are quite hard to read and don't really fit
in with the colour scheme of the rest of the page."

## 1. Colour palette realignment

The AI Visibility Score hero, its funnel, the contribution bar,
twin sub-scores, sparkline and the opportunity panel all used a
mixed palette of emerald / mint / royal blue / **violet** / gold /
**magenta-pink**. Three of those shades (violet `#8b5cf6`,
magenta `#ec4899`, mint `#34d399`) clashed with the dashboard's
native brand tokens (orange `#E57200`, amber `#f59e0b`, navy, cyan,
brand-success green `#10b981`, brand-danger `#ef4444`).

Changes in `audit-dashboard.html`:

| Element | Before | After |
| --- | --- | --- |
| Hero score RAG — green | `#34d399` | `#10b981` (brand success) |
| Hero score RAG — amber | `#fbbf24` | `#f59e0b` (brand warning / `--dark-brand`) |
| Hero score RAG — red | `#f87171` | `#ef4444` (brand danger) |
| Hero delta up/down | mint / coral | brand success / danger |
| Twin sub-scores RAG | mint / gold / coral | brand success / warning / danger |
| Funnel bar (non-terminal) | `#3b82f6 → #8b5cf6` (blue → violet) | `#3b82f6 → #06b6d4` (blue → cyan) |
| Funnel bar (terminal = "the win") | `#10b981 → #34d399` (two greens) | `#E57200 → #f59e0b` (brand orange gradient) |
| Funnel delta up/down | mint / coral | brand success / danger |
| Contribution slice — `moneyCitations` (top weight) | `#10b981` | `#E57200` (brand orange — draws the eye) |
| Contribution slice — `aiCitation` | `#34d399` | `#f59e0b` (brand amber) |
| Contribution slice — `serpAiGap` | `#8b5cf6` (violet) | `#06b6d4` (cyan) |
| Contribution slice — `shareOfVoice` | `#f59e0b` | `#10b981` (brand success) |
| Contribution slice — `crossEngine` | `#ec4899` (magenta) | `#64748b` (slate) |
| Contribution slice — `serpFeature` | `#64748b` | `#94a3b8` (lighter slate) |
| Sparkline "now" dot | `#fbbf24` (gold) | `#E57200` (brand orange) |
| Opportunity panel border / title / links | gold `#fbbf24` | amber `#f59e0b` |
| Opportunity "tier gap" colour | `#60a5fa` | `#06b6d4` (cyan) |
| Exploratory pillar dashed border | violet `#a855f7` | cyan `#06b6d4` |
| Exploratory badge text / bg | `#7c3aed` / `#faf5ff` | `#0891b2` / `#ecfeff` |

Net effect: the hero strip now reads as part of the same family as
the rest of the dashboard (orange/amber for brand-critical numbers,
cyan/blue for cool/neutral, slate for muted, green/red for RAG).

## 2. Filter-active banner above the pillar grid

The Keyword Ranking & AI tab's pillar tiles apply whatever filter
the user has currently selected (rank bucket, segment, volume,
priority-matrix cell, etc.). With a filter active the tile
denominators silently flex — e.g. "2/3 (67%)" instead of
"2/84 (2%)" for AI citations. The user read this as a data bug
("do these numbers make sense?") rather than as a filtered view.

Fix: added a non-dismissable amber banner at the top of the pillar
grid that appears whenever `filteredCount !== totalKeywords`. The
banner states the scope explicitly (`2 of 84 keywords`), lists the
filters that are active (e.g. `segment: money, rank: 11-20`),
reminds the user that Cross-engine and Share-of-voice tiles still
use the full tracked set, and offers a one-click **Clear filters**
button that delegates to the existing sidebar clear so preset
state, keyword-input debounce, priority-matrix filter, pagination
and sort order all reset in lockstep.

Implementation:
- New DOM element `#ranking-filter-banner` (see HTML near the top of
  the `.ranking-metric-pills` block).
- New `.ranking-filter-banner*` CSS classes using brand-orange
  (`#E57200`) and cream (`#fff7ed`) so it ties into the rest of the
  page.
- New helpers `summariseActiveRankingFilters()` and
  `updateRankingFilterBanner()`, called from `updateMetricPills()`
  at the start of every re-render.
- Click handler is attached once at load and delegates to the
  sidebar's `#ranking-filter-clear` button; falls back to a manual
  state reset if the sidebar is not in the DOM.

## 3. Clarifying footnotes for low AI Overview counts

User's other concern: only 3 of 84 keywords showed AI Overview
data in the last audit. Root-cause investigation:

- `api/aigeo/serp-rank-test.js` sets `load_async_ai_overview: true`
  and `expand_ai_overview: true` on every DFS call.
- `ai_overview_present_any` is derived from DFS's
  `result.item_types.includes('ai_overview')` — so any AIO that
  Google actually rendered is captured.
- `ai_engines.google_aio.present` is set by
  `extractCitationsFromDfsResult`, which looks for an `ai_overview`
  item inside `result.items[]` and returns `present: false` when
  none is found.

So 3/84 is the genuine signal. Google AIO triggers are sparse and
biased toward informational/how-to queries; very transactional
queries ("book a landscape workshop Wales", product URLs, etc.)
frequently suppress AIO entirely. This is *not* a pipeline bug.

Rather than change any collection logic, we added two footnotes so
users stop reading low AIO numbers as a system failure:

- **SERP feature coverage tile**: the footnote now explains that
  "AI Overview triggers are controlled by Google and typically fire
  on informational/how-to queries, not pure commercial/transactional
  ones — a low AIO count here usually reflects query mix, not a
  data gap."
- **Cross-engine citation breadth tile**: the footnote now notes
  that cross-engine overlap is capped by AIO trigger rate — if
  Google only fires AIO for a small share of your tracked keywords,
  overlap will stay small no matter how well the pages are
  optimised. It also points users to the "AI Overview present"
  line in the SERP feature tile for the underlying pool size.

## Files touched

- `audit-dashboard.html` (palette tokens, filter banner HTML + CSS +
  JS, tile footnotes)
- `Docs/HERO-UI-REFRESH-2026-04-17.md` (this file)
