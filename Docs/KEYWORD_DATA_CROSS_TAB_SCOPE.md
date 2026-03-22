# Keyword / rank / traffic data — what exists, gaps, expansion (parked)

**Status:** Parked (2026-03-26). No cross-tab refactor planned until there is appetite for coordinated changes and regression testing across Traditional SEO, Ranking & AI, and related views.

This note records **facts from the codebase** so we do not re-litigate “do we already have X in Supabase?” from memory.

---

## 1. What we already persist (high level)

| Store | Grain | Typical use | Rank for one target keyword? | “Est. traffic” |
|--------|--------|-------------|--------------------------------|----------------|
| **`keyword_target_metrics_cache`** | `(page_url, keyword)` | Traditional SEO **③** / KE refresh | **`rank_position`** when Keywords Everywhere returns URL+keyword SERP data | **`estimated_traffic`**, **`url_estimated_traffic`** (KE) |
| **`keyword_rankings`** (+ `audit_results.ranking_ai_data`) | **One row per tracked keyword** (per property + audit date) | Ranking & AI cron (`api/cron/keyword-ranking-ai.js`) | **`best_rank_absolute`**, **`best_rank_group`**, **`best_url`** from **DataForSEO organic SERP** (`api/aigeo/serp-rank-test.js`) | **`search_volume`** (DFS Google Ads search volume path in that flow) — **not** a separate “estimated_traffic” column in the cron payload |
| **`audit_results.money_pages_metrics`** | **Per money page URL** (GSC-derived) | Money pages / overlays | **`avgPosition`** is **page-level GSC average**, not rank for a single chosen keyword | Clicks / impressions / CTR — **not** third-party “est traffic” |

**DFS backlink caches** (`dfs_*`): **`rank`** and similar fields refer to **backlink / index strength**, **not** Google organic position for a keyword.

---

## 2. Do we already have a “better than KE” rank for *every* Traditional SEO URL + target keyword?

**No.**

- **`keyword_rankings`** only covers keywords in the **tracked keyword list** (loaded via `/api/keywords/get` for the ranking job). It does **not** automatically equal “every URL in `06-site-urls` / CSV 07 target map.”
- **`keyword_target_metrics_cache`** only covers **pairs the dashboard sends** on keyword refresh (page URL + target keyword from the Traditional SEO / CSV 07 pipeline). It is **not** “every possible URL × every possible keyword.”

So there is **no** single Supabase table today that is a **complete** “all site URLs × each row’s target keyword” organic rank mirror.

---

## 3. Known KE behaviour (homepage / brand example)

Local smoke tests (see `npm run test:ke`, `npm run test:ke:www`) showed, for this property:

- **`get_page_backlinks`**: **bare apex** (`https://alanranger.com/`) can return **0** rows; **`https://www.alanranger.com/`** returns a non-zero sample — **www matters** for KE page backlinks.
- **`get_url_keywords`**: the list may **not include** the exact CSV target phrase (e.g. “alan ranger photography”), so **`rank_position` / `estimated_traffic`** from that endpoint can stay empty **even when** volume and URL traffic exist.

That is **provider payload shape**, not “audit buttons broken.”

---

## 4. If we unified SERP / volume across tabs (not doing now)

**Goal (hypothetical):** Every Traditional SEO row’s **target keyword** gets a **reliable organic rank** similar in spirit to `keyword_rankings` (DataForSEO SERP), without depending on KE’s URL-keyword list.

**Rough API cost shape:**

- Organic SERP: order of **one DataForSEO organic SERP task per *distinct* target keyword** (dedupe across URLs), not necessarily one per URL.
- Search volume: often **batchable** (existing `serp-rank-test` path already merges DFS volume for batches of keywords).

**Risk:** Touching **three** dashboard areas without a phased plan risks regressions in caching, cron, and UI columns. Hence **parked**.

---

## 5. Related files (for the next person)

- KE refresh / cache: `api/aigeo/keyword-target-metrics.js`, `sql/20260321_keyword_target_metrics_cache.sql`
- Ranking & AI cron: `api/cron/keyword-ranking-ai.js`, `api/aigeo/serp-rank-test.js`, `api/aigeo/ai-mode-serp-batch-test.js`, `api/supabase/save-keyword-batch.js`
- KE smoke: `scripts/test-ke-sample.mjs`, `scripts/test-ke-backlinks-www.mjs`, `package.json` scripts `test:ke`, `test:ke:www`, `test:ke:dump`
- Schema snapshot: `sql/SUPABASE_SCHEMA.sql` (see `keyword_target_metrics_cache`, `gsc_page_timeseries`, `dfs_*`)

---

## 6. Decision

**Defer** cross-tab unification of rank/traffic sources until there is explicit scope, a migration plan, and regression checks. This document is the **parking record**.
