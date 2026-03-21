# Traditional SEO — Backlinks (DataForSEO feed + UI)

**Purpose:** Product spec agreed for replacing/expanding KE-only backlink samples with a **DataForSEO (DFS)** feed, **without** burning credits on every dashboard load.

**Last updated:** 2026-03-21

---

## Agreed metric set (domain + per-URL + quality)

| Area | Metrics |
|------|---------|
| **Domain index** | Total backlinks count; referring domains count; **dofollow / nofollow** split (counts); **spam / toxicity** (or equivalent) at domain level. |
| **Per URL** | Backlinks for that URL; per-link **strength** (or rank/authority field returned by DFS); **dofollow / nofollow** per row; **anchor text**. |
| **Disavow** | User can **toggle** “respect disavow file” vs “show raw index” so the same cached DFS payload can be viewed **with** and **without** disavow filtering (same pattern as KE: server stores a bounded set; client can re-filter for display where applicable). |
| **Sources** | **DFS** = primary for index-style numbers and rich rows when enabled. **KE** remains the **rollback** path (`BACKLINK_INDEX_ROLLBACK=1` → KE-only; see `api/aigeo/dataforseo-backlink-summary.js`). |

---

## UX decisions

### 1. Top of Traditional SEO — **one** “Backlinks summary” tile

Replace the current **separate** KE sample tiles + DFS tiles with a **single** card that can show (when DFS data is loaded):

- Total backlinks (domain)
- Referring domains (domain)
- Dofollow / nofollow counts (domain-level split)
- Spam / toxicity signal(s) at domain level (map from DFS fields, e.g. spam scores already in summary cache)
- **Disavow toggle** (with / without) affecting **displayed** counts where the data supports it (and documented limits if only row-level filtering applies)

When rollback is on or DFS has not been fetched, the tile falls back to **KE sample** copy (existing honest “sample not total” wording) or “Run fetch” state.

### 2. URL row modal — **full backlink list** for that URL (DFS)

For each evaluated URL, the modal should list **all backlinks returned for that URL** from the DFS backlink feed we implement, with columns including:

- **Strength** (DFS field: e.g. rank / domain rank / authority — exact column TBD from API response)
- **Dofollow / nofollow** (per row)
- **Anchor text**
- (Optional but useful) source URL / target URL for verification

**Reality check:** “All” means **the full set we pull from DFS for that URL**, subject to **API pagination**, **serverless time**, **credit cost**, and a **configurable cap** documented in env (same spirit as `KE_PAGE_BACKLINKS_*`). The UI copy should not imply infinite index depth beyond what was fetched.

### 3. **Explicit** “Audit / fetch DFS backlinks” control (no auto-spend on refresh)

- **Do not** call live DFS (or heavy refresh) on **every page load** or generic grid refresh.
- Add or extend a **dedicated button** (e.g. “Fetch DFS backlinks” / “Refresh backlink index”) that:
  - Fetches **domain summary** (and later **per-URL backlink batches** as designed)
  - Writes to **Supabase** cache
  - Updates tiles + row modal from **cache**
- **③ Refresh keyword demand (KE)** should remain focused on **KE** unless product explicitly decides to couple DFS again; prefer **separation** to control cost.

---

## Implementation map (for agents)

| Piece | Today | Target |
|-------|--------|--------|
| Domain summary | `POST /api/aigeo/dataforseo-backlink-summary` + `dfs_backlink_summary_cache` | UI reads `dofollow_backlinks` / `nofollow_backlinks` when present on summary row. |
| Per-URL rows | KE `page_backlinks_json` + BL modal | **`POST /api/aigeo/dataforseo-backlink-pages`** (`lookup` \| `refresh`, `page_urls[]`, `force`) → `dfs_page_backlinks_cache`. Modal prefers DFS rows when loaded. |
| Tiles | Split KE + DFS DOM in `audit-dashboard.html` | **One** summary component; wire to cache + toggle. |
| Disavow | Server filter on KE store; `GET /api/aigeo/disavow-list` | Reuse disavow list for **client** (and optional server) filter on DFS rows; toggle only changes **view**, not necessarily re-calling DFS. |

---

## Env / rollback (unchanged intent)

| Variable | Role |
|----------|------|
| `BACKLINK_INDEX_ROLLBACK` | `1` / `true` / `yes` / `on` → **force KE-only** for backlink index behaviour; no DFS spend. |
| `TRADITIONAL_SEO_BACKLINK_INDEX_SOURCE` | `ke` / `dataforseo` / `both` when rollback is off. |
| `DATAFORSEO_API_LOGIN` / `DATAFORSEO_API_PASSWORD` | Basic auth for DFS (see existing summary route). |
| `DFS_PAGE_BACKLINKS_MAX` | Optional. **Default `100`** — max backlink rows stored per page URL for the DFS page list (fetch + modal). Clamped **1–500**. Implemented in `lib/dfs-backlink-limits.js`; surfaced on `dataforseo-backlink-summary` responses as `data.dfsPageBacklinksMax`. |

---

## Database (Supabase)

| Object | Purpose |
|--------|---------|
| `public.dfs_backlink_summary_cache` | Domain summary from `backlinks/summary/live` (existing). Columns **`dofollow_backlinks`**, **`nofollow_backlinks`** added when API maps them (nullable until populated). |
| `public.dfs_page_backlinks_cache` | Per normalised **`page_url`**: **`backlink_rows`** (JSON array of link objects: anchor, follow type, strength fields), counts, **`cost_last`**, **`fetched_at`**. |

**Repo files:** `migrations/20260322_dfs_page_backlinks_cache.sql`, `sql/20260322_dfs_page_backlinks_cache.sql` (mirror for manual runs).

---

## Related docs

- **KE cache + disavow + Pg bl:** `Docs/TRADITIONAL_SEO_KEYWORD_METRICS.md`
- **Summary table SQL:** `sql/20260321_dfs_backlink_summary_cache.sql`
