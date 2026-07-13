# DataForSEO SERP field map (Phase 0)

Source endpoint: `POST /v3/serp/google/organic/live/advanced`  
Parsed in: `lib/keyword-ranking/serp-surface-extract.js` via `api/aigeo/serp-rank-test.js`

Probes planned (Release 1): `photographer coventry` (pack), `alan ranger` (knowledge graph), plus any keyword whose `item_types` includes `featured_snippet` / `people_also_ask`. Field paths below match DataForSEO Live Advanced item schemas used in production collectors; parsers tolerate missing nested fields (return false/null).

## Local pack → `local_pack_position`

| Path | Notes |
|------|--------|
| `result.items[]` where `type === "local_pack"` | **One item per pack business** (siblings, not nested) |
| `items[].title` | Match `/alan\s*ranger/i` (primary — DFS often returns `domain: null`) |
| `items[].domain` / `items[].url` | Match `alanranger.com` when present |
| `items[].rank_group` (fallback `rank_absolute`) | Pack position within the 3-pack (1–3) |

DFS Live Advanced does **not** nest businesses under a parent `local_pack.items[]` container (unlike `hotels_pack`). Each listing is its own top-level `items[]` entry with `type: "local_pack"`.

If pack present but Alan absent → `local_pack_present_any=true`, `local_pack_position=NULL`.

## Knowledge panel → `kp_present` / `kp_ours`

| Path | Notes |
|------|--------|
| `result.items[]` where `type === "knowledge_graph"` (also accept `knowledge_panel`) | KP container |
| `title` / `subtitle` | Brand name match |
| `website` / `url` / `domain` | Domain match |

## Featured snippet → `featured_snippet_ours`

| Path | Notes |
|------|--------|
| `result.items[]` where `type === "featured_snippet"` | |
| `domain` / `url` | Owner domain; also copied into `serp_features.featured_snippet_domain` |

## People Also Ask → `paa_ours`

| Path | Notes |
|------|--------|
| `result.items[]` where `type === "people_also_ask"` | |
| `items[]` questions | |
| `expanded_element` (object or array) | |
| `domain` / `url` / `source.domain` / `source.url` | Any cite of alanranger.com → `paa_ours=true` |

## Presence booleans (unchanged)

Still derived from `result.item_types` includes: `local_pack`, `featured_snippet`, `people_also_ask`, `ai_overview`, `knowledge_graph`.

## Cost

Zero extra DFS calls — parse fields already returned in Live Advanced.

## serp_surface_stack → `keyword_rankings.serp_surface_stack` (Release 0, schema_version 3)

Ordered vertical SERP anatomy built by `lib/keyword-ranking/serp-surface-stack.js` from the same `result.items[]` payload. No extra DFS cost.

| Path | Notes |
|------|--------|
| `result.items[]` sorted by `rank_absolute` ascending | Vertical served order |
| Consecutive `type === "organic"` | Collapse to one `organic` slot; `our_position` = Alan's best `rank_group` in block |
| Consecutive `type === "local_pack"` siblings | Collapse to one `local_pack` slot at first pack item's position |
| `type === "knowledge_graph"` / `knowledge_panel` | **Not** in vertical slots — appended as `{ slot: null, type: "knowledge_panel", ours }` |
| All other DFS types (`video`, `images`, `ai_overview`, etc.) | One slot each, `type` verbatim |

Per-element shape stored in JSONB array:

```json
{ "slot": 1, "type": "local_pack", "ours": true, "our_position": 1, "owners": [...] }
```

### Owner capture (`owners` field, same collection pass)

| Surface | `owners` shape |
|---------|----------------|
| `local_pack` | Top 3: `[{ name, position, ours }]` |
| `featured_snippet` | Owner domain string in array |
| `people_also_ask` | First 6 answer-owner domains |
| `ai_overview` | Cited domains (from `lib/ai-citation-extract.js`) |
| `organic` | Top 3 domains `[{ domain, position, ours }]` |

Domains stored bare (no scheme).

### Write paths (all required)

1. **refresh-core** — `buildKeywordRows()` in `lib/keyword-ranking/refresh-core.js` (cron + ad-hoc refresh via `saveKeywordBatch`)
2. **Dashboard incremental** — `saveRankingAiDataIncremental()` in `audit-dashboard.html` → `api/supabase/save-keyword-batch.js`
3. **Full audit save** — `api/supabase/save-audit.js` keyword row mapper (must include `serp_surface_stack` or full saves drop the column)

Stack originates in `api/aigeo/serp-rank-test.js` (`buildSerpSurfaceStack(items)` per keyword).

### Top-of-Page scoring

`lib/audit/topOfPage.js` — schema_version 3. Slot decay by served order; within-surface ownership multipliers. Output nested in `ranking_ai_pillar_scores.topOfPage` at audit save. `surfaceVisibility` (v2) unchanged.
