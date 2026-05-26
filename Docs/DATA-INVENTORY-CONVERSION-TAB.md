# Data Inventory — Conversion & Revenue-Truth Tab (Discovery Only)

> **⚠️ The revenue section of this inventory is SUPERSEDED on 2026-05-26 — see `Docs/REVENUE-TRUTH-FROM-BOOKING-SHEET.md`.** The revenue figures quoted from `revenue_snapshots` here (notably the 2025-01 = £117k and 2025-04 = £177k Squarespace API figures) were confirmed by the user as NOT real — they were the symptom that triggered the `Docs/REVENUE-DATA-AUDIT.md` forensic audit, which in turn led to Phase L (Booking Sheet as single source of truth) and Phase L1 (three tier systems, not one). The headline revenue figure to quote is now `revenue_amount` from `public.booking_sheet_monthly_wide` (= the full 12-category sum = the Booking Sheet `Sales YYYY` row-18 / YTD Actual figure: **2025 = £46,567.46, 2026 YTD = £19,598.04, 17-month total = £66,165.50**). `operational_revenue` (D2C + B2B) is a secondary breakdown line beneath the headline, not the headline itself. The non-revenue parts of this inventory (GSC traffic, keyword data, Academy engagement, page catalogue) remain valid.

**Status:** Discovery report. No design, schema or code is proposed.
**Date:** 2026-05-26.
**Author:** Cursor coding agent, on behalf of Alan Ranger.
**Purpose:** Scope what data already exists so a new dashboard tab — separate from the existing Revenue Funnel tab — can (a) track actual monthly revenue/GP against survival / comfort / thriving tiers, and (b) diagnose pages with traffic but low bookings.

## Ground rules followed

- Every factual claim below is backed by a pasted SQL query (with the project ID stated) or a pasted snippet of API/configuration code. Where verification was not possible, the item is labelled **UNVERIFIED** with the reason.
- Numbers are exact at the moment the queries were run on 2026-05-26 (Europe/London).
- Two Supabase projects are involved:
  - **`igzvwbvgvmzvvzoclufx`** — the AI GEO Audit / "ai-chat" project (MCP server `user-supabase-ai-chat`). This is the production dashboard backend.
  - **`dqrtcsvqsfgbqmnonkpt`** — the Academy project (MCP server `user-supabase-academy`). Holds trial/membership/engagement data.
- British English is used throughout.

---

## SECTION 1 — Supabase tables (full inventory)

Categorisation key used in tables below:

- **traffic** = Google Search Console / Google Analytics 4 caches.
- **keyword** = keyword rank, search volume, SERP feature data.
- **financial** = actual booking / order / revenue / cost data.
- **academy** = Academy trial / membership / engagement.
- **catalogue** = product, page, content metadata.
- **chat** = AI chat sessions and analytics.
- **infra/audit** = pipeline state, regression tests, debug logs, health snapshots.
- **other** = unclassified small / utility tables.

### 1A. AI GEO Audit project — `igzvwbvgvmzvvzoclufx` (public schema)

Source: `list_tables({schemas:['public']})` against `user-supabase-ai-chat`, supplemented by `SELECT COUNT(*) ...` per table (the row counts in `list_tables` use `pg_class.reltuples` and are stale for several tables — the `Rows` column below is the live `COUNT(*)`).

#### 1A.1 Populated tables (live row count > 0)

| Table | Rows (live) | Date column used | Date min | Date max | Category | What it holds (plain English) |
|---|---:|---|---|---|---|---|
| `revenue_snapshots` | 77 | `period_start` / `period_end` | 2025-01-01 | 2026-05-31 | financial | **The financial truth table.** One row per (property, period, source). Stores actual revenue in GBP, transaction count, per-tier revenue and per-tier transaction count in `jsonb`. Sources observed: `booking_sheet`, `squarespace_api`, `stripe_supplemental`. |
| `revenue_funnel_targets` | 28 | n/a | n/a | n/a | financial | Monthly revenue + GP **targets** per (property, scenario, tier_id). `tier_id NULL` rows are property-wide. Drives the GP-gap denominator in smart-priorities. Active scenario currently has every numeric target set to 0 (see Section 4). |
| `revenue_funnel_scenarios` | 7 | `created_at` | 2026-05-20 | 2026-05-20 | financial | Named scenarios with `monthly_survival_baseline_gbp` and `hours_per_week`. Only one is `is_active=true` at a time. There is **no comfort or thriving baseline field** — only a single survival baseline per scenario. |
| `revenue_funnel_tier_costs` | 1 | n/a | n/a | n/a | financial | Per-(property,tier) monthly fixed operating cost + minimum monthly unit count. Only one row exists, for `academy`. |
| `revenue_funnel_tier_weights` | 42 | n/a | n/a | n/a | financial | Strategic 0..5 multiplier per (property, scenario, tier). Sort/mix weight for priorities, not money. |
| `revenue_funnel_lever_weights` | 42 | n/a | n/a | n/a | financial | Strategic 0..5 multiplier per (property, scenario, lever_id) plus optional effort cap. |
| `revenue_funnel_priorities` | 21 | `created_at` | n/a | n/a | financial | Saved "do this next" recommendations: title, pages_affected[], primary_kpi, baseline/target, estimated_lift, status. |
| `product_display_price` | 140 | `updated_at` | n/a | n/a | catalogue | Per-product canonical display price in GBP (`product_url`, `product_title`, `display_price_gbp`, `preferred_source`). |
| `product_tier_override` | 5 | n/a | n/a | n/a | catalogue | Manual product-URL → commercial-tier overrides for the tier classifier. |
| `csv_metadata` | 1254 | n/a | n/a | n/a | catalogue | Metadata for every CSV-imported page (blog, course_events, course_products, landing_service_pages, product_schema, site_urls, workshop_events, workshop_products). 596 distinct URLs. |
| `gsc_page_metrics_28d` | 58322 | `date_start` / `date_end` | 2024-12-04 | 2026-05-24 | traffic | Rolling 28-day GSC metrics per (run, site, page): clicks_28d, impressions_28d, ctr_28d, position_28d. 2160 distinct URLs, 109 distinct run_ids. Heart of the page-level traffic data. |
| `gsc_page_timeseries` | 30238 | `date` | 2025-12-27 | 2026-05-17 | traffic | Daily per-page GSC metrics (clicks, impressions, ctr, position). 418 distinct URLs. Shorter window than `gsc_page_metrics_28d` because backfill only covers ~5 months. |
| `gsc_timeseries` | 585 | `date` | 2024-10-17 | 2026-05-24 | traffic | Daily **site-wide** GSC totals (clicks, impressions, ctr, position). 19 months of history. |
| `gsc_url_inspection_cache` | 552 | `inspected_at` | n/a | n/a | traffic | Per-URL GSC URL Inspection result (coverage_state, verdict, page_fetch_state, google_canonical, indexed, http_ok). |
| `ga4_site_metrics_28d` | 4 | `date_start` / `date_end` | 2026-04-22 | 2026-05-24 | traffic | Rolling 28-day **site-wide** GA4 (sessions, page_views, enquiry events, money-page enquiry events) plus `event_counts jsonb` of every GA4 event type with its 28d count. **Site-level only — no per-page rows exist.** |
| `dashboard_subsegment_windows` | 1440 | `date_start` / `date_end` | 2025-11-03 | 2026-05-24 | traffic | Per-(run, segment, scope) windowed clicks/impressions/ctr/avg_position; supports subsegment charts on the dashboard. |
| `keyword_rankings` | 7194 | `audit_date` | 2025-12-11 | 2026-05-26 | keyword | One row per (audit_date, property_url, keyword). Stores best_rank_group, best_rank_absolute, best_url, search_volume, has_ai_overview, ai_total_citations, demand_share, segment, page_type, opportunity_score and SERP-feature booleans. **84 keywords/day**, ~5 months of daily snapshots. |
| `traditional_seo_target_keyword_overrides` | 47 | `created_at` | n/a | n/a | keyword | In-app "assigned keyword" per page (target_keyword for a page_url). Layered over GitHub CSV 07 baseline. |
| `audit_results` | 656 | `audit_date` | 2024-07-25 | 2026-05-26 | infra/audit | Historical full-audit snapshots. Many `jsonb` columns (schema, authority, brand, money pages, etc.). The Audit Dashboard's main row. |
| `portfolio_snapshots_v2` | 2290 | `created_at` | 2025-12-21 | 2026-05-26 | infra/audit | Long-form KPI snapshots per (run, segment, scope, kpi). Used for Portfolio dashboards. |
| `portfolio_segment_metrics_28d` | 1954 | n/a | n/a | n/a | traffic | 28-day segment-level aggregates (categorised pages). |
| `portfolio_audit_runs` | 225 | `created_at` | n/a | n/a | infra/audit | One row per portfolio audit run. |
| `domain_strength_snapshots` | 2778 | `created_at` | 2025-12-14 | 2026-05-25 | keyword | Historical domain-strength sub-scores per scan. |
| `domain_rank_pending` | 220 | n/a | n/a | n/a | keyword | Queue of domains awaiting rank lookup. |
| `domain_strength_domains` | 55 | n/a | n/a | n/a | keyword | Reference domains used for benchmarking. |
| `dfs_domain_backlink_rows` | 1650 | n/a | n/a | n/a | keyword | DataForSEO backlink rows (domain index). |
| `dfs_backlink_baseline_edges` | 1625 | n/a | n/a | n/a | keyword | DataForSEO backlink baseline edges. |
| `page_chunks` | 2138 | n/a | n/a | n/a | catalogue | Chunked page content (used by AI chat retrieval). |
| `page_entities` | 783 | n/a | n/a | n/a | catalogue | Extracted entities per page. |
| `page_html` | 1643 | n/a | n/a | n/a | catalogue | Stored page HTML used by audit. |
| `chat_sessions` | 48404 | `created_at` | 2026-03-05 | 2026-05-26 | chat | One row per AI chat session. ~3 months of traffic. |
| `chat_interactions` | 48240 | `created_at` | 2026-03-05 | 2026-05-26 | chat | One row per user↔assistant interaction inside a session. |
| `chat_analytics_daily` | 82 | n/a | n/a | n/a | chat | Daily chat analytics rollups. |
| `regression_test_runs` | 3962 | n/a | n/a | n/a | infra/audit | Regression test execution log. |
| `regression_test_results` | 10 | n/a | n/a | n/a | infra/audit | Regression test result rows (sparse). |
| `db_health_snapshots` | 189 | n/a | n/a | n/a | infra/audit | DB-health monitor snapshots. |
| `db_health_alerts` | 147 | n/a | n/a | n/a | infra/audit | DB-health alerts. |
| `content_improvement_tracking` | 25 | `created_at` | 2025-10-08 | 2026-05-12 | catalogue | Tracking of content improvements (operator workflow). |
| `optimisation_task_events` | 6116 | n/a | n/a | n/a | infra/audit | Event log for optimisation tasks (status transitions, etc.). NB the `list_tables` snapshot reported 347 rows; the live `COUNT(*)` returned 6116. |
| `optimisation_task_cycles` | 66 | n/a | n/a | n/a | infra/audit | Cycle headers for optimisation tasks. |
| `optimisation_tasks` | 1 | n/a | n/a | n/a | infra/audit | The optimisation-tasks pointer row. |
| `job_progress` | 18 | n/a | n/a | n/a | infra/audit | Long-running job progress tracker. |
| `impl_audit_snapshots` | 7 | n/a | n/a | n/a | infra/audit | Implementation-audit snapshots. |
| `audit_debug_logs` | 4 | n/a | n/a | n/a | infra/audit | Debug logs from audit runs. |
| `debug_logs` | 1 | n/a | n/a | n/a | infra/audit | UI debug log entries. |
| `optimisation_tasks_delete_audit` | 1 | n/a | n/a | n/a | infra/audit | Soft-delete audit trail. |
| `optimisation_task_cycles_delete_audit` | 1 | n/a | n/a | n/a | infra/audit | Soft-delete audit trail. |
| `optimisation_task_events_delete_audit` | 2 | n/a | n/a | n/a | infra/audit | Soft-delete audit trail. |
| `event_product_links_auto` | 132 | n/a | n/a | n/a | catalogue | Auto-detected event↔product links. |

**Pasted evidence for the date / row counts above** (a single UNION query covering every table for which Section 3 / 4 / 5 rely on the row count):

```sql
-- against project igzvwbvgvmzvvzoclufx
SELECT 'revenue_snapshots', MIN(period_start)::text, MAX(period_end)::text, COUNT(*), COUNT(DISTINCT property_url), COUNT(DISTINCT source) FROM revenue_snapshots
UNION ALL ...
```

Output:

```json
[
 {"t":"revenue_snapshots","d_min":"2025-01-01","d_max":"2026-05-31","rows":77,"props":1,"sources":3},
 {"t":"revenue_funnel_targets","rows":28,"props":1,"scenarios":4},
 {"t":"revenue_funnel_scenarios","rows":7,"props":1,"distinct_names":7},
 {"t":"revenue_funnel_tier_costs","rows":1,"props":1,"tiers":1},
 {"t":"ga4_site_metrics_28d","d_min":"2026-04-22","d_max":"2026-05-24","rows":4,"props":1},
 {"t":"gsc_page_metrics_28d","d_min":"2024-12-04","d_max":"2026-05-24","rows":58322,"pages":2160,"runs":109},
 {"t":"gsc_page_timeseries","d_min":"2025-12-27","d_max":"2026-05-17","rows":30238,"pages":418},
 {"t":"gsc_timeseries","d_min":"2024-10-17","d_max":"2026-05-24","rows":585,"props":1},
 {"t":"keyword_rankings","d_min":"2025-12-11","d_max":"2026-05-26","rows":7194,"props":3,"keywords":95},
 {"t":"product_display_price","rows":140,"products":140},
 {"t":"csv_metadata","rows":1254,"urls":596,"csv_types":8},
 {"t":"traditional_seo_target_keyword_overrides","rows":47,"pages":47},
 {"t":"gsc_url_inspection_cache","rows":552,"pages":552},
 {"t":"dashboard_subsegment_windows","d_min":"2025-11-03","d_max":"2026-05-24","rows":1440,"sites":1,"scopes":1},
 {"t":"audit_results","d_min":"2024-07-25","d_max":"2026-05-26","rows":656,"props":3}
]
```

#### 1A.2 Empty tables (0 live rows)

These tables exist in the schema but are not populated as of 2026-05-26. Listed by category for completeness, no separate detail per table:

- **catalogue / events (legacy or future):** `series`, `event`, `series_product_map`, `course_family_product_map`, `course_family_series_map`, `event_product_map`, `product`, `event_product`, `category_synonym`, `location_synonym`, `series_product_url`, `url_http_status`, `event_product_links`, `event_product_links_courses`, `course_events_override`, `page_text`, `content_events`, `event_product_overrides`, `product_price_overrides`, `event_blacklist`, `event_product_mapping_rules`.
- **infra:** `_audit_baseline_counts`, `light_refresh_runs`, `url_last_processed`, `job_run_details`, `database_maintenance_run`, `database_maintenance_run_table`, `schema_audit_logs`, `system_maintenance_state`, `chat_events`, `chat_feedback`, `shared_audits`, `module_results_ms` (in ai-chat project; the academy copy is populated), `exam_member_links` (ai-chat copy).
- **audit/keyword caches:** `domain_rank_history`, `traditional_seo_rules`, `traditional_seo_score_snapshots`, `traditional_seo_rule_overrides`, `keyword_target_metrics_cache`, `ke_domain_metrics_cache`, `dfs_backlink_summary_cache`, `dfs_page_backlinks_cache`, `dfs_backlink_ingest_state`, `traditional_seo_evaluation_cache`, `dfs_backlink_tile_baseline`.
- **mentions / portfolio:** `mentions_baseline_runs`, `mentions_baseline_entries`, `citation_consistency_runs`, `citation_consistency_entries`, `portfolio_snapshots` (v1 superseded by v2).
- **audit_cron:** `audit_cron_schedule`.

These are listed because the brief asked for "every table". None of them are referenced in Sections 3-7.

#### 1A.3 Detailed column listings + sample rows for the seven tables Sections 3-7 depend on

The following columns and samples were obtained directly from `information_schema.columns` and `SELECT * FROM <table> LIMIT N`.

##### (a) `revenue_snapshots` — primary financial truth (used in Sections 3, 4, 6)

| Column | Type | Plain-English description |
|---|---|---|
| `id` | uuid | Surrogate key. |
| `property_url` | text | Site identifier. **Only value present today is `https://www.alanranger.com`** (1 distinct value). |
| `period_start` | date | Start of period (inclusive). May be the 1st of a month (calendar mode) or 28-day-rolling start (rolling mode) depending on `source` and how the sync was run. |
| `period_end` | date | End of period (inclusive). |
| `revenue_amount` | numeric | Total revenue in GBP for the period from this single source. |
| `currency` | text | Always `GBP` in current data. |
| `source` | text | One of `booking_sheet`, `squarespace_api`, `stripe_supplemental` (see Section 2). |
| `transactions` | integer | Count of underlying transactions (orders / charges / sheet rows) in this period from this source. |
| `tier_revenue` | jsonb | `{academy, courses, hire, services, workshops_nonres, workshops_residential, unidentified}` revenue split in GBP. |
| `tier_transactions` | jsonb | Same keys, counts. |
| `notes` | text | Free text human-readable summary written by the sync. |
| `created_at` | timestamptz | When the row was upserted. |

Pasted samples (top 2 rows, most recent first):

```json
[
 {"property_url":"https://www.alanranger.com","period_start":"2026-05-10","period_end":"2026-05-17",
  "revenue_amount":"200","currency":"GBP","source":"squarespace_api","transactions":2,
  "tier_revenue":null,"tier_transactions":null,
  "notes":"Synced from Squarespace Orders API"},
 {"property_url":"https://www.alanranger.com","period_start":"2026-05-01","period_end":"2026-05-31",
  "revenue_amount":"240","currency":"GBP","source":"booking_sheet","transactions":2,
  "tier_revenue":{"hire":0,"academy":0,"courses":240,"services":0,"unidentified":0,
                  "workshops_nonres":0,"workshops_residential":0},
  "tier_transactions":{"hire":0,"academy":0,"courses":2,"services":0,"unidentified":0,
                       "workshops_nonres":0,"workshops_residential":0},
  "notes":"Imported from Booking Sheet (Bank + PayPal + Cash + Voucher/PicknMix re-attribution; Stripe excluded)"}
]
```

Note in row 1 `tier_revenue IS NULL`: the early Squarespace API rows do not yet have tier split (the tier classifier was added later). See Section 7.

##### (b) `revenue_funnel_targets` — used in Section 4

| Column | Type | Description |
|---|---|---|
| `id` | uuid | PK. |
| `property_url` | text | Site. |
| `scenario_id` | uuid | FK → `revenue_funnel_scenarios.id`. |
| `tier_id` | text \| NULL | Tier code (`academy`, `courses`, `hire`, `services`, `workshops_nonres`, `workshops_residential`) or NULL for the property-wide target. |
| `monthly_revenue_target_gbp` | numeric | Target revenue per month, GBP. |
| `monthly_gp_target_gbp` | numeric | Target GP per month, GBP. |
| `notes`, `created_at`, `updated_at` | text/ts | Metadata. |

Active scenario targets (live query output):

```json
[
 {"scenario":"Auto: Balanced path 2026-05-20","tier_id":null,"rev_target":"0","gp_target":"0"},
 {"scenario":"Auto: Balanced path 2026-05-20","tier_id":"academy","rev_target":"0","gp_target":"0"},
 {"scenario":"Auto: Balanced path 2026-05-20","tier_id":"courses","rev_target":"0","gp_target":"0"},
 {"scenario":"Auto: Balanced path 2026-05-20","tier_id":"hire","rev_target":"0","gp_target":"0"},
 {"scenario":"Auto: Balanced path 2026-05-20","tier_id":"services","rev_target":"0","gp_target":"0"},
 {"scenario":"Auto: Balanced path 2026-05-20","tier_id":"workshops_nonres","rev_target":"0","gp_target":"0"},
 {"scenario":"Auto: Balanced path 2026-05-20","tier_id":"workshops_residential","rev_target":"0","gp_target":"0"}
]
```

Every per-tier target in the **active** scenario is currently **0**. The structure supports per-tier monthly £ targets, but no values are set.

##### (c) `revenue_funnel_scenarios`

| Column | Type | Description |
|---|---|---|
| `id` | uuid | PK. |
| `property_url` | text | Site. |
| `name` | text | Free-text scenario label. |
| `notes`, `is_active` | text/bool | Metadata; exactly one is `is_active=true` at a time per property. |
| `monthly_survival_baseline_gbp` | numeric | **Single "survival" £ floor per scenario. No comfort or thriving fields exist on this table.** |
| `hours_per_week` | numeric | Operator capacity assumption. |
| `created_at`, `updated_at` | ts | Metadata. |

All seven scenarios live now:

```json
[
 {"name":"Auto: Balanced path 2026-05-20","is_active":true, "survival":"3000","hours_per_week":"16","created":"2026-05-20"},
 {"name":"Auto: Hard path (full-commit compound)","is_active":false,"survival":"2500","hours_per_week":"0","created":"2026-05-20"},
 {"name":"Auto: Balanced path (most £ this month)","is_active":false,"survival":"2500","hours_per_week":"0","created":"2026-05-20"},
 {"name":"Auto: Easy path (quick wins)","is_active":false,"survival":"2500","hours_per_week":"0","created":"2026-05-20"},
 {"name":"May 20 2026","is_active":false,"survival":"3000","hours_per_week":"12","created":"2026-05-20"},
 {"name":"May 2026","is_active":false,"survival":"3000","hours_per_week":"12","created":"2026-05-20"},
 {"name":"Baseline","is_active":false,"survival":"2500","hours_per_week":"6","created":"2026-05-20"}
]
```

##### (d) `revenue_funnel_tier_costs`

Only one row exists.

```json
[{"tier_id":"academy","monthly_fixed_cost_gbp":"100","min_monthly_units":"10",
  "unit_label":"paid signups",
  "notes":"Memberstack + Supabase + Squarespace email + AI content amortised. Min 10 paid signups/mo at £79/yr."}]
```

The other tiers (`courses`, `workshops_*`, `services`, `hire`) have no fixed-cost rows. GP for those tiers can only be assumed (a per-tier GP% multiplier), not derived from cost data here.

##### (e) `ga4_site_metrics_28d` — site-wide events (used in Section 5)

Columns: `id, property_url, ga4_property_id, date_start, date_end, sessions_28d, page_views_28d, enquiry_events_28d, event_counts (jsonb), captured_at, money_page_enquiry_events_28d`.

Most recent row (2026-04-27 → 2026-05-24, site-wide):

```json
{
 "sessions_28d":"62693","page_views_28d":"68246",
 "enquiry_events_28d":"905","money_page_enquiry_events_28d":"287",
 "event_counts":{
   "click":213,"login":4,"scroll":9847,"sign_up":9,"purchase":7,
   "cta_click":104,"page_view":68246,"view_item":304,"chat_start":53,
   "form_start":362,"add_to_cart":6,"first_visit":57161,"form_submit":38,
   "place_order":2,"acuity_click":12,"file_download":250,
   "session_start":62472,"user_engagement":16151,"checklist_download":233,
   "contact_us_form_submit":17
 }
}
```

This is **site-wide only**. There is no per-page GA4 table in either Supabase project. See Section 5.

##### (f) `gsc_page_metrics_28d` — page-level GSC

Columns: `id, run_id, site_url, page_url, date_start, date_end, clicks_28d, impressions_28d, ctr_28d, position_28d, captured_at`.

Sample for `/beginners-photography-classes` (latest five 28-day windows):

```json
[
 {"date_start":"2026-04-27","date_end":"2026-05-24","clicks_28d":"5","impressions_28d":"1104","ctr_28d":"0.00453","position_28d":"40.67"},
 {"date_start":"2026-04-26","date_end":"2026-05-23","clicks_28d":"5","impressions_28d":"1141","ctr_28d":"0.00438","position_28d":"39.91"},
 {"date_start":"2026-04-24","date_end":"2026-05-21","clicks_28d":"5","impressions_28d":"1163","ctr_28d":"0.00430","position_28d":"39.12"},
 {"date_start":"2026-04-21","date_end":"2026-05-18","clicks_28d":"4","impressions_28d":"1778","ctr_28d":"0.00225","position_28d":"34.93"},
 {"date_start":"2026-04-20","date_end":"2026-05-17","clicks_28d":"3","impressions_28d":"1744","ctr_28d":"0.00172","position_28d":"34.92"}
]
```

##### (g) `keyword_rankings` — keyword detail per audit_date

Columns: `id, audit_date, property_url, keyword, best_rank_group, best_rank_absolute, best_url, best_title, search_volume, has_ai_overview, ai_total_citations, ai_alan_citations_count, ai_alan_citations (jsonb), competitor_counts (jsonb), serp_features (jsonb), segment, page_type, demand_share, opportunity_score, ai_engines (jsonb), segment_source, segment_confidence, segment_reason, ai_overview_present_any, local_pack_present_any, paa_present_any, featured_snippet_present_any, last_refreshed_at, created_at, updated_at`.

Top recent rows for `/beginners-photography-classes`:

```json
[
 {"audit_date":"2026-05-26","keyword":"beginners photography classes","best_rank_group":13,"search_volume":720,
  "best_url":"https://www.alanranger.com/beginners-photography-classes?srsltid=..."},
 {"audit_date":"2026-05-26","keyword":"beginners photography class","best_rank_group":13,"search_volume":720,
  "best_url":"https://www.alanranger.com/beginners-photography-classes?srsltid=..."},
 {"audit_date":"2026-05-26","keyword":"beginners photography courses","best_rank_group":14,"search_volume":720,
  "best_url":"https://www.alanranger.com/beginners-photography-classes?srsltid=..."}
]
```

84 keywords/day, daily cadence since 2025-12-11.

---

### 1B. Academy project — `dqrtcsvqsfgbqmnonkpt` (public schema)

Source: `list_tables({schemas:['public']})` against `user-supabase-academy`.

| Table | Rows (live) | Date column | Date min (UTC) | Date max (UTC) | Category | What it holds |
|---|---:|---|---|---|---|---|
| `academy_events` | 5042 | `created_at` | 2026-01-04 21:08 | 2026-05-26 13:33 | academy | Engagement events. Distinct `event_type` values: `login` (3566), `module_open` (1309), `logout` (79), `member_login` (48), `dashboard_access` (35), `question_asked` (3), `question_ai_generated` (1), `question_published` (1). |
| `academy_plan_events` | 488 | `created_at` | 2026-01-05 21:25 | 2026-05-21 19:42 | academy | Stripe webhook log feeding plan-state. Distinct `event_type`: `invoice.paid` (222), `checkout.session.completed` (222), `customer.subscription.created` (17), `customer.subscription.updated` (13), `invoice.payment_failed` (12), `customer.subscription.deleted` (2). |
| `academy_trial_history` | 208 | `trial_start_at` | 2026-01-05 21:25 | 2026-05-21 17:45 | academy | **Trial lifecycle.** Has `trial_start_at`, `trial_end_at`, `converted_at`, `trial_length_days`, `source`, plus re-engagement email columns. |
| `academy_annual_history` | 29 | `annual_start_at` | 2026-01-14 17:08 | 2026-05-21 19:42 | academy | Annual paid memberships. 29 rows, 16 distinct members (renewals included). |
| `ms_members_cache` | 208 | `created_at` | 2026-01-03 16:03 | 2026-05-21 17:45 | academy | Cached Memberstack member profile + `plan_summary jsonb` (status / is_paid / is_trial / plan_id / plan_name / expiry_date / current_period_end). |
| `academy_email_events` | 218 | `sent_at` | 2026-04-20 22:53 | 2026-05-26 08:00 | academy | One row per automated email (stage_key, status, message_id, subject, dry_run). |
| `academy_email_templates` | 6 | n/a | n/a | n/a | academy | Editable template store. |
| `academy_email_schedules` | 6 | n/a | n/a | n/a | academy | Hourly dispatcher schedule. |
| `academy_qa_questions` | 19 | n/a | n/a | n/a | academy | User Q&A questions. |
| `academy_hue_test_results` | 25 | n/a | n/a | n/a | academy | Photography-style quiz results (also held on `ms_members_cache.photography_style_*`). |
| `academy_config` | 2 | n/a | n/a | n/a | other | Key/value config used by the Academy admin app. |
| `module_results` | 204 | n/a | n/a | n/a | academy | Per-member module completion results. |
| `module_results_ms` | 449 | n/a | n/a | n/a | academy | Memberstack-keyed version of module_results. |
| `exam_member_links` | 1 | n/a | n/a | n/a | academy | Member-to-exam link. |
| `debug_logs` | 1 | n/a | n/a | n/a | infra/audit | Academy app debug logs. |

Pasted SQL evidence (one UNION query):

```json
[
 {"t":"academy_trial_history","d_min":"2026-01-05 21:25:00+00","d_max":"2026-05-21 17:45:56+00","rows":208,"members":207},
 {"t":"academy_annual_history","d_min":"2026-01-14 17:08:17+00","d_max":"2026-05-21 19:42:09+00","rows":29,"members":16},
 {"t":"academy_plan_events","d_min":"2026-01-05 21:25:00+00","d_max":"2026-05-21 19:42:09+00","rows":488,"members":210},
 {"t":"academy_events","d_min":"2026-01-04 21:08:05.558+00","d_max":"2026-05-26 13:33:00.012088+00","rows":5042,"members":210},
 {"t":"ms_members_cache","d_min":"2026-01-03 16:03:38.406+00","d_max":"2026-05-21 17:45:23.016+00","rows":208,"members":208},
 {"t":"academy_email_events","d_min":"2026-04-20 22:53:05.151+00","d_max":"2026-05-26 08:00:29.589303+00","rows":218,"members":179}
]
```

#### Sample rows (top 2-3 per critical table)

**`academy_trial_history`** (most recent first):

```json
[
 {"member_id":"mem_cmpfs74nb0fl10ur82g4fg9ix","trial_start_at":"2026-05-21 17:45:56+00","trial_end_at":"2026-06-04 17:45:56+00","converted_at":"2026-05-21 19:42:09+00","source":"stripe_webhook","trial_length_days":14},
 {"member_id":"mem_cmpf6i44q0b4a0sq4arjz7hu5","trial_start_at":"2026-05-21 07:39:56+00","trial_end_at":"2026-06-04 07:39:56+00","converted_at":null,"source":"stripe_webhook","trial_length_days":14},
 {"member_id":"mem_cmpe90unh05x70ts8et9a8pmi","trial_start_at":"2026-05-20 16:03:12+00","trial_end_at":"2026-06-03 16:03:12+00","converted_at":null,"source":"stripe_webhook","trial_length_days":14}
]
```

Live conversion rate (trial → paid) on all 208 trials:

```json
[{"trials":208,"converted_trials":9,"conv_rate_pct":"4.33"}]
```

**`ms_members_cache.plan_summary`** sample:

```json
[
 {"member_id":"mem_cmkvnkdqk4itc0sqj4l9dh1z3","email":"maykhin.mpk@gmail.com",
  "plan_summary":{"status":"CANCELED","is_paid":false,"plan_id":"pln_academy-trial-30-days--wb7v0hbh","is_trial":true,"plan_name":"Academy Trial","plan_type":"trial","expiry_date":"2026-02-25T21:01:30.381Z","payment_mode":"ONETIME","current_period_end":null,"cancel_at_period_end":false}}
]
```

Note: the cached `plan_summary` records a **30-day** trial plan, yet `academy_trial_history.trial_length_days = 14` for recent rows. The two systems are recording different trial campaigns. Flagged in Section 7.

---

## SECTION 2 — External API & data connections

For each external source: **actual auth status** + how the app talks to it + what is reachable.

### 2.1 Google Search Console (GSC)

- **Connected via** Google OAuth refresh-token flow.
- **Env vars in the AI GEO Audit Vercel project:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GSC_SITE_URL` (verified in `api/fetch-search-console.js:46-50`).
- **Auth helper** is `getGSCAccessToken()` in `api/aigeo/utils.js`, consumed by `api/aigeo/gsc-page-totals.js`, `gsc-page-timeseries.js`, `gsc-page-level.js`, `gsc-entity-metrics.js`, `gsc-url-inspection.js`, the `backfill-*` scripts, and the `cron/backfill-money-page-timeseries.js` cron.
- **Endpoint touched:** `POST https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query`.
- **What lands in Supabase from GSC:**
  - `gsc_timeseries` — site-wide daily, 2024-10-17 → 2026-05-24 (585 rows).
  - `gsc_page_metrics_28d` — page-level rolling 28-day, 2024-12-04 → 2026-05-24 (58 322 rows, 2 160 pages).
  - `gsc_page_timeseries` — page-level daily, 2025-12-27 → 2026-05-17 (30 238 rows, 418 pages).
  - `gsc_url_inspection_cache` — per-URL Index Inspection (552 URLs).
  - `dashboard_subsegment_windows` — per-segment windowed rollups.
- **Dimensions actually queried in code:** `query`, `page`, `country`, `device`, `searchAppearance` (see `gsc-entity-metrics.js`). Query- and page-level data are both reachable, but only the rollups above are persisted.
- **Status:** **connected.**

### 2.2 Google Analytics 4 (GA4)

- **Connected via** the same Google OAuth refresh token as GSC.
- **Env vars:** `GA4_PROPERTY_ID` (default in code; see `api/aigeo/ga4-data.js:22`), plus the OAuth trio shared with GSC.
- **Endpoint touched:** `POST https://analyticsdata.googleapis.com/v1beta/properties/{id}:runReport` (`api/aigeo/ga4-data.js:27`).
- **Metrics/dimensions actually pulled (per `ga4-data.js` + `ga4_site_metrics_28d` rows):** `sessions`, `screenPageViews`, and per-event-name counts (`page_view`, `session_start`, `first_visit`, `user_engagement`, `scroll`, `click`, `cta_click`, `form_start`, `form_submit`, `contact_us_form_submit`, `view_item`, `add_to_cart`, `purchase`, `place_order`, `sign_up`, `chat_start`, `acuity_click`, `file_download`, `checklist_download`, `login`).
- **What is persisted:** **site-wide only**, in `ga4_site_metrics_28d` (4 rows, 2026-04-22 → 2026-05-24). There is no per-page GA4 table.
- **Date range actually accessible:** unbounded from the API; only the last ~33 days are cached.
- **Bounce rate, time on page, scroll depth per page:** NOT cached, would require a new GA4 dimension fetch (`pagePath` + per-event counts).
- **Status:** **connected** (auth works), but page-level engagement metrics are **available-not-cached**.

### 2.3 Squarespace Commerce Orders API

- **Connected via** Squarespace API key (`SQUARESPACE_API_KEY`, declared in `api/aigeo/squarespace-revenue-sync.js:20`).
- **Endpoint touched:** `https://api.squarespace.com/1.0/commerce/orders`.
- **Optional security:** `SQUARESPACE_SYNC_TOKEN` (for cron-triggered GETs).
- **What lands in Supabase:** `revenue_snapshots` rows with `source = 'squarespace_api'` — 34 rows, period 2025-01-01 → 2026-05-31, total £414 481.60.
- **What the sync stores:** total revenue per period, transaction count, per-tier split via `classifyCommercialTier()` (header comment lines 1-13).
- **Modes supported:** `single` (one row for a custom range) and `monthly` (one row per calendar month touched). Both have been used in practice (some rows are `2026-05-01..2026-05-31`, others are rolling `2026-04-21..2026-05-18`).
- **Status:** **connected.**

### 2.4 Stripe API

- **Connected via** Stripe restricted API key (`STRIPE_SECRET_KEY`, declared in `api/aigeo/stripe-revenue-sync.js:23-26`).
- **Endpoint touched:** `https://api.stripe.com/v1` (charges + invoices).
- **Optional security:** `STRIPE_SYNC_TOKEN`.
- **What this sync deliberately captures** (from the header comment lines 3-11): **Acuity charges → `services` tier; Squarespace Member Areas subs → `academy` tier; direct Stripe subs (£59/£79) → `academy`; everything else → `other`. Squarespace Commerce charges are explicitly EXCLUDED to avoid double-counting** the Squarespace API source.
- **What lands in Supabase:** `revenue_snapshots` rows with `source = 'stripe_supplemental'` — 26 rows, 2025-01-01 → 2026-05-31, total £44 607.
- **Status:** **connected.**

### 2.5 Booking Sheet upload (operator-driven)

- **Endpoint:** `POST /api/aigeo/booking-sheet-upload` — operator-uploaded `.xlsm` workbook (`booking-sheet-upload.js:1-32`).
- **Auth:** Supabase service-role write only; no third-party auth (file is uploaded by operator).
- **What lands in Supabase:** `revenue_snapshots` rows with `source = 'booking_sheet'` — 17 rows (one per month), 2025-01-01 → 2026-05-31, total £28 326.90.
- **Purpose:** captures the funded-but-not-Stripe rows the other two APIs miss (Bank transfer, PayPal, Cash, Vouchers, Pick-n-Mix). **Stripe rows in the sheet are explicitly excluded by the parser** to avoid double-counting.
- **Status:** **connected** (manual upload pathway).

### 2.6 Memberstack

- **Connected** in the **Academy** repo (`@memberstack/admin`), NOT the AI GEO Audit repo.
- **Env var:** `MEMBERSTACK_SECRET_KEY` (`Academy/.../api/academy-qa-questions-count.js:53`).
- **Flow:** Memberstack webhooks + Stripe webhooks both write to the academy Supabase project (`academy_plan_events`, `academy_trial_history`, `academy_annual_history`, `ms_members_cache`).
- **What is reachable per member:** id, email, name, photography-style quiz fields, plan_summary jsonb (`status`, `is_paid`, `is_trial`, `plan_id`, `plan_name`, `plan_type`, `expiry_date`, `current_period_end`, `cancel_at_period_end`), and the full Memberstack raw payload in `ms_members_cache.raw`.
- **Status:** **connected** to the Academy Supabase. **Not directly accessible from the AI GEO Audit repo's code** — any cross-project query has to go via the academy Supabase project key.

### 2.7 DataForSEO

- **Connected via** `DATAFORSEO_API_LOGIN` + `DATAFORSEO_API_PASSWORD` (verified in `api/aigeo/dataforseo-backlink-pages.js:79-80`).
- **Switches:** `TRADITIONAL_SEO_BACKLINK_INDEX_SOURCE`, `BACKLINK_INDEX_ROLLBACK`, `DATAFORSEO_PAGE_BACKLINKS_STALE_DAYS`, `DFS_PAGE_BACKLINK_REFRESH_BATCH`.
- **What lands:** `dfs_domain_backlink_rows` (1 650), `dfs_backlink_baseline_edges` (1 625). Several caches (`dfs_page_backlinks_cache`, `dfs_backlink_summary_cache`, `dfs_backlink_tile_baseline`) are present but currently empty.
- **Used for:** Traditional SEO "Pg bl" backlink modal + the Backlinks tab.
- **Status:** **connected.**

### 2.8 Keywords Everywhere (KE)

- **Connected via** `KEYWORDS_EVERYWHERE_API_KEY` (+ `KEYWORDS_EVERYWHERE_COUNTRY`, `KEYWORDS_EVERYWHERE_CURRENCY`); see `api/aigeo/keyword-target-metrics.js:665-668`, `1126-1129`.
- **What lands:** `keyword_target_metrics_cache` (currently empty — 0 rows; cache invalidated/cleared). Live API calls still happen on-demand.
- **Used for:** column **③** (volume + metrics age) in the Traditional SEO keywords table.
- **Status:** **connected** (key configured); the persistent cache is currently empty.

### 2.9 Anything else?

- **Squarespace Member Areas direct API:** not reached — Member-Areas subscriptions are observed via Stripe (see 2.4).
- **Google Business Profile, Ahrefs/Moz/SEMrush, social platform APIs:** not connected. UI placeholders (`Moz DA`, `Rank`) exist but are not populated.

---

## SECTION 3 — Financial bookings data (~12 months) — detailed

### 3.1 Where it lives

All actual financial data is in **`revenue_snapshots`** (project `igzvwbvgvmzvvzoclufx`). There is no separate per-booking / per-order table inside Supabase. Per-order/per-charge detail exists only on the upstream systems (Squarespace, Stripe, the local `.xlsm` Booking Sheet).

### 3.2 Granularity

**Per-period × per-source aggregate.** Each row represents the **total** revenue and transaction count for one `(property_url, period_start, period_end, source)` combination.

Two period shapes are in the table simultaneously:

- **Calendar months** (e.g. `2026-05-01..2026-05-31`).
- **Rolling 28-day windows** (e.g. `2026-04-21..2026-05-18`).

This is a **mode mix** introduced by the sync's `modes = "single,monthly"` flag and the cron's rolling default. See Section 7.

### 3.3 Fields actually populated

| Field | Populated? | Notes |
|---|---|---|
| `period_start` / `period_end` | ✅ all rows | Date precision only, no time. |
| `revenue_amount` | ✅ all rows | GBP. |
| `currency` | ✅ all rows | Always `GBP`. |
| `source` | ✅ all rows | `squarespace_api` / `stripe_supplemental` / `booking_sheet`. |
| `transactions` | ✅ all rows | Count for the period. |
| `tier_revenue` (jsonb split) | ⚠️ later rows only | Earliest 2025 Squarespace API rows have `tier_revenue IS NULL`. |
| `tier_transactions` (jsonb split) | ⚠️ later rows only | Same caveat. |
| `notes` | ✅ all rows | Human-readable origin string. |
| `created_at` | ✅ all rows | Upsert time. |
| **per-product name** | ❌ | NOT stored on `revenue_snapshots`. Only the tier bucket survives. |
| **customer identifier** | ❌ | NOT stored. Upstream only. |
| **booking channel / source** (referrer, landing page, GA4 channel) | ❌ | NOT stored. |
| **discount flag** | ❌ | NOT stored (handled upstream by Squarespace). |
| **refund / cancellation flag** | ⚠️ partial | `squarespace-revenue-sync.js` has an `includeCancelled` switch (defaults to "0"); cancelled orders are simply excluded rather than flagged. Refunds inside Stripe are not separately stored either. |

### 3.4 Sample rows (3 most recent)

```json
[
 {"property_url":"https://www.alanranger.com","period_start":"2026-05-10","period_end":"2026-05-17",
  "revenue_amount":"200","currency":"GBP","source":"squarespace_api","transactions":2,
  "tier_revenue":null,"tier_transactions":null,
  "notes":"Synced from Squarespace Orders API"},
 {"property_url":"https://www.alanranger.com","period_start":"2026-05-01","period_end":"2026-05-31",
  "revenue_amount":"240","currency":"GBP","source":"booking_sheet","transactions":2,
  "tier_revenue":{"hire":0,"academy":0,"courses":240,"services":0,"unidentified":0,"workshops_nonres":0,"workshops_residential":0},
  "tier_transactions":{"hire":0,"academy":0,"courses":2,"services":0,"unidentified":0,"workshops_nonres":0,"workshops_residential":0},
  "notes":"Imported from Booking Sheet (Bank + PayPal + Cash + Voucher/PicknMix re-attribution; Stripe excluded)"},
 {"property_url":"https://www.alanranger.com","period_start":"2026-05-01","period_end":"2026-05-31",
  "revenue_amount":"347","currency":"GBP","source":"stripe_supplemental","transactions":5,
  "tier_revenue":{"hire":0,"academy":217,"courses":0,"services":130,"unidentified":0,"workshops_nonres":0,"workshops_residential":0},
  "tier_transactions":{"hire":0,"academy":3,"courses":0,"services":2,"unidentified":0,"workshops_nonres":0,"workshops_residential":0},
  "notes":"Auto-synced from Stripe API (Acuity + Subscriptions)"}
]
```

### 3.5 Total row count + exact date span

```json
[{"rows":77,"d_min":"2025-01-01","d_max":"2026-05-31","props":1,"sources":3}]
```

### 3.6 Per-source totals (entire stored history)

```json
[
 {"source":"booking_sheet",      "rows":17,"d_min":"2025-01-01","d_max":"2026-05-31","total_gbp":"28326.90"},
 {"source":"squarespace_api",    "rows":34,"d_min":"2025-01-01","d_max":"2026-05-31","total_gbp":"414481.60"},
 {"source":"stripe_supplemental","rows":26,"d_min":"2025-01-01","d_max":"2026-05-31","total_gbp":"44607.00"}
]
```

### 3.7 Month-by-month coverage (every month, every source)

```text
yyyymm  | source             | rev_gbp     | txns
2026-05 | booking_sheet      |     240.00  |    2
2026-05 | squarespace_api    |     400.00  |    7
2026-05 | stripe_supplemental|     347.00  |    5
2026-04 | booking_sheet      |    1072.75  |   14
2026-04 | squarespace_api    |    8723.00  |   60
2026-04 | stripe_supplemental|     491.00  |    7
2026-03 | booking_sheet      |     701.62  |    8
2026-03 | squarespace_api    |    9409.00  |   68
2026-03 | stripe_supplemental|     665.00  |    7
2026-02 | booking_sheet      |     456.00  |    5
2026-02 | squarespace_api    |    3910.00  |   17
2026-02 | stripe_supplemental|     208.00  |    3
2026-01 | booking_sheet      |     601.67  |   13
2026-01 | squarespace_api    |   46929.00  |  292
2026-01 | stripe_supplemental|    5199.00  |   56
2025-12 | booking_sheet      |    4110.95  |   58
2025-12 | squarespace_api    |    1199.00  |   21
2025-12 | stripe_supplemental|      65.00  |    1
2025-11 | booking_sheet      |    2804.80  |   28
2025-11 | squarespace_api    |    1200.00  |   17
2025-11 | stripe_supplemental|     240.00  |    1
2025-10 | booking_sheet      |     570.00  |    7
2025-10 | squarespace_api    |    1612.00  |   29
2025-10 | stripe_supplemental|     890.00  |    5
2025-09 | booking_sheet      |    1434.48  |   14
2025-09 | squarespace_api    |    3669.00  |   31
2025-09 | stripe_supplemental|     125.00  |    2
2025-08 | booking_sheet      |    1020.00  |   13
2025-08 | squarespace_api    |     706.40  |   24
2025-08 | (stripe missing)
2025-07 | booking_sheet      |    4605.00  |   44
2025-07 | squarespace_api    |    2205.00  |   15
2025-07 | stripe_supplemental|     110.00  |    3
2025-06 | booking_sheet      |    4349.10  |   52
2025-06 | squarespace_api    |    3051.20  |   19
2025-06 | (stripe missing)
2025-05 | booking_sheet      |    2864.00  |   38
2025-05 | squarespace_api    |    1228.00  |   15
2025-05 | stripe_supplemental|     180.00  |    2
2025-04 | booking_sheet      |    1395.00  |   18
2025-04 | squarespace_api    |  177726.60  | 1586
2025-04 | stripe_supplemental|   20343.00  |  198
2025-03 | booking_sheet      |     669.83  |    7
2025-03 | squarespace_api    |   32314.60  |  300
2025-03 | stripe_supplemental|    4973.00  |   43
2025-02 | booking_sheet      |     255.84  |    2
2025-02 | squarespace_api    |    2683.00  |   15
2025-02 | stripe_supplemental|     155.00  |    2
2025-01 | booking_sheet      |    1175.86  |   19
2025-01 | squarespace_api    |  117515.80  |  984
2025-01 | stripe_supplemental|   10616.00  |   93
```

- **No months are missing** between 2025-01 and 2026-05 (17 full months).
- **Two months are missing the `stripe_supplemental` source** (2025-06, 2025-08). These could be true zeros or sync gaps; not verified.
- The huge spikes in Squarespace 2025-01 (£117 515.80, 984 txns) and 2025-04 (£177 726.60, 1 586 txns) need to be sanity-checked against the user's expectation — they dwarf every other month and may represent voucher/Pick-n-Mix bursts or an annual academy-renewal event. **UNVERIFIED — flagging as a data-quality item, not as fact**.

### 3.8 Where the raw transactional detail still lives

- **Squarespace Commerce Orders** → on Squarespace (reachable via `/1.0/commerce/orders`).
- **Stripe charges + invoices** → in Stripe.
- **Booking Sheet** → the operator's local `Booking Sheet 2026 - Alan Ranger Photography.xlsm` (uploaded to `/api/aigeo/booking-sheet-upload`). The parser is `lib/booking-sheet-parser.mjs`.
- **Memberstack member + plan history** → Memberstack + the academy Supabase mirror.

Re-ingesting per-booking detail into Supabase would require either (a) widening the sync APIs to insert per-row records, or (b) a new transactions table — both are out of scope here.

---

## SECTION 4 — Can the financial data support tier tracking & revenue decomposition?

### 4.1 Actual monthly revenue, last 12+ months — **YES**

- 17 months of `revenue_snapshots` rows cover Jan 2025 → May 2026 with no missing months overall.
- Aggregation field is **`SUM(revenue_amount) GROUP BY DATE_TRUNC('month', period_start)`** — but with two caveats:
  1. Some rows are calendar-month (`2026-05-01..2026-05-31`) and some are rolling 28-day (`2026-04-21..2026-05-18`). Both shapes coexist for the same month, so naive `SUM` across all three sources for one calendar month is **not** safe without first filtering to one period shape, or de-duplicating by source × month.
  2. The active scenario's per-tier targets are all 0, so any "vs target" comparison would compare against zero today.

### 4.2 Monthly split into booking COUNT vs average booking VALUE — **YES, but with assumptions**

- `revenue_snapshots.transactions` gives the count per (period, source).
- `revenue_amount / transactions` gives the average value per source.
- Total monthly count = `SUM(transactions)` across sources for that month. This is reliable **provided** `booking_sheet` and `stripe_supplemental` rows do not overlap with `squarespace_api` for the same transaction. The two syncs explicitly exclude each other (Booking Sheet excludes Stripe; Stripe excludes Squarespace Commerce charges), so by construction overlap should be minimal — **but this has not been audited**.

### 4.3 Per-product / per-tier breakdown — **YES, for tiers; NO, for product**

- **Tier**: `tier_revenue` and `tier_transactions` give six fixed buckets (`academy`, `courses`, `hire`, `services`, `workshops_nonres`, `workshops_residential`) plus `unidentified` / `other`. Used in the Revenue Funnel tab today.
  - ⚠️ Earliest Squarespace API rows have `tier_revenue IS NULL` (see Section 3.4 row 1) — the tier classifier was added later. Counts in 2025-Q1 may have to fall back to property-wide totals only.
- **Product**: not stored on `revenue_snapshots`. Recovering per-product totals would require either re-querying Squarespace/Stripe for each period or persisting per-line-item rows.

### 4.4 GP vs revenue — **only revenue is measured**

- `revenue_snapshots` stores revenue, not GP. There is no per-row cost field.
- The only stored cost data point is `revenue_funnel_tier_costs` — currently **one** row (`academy`: £100/month fixed, min 10 paid signups). Every other tier has no fixed-cost record.
- GP can therefore only be **assumed** today, via a per-tier GP% multiplier. Code does this:
  - `revenue-funnel-aio-model.js` and `revenue-funnel-smart-priorities.js` use constants such as `TRUE_AOV_BY_TIER`, `BOOKING_CONV_RATE_BY_TIER`, `ACADEMY_TRIAL_FUNNEL`, plus GP% assumptions baked into card text (e.g. "~£356/mo profit at 90% GP" — see priorities sample in §1A.3(g)).
  - These are explicit **ASSUMPTIONS**, not measured values. Any GP line on the new tab must be labelled as such.
- For the Academy tier, the `min_monthly_units = 10` row gives a break-even floor for fixed costs only; variable cost is still unknown.

### 4.5 Survival / comfort / thriving lifestyle bands — **NO native fields, only "survival" exists**

- `revenue_funnel_scenarios.monthly_survival_baseline_gbp` stores a **single** survival floor (£3 000 on the active scenario). There is no `comfort_baseline_gbp` or `thriving_baseline_gbp` column.
- Comfort / thriving thresholds would need to come from somewhere outside the existing Supabase schema (either added as new fields, or computed from a multiplier on survival — both are design choices, out of scope here).

### 4.6 Plain-English summary of what the financial data CAN and CANNOT support

**CAN** support today:

- Actual **revenue** £ per calendar month, 17 months back.
- Actual **transaction count** per month per source per tier.
- Average booking value per source per month (rev / txns).
- Per-tier (academy / courses / workshops_res / workshops_nonres / services / hire / other) revenue and count split, **for rows where `tier_revenue` is populated** (most rows post-Q2 2025).
- Comparison vs the active scenario's £3 000 survival baseline.

**CANNOT** support today, without new work:

- GP (no per-tier cost data except academy's £100/mo fixed).
- Comfort / thriving lifestyle band targets (only survival exists).
- Per-product revenue trend (only tier survives the sync).
- Channel / source / landing-page attribution per booking (see Section 6).
- Trial → paid conversion **value** broken out into the academy revenue line beyond what the Stripe sync already buckets. (Trial *counts* and *conversion rate* are reachable via the academy project; see §1B.)
- Single-mode aggregation across all sources without first reconciling the calendar-month vs 28-day-rolling period shapes.

---

## SECTION 5 — The funnel join for `/beginners-photography-classes`

The brief asked: for each stage, state whether it can be sourced from real data today, and from where.

### 5.1 Impressions

- **Source:** `gsc_page_metrics_28d.impressions_28d` (28-day rolling) and `gsc_page_timeseries.impressions` (daily).
- **Pasted row (most recent 28d window, 2026-04-27 → 2026-05-24):** `impressions_28d = 1 104`.
- **Daily-level total stored for this page (2025-12-27 → 2026-05-17):** `SUM(impressions) = 2 356` over 56 stored days. (Daily backfill window is shorter than the 28d cache.)
- **Status:** **available**.

### 5.2 Clicks

- **Source:** same two tables, `clicks_28d` / `clicks`.
- **Most recent 28d:** 5 clicks. Daily-stored total over 56 days: 5 clicks.
- **Status:** **available**, but the click volume is so low that any per-page ratio (CTR, conv) is noise.

### 5.3 Rank / position

- **Source A:** `gsc_page_metrics_28d.position_28d` (most recent 28d = **40.67**).
- **Source B (keyword-level):** `keyword_rankings` for the three keywords that map to this page — `beginners photography classes` (rank 13, vol 720), `beginners photography class` (rank 13, vol 720), `beginners photography courses` (rank 14, vol 720). Best assigned-keyword rank therefore lives in `keyword_rankings.best_rank_group`.
- **Status:** **available**.

### 5.4 On-page engagement — bounce / time on page / scroll

- **Source:** **NOT AVAILABLE per page** in Supabase. `ga4_site_metrics_28d` only stores site-wide totals (e.g. `scroll = 9 847`, `user_engagement = 16 151`). There is no per-`pagePath` GA4 row.
- **Reachable via API:** a fresh GA4 `runReport` with dimension `pagePath` and metrics `engagementRate`, `averageEngagementTime`, `screenPageViews`, plus the `scroll` event count, could backfill this — **but no such cache exists today**.
- **Status:** **NOT AVAILABLE in stored data; reachable from GA4 with new queries.**

### 5.5 Enquiry events — form submit / phone-number click / consultation booking

- **Site-wide counts ARE stored** in `ga4_site_metrics_28d.event_counts`: `form_start = 362`, `form_submit = 38`, `contact_us_form_submit = 17`, `acuity_click = 12`, `cta_click = 104`, `chat_start = 53`, `add_to_cart = 6`. Money-page totals: `enquiry_events_28d = 905`, `money_page_enquiry_events_28d = 287`.
- **Per-page enquiry counts:** **NOT AVAILABLE** in any Supabase table.
- **Phone-number click as a distinct event:** **UNVERIFIED** — no `phone_click` or `tel_click` is present in the site-wide `event_counts` jsonb; if it is tracked in GA4 it has not been ingested.
- **Status:** site-wide enquiry counts available, **per-page enquiry counts not stored**.

### 5.6 Actual booking → revenue

- **Per-page booking:** **NOT AVAILABLE.** `revenue_snapshots` has no `page_url` column; rows are property-wide aggregates. There is no field linking a single booking to the landing page that produced it.
- **By tier:** the page belongs to the **`courses`** tier per `csv_metadata` (`csv_type = course_products` and `landing_service_pages` both list this URL). Tier-level monthly revenue from `revenue_snapshots.tier_revenue.courses` is available — e.g. May 2026 (calendar month) booking_sheet rows attributed £240 to `courses`, 2 transactions.
- **Status:** **per-page revenue = NOT AVAILABLE**; per-tier revenue is the lowest granularity stored.

### 5.7 Summary of the funnel for `/beginners-photography-classes`

| Stage | Source | Status |
|---|---|---|
| Impressions | `gsc_page_metrics_28d.impressions_28d` | ✅ available (1 104 / 28d) |
| Clicks | `gsc_page_metrics_28d.clicks_28d` | ✅ available (5 / 28d) — too sparse for ratios |
| Rank (page-level avg position) | `gsc_page_metrics_28d.position_28d` | ✅ available (40.67) |
| Rank (per keyword) | `keyword_rankings.best_rank_group` | ✅ available (3 keywords mapped, ranks 13-14) |
| Bounce / time on page / scroll | nothing per page | ❌ not stored; reachable via new GA4 query |
| Enquiry events (form, tel, Acuity click) per page | nothing per page | ❌ not stored; site-wide totals exist in `ga4_site_metrics_28d` |
| Actual bookings per page | nothing per page | ❌ no `page_url` link on `revenue_snapshots` |
| Revenue attributed to page | nothing per page | ❌ same |
| Revenue at tier the page belongs to (`courses`) | `revenue_snapshots.tier_revenue.courses` | ✅ available per month |

The gaps that matter most for the "traffic-but-no-bookings" diagnosis are:

- per-page GA4 (bounce, scroll, engaged sessions);
- per-page enquiry events (form_submit, acuity_click, tel_click);
- any link at all between a booking and a landing page or referring keyword/channel.

---

## SECTION 6 — Join keys & attribution

### 6.1 Booking ↔ landing page or traffic source

- **There is no field linking a booking to a landing page or traffic source.**
- `revenue_snapshots` columns are: `property_url`, `period_start`, `period_end`, `revenue_amount`, `source` (= billing API name, not marketing source), `transactions`, `tier_revenue`, `tier_transactions`, `notes`. No `page_url`, `landing_page`, `ga4_channel`, `utm_*`, `referrer`, or `customer_id`.
- The upstream systems do hold per-order detail (Squarespace order metadata; Stripe charge metadata; Booking Sheet customer name and product name), but **none of that is persisted** in Supabase.
- **This is the single biggest attribution gap** for the new tab. Today, no SQL join can answer "how much revenue came from `/beginners-photography-classes`".

### 6.2 Common keys across data sources

| Key | Lives in | Format(s) observed | Consistent? |
|---|---|---|---|
| **`property_url`** | `revenue_snapshots`, `revenue_funnel_*`, `keyword_rankings`, `ga4_site_metrics_28d`, `gsc_page_timeseries`, `gsc_timeseries`, `audit_results`, `traditional_seo_target_keyword_overrides` | `https://www.alanranger.com` (canonical), `alanranger.com` (84 rows on `keyword_rankings`), `https://www.alanranger.com/` (33 rows on `keyword_rankings`) | ❌ **3 formats in keyword_rankings** (see §7). |
| **`page_url`** | `gsc_page_metrics_28d`, `gsc_page_timeseries`, `gsc_url_inspection_cache`, `csv_metadata`, `product_display_price`, `traditional_seo_target_keyword_overrides`, `keyword_rankings.best_url` | `https://www.alanranger.com/slug` vs `https://alanranger.com/slug` (no-www, observed in `traditional_seo_target_keyword_overrides`), vs slug-only (`product_display_price` row `"ireland-photography-workshops-dingle"`), vs URLs with `?srsltid=...` Google Merchant tracking suffix (`keyword_rankings.best_url`) | ❌ **multiple shapes** across tables. |
| **`date`** | every traffic table | `date`, `date_start`/`date_end`, `period_start`/`period_end`, `audit_date` | Date precision only (no time zone). All are stored as `date`. Timezone interpretation is implicit (UTC for GA4/Stripe, local for Booking Sheet) — see §7. |
| **product name** | `product_display_price.product_title`, `csv_metadata.title`, Stripe charge metadata, Squarespace order line items | Free text strings. **Stripe/Squarespace product names ≠ on-site page title** (e.g. Squarespace order "BEGINNERS PHOTOGRAPHY CLASSES - 3 WEEKLY EVENING CLASSES" vs site page title "Beginners Photography Classes - 3 Weekly Evening Classes"). | ❌ casing differs. |
| **member_id / email** | `ms_members_cache.member_id`, `academy_*.member_id`, Stripe `customer.email` | Memberstack `mem_...` IDs in academy project. Stripe customer IDs in `academy_plan_events.stripe_customer_id`. These two ID spaces are bridged inside `academy_plan_events` via webhook payloads. | Reasonable inside the academy project, **but not linked into `revenue_snapshots`**. |

### 6.3 Existing booking-to-page / booking-to-keyword links — **NONE in stored data**

- No row in any Supabase table currently records "this booking came from this page" or "this booking came from this keyword".
- The closest available proxy is **(tier of the page) ↔ (tier_revenue bucket)** — e.g. `/beginners-photography-classes` is a `courses` page, and `revenue_snapshots.tier_revenue.courses` exists per month. That is a many-to-many proxy, not attribution.
- A proper attribution pathway would need either:
  - per-order metadata captured from Squarespace order URLs / Stripe charge metadata at sync time (not done today), **or**
  - GA4 `purchase` events with a `pagePath` / `transactionId` dimension cached per page (not done today — only site-wide event counts are stored).

---

## SECTION 7 — Known data-quality issues

These will corrupt either a join or a monthly aggregation if not handled before the new tab is designed.

### 7.1 Three `property_url` formats on `keyword_rankings`

Live evidence:

```json
[
 {"property_url":"alanranger.com","rows":84},
 {"property_url":"https://www.alanranger.com","rows":7077},
 {"property_url":"https://www.alanranger.com/","rows":33}
]
```

Any join that filters `property_url = 'https://www.alanranger.com'` misses 117 rows (84 + 33). The codebase's `urlSlugKey` helper handles this in app code, but raw SQL queries do not.

### 7.2 No-www vs www in `traditional_seo_target_keyword_overrides`

Sample evidence:

```json
[
 {"page_url":"https://alanranger.com/blog-on-photography/how-to-plan-an-arps-panel","target_keyword":"arps panel"},
 {"page_url":"https://alanranger.com/blog-on-photography/how-to-plan-an-lrps-panel","target_keyword":"lrps panel"},
 {"page_url":"https://alanranger.com/blog-on-photography/uk-sports-action-photography-guide","target_keyword":"sports action photography guide"}
]
```

`page_url` here is **`https://alanranger.com/`** (no `www`), whereas `keyword_rankings.best_url`, `gsc_page_metrics_28d.page_url`, and `revenue_snapshots.property_url` use **`https://www.alanranger.com/`** (with `www`).

### 7.3 Squarespace `?srsltid=...` tracking suffix on `keyword_rankings.best_url`

Evidence (one of three rows for `/beginners-photography-classes`):

```text
https://www.alanranger.com/beginners-photography-classes?srsltid=AfmBOoqSm7FKE61otSiGFtfx9qwI97Ytxb7zoPnvRvyQAlQBJ7TXS25l
```

A direct string join `keyword_rankings.best_url = gsc_page_metrics_28d.page_url` will miss these rows. App code strips the suffix; raw SQL must too.

### 7.4 Mixed period shapes inside `revenue_snapshots`

Calendar months and rolling 28-day windows coexist in the same table for the same property, e.g. (May 2026 alone):

- `2026-05-01..2026-05-31` (`booking_sheet`, `squarespace_api`, `stripe_supplemental` calendar-month rows)
- `2026-04-21..2026-05-18` (Squarespace + Stripe rolling-28d rows)
- `2026-05-10..2026-05-17` (Squarespace 7-day window)

A naive `SUM(revenue_amount) GROUP BY DATE_TRUNC('month', period_start)` will double-count.

### 7.5 Early Squarespace rows have `tier_revenue IS NULL`

Sample (latest Squarespace API row): `tier_revenue: null, tier_transactions: null`. Tier-level rollups have to fall back to property-wide totals for those rows, or those rows must be excluded from per-tier analysis.

### 7.6 Stripe gaps for two months

`stripe_supplemental` is missing for **2025-06** and **2025-08** (see §3.7). It is not known whether these are true zeros or sync gaps — the sync's audit log was not part of this discovery. **UNVERIFIED**.

### 7.7 Outlier monthly Squarespace revenue (2025-01 and 2025-04)

- 2025-01: £117 515.80 / 984 transactions.
- 2025-04: £177 726.60 / 1 586 transactions.

These dwarf every other 2025 month. Possible causes (UNVERIFIED): voucher / Pick-n-Mix promotion, annual academy renewal, or a one-off product launch. Until checked these will distort any "vs target" or "year-on-year" comparison.

### 7.8 Trial length mismatch (Academy)

- `academy_trial_history.trial_length_days = 14` on the three most-recent trials (May 2026), source `stripe_webhook`.
- `ms_members_cache.plan_summary.plan_id = pln_academy-trial-30-days...` on cached members.

The two systems are recording different trial campaigns. A naive funnel of "trial started → paid in 30 days" must pick which clock to use.

### 7.9 Timezone implicit, not stored

- GA4 / GSC tables store `date` only (no timezone field). Google's reports default to the property's timezone (Europe/London).
- Stripe sync stores `period_start` / `period_end` as `date` after converting from UTC unix timestamps (`dateToUnixStart()` in `stripe-revenue-sync.js`).
- Booking Sheet rows are computed from the workbook (local Europe/London dates).

Until the new tab settles on a single timezone, edge-of-month rows can land in two buckets.

### 7.10 `optimisation_task_events` row count discrepancy

`list_tables` reported 347 rows; live `COUNT(*) = 6 116`. `pg_class.reltuples` is stale for several tables; any UI surface that uses the metadata RPC will under-report sizes. Cosmetic for the new tab, but worth knowing before designing any "DB health" widget.

### 7.11 `audit_results` row-count discrepancy

`list_tables` reported 12 rows; live `COUNT(*) = 656`. Same cause — stale `pg_class.reltuples`.

### 7.12 RLS is OFF on most tables

The MCP advisory flagged 84 tables in the ai-chat project and 8 in the academy project as having Row Level Security disabled. Cosmetic for an internal admin tab — but the anon key can currently read every row in every table. If the new tab were exposed publicly without a server proxy, every figure in this document would be exposed too.

### 7.13 No per-product attribution on `revenue_snapshots`

Reiterated for emphasis: tier survives the sync, product name does not. A tab that shows "top 10 products by revenue this month" cannot be built from current data without changing how the syncs persist.

### 7.14 Product name casing differs between Squarespace orders and on-site CSVs

Squarespace orders contain product titles like `"BEGINNERS PHOTOGRAPHY CLASSES - 3 WEEKLY EVENING CLASSES"` (uppercase) whereas `csv_metadata.title` for the same URL is `"Beginners Photography Classes - 3 Weekly Evening Classes"` (title case). Any future product↔page join must be case-insensitive and slug-normalised.

---

## Appendix A — Project IDs, MCP servers, code references

- AI GEO Audit Supabase: project `igzvwbvgvmzvvzoclufx`, MCP `user-supabase-ai-chat`.
- Academy Supabase: project `dqrtcsvqsfgbqmnonkpt`, MCP `user-supabase-academy`.
- Sync code:
  - `api/aigeo/squarespace-revenue-sync.js` (lines 1-32 spec; 367, 391-392 for env).
  - `api/aigeo/stripe-revenue-sync.js` (lines 1-46 spec, exclusions, app IDs; 401, 415 for env).
  - `api/aigeo/booking-sheet-upload.js` (lines 1-43 spec; 36-37 for env).
  - `api/aigeo/ga4-data.js` (line 22 for property env, line 27 endpoint).
  - `api/aigeo/gsc-page-totals.js` (line 160 endpoint).
  - `api/aigeo/dataforseo-backlink-pages.js` (lines 79-80 for env).
  - `api/aigeo/keyword-target-metrics.js` (lines 665-668 for KE env).
  - `api/fetch-search-console.js` (lines 46-50 for the OAuth env trio).
- Conversion-model code (assumption stacks, GP%, AOV by tier): `lib/revenue-funnel-aio-model.js` (`liftRange`, `liftRangeForOnPageMove`, `TRUE_AOV_BY_TIER`, `BOOKING_CONV_RATE_BY_TIER`, `ACADEMY_TRIAL_FUNNEL`).

## Appendix B — Items explicitly labelled UNVERIFIED in this report

- **2025-08 + 2025-06 missing `stripe_supplemental` rows** — could be true zeros or sync gaps; the sync's audit log was not inspected (§7.6).
- **2025-01 and 2025-04 outlier Squarespace revenue** — likely voucher / annual academy renewal but not confirmed (§7.7).
- **`phone_click` / `tel_click` as a distinct GA4 event** — not observed in stored `event_counts`; tracking in GA4 itself was not checked (§5.5).
- **Whether Squarespace `includeCancelled` excludes-vs-flags cancellations consistently across all 17 months** — code default is "0" (exclude); no historical re-pull was done (§3.3).
