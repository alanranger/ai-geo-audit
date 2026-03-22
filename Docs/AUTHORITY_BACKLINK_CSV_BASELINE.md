# Authority backlink baseline (CSV upload era)

**Purpose:** Snapshot of **AI Health Scorecard → Authority → Backlink metrics** while Authority still used **manual backlink CSV upload** (pre-default DFS / Supabase `dfs_domain_backlink_rows`). Use this to compare **where and why** numbers change after switching to the spam-filtered DFS index.

**Recorded from UI (circled “Backlink Metrics” block):**

| Metric | Baseline (CSV) |
|--------|----------------|
| Referring domains | **407** |
| Total backlinks | **4434** |
| Follow ratio | **50%** |
| Backlink score (0–100) | **70** |

**Context:** Same card showed overall **Authority 48 (Amber)** with component scores including **Backlinks 70/100** alongside Behaviour / Ranking / Reviews.

**Why DFS will differ:** CSV exports (e.g. third-party tools) are a **different universe** of links than the **spam-filtered DataForSEO live index** stored after **Traditional SEO → DFS full index**. Expect **referring domains**, **totals**, **follow %**, and **computed backlink score** to move; that is expected, not necessarily a regression.

**Related:** Default metrics API is `GET /api/aigeo/backlink-metrics?domain=…` (DFS aggregate). Rollback / legacy CSV path: `AUTHORITY_BACKLINK_METRICS_SOURCE=csv_legacy` (see `backup/20260323-authority-dfs-rollback/ROLLBACK.txt`).
