# Academy funnel investigation — May 2026

Investigation triggered by the Revenue Funnel dashboard's Academy panel showing:

- **Demand collapse** — trial starts: Jan **68** → Feb **55** → Mar **42** → Apr **28** → May **10** (-85% over 5 months)
- **Conversion collapse** — Jan→May trial-to-paid = **4.4%** vs healthy SaaS benchmark of 10–25%

The user asked the assistant to investigate both problems in parallel using the public entry-point URLs:

- `https://www.alanranger.com/free-online-photography-course`
- `https://www.alanranger.com/academy/login`

This document records what was actually found, the root causes, and the fixes applied.

---

## TL;DR — three real problems, one false lead

| # | Problem | Severity | Fix status |
|---|---|---|---|
| 1 | **GSC sync drops the Academy URLs** — `gsc_page_timeseries` never receives data for `/free-online-photography-course`, `/academy/login`, `/free-photography-course`. Dashboard is blind to ~660 clicks / 47.6K impressions per 28d. | High (measurement) | **Fix applied** — see `api/cron/backfill-money-page-timeseries.js` |
| 2 | **AIO citation gap on Academy queries** — Alan ranks #1–#3 organically for `online photography course`, `free online photography course`, `photography course online` but is cited **0 times** in any AI Overview. AIO sits above organic results and is eating ~40–60% of clicks. | High (demand) | Diagnosis complete; content plan proposed |
| 3 | **Landing-page conversion friction** — duplicate sign-up forms, FUD-first checkout warning, no price/value above the fold, and a dead-end `/academy/trial-expired` page that does nothing to reactivate. | High (conversion) | Revised HTML drafted for all 4 pages — see `Docs/academy-funnel-rewrites/` |

**False lead** (initially raised, corrected by user): in-house email events (`academy_email_events`) start Apr 21 2026, which I first read as "trial reminders weren't firing pre-Apr 21". They were — via Zapier. The Zapier→in-house cutover on Apr 21 explains the table state and was **not** the cause of the conversion collapse.

---

## 1. GSC sync — root cause and fix

### Evidence

`gsc_page_timeseries` rows by week show a clear regression around Jan 19→26 2026:

| Week | URLs tracked | Total impressions |
|---|---:|---:|
| 2026-01-12 | 399 | 12,204 |
| 2026-01-19 | 400 | 7,460 |
| **2026-01-26** | **190** | **1,699** |
| 2026-02-23 | 195 | 2,456 |
| 2026-04-13 | 147 | 1,023 |
| 2026-04-20 | 144 | 168 |

GSC console screenshots (provided by user) show the real numbers are dramatically higher:

- `/free-online-photography-course` — 660 clicks, 47.6K impressions, 1.4% CTR, position 14.3 (last 28d)
- `/academy/login` — 6 clicks, 222 impressions, 2.7% CTR, position 6.7 (last 28d)
- Traditional SEO audit table also shows `/free-online-photography-course` with 394 clicks, 15K impressions, 2.62% CTR

So the dashboard was showing roughly **3–4% of actual GSC traffic** — and zero from the Academy URLs.

### Root cause

`api/cron/backfill-money-page-timeseries.js`:

1. Loads `audit_results.money_pages_metrics.rows` from the latest audit (line 80–82).
2. Calls GSC `searchAnalytics/query` for the property.
3. Filters the GSC response, keeping only rows whose `page` is in the audit's money-pages list (line 121–133).

The latest audit (2026-05-17) contains **225 money pages**, and a SQL check confirmed **none** of the Academy URLs are in that list:

```sql
select (
  select count(*) from jsonb_array_elements(money_pages_metrics->'rows') as r
  where r->>'url' ilike '%free-online-photography-course%'
     or r->>'url' ilike '%academy/login%'
     or r->>'url' ilike '%free-photography-course%'
) as academy_urls_in_list
-- returns: 0
```

So every GSC row for these URLs was silently dropped by the filter, which is why the Jan-26 cliff appears in the table.

### Fix

Added a `STRATEGIC_PAGES` allowlist in `backfill-money-page-timeseries.js`. URLs in this list are unioned into the page-filter set so they are always saved, regardless of whether the audit considers them "money pages".

Initial allowlist (Academy funnel entry points):

```
academy/login
academy/trial-expired
free-online-photography-course
free-photography-course
free-online-photography-academy
online-photography-course
```

To populate history, re-run the backfill:

```
GET /api/cron/backfill-money-page-timeseries?secret=<CRON_SECRET>
```

This will start filling `gsc_page_timeseries` with last-28-day data for the Academy URLs on its next cron tick.

### Follow-up (deferred)

The proper fix is to make `money_pages_metrics` audit selection include strategic pages even when they don't meet the click-volume threshold. Track this under `strategic-pages-config` in a future iteration. For now the hardcoded allowlist is the right tactical fix because it cannot accidentally lose visibility on these critical pages.

---

## 2. AIO citation gap — diagnosis

### Where Alan IS cited in AIO (latest audit)

| Keyword | AIO citations | Alan citations | Page cited |
|---|---:|---:|---|
| alan ranger / alan ranger photography | 13–15 | **6–7** | branded — home, about, workshops |
| photography workshops uk | 15 | 1 | `/photography-workshops` |
| landscape photography workshop(s) | 12–14 | 1–3 | `/landscape-photography-workshops` |
| beginners photography class | 46 | 1 | `/blog-on-photography/10-basic-camera-settings…` |
| camera courses for beginners | 12 | 1 | `/beginners-photography-classes` |
| photo editing course | 23 | 1 | `/photo-editing-course-coventry` |

### Where Alan is NEVER cited

| Keyword | Vol | Alan rank | AIO citations | Alan citations |
|---|---:|---:|---:|---:|
| online photography course | 1,000 | #2 | 22 | **0** |
| free online photography course | 480 | #1 | 12 | **0** |
| photography course online | 480 | #3 | 14 | **0** |
| beginner photography courses | 720 | #14 | 18 | **0** |
| beginners photography course | 720 | #16 | 16 | **0** |
| photography course near me | 2,400 | unranked | 15 | **0** |
| best photography course | 90 | unranked | 18 | **0** |
| Learn Photography Online | 20 | #4 | 17 | **0** |

### Pattern

AIO cites Alan for **service-shaped pages** (workshops, local courses) and **blog answer pages**, but never for the Academy marketing landing pages.

Why: AIO answers an information question. `/free-online-photography-course` describes a product behind a login wall, not how to learn photography. Google has no answerable content to pull from the page.

### Recommended fix (content plan, not a code change)

1. **Pillar article** — `/blog-on-photography/how-to-learn-photography-online-uk-2026` — genuinely answers "how do I learn photography online", structured with H2/H3 step blocks (Step 1: pick a camera; Step 2: master exposure; Step 3: practical assignments…). Ends with a CTA to the trial. This is what AIO can cite.
2. **5 satellite "answer" articles** — most probably already exist in the 190 blog posts:
   - What is ISO in photography (already exists)
   - What is exposure in photography (already exists)
   - Composition rules for beginners (already exists)
   - First 10 things to do with a new camera (already exists — already AIO-cited)
   - Free vs paid online photography courses (new)
   
   Each links *down* to `/free-online-photography-course`.
3. **Add `FAQPage` + `HowTo` schema** on the pillar and satellites. The currently-cited pages have strong entity signals; the academy pages don't.

Expected impact: capturing 1 AIO citation on each of the 4 top Academy queries (combined 2,960/mo volume, currently 0% citation share) is worth roughly 200–400 extra clicks/month at observed AIO click-through patterns.

---

## 3. Landing-page conversion friction — fixes drafted

Read the four pages with Firecrawl. The leaks are consistent across pages.

### Common issues

- **FUD-first checkout warning**: every page leads with the orange "IMPORTANT: Your trial is only activated after you complete the £0 Stripe checkout. If you close or leave the checkout window, your plan will NOT be created…" — reads like a cancellation policy *before* the user has clicked Join. Spook factor. → Move *below* the CTA.
- **Pricing hidden in FAQ accordions**: £79/year is only mentioned in collapsed FAQ blocks. → Show "£79/year. Cancel anytime. No card needed for trial." above the fold.
- **Trial CTA buried among three identical-weight buttons** (Log in / Start 14-Day Free Trial / Annual Membership). → Make trial the visually dominant primary CTA; demote Log in.
- **No social proof above the fold** (only one veteran testimonial deep in the page). → Add 2–3 short testimonials + member count.

### Page-specific issues

| Page | Specific issue |
|---|---|
| `/free-online-photography-course` | TWO sign-up forms. The bottom "Get Access to Free Online Course — Join today" is a Squarespace **newsletter** form, not a trial. Some visitors fill the wrong form and never become trial users. |
| `/free-photography-course` | Near-duplicate of the above. Risks Google splitting click signal between the two. **Action: pick one as canonical, 301 the other.** |
| `/academy/login` | Pure gate page. Three equal buttons. No value summary. No price. |
| `/academy/trial-expired` | **Highest-impact leak.** Dead-end page. Of 8 tracked converters, **5 converted after trial expired** — this page (and its accompanying rewind emails) is where the actual conversion happens, and the page is empty. |

### Pricing policy (clarified by user)

- **Pre-trial pages** (`/free-online-photography-course`, `/free-photography-course`, `/academy/login`): show **£79/year only**. We want full-price sign-ups first.
- **Post-trial only** (`/academy/trial-expired` page + post-expiry rewind emails): **SAVE20 → £59 first year** is the reactivation hook.

This is why the revised `/academy/trial-expired` page in `Docs/academy-funnel-rewrites/01-trial-expired.html` foregrounds the SAVE20 offer, but the trial-start pages do not mention it.

### Deliverables

Revised HTML drafted for all four pages (see `Docs/academy-funnel-rewrites/`):

- `01-trial-expired.html` — full rewrite with SAVE20, value recap, urgency, testimonial
- `02-free-online-photography-course.html` — hero CTA block + newsletter-form fix + repositioned FUD
- `03-free-photography-course.html` — same hero pattern + canonical note
- `04-academy-login.html` — hero strip + dominant trial CTA

These are intended to be pasted into Squarespace **Code Block** sections, replacing the equivalent existing blocks. The site nav, footer and Squarespace chrome stay untouched.

---

## 4. Prioritised action list (post-investigation)

Listed by GP-impact ÷ effort. Numbers 1–3 are the highest-ROI single changes on the site.

1. **Replace `/academy/trial-expired` content** with revised HTML (`01-trial-expired.html`). 1–2 hours.  
   _Why_: 62.5% of converters convert here. Currently the page does nothing to help.
2. **Deploy GSC sync fix** (already applied in code; just commit + push + trigger backfill). 15 min.  
   _Why_: Without it, we cannot measure any of the other changes.
3. **Update `/free-online-photography-course` hero + remove duplicate newsletter form** with revised HTML (`02-free-online-photography-course.html`). 1 hour.  
   _Why_: 660 clicks/28d landing here at 1.4% CTR — biggest top-of-funnel page; biggest leak.
4. **Update `/academy/login`** with revised HTML (`04-academy-login.html`). 30 min.
5. **Decide canonical** between `/free-online-photography-course` and `/free-photography-course`; 301 the loser. 15 min config in Squarespace.
6. **AIO content plan** (pillar + 5 satellites, schema). 1–2 weeks.

Items 1, 2, 3, 4, 5 are all <2 hours each. Do these before any further analytics work.

---

## 5. Evidence & references

### SQL queries used (for re-verification)

```sql
-- monthly trial starts
select to_char(trial_start_at, 'YYYY-MM') as month,
       count(distinct member_id) as unique_trials,
       count(distinct case when converted_at is not null then member_id end) as converted
from public.academy_trial_history
where trial_start_at >= '2025-09-01'
group by 1 order by 1;

-- GSC sync regression
select date_trunc('week', date)::date as week,
       count(distinct page_url) as urls,
       sum(clicks) as clicks,
       sum(impressions) as imps
from public.gsc_page_timeseries
where date >= '2025-12-01'
group by 1 order by 1 desc;

-- money pages count + academy URLs check (proves the filter bug)
select jsonb_array_length(coalesce(money_pages_metrics->'rows','[]'::jsonb)) as money_pages_count,
       (select count(*) from jsonb_array_elements(money_pages_metrics->'rows') as r
        where r->>'url' ilike '%free-online-photography-course%'
           or r->>'url' ilike '%academy/login%') as academy_urls_in_list
from public.audit_results
where property_url = 'https://www.alanranger.com'
order by audit_date desc limit 1;

-- AIO citation gap
select keyword, search_volume, best_rank_group,
       ai_total_citations, ai_alan_citations_count
from public.keyword_rankings
where audit_date = (select max(audit_date) from public.keyword_rankings)
  and keyword in ('online photography course','free online photography course',
                  'photography course online','beginner photography courses');
```

### Files touched

- `api/cron/backfill-money-page-timeseries.js` — added strategic-pages allowlist
- `Docs/ACADEMY_FUNNEL_INVESTIGATION_2026-05.md` — this file
- `Docs/academy-funnel-rewrites/00-README.md`
- `Docs/academy-funnel-rewrites/01-trial-expired.html`
- `Docs/academy-funnel-rewrites/02-free-online-photography-course.html`
- `Docs/academy-funnel-rewrites/03-free-photography-course.html`
- `Docs/academy-funnel-rewrites/04-academy-login.html`
- `Docs/CHANGELOG.md` — entry for 2026-05-19
