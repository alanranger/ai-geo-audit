# Keyword rules (v1) + SERP metrics (part 2)

Reference doc for **Traditional SEO / on-page keyword checks** and planned **search volume + ranking** columns.  
Pair with target keywords from shared CSV: `alan-shared-resources/csv/07-url-target-keywords-seospace.csv` (and canonical URLs in `06-site-urls.csv`).

---

## Part 1 — Core on-page rules (ship first)

These five checks use the **target keyword** for the URL and the page’s fetched **title, meta description, H1, slug, and intro body**.

| ID | Rule | Intent |
|----|------|--------|
| **K1** | **Keyword in `<title>`** | Whole phrase or close variant (see *Match modes* below). |
| **K2** | **Keyword in meta description** | At least once, or “all words” in any order (same mode family as K1). |
| **K3** | **Keyword in visible H1** | Match or clear variant (same normalisation as K1 where possible). |
| **K4** | **Slug alignment** | Slug contains **≥1 meaningful token** from the keyword (exclude stopwords / tiny words, e.g. *in, for, near, the, a* — list to be finalised in code). |
| **K5** | **Keyword in intro body** | Present in the **first ~100–150 words** of main content (exclude nav/boilerplate if parser allows). |

### Match modes (choose one default for K1–K3)

To implement, pick a **default** and keep the others as optional toggles:

1. **Exact (normalised)** — lowercased, collapsed whitespace, strip trailing punctuation; optional hyphen/underscore equivalence.
2. **All words** — every non-stopword token from the keyword appears somewhere in the field (order-independent).
3. **Phrase + stopwords** — require the “core” tokens only; use a small **stopword list** for EN.

**Recommendation for v1:** **All words** for title/H1; **all words or phrase** for meta (meta often shorter); document the chosen default in the audit UI.

### Normalisation (apply before all string checks)

- Lowercase, trim, collapse internal spaces.  
- Optional: remove `|` and site-name suffix patterns from title comparisons (configurable).  
- Do not fail on British vs US spelling unless an allowlist synonym is added later.

---

## Part 2 — URL results table: volume + rank (shipped in part; rank TBD)

**Shipped (2026-03-13):** Traditional SEO results table columns **Kw vol**, **Rank**, **Moz DA**, **Metrics age** (see `audit-dashboard.html`).

| Column | Meaning | Current source |
|--------|--------|----------------|
| **Kw vol** (`search_volume`) | Monthly search volume for the **target keyword** (KE / GKP-style). | **Keywords Everywhere** via `/api/aigeo/keyword-target-metrics` → `keyword_target_metrics_cache`. |
| **Metrics age** | When the cache row was last refreshed + stale flag (TTL). | Same cache; TTL `KEYWORD_METRICS_STALE_DAYS` (default 30). |
| **Rank** (`rank_position`) | Organic position for keyword × URL. | **Not wired** in UI/API yet (nullable in DB). Future: GSC query×page, DataForSEO, etc. |
| **Moz DA** (`moz_domain_authority`) | Domain authority style metric. | **Not wired** (nullable). KE’s bulk keyword endpoint does not populate this. |

### User flow (important)

- **① / ②** Traditional SEO buttons **do not** call Keywords Everywhere.  
- **③ Refresh keyword demand (KE)** (or duplicate next to **Rows per page**) runs the external API for **missing/stale** URL+keyword pairs only, then upserts Supabase.  
- Normal page load / post-audit: **lookup** reads cache only (no KE spend).

### Documentation

- **`Docs/TRADITIONAL_SEO_KEYWORD_METRICS.md`** — API, env vars, SQL, troubleshooting.  
- **GSC** still provides **clicks/impressions** on the same table rows; it does not replace third-party **volume** for arbitrary keywords.

### Legacy note (money pages JSON)

- Extending `audit_results.money_pages_metrics.rows[]` with volume/rank remains optional; the canonical store for Traditional SEO keyword metrics is **`keyword_target_metrics_cache`**.

---

## Changelog

- **2026-03-13** — K1–K5 unchanged. Part 2: **volume + metrics age** implemented with **Keywords Everywhere** + Supabase cache; **rank/Moz** columns reserved.
- **2026-03-13** (earlier) — v1 rule set (K1–K5) agreed; Part 2 initially scoped to DataForSEO-style API (superseded for volume by KE cache above).
