# DataForSEO backlinks: spam URL filters (alanranger.com)

This note captures a **data-driven filter set** derived from the SEOSpace export  
`alan-shared-resources/csv/alanranger.com_-backlink-data-seospace.csv` (~6k rows), so the decision is not lost.

## What we are trying to do

Use **`backlinks/live`** **filters** so the API returns **fewer junk rows** (mostly link-farm / negative-SEO style referrers). DataForSEO documents **up to 8** filter conditions per request and does not charge extra for filtering ([backlinks/filters](https://docs.dataforseo.com/v3/backlinks/filters/)).

## What the CSV showed (short)

- **`seo-anomaly`** in the **linking page URL** appeared on **~3,872** rows — the dominant cluster.
- **`bhs-links`** in the URL: **132** rows (second clear family).
- **`dark-side-links`** in the URL: **5** rows (syndicated slug pattern).
- **`quarterlinks`** in the URL: **10** rows.
- A **fifth** pattern **`%dofollow-article-links%`** overlapped **`quarterlinks`** heavily (same URLs in practice), so it was **dropped** as redundant.
- A **blind** “URL contains **`links`**” rule would hit **156** rows but **~70** had **low or blank** spam in that export — **too risky** as a single API `%links%` filter without review.
- **`compositingmentor.com`** had **mixed** spam scores in the export (not all rows sky-high), so **blocking the whole domain** was left **optional** only if you explicitly want **zero** referrers from that host.

## Recommended production filter pack (4 conditions)

Apply on the referring page URL field **`url_from`** with **`not_like`** and `%…%` wildcards (documented for string fields). Chain with **`and`** so a row must fail **all** patterns to be kept (i.e. it is excluded if **any** pattern matches).

1. `["url_from","not_like","%seo-anomaly%"]`
2. `["url_from","not_like","%bhs-links%"]`
3. `["url_from","not_like","%dark-side-links%"]`
4. `["url_from","not_like","%quarterlinks%"]`

Example `filters` value:

```json
[
  ["url_from", "not_like", "%seo-anomaly%"], "and",
  ["url_from", "not_like", "%bhs-links%"], "and",
  ["url_from", "not_like", "%dark-side-links%"], "and",
  ["url_from", "not_like", "%quarterlinks%"]
]
```

Optional later (not in the default four): numeric cap on **`backlink_spam_score`** (field name from [backlinks/live](https://docs.dataforseo.com/v3/backlinks/backlinks/live/) response), or **`domain_from`** exclusions for specific hosts — tune after live DFS samples.

## How to run a quick A/B test locally

From repo root, with DataForSEO Basic auth in `.env` / `.env.local`: **`DATAFORSEO_API_LOGIN`** + **`DATAFORSEO_API_PASSWORD`** (used by `dataforseo-backlink-pages.js`), or **`DATAFORSEO_LOGIN`** + **`DATAFORSEO_PASSWORD`** (used by `dataforseo-client.js`). The compare script accepts either pair.

```bash
npm run test:dfs-backlink-filters
```

Optional: `node scripts/dfs-backlink-filter-compare.mjs --target=alanranger.com --limit=100`

The script sends **two sequential** HTTP POSTs to `backlinks/live` (**one task per request** — DataForSEO returns an error if you batch multiple tasks in a single JSON array). Compare **unfiltered** vs **four filters** using `total_count`, returned item counts, cost, and a short sample of `domain_from` / `url_from`.

## Supabase (Option B — domain index)

**Migration:** run `migrations/20260321_dfs_domain_backlink_index.sql` (or `sql/20260321_dfs_domain_backlink_index.sql`) in the Supabase SQL editor.

| Table | Role |
|--------|------|
| **`dfs_domain_backlink_rows`** | One row per backlink edge (filtered). Keyed by **`row_hash`**. **`url_to_key`** = `normalizeDfsPageUrl(url_to)` for joining audit URLs. |
| **`dfs_backlink_ingest_state`** | Per **`domain_host`**: **`last_full_at`**, **`last_delta_at`**, **`delta_first_seen_floor`** (cursor for `first_seen > …` on delta). |

**API:** `POST /api/aigeo/dataforseo-backlink-domain`

| `action` | Behaviour |
|----------|-----------|
| **`status`** | Returns row count + ingest state for `domain`. |
| **`full`** | Deletes existing rows for `domain`, paginates **`backlinks/live`** with spam filters, inserts rows, sets **`delta_first_seen_floor`** from max **`first_seen`** in the ingest (or `now` if empty). |
| **`delta`** | Requires a prior **full**. Fetches rows with **spam filters** and **`first_seen` > `delta_first_seen_floor`**, upserts by **`row_hash`**, advances the floor. |

**Shared filters in code:** `lib/dfs-spam-filters.js` (`dfsSpamUrlFilters()`).

**Pagination caps (env):** `DFS_DOMAIN_INGEST_MAX_PAGES` (default **40**), `DFS_DOMAIN_INGEST_PAGE_LIMIT` (default **1000**, max 1000). If **`truncated: true`** in the JSON response, raise max pages or run again (not yet resuming mid-token from the UI).

**Dashboard:** **DFS full index** and **DFS new links** call this route; **`POST /api/aigeo/dataforseo-backlink-pages`** **`lookup`** merges **`dfs_domain_backlink_rows`** over **`dfs_page_backlinks_cache`** when any domain rows exist (per-URL **DFS bl** + modal).

**Compare script:** still **DataForSEO-only** — no Supabase.

## References

- [Backlinks / live](https://docs.dataforseo.com/v3/backlinks/backlinks/live/)
- [Backlinks filters](https://docs.dataforseo.com/v3/backlinks/filters/)
- [Available filters (GET)](https://docs.dataforseo.com/v3/backlinks/available_filters)
