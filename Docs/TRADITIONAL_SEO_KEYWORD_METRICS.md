# Traditional SEO — Keyword demand cache (Keywords Everywhere)

**Purpose:** Handover for new chat agents and humans. Describes the **Kw vol / Rank / Moz DA / Metrics age** columns and the **③ Refresh keyword demand (KE)** flow.

**Last updated:** 2026-03-21

---

## TL;DR

| Question | Answer |
|----------|--------|
| Do **① / ②** fill keyword volume? | **No.** They only run Traditional SEO (extractability + rules). |
| What fills **Kw vol** and **Metrics age**? | **③ Refresh keyword demand (KE)** → server calls **Keywords Everywhere** → upserts **Supabase** → UI reads cache. |
| Why are **Rank** and **Moz DA** blank? | Not wired to KE’s keyword batch API. Columns exist for future GSC / DataForSEO / Moz (or manual DB updates). |
| Why did production once miss new columns? | **Uncommitted `audit-dashboard.html`.** Vercel deploys **git `main`**, not local Dropbox only. Always **commit + push**. |

---

## UI (audit-dashboard.html)

- **Run controls card:** **①** Full audit + Traditional SEO, **②** Score Traditional SEO only, **③ Refresh keyword demand (KE)** (blue outline).
- **Same action:** duplicate **③** next to **Rows per page** above the main grid.
- **Attributes:** both ③ buttons use `data-traditional-seo-refresh-kw="1"`; `wireTraditionalSeoButtons()` attaches the same handler.
- **After ② / ①:** client calls **`traditionalSeoKeywordMetricsLookupIfNeededForRun()`** — **POST `lookup` only** (no KE on page load).

**State:** `TRADITIONAL_SEO_STATE.keywordMetricsByUrl` (`Map` keyed by **exact row URL string** from evaluation rows).

---

## API

**Route:** `POST /api/aigeo/keyword-target-metrics`  
**File:** `api/aigeo/keyword-target-metrics.js`

**Body (JSON):**

```json
{ "action": "lookup" | "refresh", "pairs": [{ "url": "https://...", "keyword": "..." }], "force": false }
```

| Action | Behaviour |
|--------|-----------|
| `lookup` | **Supabase read only.** Returns `data.byPageUrl` keyed by **request `url`** (display key). Each value includes `search_volume`, `cpc`, `competition`, `rank_position`, `moz_domain_authority`, `fetched_at`, `stale`. |
| `refresh` | For each `(page_url, keyword)` that is **missing** or **stale** (unless `force: true`), call KE, then **upsert** cache. Batches keywords (≤100 per KE request). |

**Env:**

| Variable | Required | Notes |
|----------|----------|--------|
| `SUPABASE_URL` | Yes | |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role for upsert/select |
| `KEYWORDS_EVERYWHERE_API_KEY` | Yes for `refresh` | Bearer token |
| `KEYWORDS_EVERYWHERE_COUNTRY` | No | Default **`gb`** (Google UK). **`uk` is mapped to `gb`**. |
| `KEYWORDS_EVERYWHERE_CURRENCY` | No | Default **`GBP`** (uppercase; `gbp` in env is normalised up) |
| `KEYWORD_METRICS_STALE_DAYS` | No | Default `30` (1–365) |
| `DISAVOW_FILE_PATH` | No | Optional absolute path to the disavow `.txt`. Default: `public/Disavow links https_www_alanranger_com.txt` (also served to the dashboard for the BL modal). |
| `KE_PAGE_BACKLINKS_NUM` | No | Default **`25`** — max **clean** backlinks stored per page after disavow filtering (see below). |
| `KE_PAGE_BACKLINKS_MAX_STORED` | No | Default **`200`**, max **2000** — hard cap on JSON rows in `page_backlinks_json` (payload / DB size). |
| `KE_PAGE_BACKLINKS_OVERSAMPLE_MULT` | No | Default **`5`** (1–20) — KE `get_page_backlinks` is called with `num ≈ min(FETCH_CAP, max(desired × mult, desired + 40))` so spam rows can be dropped while still filling `desired`. |
| `KE_PAGE_BACKLINKS_FETCH_CAP` | No | Default **`500`**, max **2000** — upper bound on `num` sent to KE for page backlinks. |
| `KE_DOMAIN_BACKLINKS_OVERSAMPLE_MULT` | No | Default **`3`** (1–15) — same idea for `get_unique_domain_backlinks`. |
| `KE_DOMAIN_BACKLINKS_FETCH_CAP` | No | Default **`300`**, max **2000**. |

**Disavow + Pg bl:** KE does not accept a blocklist. The server **oversamples**, filters against the disavow file, then stores up to **`KE_PAGE_BACKLINKS_NUM`** rows. The BL modal loads the list from **`GET /api/aigeo/disavow-list`** (not a raw `.txt` URL — the SPA rewrite would return HTML). It filters cached rows the same way as the server.

**Why not “all” backlinks?** KE credits / rate limits, serverless time, and Supabase **jsonb** size all scale with row count. Defaults keep the dashboard fast; raise **`KE_PAGE_BACKLINKS_NUM`** and **`KE_PAGE_BACKLINKS_MAX_STORED`** if you need a deeper sample (still bounded).

**KE endpoint (server):** `POST https://api.keywordseverywhere.com/v1/get_keyword_data` (form body: `country`, `currency`, `dataSource=gkp`, repeated `kw[]`). See [Keywords Everywhere API](https://keywordseverywhere.com/api-documentation.html).

**Limits:** max **800** pairs per request body; dashboard chunks **400** per POST when many URLs.

---

## Database

**Table:** `public.keyword_target_metrics_cache`  
**SQL files:** `sql/20260321_keyword_target_metrics_cache.sql` (also mirrored in `sql/SUPABASE_SCHEMA.sql`)  
**Unique key:** `(page_url, keyword)` — `page_url` is **normalised** (host lowercase, no `www`, trimmed trailing slash on path).

**Apply migration:** Supabase SQL editor, or MCP **`user-supabase-ai-chat`** → `apply_migration` (project ref **`igzvwbvgvmzvvzoclufx`** — **not** the Academy project).

---

## Troubleshooting

1. **Columns exist but all `—`:** Run **③** after Traditional SEO rows exist with **Target kw**. Check Vercel function logs for `/api/aigeo/keyword-target-metrics`.
2. **500 / missing_env:** `KEYWORDS_EVERYWHERE_API_KEY` or Supabase vars missing on **Vercel**; redeploy after editing env.
3. **`Bad Request` / refresh fails with generic 400:** Often **Supabase `.in('page_url', …)` too large** (many long URLs in one query). The API **chunks page URLs** (default **40** per query) to stay under PostgREST limits. If you still hit limits, lower `PAGE_URL_IN_CHUNK` in `api/aigeo/keyword-target-metrics.js`.
4. **Keywords Everywhere errors:** Toasts now prefix with `KE {status}:` when the external API fails. **Country:** env `uk` is normalised to **`gb`**. **Currency:** sent **uppercase** (e.g. `GBP`) to match KE examples.
5. **Empty after refresh:** KE error message in toast; verify credits/plan on Keywords Everywhere account.
6. **Table missing:** Apply SQL migration; API may return warning in `meta` until table exists.

---

## Related docs

- `HANDOVER.md` — project-wide context (update commit hash when you ship).
- `Docs/KEYWORD_RULES_V1.md` — K1–K5 rules + Part 2 (volume/rank) notes.
- `README.md` — env + API list summary.
