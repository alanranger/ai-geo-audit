# AI Visibility Execution Board (2026)

Purpose: turn `AI-Visibility-Checklist.docx.md` into a practical, high-impact execution plan using what is already built in `AI GEO Audit` and `Schema Tools`.

Status keys:

- `Done`: implemented and usable now.
- `In-Play`: partially implemented, wired, or documented but not complete.
- `Missing`: not implemented yet.

---

## 1) Current State by Checklist Area

## Technical Foundation

| Item | Status | Evidence |
| --- | --- | --- |
| Crawl and parse schema across URLs | Done | `api/schema-audit.js` |
| Handle dynamic schema loader patterns | Done | `api/schema-audit.js` |
| Robots.txt AI-bot access check | Missing | No dedicated endpoint/script found |
| Sitemap + indexing health checks | Missing | No dedicated endpoint/script found |
| `/facts` or `/about` factual-page coverage check | In-Play | `/about` appears in defaults in `api/aigeo/schema-coverage.js` |

## Structured Data

| Item | Status | Evidence |
| --- | --- | --- |
| Store schema types/foundation/rich eligibility | Done | `sql/SUPABASE_SCHEMA.sql` (`schema_types`, `schema_foundation`, `schema_rich_eligible`) |
| Detect key schema families in audit flow | Done | `api/schema-audit.js` |
| Organization + Person generation | Done | `Schema Tools/scripts/generate-blog-schema.js` |
| FAQ schema generation/use | Done | `Schema Tools/alanranger-schema/*_faq.json` |
| Product/Event schema at scale | Done | `Schema Tools/alanranger-schema/lessons-schema.json`, `workshops-schema.json` |
| LocalBusiness signal scoring | In-Play | `api/aigeo/local-signals.js` has `localBusinessSchemaPages` TODO placeholder |
| Service schema as first-class validation track | Missing | `Schema Tools/scripts/csv-schema-validator.js` has Product/Event/Organization/LocalBusiness, no Service block |

## Content Strategy Signals

| Item | Status | Evidence |
| --- | --- | --- |
| Recommendation plumbing for FAQ/content improvements | In-Play | `api/supabase/save-audit.js` |
| Automated TL;DR presence checks | Missing | No dedicated detector found |
| Direct-answer intro checks | Missing | No dedicated detector found |
| Comparison-table detection | Missing | No dedicated detector found |
| Last-updated freshness checks | Missing | No dedicated detector found |

## Off-Site Consensus and Local Signals

| Item | Status | Evidence |
| --- | --- | --- |
| GBP/local signal pipeline | Done | `api/aigeo/local-signals.js`, `data/gbp-reviews.json` |
| Reviews pipeline | Done | `api/reviews/site-reviews.js` |
| Backlink metrics ingestion | Done | `api/aigeo/backlink-metrics.js` |
| Directory/citation consistency monitor (NAP across major listings) | In-Play | NAP scoring present, but no full citation monitor pipeline found |
| Third-party mention quality tracking (PR/podcasts/publications) | Missing | No dedicated endpoint found |

## Reddit, LinkedIn, YouTube

| Item | Status | Evidence |
| --- | --- | --- |
| Strategy documented | Done | `Docs/AI-Visibility-Checklist.docx.md` |
| Platform-level tracking and scoring | Missing | No dedicated collector/scorer found |
| Social profile/link consistency checks | Missing | No dedicated endpoint found |

## Monitoring and Operations

| Item | Status | Evidence |
| --- | --- | --- |
| Scheduled global runs | Done | `api/cron/global-run.js`, `api/cron/run-job.js` |
| Parity/diagnostics scripts | Done | `scripts/check_gsc_parity.py` |
| Existing fix plans and handover docs | Done | `HANDOVER.md`, `Docs/FIX-PLAN-COMPREHENSIVE.md` |
| Real-time alerting for drift/regressions | In-Play | Mentioned in docs/roadmap; not fully productized |

---

## 2) What Is Already Moving the Needle

These are already high-value and should be protected:

1. **Schema at scale is real and productionized**

   - Generation + validation + deployment workflows exist in `Schema Tools`.
   - This is a major moat for AI extraction quality.

2. **Audit datastore is schema-aware**

   - Foundation and rich-result eligibility are persisted and queryable.
   - Enables trend tracking and QA over time.

3. **Off-site trust signals are not just theoretical**

   - GBP/reviews/backlinks are wired, which aligns with consensus-based AI recommendation behavior.

4. **Cron orchestration exists**

   - You have execution cadence infrastructure already; this reduces delivery risk for new checks.

---

## 3) High-Value Ticket Backlog (Do First)

Scoring:

- `Impact`: expected influence on AI visibility and recommendation quality.
- `Effort`: implementation complexity/risk.
- Priority favors high impact and low/medium effort.

| Priority | Ticket | Impact | Effort | Why it matters |
| --- | --- | --- | --- | --- |
| P0 | Implement `localBusinessSchemaPages` scanner in `local-signals` | High | Medium | Removes placeholder in local trust scoring and directly improves local recommendation confidence |
| P0 | Add technical foundation endpoint (`robots + sitemap + indexability`) | High | Medium | Fixes crawl/index blind spots before content/schema optimization |
| P0 | Add first-class `Service` schema validation + generation checks | High | Medium | Service pages are core revenue pages; closes schema gap vs Product/Event |
| P1 | Add content extractability checks (`TL;DR`, direct answer intro, FAQ block, last-updated) | High | Medium | Converts checklist guidance into measurable, enforceable page quality signals |
| P1 | Add schema QA gate before deploy (`@id` consistency, ISO dates, required fields by type) | High | Low | Prevents silent quality drift and parser breakage in generated schema |
| P1 | Build citation consistency monitor (major directory profiles + NAP diff) | Medium/High | Medium | Extends current local signals from partial to durable off-site consensus tracking |
| P2 | Add Reddit/LinkedIn/YouTube mention tracker | Medium | Medium/High | Important for long-term AI citations; less immediate than technical/schema blockers |
| P2 | Add mention-quality scoring (source authority + recency + sentiment proxy) | Medium | High | Useful once base mention ingestion exists |

---

## 4) Suggested Sprint Plan (Needle-First)

### Sprint A (1 week): unblock core scoring

- Ship `localBusinessSchemaPages` scan (P0).
- Ship `robots/sitemap/indexability` technical checker (P0).
- Add `Service` schema checks in validator + report output (P0).

Success criteria:

- Local signals no longer return `0` due to TODO placeholders.
- Technical checker surfaces pass/fail reasons per domain.
- Validation reports include explicit `Service` coverage.

### Sprint B (1 week): protect and improve extractability

- Add schema QA gate in Schema Tools pipeline (P1).
- Add TL;DR/direct-answer/FAQ/last-updated content checks (P1).

Success criteria:

- Pre-deploy fails fast on malformed dates and broken IDs.
- Audit output includes new content extractability subscores.

### Sprint C (1-2 weeks): external consensus expansion

- Citation consistency monitor (P1/P2).
- Reddit/LinkedIn/YouTube mention baseline ingestion (P2).

Success criteria:

- Dashboard shows tracked citation sources and consistency drift.
- First social mention baseline available for trend deltas.

---

## 5) Explicit De-Prioritization (for now)

To keep focus on highest ROI:

- Do not lead with aggressive/grey-hat tactics.
- Do not over-invest in new dashboards until P0/P1 data quality checks are live.
- Do not expand to advanced mention scoring before basic ingestion and consistency checks exist.

---

## 6) Owner-Ready Ticket Stubs

Use these as immediate issue titles:

1. `P0: Implement localBusinessSchemaPages scanner in local-signals`
2. `P0: Build technical foundation audit (robots/sitemap/indexability)`
3. `P0: Add Service schema to validation + coverage reporting`
4. `P1: Add pre-deploy schema QA gate (@id, ISO dates, required fields)`
5. `P1: Add content extractability checks (TLDR/direct answer/FAQ/last-updated)`
6. `P1: Add citation consistency monitor (core directories + NAP drift)`
7. `P2: Add Reddit/LinkedIn/YouTube mention ingestion baseline`

---

## 7) RACI Delivery Plan (Who Does What)

Roles:

- `Product Owner (PO)`: you; priority and acceptance sign-off.
- `AI GEO Engineer (AGE)`: backend/data logic in `AI GEO Audit`.
- `Schema Engineer (SE)`: generation/validation/deploy logic in `Schema Tools`.
- `Content/SEO Lead (CSL)`: content-side adoption and verification.

| Ticket | Responsible | Accountable | Consulted | Informed |
| --- | --- | --- | --- | --- |
| P0: localBusinessSchemaPages scanner | AGE | PO | SE | CSL |
| P0: technical foundation audit (robots/sitemap/indexability) | AGE | PO | CSL | SE |
| P0: Service schema parity in validator/generation | SE | PO | AGE | CSL |
| P1: pre-deploy schema QA gate | SE | PO | AGE | CSL |
| P1: content extractability checks | AGE | PO | CSL | SE |
| P1: citation consistency monitor | AGE | PO | CSL | SE |

### Definition of Done per ticket

1. `P0 localBusinessSchemaPages scanner`
   - Real page counts replace all TODO `0` placeholders.
   - Local signals response includes actual scan count and sampled URLs.
   - Regression test: at least one known LocalBusiness URL is detected.

2. `P0 technical foundation audit`
   - New endpoint returns pass/fail per check: robots, sitemap, indexability.
   - Failures include plain-English remediation advice.
   - Included in global run and stored in audit history.

3. `P0 Service schema parity`
   - `Service` added to validation requirements and report output.
   - Generation path emits Service schema for service templates.
   - CSV/bulk runs report Service coverage and failures.

4. `P1 pre-deploy schema QA gate`
   - Deploy blocked on rule failures (`@id`, ISO dates, required fields).
   - Error output is actionable and file-specific.
   - Known bad fixture fails, known good fixture passes.

5. `P1 content extractability checks`
   - Per-URL checks for TL;DR, direct-answer intro, FAQ block, last-updated.
   - New subscore and recommendation text in API output.
   - Dashboard/API consumers receive normalized pass/fail structure.

6. `P1 citation consistency monitor`
   - Track core citation sources and NAP consistency deltas.
   - Emit “drift detected” tasks with source details.
   - Retain historical snapshots for trend view.

---

## 8) Recommendation: Add a New "Implementation Progress" Tab

Short answer: **yes**, add it.  
This will make delivery transparent and business-readable, even without technical detail.

### Why this tab is high ROI

- Converts engineering work into visible business outcomes.
- Shows what is done, what is blocked, and expected AI visibility benefit.
- Prevents duplicate effort and “invisible progress” problems.

### Proposed tab name and purpose

- **Tab:** `Implementation Progress`
- **Purpose:** track execution status, expected citation impact, and realized movement.

### Core sections (simple, non-technical)

1. **Now / Next / Later board**
   - Columns: `Planned`, `In Progress`, `Done`, `Blocked`.
   - Each ticket card includes owner, ETA, and impact tier.

2. **Benefit view (business language)**
   - Fields: `What changed`, `Why it matters`, `Expected AI impact`, `Confidence`.
   - Example expected impact labels: `High`, `Medium`, `Low`.

3. **Outcome metrics**
   - `Technical blockers fixed` (count)
   - `Schema quality pass rate`
   - `Extractability pass rate`
   - `Citation consistency score`
   - `AI citation visibility trend` (when available)

4. **Outstanding tasks list**
   - Prioritized by `Impact x Effort`.
   - Include dependency flags and blockers.

5. **Change log feed**
   - Date-stamped implementation notes tied to ticket IDs.

### Suggested data model (minimal)

Use a single table for speed to launch:

- `implementation_tasks`
  - `id`, `title`, `priority`, `status`, `owner`, `eta`
  - `expected_benefit`, `expected_impact_level`
  - `acceptance_criteria`, `dependencies`
  - `delivered_at`, `actual_outcome_note`

And one lightweight metrics table:

- `implementation_metrics_daily`
  - `date`
  - `schema_pass_rate`
  - `extractability_pass_rate`
  - `citation_consistency_score`
  - `technical_blockers_open`

### Rollout sequence

1. Ship read-only tab with seeded task data from this document.
2. Wire status updates from ticket completion.
3. Add outcome metrics after P0 tickets land.
4. Add trend lines and “before vs after” snapshots.

---

## 9) Practical Non-Technical View for You

For each ticket, the tab should show:

- `What was implemented`
- `What this improves in AI visibility`
- `How confident we are this moves citations`
- `What is still outstanding`

This makes it clear, at a glance, what is delivering value first.
