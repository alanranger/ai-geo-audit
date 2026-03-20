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

## Part 2 — URL results table: volume + rank (next)

**Goal:** In the **per-URL results table** (alongside existing **clicks** and **impressions** from GSC), add:

| Column | Meaning |
|--------|--------|
| **keyword_search_volume** | Monthly search volume for the **target keyword** (locale + engine to be fixed, e.g. Google UK). |
| **keyword_rank** | Organic **position** for that keyword for **this URL** (or best matching ranking URL if different — policy TBD). |
| **keyword_rank_fetched_at** | (Optional) When rank/volume was last refreshed. |

### Data source

**Google Search Console** gives **query × page** performance for queries that actually triggered impressions; it does **not** provide full **search volume** for arbitrary keywords. So:

- **Volume + rank for a chosen keyword** → third-party API such as **DataForSEO** (or similar) is the usual approach.  
- **GSC** can still complement: e.g. show **actual query** performance when the target keyword (or close query) appears in GSC data.

### Implementation note (defer to part 2)

- Extend the structure that already carries money-page rows, e.g. `audit_results.money_pages_metrics.rows[]` in `sql/SUPABASE_SCHEMA.sql` (today: `url`, `title`, `clicks`, `impressions`, `ctr`, `avgPosition`, …) with the new fields above.  
- Add a **cache table** or JSON blob for DataForSEO responses to avoid hammering the API (keyed by `keyword + locale + date`).  
- **Part 2** is intentionally separate: credentials, rate limits, cost controls, and “which SERP feature counts as position 1” need their own spec.

---

## Changelog

- **2026-03-13** — v1 rule set (K1–K5) agreed; Part 2 (volume + rank columns) scoped to DataForSEO-style API + schema extension.
