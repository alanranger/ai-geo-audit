# DataForSEO SERP field map (Phase 0)

Source endpoint: `POST /v3/serp/google/organic/live/advanced`  
Parsed in: `lib/keyword-ranking/serp-surface-extract.js` via `api/aigeo/serp-rank-test.js`

Probes planned (Release 1): `photographer coventry` (pack), `alan ranger` (knowledge graph), plus any keyword whose `item_types` includes `featured_snippet` / `people_also_ask`. Field paths below match DataForSEO Live Advanced item schemas used in production collectors; parsers tolerate missing nested fields (return false/null).

## Local pack → `local_pack_position`

| Path | Notes |
|------|--------|
| `result.items[]` where `type === "local_pack"` | Pack container |
| `local_pack.items[]` | Business rows |
| `items[].title` | Match `/alan\s*ranger/i` or brand name |
| `items[].domain` / `items[].url` | Match `alanranger.com` |
| `items[].rank_group` (fallback `rank_absolute`) | Stored as integer position |

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
