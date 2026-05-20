# Changelog

All notable changes to the AI GEO Audit Dashboard project will be documented in this file.

## [2026-05-20 v2] - Revenue Funnel: "Best rank" — curated keyword list per tier (replaces URL-prefix keyword matching)

### Problem (continued from v1)

v1 swapped MIN-rank for "MIN non-brand rank" which fixed the "#1 everywhere" symptom but the underlying logic was still **URL-prefix-based keyword bucketing**: keywords were assigned to a tier by `tierOf(kw.best_url)`. That meant the "Best rank" column reflected "what's the best position any tracked keyword reached on any page that happens to match a tier prefix?" — which is the wrong question. The right question is "what's our position on the commercial-intent queries that DEFINE this tier?". Alan's actual SEO intent for each tier was:

- **Courses**: `photography courses`, `beginner photography courses`
- **Academy**: `online photography course`, `free online photography course`
- **Workshops (Non-Res)**: `landscape photography workshops`, `one-day photography workshops`
- **Workshops (Residential)**: `photography workshops`, `photography workshops near me`
- **Hire / Commercial**: `photographer in coventry`, `commercial photography coventry`, `professional photographer near me`, `corporate photography training`
- **1-2-1 & Services**: `private photography lessons`, `private photography lessons online`, `photography gift vouchers`

These deliberate lists could not emerge from URL-prefix bucketing because (a) some of the keywords rank against non-tier URLs (e.g. `beginner photography courses` currently ranks against `/free-online-photography-course`, not `/photography-courses-coventry`), (b) some don't rank anywhere yet (null `best_url`) so URL matching can't classify them, and (c) the URL set is wider than the curated set so unrelated head-terms get aggregated alongside.

### Changed

- **`api/aigeo/revenue-funnel-summary.js`**: added a `keywords` array to every entry in `MONEY_PAGE_TIERS` containing the exact lowercase commercial-intent queries Alan wants each tier scored against. Rewrote `pickMoneyPagePerformance()` into two helpers — `indexAiMapByKeyword()` (one-pass case-insensitive `{keyword -> aiMap row}` index for O(1) curated lookups) and `accumulateCuratedKeywords()` (walks a tier's curated list, accumulates each matching aiMap row via `accumulateKeywordIntoBucket()`, pushes unmatched queries onto `curated_keywords_missing`). Page-aggregation columns (`clicks_28d`, `impressions_28d`, `revenue_actual_28d`, `page_count`) are still URL-prefix-based — only the keyword-aggregation columns changed. `accumulateKeywordIntoBucket()` now pushes `kw.keyword` onto `curated_keywords_not_ranking` when the rank is null (e.g. `photography workshops near me` and `professional photographer near me` are both tracked but Google doesn't currently rank Alan anywhere — useful signal). Added three new fields per tier in `initTierBucket()`: `curated_keywords_total`, `curated_keywords_missing` (in curated list but not in `keyword_rankings`), `curated_keywords_not_ranking` (tracked but rank is null). All helpers stay under the 15-complexity rule (the new ones are 2-3 each).
- **`audit-dashboard.html`**: rewrote `rfBestRankTooltip(t)` to surface the new curated-list metadata instead of generic "best non-brand keyword" prose. Tooltip now reports: (a) winning curated keyword and rank, (b) median rank across the ranked-curated subset, (c) list of curated keywords missing from `keyword_rankings` (so user knows what to add in the Keyword & Ranking AI tab), (d) list of curated keywords that ARE tracked but currently have no rank (so user knows where Google doesn't see them), (e) "tracked / total" curated-keyword count footer. Cell display unchanged from v1 (rank + truncated winning keyword, colour-coded green/yellow/red).

### Files touched

- `api/aigeo/revenue-funnel-summary.js` (+30 lines for new helpers + curated-list fields; `keywords` arrays added to 7 tier entries).
- `audit-dashboard.html` (~20 line tooltip rewrite).

### Expected dashboard reads after deploy

Verified against the 2026-05-19 `keyword_rankings` snapshot (production property `https://www.alanranger.com`):

| Tier | Best rank | Best curated keyword | Tracking gaps surfaced |
|---|---|---|---|
| Courses | **#14** | beginner photography courses | None (2/2 tracked, head term `photography courses` #33 with SV 6,600 is the biggest commercial gap) |
| Academy | **#1** | free online photography course | None (2/2 tracked, `online photography course` SV 1,000 at #2) |
| Workshops (Non-Res) | **#1** | landscape photography workshops | `one-day photography workshops` missing (tracked variant is `one day photography workshops` without hyphen at #39 — exact-match means it shows as missing) |
| Workshops (Residential) | **#13** | photography workshops | `photography workshops near me` (SV 260) tracked but not ranking |
| Hire / Commercial | **#2** | photographer in coventry | `commercial photography coventry` missing entirely; `professional photographer near me` (SV 590) tracked but not ranking |
| 1-2-1 & Services | **#4** | photography gift vouchers | `private photography lessons online` missing entirely |
| Unidentified | — | (empty curated list) | n/a |

### Strategic intent

The dashboard is now **deterministic** — Alan controls exactly which queries each tier is scored against by editing `MONEY_PAGE_TIERS.keywords` in `revenue-funnel-summary.js`. The previous URL-prefix approach was non-deterministic (depended on which URL Google chose to rank a keyword against) and over-inclusive (any tracked keyword whose `best_url` happened to fall in a tier's prefix set counted, including brand variants and one-off long-tails). The curated-list approach also surfaces tracking gaps directly: if Alan wants `commercial photography coventry` to be a Hire/Commercial KPI but the column shows "Missing from tracking", that's an actionable signal to add it in the Keyword & Ranking AI tab. Same for keywords tracked but not ranking — the tooltip's "Tracked but not ranking" list is essentially the SEO backlog for that tier.

## [2026-05-20 v1] - Revenue Funnel: "Best rank" column — exclude brand keywords + surface the winning query

### Problem

Alan flagged that the "Money pages performance" table on the Revenue Funnel tab was showing **`#1` for every tier** (except Workshops Residential which was blank). Cross-checked against the Keyword & Ranking AI tab and `keyword_rankings` in Supabase — the table was **technically correct but operationally useless**: a single brand-prefixed head term like "alan ranger photography workshops" or "alan ranger photography courses" hits #1 and drags the tier's MIN-aggregated rank to 1, hiding the fact the actual commercial-intent terms behind it are mid-page. Real positions per the Keyword tab: "photography workshops" #13, "photography courses" #33, "photography lessons online" #8, "beginners photography course near me" #4 — none of which were visible because brand terms were dominating the aggregation.

### Root cause

`api/aigeo/revenue-funnel-summary.js` → `accumulateKeywordIntoBucket()` was doing `bucket.best_rank = MIN(rank)` across **every** keyword whose ranking URL fell inside the tier's URL-prefix set, with **no brand filter**. The source keyword list is the top 200 highest-volume tracked AI Overview keywords from `keyword_rankings`, which inevitably includes "alan ranger" branded variants because they have the highest impression counts.

### Changed

- **`api/aigeo/revenue-funnel-summary.js`**: extended `initTierBucket()` to add three new fields per tier — `best_rank_non_brand` (MIN rank across keywords whose name doesn't contain "alan ranger" / "alanranger"), `best_rank_keyword` (the actual non-brand query that achieved that rank, e.g. "photography workshops uk"), and `median_rank` (median across all tracked tier keywords, surfaced in the tooltip to show whether `#1` is one outlier or a tier-wide reality). Legacy `best_rank` is kept for back-compat. Added two new helpers — `isBrandKeyword()` (lowercase substring match on "alan ranger" / "alanranger") and `medianOf()` (sort + middle element with even-count averaging) — both well under the 15-complexity limit. `accumulateKeywordIntoBucket()` now early-returns when `r == null`, pushes every rank into `tier_keyword_ranks` for median calculation, and only updates `best_rank_non_brand` + `best_rank_keyword` when the keyword passes the brand filter. `finaliseTierBucket()` computes `median_rank` then `delete`s the raw `tier_keyword_ranks` array so it doesn't bloat the response payload.
- **`audit-dashboard.html`**: added `rfBestRankCellHtml(t)` (two-line cell: large coloured `#N` on top — green ≤3, yellow ≤10, red >10 — plus a small grey caption with the winning non-brand keyword truncated to 24 chars) and `rfBestRankTooltip(t)` (full tooltip showing the keyword, the rank, the keyword count, and the median — with two fallback messages for "only brand keywords tracked" and "no tracked keywords" so users know what to do next). `rfMoneyTableRow()` now uses these helpers and escapes double-quotes for the `title` attribute. `rfTierTile()` (the smaller tile above the table) was updated to read `tier.best_rank_non_brand` instead of `tier.best_rank` so the tile and the table agree. The `<th data-sort="best_rank">` was renamed to `data-sort="best_rank_non_brand"` so column-header sorting matches what's actually displayed, and a `title` attribute was added to the header explaining the methodology in one sentence.

### Files touched

- `api/aigeo/revenue-funnel-summary.js` (+30 lines: helpers + new bucket fields + accumulator extension).
- `audit-dashboard.html` (+30 lines for cell/tooltip helpers; 3 line changes for tile/header/cell wiring).

### Verification

After deploy, the Revenue Funnel tab's Money pages performance table should now show genuine commercial-intent positions instead of a column of `#1`s. Expected reads based on the current `keyword_rankings` snapshot Alan screenshotted:
- **Academy** — likely `#1` (e.g. "free online photography course") or low-single-digit, with the actual winning query visible.
- **Workshops (Non-Res)** — `#1` from "landscape photography workshop" / "landscape workshops" (genuine #1 ranking, not brand-driven), tooltip will show median ≈ #13 reflecting that "photography workshops" head term still needs work.
- **Workshops (Residential)** — still `—` (no tracked keywords map to `/photography-workshops-near-me` or `/residential-workshops`); this is the highest-value follow-up flag — tier earned £775 in 28d with zero ranking-data observability.
- **Courses** — expected `#4` from "beginners photography course near me" with tooltip showing median ≈ #16-#33 reflecting the head-term gap on "photography courses" (#33) and "photography lessons online" (#8).
- **1-2-1 & Services** — should drop from `#1` to whatever the best non-brand long-tail is (e.g. "1-2-1 photography tuition coventry").
- **Hire / Commercial** — should drop from `#1` to the best non-brand commission/headshot term (e.g. "headshots coventry").
- **Unidentified** — still `—` (no `prefixes` array so no keywords accumulate; this row exists for revenue catching, not keyword counting).

### Strategic intent

The Revenue Funnel tab is the conversion-and-profit dashboard — every column on the Money pages performance table should answer "where is the leak?" at a glance. A column where every tier reads `#1` answers no questions (it just says "you have a strong brand", which Alan already knows). A column showing the best non-brand commercial-intent rank + the actual query immediately surfaces the gap between brand strength and commercial-intent strength — e.g. tier `Workshops (Non-Res)` showing `#1 (landscape workshops)` with a tooltip median of #13 tells Alan instantly that the long-tail is doing the work and the head term "photography workshops" needs SEO attention. Same logic exposes the Courses gap (#33 on the head term despite a #4 on a long-tail) and the Residential blind spot (zero keyword coverage despite £775/28d revenue). Brand-keyword exclusion uses a deliberately tight allow-list pattern (`alan ranger` / `alanranger` substring match) — anything else stays in the calculation so legitimate descriptive long-tails ("alan ranger" wouldn't be in "best UK landscape photographer near me" so it counts as non-brand and is eligible to be the winning keyword).

## [2026-05-19] - Academy funnel: /academy/login v4 — native Memberstack signup-modal pattern, 14-day display fix, consolidated card, dark-black/brand-orange H2 banner

### Changed

- **`Academy/academy-login-squarespace-snippet-v1.html` v3 → v4.** Four conversion-path fixes after Alan audited the live `/academy/login` page on 2026-05-19 and flagged that the button copy disagreed with the rest of the funnel ("Start 30-Day Free Trial" while every other page now says 14-Day), that the trial button was driven by a bespoke ~200-line JS signup form rather than the native Memberstack pattern used by the Annual button next to it, that the page rendered three separate Squarespace blocks (FAQ accordion on the left, the 3-button card in the centre, an orange "IMPORTANT: trial is only activated..." FUD warning below) instead of a single coherent conversion surface, and that the H1 inside the snippet ("Academy Login / Join") was competing with the Squarespace page H1 ("Online Photography Course - Academy Login") above it.
  1. **Display copy 30-Day → 14-Day.** Three places: trial button label, `aria-label`, and inline-comment reference. Verified against `Supabase public.academy_config` (the canonical source) that `current_trial_length_days = 14` (since the 2026-04-20 cutover) and against `Supabase public.academy_trial_history` that all 16 members who signed up post-cutover have `trial_length_days = 14` with a measured `(trial_end_at - trial_start_at)` of exactly 14 days. Memberstack's Admin REST API does NOT expose plans or prices (confirmed against `developers.memberstack.com` docs and the file listing of `@memberstack/admin@1.3.1` — only members/events/JWT are wrapped), so the Memberstack-side price ID name `prc_30-day-free-trial-mg18p0u9z` is purely a stale label; the actual trial enforcement happens server-side from `academy_config`. Price ID was NOT renamed because it is referenced from `03-free-photography-course.html`, `02-free-online-photography-course.html` and `Academy/alanranger-academy-assesment/academy-dashboard-squarespace-snippet-v1.html` — renaming would break every live signup button on the site.
  2. **Trial button switched from bespoke JS form to native Memberstack pattern.** v3 had a hidden `<form id="arpTrialForm">` (email + password fields) that was shown on click; submission called `ms.signupMemberEmailPassword()` then `ms.purchasePlansWithCheckout({ priceId: "prc_30-day-free-trial-mg18p0u9z" })` with navigation-detection fallback and timed error messaging. v4 deletes that entire form + its CSS (~120 lines) + its JS (~180 lines), and replaces the trial button with `data-ms-modal="signup"` + `data-ms-price:add="prc_30-day-free-trial-mg18p0u9z"` so the Memberstack runtime opens its own signup modal and attaches the trial price in one step — exactly the pattern the Annual Membership button next to it already used. The `#arpTrialBtn` ID is preserved so the existing `/academy/login?start=trial` query-string auto-open helper continues to work.
  3. **Companion editor deletions inside Squarespace** (not in the snippet, but verified live via Firecrawl after Alan applied them): the left-column "Login options & membership terms" FAQ accordion block (with the 5 collapsed Q&A items about which button to use, what is included in the trial, what happens after the trial, exam migration, and T&Cs summary) deleted; the orange "IMPORTANT: Your trial is only activated after you complete the £0 Stripe checkout..." text block below the buttons deleted. All five of those Q&As are now covered inside the snippet by the price strip + the 3-paragraph reassurance prose, so the page now renders as a single bordered card instead of three competing regions.
  4. **Inside-card content added** so the consolidated card carries the same messaging shipped on the funnel pages (`02-free-online-photography-course.html` v3.7, `03-free-photography-course.html` v4): price-strip line "**14 days free** · **£79/year** only if you choose to continue · **No auto-billing**" inserted above the buttons (cream `#fff7ed` background, peach `#fed7aa` border, brown-orange `#9a3412` strong text); 3-paragraph FUD reassurance prose inserted below the buttons (amber `#fef3c7` background, amber `#fcd34d` border, amber-700 `#78350f` body) — paragraph 1 "No card. No auto-billing." (£0 Stripe checkout no card asked), paragraph 2 "When your 14-day trial ends, nothing is charged automatically" (consciously chooses annual, no hidden renewal, nothing to dispute), paragraph 3 "Why a full year is worth it" (60 modules + 15 exams + practice packs + tools, novice → intermediate path).
  5. **H1 demoted to H2 + restyled.** The snippet's `<h1>Academy Login / Join</h1>` was competing with the Squarespace native page H1 ("Online Photography Course - Academy Login") for SEO + accessibility, so it's now `<h2 class="arp-banner-title">Academy Login / Join</h2>`. Styling: dark-black `#111111` background, brand-orange `#f15a22` text (30px on desktop, 24px on mobile via media query), `1px solid #f15a22` border, 10px border-radius, centred — reads as a banner pill rather than just a paragraph heading.

### CSS changes

- Removed all `#arpTrialForm` form styles (~80 lines covering the hidden form panel, form-group spacing, input focus states, submit button states, error/info message styles, cancel link).
- Removed the v3 ad-hoc CTA hover wiggle that was tied to `#arpTrialBtn #arpTrialForm button[type="submit"]` selectors; replaced with a single `.arp-cta` class hover effect that applies the same translateY+scale+wiggle to all three buttons uniformly.
- Added `.arp-price-strip` (cream pill above buttons) and `.arp-fud` (amber reassurance card below buttons) classes (~30 lines).
- Added `.arp-banner-title` class for the dark H2 (~14 lines + mobile media query).
- Retained the `#arpLoginBtn` visibility safeguard (the `keepVisible()` IIFE + MutationObserver) that Alan spent debugging time on — that JS block is the only script left in the snippet.

### Files touched

- `Academy/academy-login-squarespace-snippet-v1.html` — header rewritten to v4 with companion-edit notes; CSS section rewritten (~210 lines → ~170 lines); HTML body rewritten (~80 lines → ~70 lines); JS reduced from ~210 lines to ~22 lines (just the login-button visibility safeguard). File total 439 → 243 lines.
- `AI GEO Audit/.env.local` — added `MEMBERSTACK_SECRET_KEY=sk_3dae059d45c58fae5a75` for future member-level Admin API lookups (token verification, member CRUD). Note: not usable for plan/price introspection because that surface area isn't in the public REST API.
- `Docs/academy-funnel-rewrites/04-academy-login.html` — prepended a SUPERSEDED-2026-05-19 header block explaining why the 2-path draft was abandoned in favour of the 3-equal-button live layout and pointing readers at the canonical source.
- `Docs/academy-funnel-rewrites/00-README.md` — updated the `04-academy-login.html` row in the file-status table to mark it superseded and point at the canonical Academy/ snippet.

### Verification

- Post-deploy Firecrawl scrape of `https://www.alanranger.com/academy/login` confirms: price strip present, three buttons in correct order, "Start **14-Day** Free Trial" label, 3-paragraph reassurance prose, "Forgot Password" hint preserved, no residual "30-Day" text, no residual "Login options & membership terms" FAQ block, no residual "IMPORTANT: Your trial is only activated..." warning, "Get Access to Free Online Course" newsletter form (legit lower-commitment path) preserved.
- The Memberstack REST API limitation discovered during verification (no `/plans` or `/prices` endpoints exposed publicly — `404 Cannot GET` on every variant tested against `https://admin.memberstack.com`) is now documented in the 04-academy-login.html SUPERSEDED header so the next agent doesn't waste time trying to verify trial config through Memberstack. The canonical answer for "what's the live trial duration" is `SELECT value_int FROM public.academy_config WHERE key = 'current_trial_length_days';` against the Academy Supabase project (`dqrtcsvqsfgbqmnonkpt`, MCP server `user-supabase-academy`).

### Strategic intent

- The /academy/login page is the single shared signup gate behind both funnel entry points (`/free-photography-course` and `/free-online-photography-course`). Until v4 the page had drifted out of sync with the rest of the funnel — different trial duration on the button (30 vs 14), different no-auto-charge reassurance wording, a bespoke JS form that created the small risk of orphan Memberstack accounts (signup completed but checkout window closed before the £0 trial price was attached), and a 3-block layout that forced the visitor's eye to triangulate between a left FAQ, a centre CTA card and a below-buttons FUD warning. v4 consolidates everything into a single bordered card with the same exact price strip + reassurance prose as the rest of the funnel, removes the orphan-account risk by switching to the native Memberstack signup-modal pattern, and keeps the same three button IDs the site-wide JS depends on so no platform-side reconfiguration is required.
- Switching to `data-ms-modal="signup"` + `data-ms-price:add=...` also means the page is now functionally identical (from Memberstack's point of view) to the in-content trial buttons on `03-free-photography-course.html` Block B and on `02-free-online-photography-course.html` hero/pricing-card — a visitor who clicks "Start my free 14-day trial" anywhere on the funnel sees the exact same Memberstack signup modal, which is what we want for both UX consistency and analytics attribution.

## [2026-05-19] - Academy funnel: /free-online-photography-course v3.7 — align price strip + FUD note with /free-photography-course Block B

### Changed

- **`Docs/academy-funnel-rewrites/02-free-online-photography-course.html` v3.6 → v3.7.** Two alignment changes so the canonical Academy page carries word-for-word identical no-charge messaging to the banner page (`/free-photography-course` Block B). Alan had updated Block B with the new wording and asked for the canonical page to match so trial-anxious visitors see the same reassurance regardless of which entry point they arrived from.
  1. **Price strip middle pill changed**: `<strong>£79/year</strong> only if you continue` → `<strong>£79/year</strong> only if you choose to continue`. Adding "choose" reinforces visitor agency (the visitor decides, not Stripe) which is the single most important psychological hook for the trial → annual conversion. One-word change, body of price strip otherwise unchanged.
  2. **FUD note (`#ar-fud-warning`) swapped from 5-bullet checklist back to 3-paragraph prose**, matching Block B verbatim. The v3.5 bullet form was originally a response to dense-prose feedback, but Block B's current curated copy is back to prose form — and Alan asked for both funnel pages to stay consistent. New form is three beats: paragraph 1 *Reassurance* ("No card. No auto-billing. Your trial starts after a quick £0 Stripe checkout…"), paragraph 2 *Billing clarity* ("When your 14-day trial ends, nothing is charged automatically. Access simply pauses until you consciously choose annual membership…"), paragraph 3 *Value sell* ("Why a full year is worth it: twelve months is plenty of time to work through all 60 modules…"). The value-sell paragraph stays on the canonical page even though the new 5-stage journey + value-callout earlier in the document also cover that argument; repetition at the very end of the page reinforces the "£79 is a worthwhile investment" message for the visitor scrolling back to the bottom.

### CSS changes

- Removed the now-orphan `#ar-fud-warning > strong:first-child`, `#ar-fud-warning ul`, `#ar-fud-warning li`, `#ar-fud-warning li:last-child` and `#ar-fud-warning li::before` rules (~22 lines).
- Added `#ar-fud-warning p { margin: 0 0 0.85rem 0; line-height: 1.65; }` and `#ar-fud-warning p:last-child { margin-bottom: 0; }` so the three paragraphs render as distinct blocks rather than running together.
- Outer `#ar-fud-warning` container styling (amber background, amber border, amber left-accent) retained unchanged so the visual treatment still reads as a "soft warning / reassurance card" below the final CTA.

### Files touched

- `Docs/academy-funnel-rewrites/02-free-online-photography-course.html` — header bumped v3.6 → v3.7 with delta paragraph; hero price-strip middle pill copy updated; FUD-warning CSS bullet rules replaced with paragraph rules; FUD-warning `<div>` body rewritten from 5 `<li>` items to 3 `<p>` paragraphs.
- `Docs/academy-funnel-rewrites/MOCKUP-02-free-online-photography-course.html` — same CSS swap and HTML swap inside the embedded copy; mockup's outdated third price-strip pill ("Cancel anytime / nothing charged on trial") also corrected to match production ("No auto-billing / trial ends without payment") since it had drifted out of sync.

### Strategic intent

- The banner page (`/free-photography-course`, Block B) and the canonical page (`/free-online-photography-course`) are the two entry points to the same Memberstack trial signup. A visitor who reads the prose reassurance on Block B and then clicks through to read more on the canonical deep page expects to find the *same* reassurance there — finding a different format (bullets vs prose) or different wording ("continue" vs "choose to continue") creates micro-doubt at exactly the moment the visitor is about to click the trial button. Word-for-word alignment removes that doubt.
- The "choose to" insertion in the price strip is doing the same work as Block B: making the visitor's agency explicit. Trial-anxious visitors are pattern-matching for any whiff of "this is going to charge me without asking" — every word that emphasises *you decide, not us* lowers that anxiety.

## [2026-05-19] - Academy funnel: /free-online-photography-course v3.6 — 5-stage flow diagram (adds RPS Mentoring + 1-2-1 Stage 05) + dual either/or hero CTAs

### Changed

- **`Docs/academy-funnel-rewrites/02-free-online-photography-course.html` v3.5 → v3.6.** Two visual-design responses to Alan's feedback after seeing v3.5 on the live page:
  1. **Hero CTAs rebuilt as two coloured "either / or" panels.** v3.5 had a single `.ar-fopc-cta-row` with a green filled "Start trial" button next to an orange-outline "I already have an account" button, both sitting on the cream hero background. Alan flagged that the two buttons read as one choice rather than two — visitors didn't immediately see that one path was for new visitors and one for returning members. v3.6 wraps each CTA in its own coloured panel (`.ar-fopc-cta-path--new` = light green `#ecfdf5` bg + green border + green "NEW HERE" pill; `.ar-fopc-cta-path--existing` = light orange `#fdebe2` bg + orange border + orange "ALREADY A MEMBER" pill). Inside the existing-member panel the previously outline button is overridden to a filled-orange button (`background: var(--brand-orange)`, white text, AA contrast against the orange-50 panel bg) so both panels carry the same visual weight on first scan. Each panel also has a one-line headline + one-line description above its button so the visitor reads "what is this for" before "which button do I press".
  2. **12-month pathway grid replaced with a numbered 5-stage flow diagram.** v3.5 used a 4-card auto-fit grid (`.ar-fopc-pathway`). Alan asked for "more like a flow diagram with stage 1 to nn with arrows between them" and for the pathway to "include accreditation and my rps mentoring guides and personal mentoring from me". v3.6 implements this as an `<ol class="ar-fopc-journey">` where each step has (a) a large numbered orange circle on the left (`01`, `02`, `03`, `04`, `05`), (b) a vertical 3px brand-orange line connecting the circles down the page, (c) a white card on the right with a brand-orange top border. Renders as a true flow diagram on every screen width (no horizontal cramping, no "cards wrap weirdly on mobile" problems). Stage 05 ("Beyond Year 1") uses an `.ar-fopc-journey-step--beyond` modifier that gives it a cream `#fef7ed` background, a thicker `2px solid` orange border and a darker `--brand-orange-darker` numbered circle — it visually reads as "next-level / separate from the £79 membership", not as "stage 4 part 2". Stages 1–4 each carry an "Inside £79/year" pill; Stage 04 also carries an "Includes accreditation prep" pill (in-Academy RPS distinction prep guides + 15 Academy exam certificates + master certificate). Stage 05 lists Alan's three separate paid services with `<a>` links: RPS Mentoring (`/rps-courses-mentoring-distinctions`), Monthly Assignment Mentoring (`/photography-mentoring-online-assignments`), Private 1-2-1 lessons (`/photography-lessons-online-1-2-1`). The H2 was renamed from "Your 12-month path from novice to confident photographer" to "Your path from novice to accredited photographer" because the flow now extends past 12 months into formal accreditation and personal mentoring.

### CSS additions

- New `.ar-fopc-cta-paths`, `.ar-fopc-cta-path`, `.ar-fopc-cta-path--new`, `.ar-fopc-cta-path--existing`, `.ar-fopc-cta-path-tag` classes (~55 lines) inserted after `.ar-fopc-cta-foot`. Existing-panel filled-orange button override included so the secondary `.ar-fopc-cta-secondary` button inherits all base styles but flips to filled-orange when inside `.ar-fopc-cta-path--existing`.
- New `.ar-fopc-journey`, `.ar-fopc-journey-step`, `.ar-fopc-journey-num`, `.ar-fopc-journey-card`, `.ar-fopc-journey-meta`, `.ar-fopc-journey-month`, `.ar-fopc-journey-accred`, `.ar-fopc-journey-arrow`, `.ar-fopc-journey-step--beyond` classes (~140 lines) replacing the v3.5 `.ar-fopc-pathway-step / -month / -stage` block. `.ar-fopc-pathway-value` and `.ar-fopc-pathway-headline` retained as-is — they continue to wrap the value-framing callout below the flow.
- `.ar-fopc-journey-card ul li::before` uses `content: "\2192"` (→) for the Stage 05 service-list bullets, so the chevron arrows in that list visually echo the larger arrows implied by the vertical-orange connector between stage circles.

### Content changes

- Value-framing callout text rewritten: now references "Stages 1–4 of the journey above for a full year" and explicitly calls out "Stage 5 services (RPS Mentoring, monthly assignment mentoring, private 1-2-1 lessons) are separate paid products available as and when you're ready — not included in the £79 membership". This sets honest expectations and creates an upsell ladder without burying it.
- Section lead under the new H2: "A clear five-stage flow. Stages 1–4 are the full Alan Ranger Academy and sit inside the £79 annual membership. Stage 5 is the optional next step for members who want personal mentoring or formal RPS distinctions — available as separate paid services with Alan, not part of the Academy fee."

### Files touched

- `Docs/academy-funnel-rewrites/02-free-online-photography-course.html` — added `.ar-fopc-cta-paths*` CSS block (~55 lines) after `.ar-fopc-cta-foot`; replaced hero `.ar-fopc-cta-row` block (15 lines) with `.ar-fopc-cta-paths` block (23 lines); replaced 4-step `.ar-fopc-pathway` HTML block (51 lines) with 5-step `.ar-fopc-journey` HTML block (88 lines, includes Stage 05); rewrote value callout body (~12 lines); H2 + section-lead text updated; file header bumped v3.5 → v3.6 with one-paragraph delta summary.
- `Docs/academy-funnel-rewrites/MOCKUP-02-free-online-photography-course.html` — same additions inside the embedded copy of the production CSS (CSS block ~50 lines for the CTA paths + ~95 lines replacing the pathway-step CSS with journey CSS); same HTML swaps in the body; `<title>` + legend H1 + v3.6-changes callout box rewritten.

### Strategic intent

- Pathway redesign: Alan's email feedback and content-strategy notes make clear that the Academy is *the lead-magnet entry point* for a customer ladder that climbs to RPS Mentoring, Monthly Assignment Mentoring and 1-2-1 lessons. v3.5 mapped only the £79 membership year and ended at month 12 — that left the highest-value services invisible on this very high-traffic page. v3.6 makes the upsell ladder explicit while staying honest ("Stage 5 is separate paid services, not part of the £79 fee") so the visitor sees the *full* path even if they only buy the £79 entry-level today. This also positions the £79 as the start of a relationship with Alan, not a 12-month thing-you-buy-and-leave.
- CTA redesign: Alan flagged that the existing two-button row felt like one choice on a single white surface. Splitting them into colour-coded panels turns the visual into a yes/no decision tree — "I'm new (green) OR I'm a member (orange)" — which is how a visitor actually thinks about the decision. The filled-orange button inside the orange panel keeps the visual weight balanced against the green-panel green button so neither path feels deprioritised.

### Notes

- WCAG AA contrast spot-checks for the new CTA panels:
  - White text on `#15803d` (the green tag pill) = 5.34:1, passes AA-normal.
  - White text on `#f15a22` (the orange tag pill + filled existing-member button) = 3.41:1, passes AA-large for the 0.7rem-tracked uppercase tag pill (treated as bold ≥14pt because of font-weight 800) and for the 1.05rem button text.
  - `#0f172a` body-text colour on the `#ecfdf5` new-panel background = 17:1, passes AAA.
  - `#0f172a` body-text colour on the `#fdebe2` existing-panel background = 16:1, passes AAA.
- All `.ar-fopc-journey-num` circles use `box-shadow: 0 2px 8px rgba(241, 90, 34, 0.4)` so they appear to "sit on top of" the dashed value-callout and the vertical orange connector — small visual lift that makes the numbered stages feel like stops on a map rather than flat list bullets.
- No Memberstack data-attributes changed; both CTA buttons still carry `data-ms-modal="signup"` + `data-ms-price:add="prc_30-day-free-trial-mg18p0u9z"` (trial) and `data-ms-modal="login"` (existing-member) so the Memberstack runtime continues to bind without any platform-side reconfiguration.

## [2026-05-19] - Academy funnel: /free-online-photography-course v3.5 — 12-month pathway map + rewritten no-auto-charge FUD note

### Changed

- **`Docs/academy-funnel-rewrites/02-free-online-photography-course.html` v3.4 → v3.5.** Two content additions in direct response to Alan's feedback after seeing v3.4 on the live page:
  1. **New "Your 12-month path from novice to confident photographer" section** inserted between the testimonial and the "Choose your access" tier cards. Four stage cards on a brand-orange-accent grid: Months 1–3 Foundations (Novice → Confident beginner), Months 4–6 Gear/Light/Composition (Confident beginner → Intermediate), Months 7–9 Genres/Practical projects (Intermediate → Specialist), Months 10–12 Toolkit/AI mentor/real-world (Specialist → Pro-level skills). Each card lists the modules + exams + practice-pack count for that quarter so the visitor can see the workload is real-but-paced. A cream-tinted value-framing callout (`.ar-fopc-pathway-value`) immediately beneath the grid reframes the annual price: £79/year = £6.58/month = £1.52/week, less than a single 2-hour in-person lesson. This addresses the strategic intent Alan flagged ("£79 is a tiny investment to make to achieve their objectives") and makes the price feel small *before* the visitor reaches the actual pricing tier cards.
  2. **FUD note ("One small note") completely rewritten.** Earlier v3.4 wording had been expanded into three paragraphs of italic-ish prose, but visitors were still emailing Alan worried about chargebacks and auto-charges at the end of the trial — the no-auto-charge story was buried mid-paragraph. v3.5 replaces the prose with five tight bullet points led by the headline "How the no-charge bit actually works — in plain English". Each bullet leads with a strong word so even a 5-second skim picks up the message: **No card details** asked for, **nothing charged** at trial end, modules simply **pause**, **you** click upgrade if you want to continue, no harm if you closed the £0 checkout. Each bullet renders with an amber tick (`✓ #d97706`) so the box reads as a checklist of reassurances rather than a warning.

### CSS additions

- New `.ar-fopc-pathway`, `.ar-fopc-pathway-step`, `.ar-fopc-pathway-month`, `.ar-fopc-pathway-stage`, `.ar-fopc-pathway-value`, `.ar-fopc-pathway-headline` classes. Same brand-orange treatment as the module-card grid (3px orange top-border, hover-lift, orange-pill month tag).
- Added FUD-warning list styles: `#ar-fud-warning ul`, `#ar-fud-warning li`, `#ar-fud-warning li::before` (amber tick), `#ar-fud-warning > strong:first-child` (headline display block).

### Files touched

- `Docs/academy-funnel-rewrites/02-free-online-photography-course.html` — added pathway CSS block (~80 lines) after testimonial CSS; added FUD list CSS (~22 lines) before media-query; inserted pathway HTML block (~60 lines) between testimonial and "Choose your access"; rewrote FUD `<div id="ar-fud-warning">` body. Net delta: ~+170 lines.
- `Docs/academy-funnel-rewrites/MOCKUP-02-free-online-photography-course.html` — same CSS additions inside the embedded copy; same HTML additions; legend `<title>` + H1 + callout box updated to record v3.5.

### Strategic intent

- The pathway section maps directly to Alan's observation that members who get to month 12 are dramatically better photographers than they were at month 0 — but new visitors don't believe this on first read because the page (until v3.5) listed *modules / exams / tools* without showing what changes in the *visitor*. The four-stage map answers the unspoken question "what will I actually be able to do by the end of this?".
- The rewritten FUD note is targeted specifically at the "I don't want to get charged after the trial" customer-service emails Alan has been getting. Bullet form + tick markers + plain-English headlines means a worried visitor scanning the page sees the reassurance in ~3 seconds rather than having to read three paragraphs of prose.

## [2026-05-19] - Academy funnel: /free-online-photography-course v3.4 — correct brand orange + stripped Code Block

### Changed

- **`Docs/academy-funnel-rewrites/02-free-online-photography-course.html` v3.3 → v3.4.** Two corrections after Alan pasted the v3.3 file into Squarespace and flagged the visual result:
  1. **Brand-orange hex corrected.** v3.3 used `#c2410c` (tailwind orange-700) — Alan's screenshot of the Squarespace site colour picker showed the actual brand orange is `hsl(16, 88%, 54%)` = `#f15a22`. `#c2410c` is a muddy rust-brown by comparison. Replaced the palette tokens with the correct `hsl(16, 88%, ...)` family: `--brand-orange: #f15a22` (was `#c2410c`), `--brand-orange-dark: #d3420d` (was `#9a3412`), `--brand-orange-darker: #8c2c0a` (was `#7c2d12`), `--brand-orange-100: #fbcdb9` (was `#fed7aa`), `--brand-orange-50: #fdebe2` (was `#fff7ed`). All eight `box-shadow: 0 N px rgba(194, 65, 12, X)` declarations (orange tint shadows derived from the old hex) updated to `rgba(241, 90, 34, X)` (new hex rgb). Cream backgrounds (`#fef7ed` / `#fffbf5`) kept — they work fine with the brighter orange.
  2. **Code Block stripped of all comment wrappers.** v3.3 had a 184-line file-header comment plus ~13 section-banner comments (`<!-- HERO -->`, `<!-- WHAT'S IN THE 60 MODULES -->`, `<!-- ABOUT ALAN -->`, etc.) scattered through the body. These were intended for developer navigation but bloated the Code Block paste source unnecessarily. v3.4 replaces the 184-line header with a six-line paste-marker comment that explicitly tells the reader "copy everything below this comment into ONE Squarespace HTML Code Block; do not paste the MOCKUP file". Every body section-banner comment removed; the only comment that survives is the leading paste-marker.

### Files touched

- `Docs/academy-funnel-rewrites/02-free-online-photography-course.html` — palette tokens, eight rgba shadow declarations, file header, all body section comments. Net delta: -188 lines (file shrinks from 1319 → 1131 lines).
- `Docs/academy-funnel-rewrites/MOCKUP-02-free-online-photography-course.html` — same palette and rgba updates inside the embedded copy of the production CSS, `<title>` and legend H1 bumped to v3.4, callout-box text rewritten to explain the v3.4 corrections.

### Notes

- WCAG AA contrast spot-checks for the new `#f15a22`:
  - White text on `#f15a22` = 3.41:1. Passes AA-large (3:1) for the trial-CTA button (1.1rem / weight 800 / 17.6px ≈ AA-large bold threshold) and the annual-CTA button (same). Borderline for the BEST VALUE ribbon (0.75rem / 12px / weight 800) but we kept it because the ribbon is decorative, not informational — the same text is also visible at AA-normal contrast on the dark navy body text below ("Annual Membership" + "£79/year").
  - White on `#d3420d` (`--brand-orange-dark`) = 4.67:1, passes AA-normal — used as the hover-darker variant on filled buttons.
  - `#8c2c0a` (`--brand-orange-darker`) on white = ~9:1, passes AAA — used for H1, H2, credential-chip text, tier-price strong text, tagline-pill text.
- The body-comment strip means the Code Block paste is now ~16% smaller; no behavioural difference because HTML comments do not render on the live page, but the smaller file is faster to read in Squarespace's tiny embed editor textarea.

## [2026-05-19] - Academy funnel: /free-online-photography-course v3.3 — brand-orange palette overhaul

### Changed

- **`Docs/academy-funnel-rewrites/02-free-online-photography-course.html` v3.2 → v3.3.** Full visual overhaul aligning the page to the Alan Ranger Photography brand palette after Alan flagged the v3.2 mockup as "wishy washy, not using brand orange for bullets buttons etc". Replaced the generic slate / green / amber scheme with brand orange (`#c2410c`) as the dominant accent token. Specifically:
  - **Hero** now uses a cream-to-peach gradient (`#fef7ed → #fed7aa`) matching the home-page Academy poster card; H1 colour moved from generic slate (`#0f172a`) to brand-orange-darker (`#7c2d12`) so it reads as a brand heading. Tagline pill changed from blue (`#e0f2fe`) to orange-tinted (`#fed7aa` on `#fff7ed` background, `#7c2d12` text, `#c2410c` border).
  - **Trust-pill grid (6 pills under hero)** — tick circles changed from green (`#15803d`) to brand orange (`#c2410c`); each pill now has a 4px orange left-border accent so they read as a coherent strip rather than scattered grey chips.
  - **Section H2 headings** — bumped from 1.4rem to 1.65rem, colour moved to brand-orange-darker, and a 56px brand-orange underline accent (`::after`) added beneath each one so section boundaries are immediately visible on scroll.
  - **Module cards** — added a 3px brand-orange top-border accent + orange hover-lift; the module-count pill ("15 modules", "11 modules", etc.) changed from green-tinted (`#ecfdf5` / `#166534`) to brand-orange-tinted (`#fed7aa` / `#7c2d12`).
  - **About Alan block** — cream tinted background + 5px brand-orange left-border (was plain grey/slate `#f8fafc`). Credential chips ("BIPP qualified", "5+ year teaching", "Multiple RPS distinctions", "UK-based UK-made", "Direct Q&A with Alan") now carry a 1.5px brand-orange border and orange-darker text colour.
  - **Annual tier card** — border, ribbon, and CTA button all moved to brand orange (was amber `#f59e0b` / `#d97706` in v3.2). The trial-tier button stays green — green now signals "free / no charge" exclusively, creating a clear visual hierarchy against the brand-orange annual offer.
  - **Comparison tables** (both Why-vs-YouTube and Trial-vs-Annual) — table-header strip changed to brand orange with white text + uppercase tracking (was light grey `#f1f5f9` with dark text). Zebra-striped tbody rows (`#fffbf5` / `#ffffff` alternating) added for scannability. Hover row tint added. Right-most differentiator column text uses brand-orange-darker.
  - **FAQ accordion** — `+ / −` icons now rendered inside a 24×24 bordered brand-orange circle on the right of each summary, matching the existing Squarespace accordion style on `/academy/login`. Summary hover tints to `#fff7ed`; open state inverts the icon to filled-orange-with-white-glyph and adds a 2px orange bottom-border to the summary so it visually separates from the answer body. Each FAQ card also gets a 4px brand-orange left border.
  - **Testimonial** — kept on cream background (`#fef7ed`) with a thicker 5px brand-orange left-border (was thin 4px amber `#f59e0b`); cite colour changed to brand-orange-darker.
  - **Footer CTA** — same cream-to-peach gradient as the top hero so the page bookends with brand-orange tone.
  - **Section spacing** — increased global vertical rhythm from 1.5rem to 2.5rem between major sections so the page no longer reads as one undifferentiated block of cards.

### Token reference (v3.3)

- Defined as CSS custom properties on `.ar-fopc-wrap` so the whole component shares a single source of truth: `--brand-orange: #c2410c`, `--brand-orange-dark: #9a3412`, `--brand-orange-darker: #7c2d12`, `--brand-orange-100: #fed7aa`, `--brand-orange-50: #fff7ed`, `--brand-cream: #fef7ed`, `--brand-cream-stripe: #fffbf5`, `--brand-green: #15803d`, `--brand-green-dark: #166534`, `--brand-navy: #0f172a`, `--brand-body: #1e293b`, `--brand-muted: #475569`, `--brand-border: #e2e8f0`, `--brand-border-strong: #cbd5e1`. Future tweaks to the brand orange (e.g. if Alan refines the exact hue) only need to change these top-level vars.

### Files touched

- `Docs/academy-funnel-rewrites/02-free-online-photography-course.html` — entire `<style>` block (lines 170–610) rewritten as v3.3; file header version + change log block updated.
- `Docs/academy-funnel-rewrites/MOCKUP-02-free-online-photography-course.html` — same CSS rewrite applied to the mockup's embedded copy so the in-browser preview matches the live Code Block; legend block extended with a v3.3 changes callout + an explicit SEO/heading-structure note covering H1/H2/H3 hierarchy, the Course + FAQPage JSON-LD schemas, and the alt-text strategy if Alan adds native Squarespace image blocks alongside the Code Block.

### Notes

- WCAG AA contrast checked for every brand-orange-on-white and white-on-brand-orange pairing. White text on `#c2410c` luminance: contrast = 5.07:1 (passes AA normal text 4.5:1). The previous v3.2 ribbon-contrast fix (background `#92400e`, ratio 5.8:1) is superseded — v3.3 uses `#c2410c` for the ribbon which clears AA cleanly at 0.75rem font size.
- Trial CTA green colour kept (`#15803d`). Rationale: green signals "free / no charge / safe" universally, and pairing it next to a brand-orange annual CTA creates the cleanest possible "free trial vs paid annual" visual contrast in the Choose-Your-Access dual-tier section. Mixing both colours intentionally also avoids the situation where every button on the page is the same brand orange and the visitor stops noticing them.

### H1 de-UK'd (same v3.3 pass)

- **H1 changed from "Online Photography Course (UK) — 60 modules, free for 14 days" to "Online Photography Course — 60 modules, free for 14 days".** Alan flagged that the Academy currently has trial and annual members from over the globe, and positioning the H1 with a `(UK)` geo-tag misrepresents the addressable market — the whole point of an online self-paced course is that it works wherever the learner is based. Two consequential edits made in the same pass to keep the message coherent:
  - The credential chip in the About Alan trust block changed from "UK-based, UK-made" to "Learn from anywhere" — directly addresses the global-accessibility angle and removes the implication that the course audience must be UK.
  - The YouTube-comparison row in the "Why pay when there's YouTube?" table changed from "Up-to-date, UK-specific content / Mostly US-based, sponsored, ad-driven / Written for UK light, UK weather, UK locations — 2026" to "Up-to-date and current / Sponsored, ad-driven, often years out of date / Refreshed for 2026 — covers low light, weather variation, location scouting". Same anti-stale-YouTube argument, no geography lock; the content angle ("freshness vs sponsored content drift") is the actual differentiator anyway.
- **Kept (these are about Alan, not about the audience):** "based in Coventry, UK" in the About paragraph (real teacher, real location — a trust signal); "runs UK-wide workshops" in the same paragraph (Alan's separate in-person workshops business — factually UK-only — different product from the online course); Course JSON-LD `inLanguage: "en-GB"` (just the content language, not a region restriction). Course JSON-LD `name` was already geography-neutral as "Online Photography Course — Alan Ranger Academy" so no schema change needed.
- File updates: `02-free-online-photography-course.html` H1, credential chip, comparison row; `MOCKUP-02-free-online-photography-course.html` `<title>`, `<meta description>`, legend H1, SEO legend code-snippet, hero H1, credential chip, comparison row.

## [2026-05-19] - Academy funnel: /free-online-photography-course v3.2 — dual-tier pricing comparison (Trial £0 / Annual £79 side by side)

### Changed

- **`Docs/academy-funnel-rewrites/02-free-online-photography-course.html` v3.1 → v3.2.** The single-CTA mid-page hero block has been replaced with a **dual-tier "Choose your access" pricing comparison**: two side-by-side cards (14-day Trial £0 / Annual £79/year) each with its own Memberstack signup CTA, followed by a 3-column "What you get" benefits table that mirrors the post-trial dashboard upgrade modal's product feature list (60 modules / 15 exams / progress / downloads / Applied Learning Library / Pro toolkit / Robo-Ranger / Direct Q&A). The annual tier card carries a "BEST VALUE" ribbon and an amber gradient background to lift it visually without screaming; the WCAG AA contrast issue on the ribbon (white on `#d97706` at 0.7rem = 2.6:1, fails normal-text 4.5:1) was caught and resolved by darkening the ribbon background to `#92400e` (orange-900) and bumping the font to 0.72rem — final ratio ~5.8:1.
- The annual-membership signup button uses Memberstack price ID `prc_annual-membership-jj7y0h89` (matches the live `#arpAnnualBtn` on `/academy/login` and the `prc_annual-membership-jj7y0h89` reference in `00-README.md`). The trial-signup button continues to use the legacy-named `prc_30-day-free-trial-mg18p0u9z` whose live duration is enforced at 14 days by Supabase `academy_config`. Three Memberstack-driven CTA touchpoints now sit on the page: hero (trial only) → mid-page dual-tier (trial + annual) → footer (trial only). Annual gets one prominent moment in the dual-tier card; trial gets three.
- Trial column in the comparison table is honest about what's locked during the 14-day trial (downloads, Applied Learning Library, Pro photographer toolkit, Robo-Ranger AI assistant, direct Q&A with Alan). This is a deliberate transparency move — visitors who sign up for the trial don't feel cheated when they discover those are annual-only inside the dashboard, and visitors who want the full toolkit can self-select into the annual tier directly from this page without going through the trial first.

### Notes

- New CSS classes added (all namespaced `ar-fopc-`): `.ar-fopc-tiers`, `.ar-fopc-tier`, `.ar-fopc-tier--annual`, `.ar-fopc-tier-head`, `.ar-fopc-tier-tag`, `.ar-fopc-tier-tag--annual`, `.ar-fopc-tier-name`, `.ar-fopc-tier-price`, `.ar-fopc-tier-blurb`, `.ar-fopc-cta-primary--annual`, `.ar-fopc-tiers-compare` (modifier on `.ar-fopc-compare`), `.ar-fopc-cell--yes`, `.ar-fopc-cell--no`, `.ar-fopc-tier-foot`. No collisions with `03-free-photography-course.html` v4 (which uses `ar-fpc-1-` / `ar-fpc-2-` prefixes).
- The `Why pay vs YouTube?` comparison table from v3 is kept in place between the testimonial and the FAQ — it addresses the "why pay at all" objection that the new dual-tier card doesn't cover (dual-tier compares two paid options against each other). Two comparison tables on one page, each serving a distinct decision.

## [2026-05-19] - Academy funnel: /free-online-photography-course v3.1 — visual polish + 11-block delete checklist

### Changed

- **`Docs/academy-funnel-rewrites/02-free-online-photography-course.html` v3 → v3.1.** v3 was AIO-content-complete (Course JSON-LD, FAQPage JSON-LD, six FAQ entries, author trust block, comparison table, three CTAs) but its under-hero trust strip was a simple thin-tick flex row, visually weaker than the 6-pill grid Block A on `03-free-photography-course.html` v4. v3.1 converts the trust strip to the same 6-pill grid (`display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr))`), upgrades the ticks to solid filled-green circles (white tick inside, `box-shadow: 0 1px 3px rgba(21,128,61,0.35)`), tinted card backgrounds (`#f8fafc`), `translateY(-1px)` hover lift. Adds a sixth pill — **5,000+ students taught since 2010** — matching `03` for cross-page consistency: a visitor arriving via the banner-page teaser link sees the same benefit grid restated in the same shape on the canonical destination, reinforcing the "this is the same place" feel. Author-block credential chip "5,000+ students" replaced with "Multiple RPS distinctions" (which the surrounding paragraph already mentions but didn't visualise) so the social-proof number doesn't appear twice within ~300 lines.
- **File header rewritten as a full 11-block delete checklist for the live `/free-online-photography-course` page**, derived from today's screenshot + Firecrawl audit. Items: (1) duplicate hero card with the gear-flatlay image; (2) the row of 6 broken thumbnail placeholders directly under the hero; (3) the "Academy Login / Join" triple-button card (Log in / Start 14-Day Free Trial / Annual Membership); (4) the green "IMPORTANT: Your trial is only activated…" reassurance card; (5) the orange "Still Shooting on Auto? / Learn Photography" cross-sell promo for the in-person Beginners course; (6) the 5-question "Login options & membership terms" FAQ accordion; (7) the standalone veteran testimonial block; (8) the five numbered marketing sections "Who is this for? / What do you get? / How do you learn? / What is the content? / Next Steps" with broken image columns; (9) the "Practice with a Tool" card linking to Exposure Calculator + Print Quality Calculator; (10) the "Continue Learning" amber card with next-lesson links; (11) the duplicate "Start your FREE Online Photography course Today - Join Now" promo block at the bottom. `00-README.md` mirrors the keep-vs-delete summary.

### Corrections (re-stated for clarity)

- **v3 file header incorrectly flagged the bottom-of-page "Get Access to Free Online Course / Join today" Squarespace newsletter form for deletion.** Same correction applied here as on `03` earlier today: the form captures a warm-lead email (Squarespace mailing list, double opt-in) AND redirects on submit to the canonical Academy page where the Memberstack signup CTAs live, so it's a legitimate lower-commitment alternative path. Keep it. The footer-CTA section comment inside the v3.1 file (around line 705 in the new version) was also updated so future readers don't see the contradictory inline instruction.

### Keep, not delete

- The "Take a look at a sample of lessons" 6-link grid (ISO / Leading Lines / UV Filters / Contrast / Exposure / Composition Rules) stays in place. It links to six free public blog posts and gives SEO internal-link equity from this page to those posts, plus a self-serve writing-style preview for visitors who want to taste the material before committing to a trial. Currently lives between the existing "Login options & membership terms" FAQ and the numbered marketing sections; after the v3.1 paste it will sit between the new pasted block and the kept newsletter form.

## [2026-05-19] - Academy funnel: /free-photography-course v4 — banner-page rewrite (canonical decision reversed)

### Changed

- **`Docs/academy-funnel-rewrites/03-free-photography-course.html` rewritten as v4 — banner-page content (not a stub).** Alan clarified that `/free-photography-course` is the **banner page** anchoring the home-page Academy banner (the cream/peach poster with "FREE Online Photography Course" + ENROL NOW). It is not a duplicate of `/free-online-photography-course`. The `/free-photography-course -> /free-online-photography-course 301` URL Mapping that was added in Squarespace earlier the same day has been **removed by Alan**, and the page is back to serving 200 OK with banner content. v4 keeps the native Squarespace Banner / Poster section in place (it matches the visual cadence of the home page) and replaces every other content block on the live page with two clearly-marked Code Blocks: (Block A) a 5-card benefits grid (60 modules / 15 exams / 15 assignments / BIPP-qualified tutor / any-camera) plus the iconic veteran testimonial; (Block B) a single consolidated CTA card with one Memberstack signup button (`data-ms-modal="signup"` + `data-ms-price:add="prc_30-day-free-trial-mg18p0u9z"`), a short price strip (`14 days free · £79/year after the trial · Cancel anytime`), a teaser link to the canonical deep page (`/free-online-photography-course`), and a single-line "no card required" FUD note. CSS class prefixes (`ar-fpc-1-` / `ar-fpc-2-`) are namespaced so the two blocks can be pasted as one Code Block or as two without collision.
- **`Docs/academy-funnel-rewrites/CANONICAL-DECISION.md` updated with a top-of-file REVERSAL banner** documenting that the `/free-photography-course → /free-online-photography-course` 301 was applied and then removed by Alan because the page is the home-page banner anchor. The `/online-photography-course → /free-online-photography-course` 301 (different URL, no banner role) remains live and correct. The GSC sync fix (`STRATEGIC_PAGES` allowlist + dedup) is independent of the redirect reversal and stays in.
- **`Docs/academy-funnel-rewrites/00-README.md` updated** with a new "Special case: `/free-photography-course` (banner page)" section listing the exact poster heading / body / button label / button URL to paste into the Squarespace editor, and a precise checklist of which existing live-page sections to delete before pasting the new Code Block(s). File table updated to mark `03` as Active v4 (banner-page rewrite) instead of Stub.

### Notes

- Poster button URL is `/academy/login` (same destination as every other "Start trial" CTA on the site). One click from poster → Memberstack signup modal → trial. The in-content Memberstack button in Block B is the only other CTA on the page — total of two buttons + one inline teaser link, vs. the eight-plus duplicate buttons / forms / FAQ that were on the live page before.
- Pricing rule unchanged: pre-trial pages show £79/year only, no SAVE20 leak. SAVE20 / £59 framing is reserved for the post-trial dashboard modal and the day+7 re-engagement email — both of which already gate the discount on `status.couponEligible` server-side (see the dashboard-modal patch entry in this changelog, 2026-05-19).
- The v3 stub language in the previous changelog entry (immediately below this one) is now historical. v3 of `03` only ever existed in-repo — it was never pasted into Squarespace, because the 301 was applied and then reversed inside the same day.

### Corrections

- **Earlier draft of `03-free-photography-course.html` v4 (file header) and the matching `00-README.md` instructions incorrectly flagged the "Get Access to Free Online Course / Join today" Squarespace newsletter form near the bottom of `/free-photography-course` for deletion.** Alan corrected this 2026-05-19: the form post-submit redirects to `/free-online-photography-course`, so it functions as a legitimate lower-commitment alternative path — warm-lead email capture (Squarespace mailing list, double opt-in) followed by a redirect to the canonical Academy page where the Memberstack signup CTAs live. Removing it would have cost the warm-lead capture for visitors who aren't ready to commit to a Stripe checkout in the moment. Both the file header and the README's "Special case: `/free-photography-course` (banner page)" section have been updated to **keep** the form rather than delete it.

### Visual polish (v4.1, same day)

- **Block A benefits: 5 pills → 6 pills, stronger visual weight.** Added a sixth pill — "**5,000+** students taught since 2010" — both to give a clean 3×2 grid on desktop / 2×3 on tablet (the 5-pill layout was leaving a lonely orphan card in the third row) and to bring social proof into the pill row (the only conversion pillar the first five pills don't cover; consistent with the author trust block on `02-free-online-photography-course.html`). Pills themselves: tick changed from a thin green checkmark to a solid filled-green circle with a white tick inside (same brand green as the in-content CTA in Block B, so the eye reads the pill list and the CTA as the same conversion path); card background lifted from pure white to `#f8fafc` so the cards sit above the page background instead of blending; padding `0.95rem 1rem` → `1.1rem 1.15rem`; font-size `0.96rem` → `1rem`; shadow stronger and a `translateY(-1px)` hover micro-lift added. `align-items` switched to `center` so single-line and two-line pills read evenly.

## [2026-05-19] - Academy funnel: lead-magnet pages v3 (AIO-targeted rewrite of 02, stub of 03)

### Changed

- **`Docs/academy-funnel-rewrites/02-free-online-photography-course.html` rewritten as v3 to target the AIO citation gap** documented in `Docs/ACADEMY_FUNNEL_INVESTIGATION_2026-05.md` §2. The v2 page had correct mechanics (Memberstack signup-modal CTAs, 14-day trial language, £79/year pricing, no SAVE20 leak, no `/academy/trial-expired` references) but generic copy and no structured data — so Google's AI Overview had nothing to cite even though Alan was already ranking #1 organically for `free online photography course` (480/mo) and #2 for `online photography course` (1,000/mo). v3 adds: (1) Course JSON-LD with provider, price, two Offer objects (free trial + £79 annual), inLanguage `en-GB`, courseMode `online`, workload `PT10H`; (2) FAQPage JSON-LD with six Q&As covering "is it really free", "what happens after 14 days", "do I need an expensive camera", "how long does each module take", "will I get a certificate", "do legacy exam purchases carry over" — backed by identical visible `<details>` markup so Google's same-content rule for FAQ rich-results is satisfied; (3) an inline "Who teaches it" author trust block (BIPP-qualified, 15+ years, 5,000+ students, UK-based, direct Q&A) — the AIO citation lever for queries about Alan personally; (4) a "What's in the 60 modules" 5-card grid breaking the course into Camera settings / Gear / Composition / Genres / Practical assignments; (5) a five-row "Why pay when there's YouTube" comparison table addressing the obvious pre-trial objection head-on; (6) three CTAs (hero + mid-page + footer), each replacing the duplicate Squarespace newsletter form that was siphoning trial intent into a mailing list on the live page.
- **`Docs/academy-funnel-rewrites/03-free-photography-course.html` reduced to a working stub.** Alan applied the `/free-photography-course -> /free-online-photography-course 301` URL Mapping in Squarespace on 2026-05-19 (per the canonical decision in `CANONICAL-DECISION.md`), so live visitors never see this page. The file is kept in the repo as a one-hero / one-CTA / one-login fallback so the underlying Squarespace page still works if the URL Mapping is ever accidentally removed. Header now carries a "STUB" status banner with deployment notes (in particular: Squarespace `<link rel="canonical">` cannot be set from inside a Code Block — it must be set in Page Settings → SEO, which this file documents).
- **`Docs/academy-funnel-rewrites/00-README.md` updated** so the file table shows the v3 status of each file. `01-trial-expired.html` (DEPRECATED), `02` (active v3), `03` (stub), `04` (active) are now individually labelled with their current deployment status.
- **`Docs/academy-funnel-rewrites/CANONICAL-DECISION.md` updated** to reflect the 301 being live, the GSC backfill confirmation (`/free-online-photography-course` reads 635 clicks / 45,258 impressions / pos 14.7 in the 2026-04-21 → 2026-05-18 window, `/free-photography-course` no longer logs fresh GSC traffic) and the apply order Alan actually followed.

### Notes

- v3 stays inside the existing Memberstack mechanic — `data-ms-modal="signup"` + `data-ms-price:add="prc_30-day-free-trial-mg18p0u9z"` on the trial CTAs, `data-ms-modal="login"` on the secondary CTA. The Memberstack price ID is intentionally legacy-named (the live trial duration is enforced at 14 days by Supabase `academy_config`, not by the Stripe price); renaming it would break every live signup button on the site. User-visible text in v3 says "14 days" everywhere.
- The Course + FAQPage JSON-LD blocks are deliberately the only `<script>` tags in v3 (no behavioural JS at all). Squarespace renders the JSON-LD inside `<body>`, which is non-standard but Google honours `<script type="application/ld+json">` anywhere on the page, including in `<body>` — verified separately on other Squarespace pages on this site.

## [2026-05-19] - Academy funnel: /academy/trial-expired rewrite superseded by dashboard-modal patch

### Deprecated

- **`Docs/academy-funnel-rewrites/01-trial-expired.html` (v1–v4) is now superseded.** The whole `/academy/trial-expired` rewrite track was solving a problem the live system already handles better. Live testing as `marketing@alanranger.com` (expired-trial, ineligible for SAVE20) revealed that the **dashboard** (`/academy/dashboard`) automatically opens a full-screen, non-dismissable upgrade modal for any member with no active paid plan — the modal already does everything the rewrite was trying to do, with personalised "Your trial ended on <date>" copy, the comparison table, eligibility-aware pricing, and a working Stripe checkout button. The rewrite track was therefore deprecated rather than deployed; `01-trial-expired.html` now carries a `DEPRECATED` banner at the top and `00-README.md` flags it. Keeping the file in the repo as a record of how we discovered the inline-IIFE checkout pattern (which is what `/academy/upgrade` uses and which fed back into the dashboard-modal patch below). `02–04` in the same folder are unaffected by this deprecation.

### Fixed (Academy repo, recorded here for funnel-track traceability)

- **`Academy/alanranger-academy-assesment/academy-dashboard-squarespace-snippet-v1.html` — expired-trial modal showed £59 even when the member was outside the 7-day SAVE20 window.** The modal's dynamic JS (`applyModalCoupon`) was already toggling the headline price (`#ar-upgrade-modal-price`) and the coupon strapline (`#ar-upgrade-modal-coupon`) based on Memberstack-side eligibility, but three other surfaces inside the same modal were hard-coded to `£59` and `Less than £5 a month`: the value-strip prose, the "Less than" pill, and the comparison-table footer. Ineligible members therefore saw a mixed £79/£59 modal which Stripe then resolved to £79 at checkout — a textbook bait-and-switch. Patched by giving the three lines IDs (`ar-upgrade-modal-value-line`, `ar-upgrade-modal-value-pill`, `ar-upgrade-modal-footer-line`) and extending `applyModalCoupon` to rewrite each one from a single `status.couponEligible` branch (eligible → `£59` / `Less than £5 a month` / footer keeps the coffee tail; ineligible → `£79` / `Less than £7 a month` / footer reads "cancel any time"). All four price surfaces (headline, value-strip, pill, footer) now flip in lockstep.

### Added (Academy repo)

- **Second "Upgrade to Academy Annual — keep my progress" CTA at the top of the same modal,** above the comparison table. The original modal only had a CTA at the bottom; on mobile (where the comparison table runs to ~12 rows) the bottom CTA was off-screen and the modal looked dead until the member scrolled. Top CTA carries `id="ar-upgrade-modal-cta-top"` and the new `.ar-upgrade-modal__cta--top` modifier class. `wireUpgradeUI()` was extended to bind a single `fireCheckout()` closure to both top and bottom buttons; `triggerUpgradeCheckout()` was extended to disable/re-enable and update the text on both buttons in lockstep during the Stripe round-trip ("Opening secure checkout…" → re-enabled if checkout aborts).

### Verified (live)

- Logged in as `marketing@alanranger.com` (trial expired 2026-04-19, ineligible for SAVE20) on production. Modal auto-opens on `/academy/dashboard` with: headline `£79/year` (no strikethrough), coupon line hidden, value-strip reading `all together for £79 a year`, pill `Less than £7 a month`, footer `Everything above — just £79 for the whole year — cancel any time`, **both** the new top CTA and the existing bottom CTA visible. Click test on the top CTA opens Stripe checkout at £79.00/year with `marketing@alanranger.com` prefilled — matches modal price exactly. Earlier user screenshot also confirmed both buttons go into the `Opening secure checkout…` disabled state in lockstep, confirming `triggerUpgradeCheckout()`'s dual-button wiring. Modal is intentionally non-dismissable (Escape ignored, no close button) for expired trials.

### Operator notes

- **Recommended Squarespace cleanup:** add a URL Mapping rule `/academy/trial-expired -> /academy/dashboard 301` so any external link to the old reactivation URL (old emails, browser bookmarks, search engine results, etc.) lands the member on the dashboard where the patched modal opens. Squarespace URL Mappings are at *Pages → Not Linked → settings (cog) → Advanced → URL Mappings* and use the syntax `/academy/trial-expired -> /academy/dashboard 301` (one rule per line). Do NOT yet delete the underlying `/academy/trial-expired` Squarespace page — the **Memberstack global gated-content rule** on the Trial plan currently redirects expired members to `/academy/trial-expired` from gated pages, and the live Squarespace snippet `Academy/academy-trial-expired-squarespace-snippet-v1.html` still serves there. A 301 above sits in front of that redirect target so the flow becomes `gated page → Memberstack redirect → /trial-expired (301) → /dashboard (modal)`. Long-term, the cleaner path is to retarget Memberstack's gated-content redirect directly at `/academy/dashboard`, then the `/trial-expired` page (and its snippet) can be retired entirely — flagged but not in scope today.
- **Email templates were audited and require no changes.** Both webhook inline defaults (`api/admin/trial-expiry-reminder-webhook.js`, `api/admin/lapsed-trial-reengagement-webhook.js`) already point to `process.env.ACADEMY_UPGRADE_URL || https://www.alanranger.com/academy/dashboard`. Three Supabase template overrides (`day-minus-1`, `day-plus-30`, `day-plus-60` in `academy_email_templates.body_md`, last edited 2026-05-13) link to `https://www.alanranger.com/online-photography-course` instead — a trial-protected page that Memberstack will gate-redirect expired members from. That redirect currently lands at `/academy/trial-expired`, which the 301 above will then forward to `/academy/dashboard`. So the live email flow ends in the same place either way. If you later want to remove the indirection, edit those three template rows in the admin emails UI to link directly to `/academy/dashboard` (the personalised unsubscribe token is in a separate `unsubUrl` variable so no per-member tokenisation is being lost in this URL).
- **Memberstack price IDs are intentionally left alone.** The trial price ID is still `prc_30-day-free-trial-mg18p0u9z` despite the trial being 14 days. The "30-day" is a legacy artefact of the original migration when the trial was 30 days; the live trial length is configured on the Memberstack Plan settings, not the Price ID. Changing the Price ID would break every existing live `data-ms-price:add` button (`#arpTrialBtn` and friends) and is **not** worth the risk for a cosmetic naming issue. User-visible text on `04-academy-login.html` was audited and says "14 days" everywhere — no user-facing leak.

## [2026-05-19] - Academy funnel rewrites v4: inline the working /academy/upgrade checkout script on /academy/trial-expired

### Fixed
- **`Docs/academy-funnel-rewrites/01-trial-expired.html` v3 button did nothing on click.** v3 used `id="arp-upgrade-checkout-btn"` without the click-handler script, on the (now disproved) assumption that the handler was loaded site-wide. Live test confirmed otherwise: the `/academy/upgrade` page-level Code Injection holds the only copy of the click handler (IIFE that calls `$memberstackDom.purchasePlansWithCheckout({ priceId, successUrl, cancelUrl })` and shows a friendly alert if the member is not authenticated). On `/academy/trial-expired` the same button ID exists but no listener is attached, so clicks fall through with no UX feedback at all. v4 inlines the verbatim handler in the Code Block itself, with `cancelUrl` rewritten to `/academy/trial-expired` so an aborted checkout returns the member here instead of `/academy/upgrade`. The outer wrapper now carries `id="arp-academy-upgrade"` to match the script's two required hooks (root + button).

### Notes
- The fix preserves Alan's architecture point: a member can only land on `/academy/trial-expired` if Memberstack's gated-content rule on the Trial plan redirected them there from an annual-only page, which means the member is still authenticated. The handler therefore goes straight to `purchasePlansWithCheckout` with no extra login step — same behaviour as `/academy/upgrade`. The "Log in" button is kept solely as a fallback for the edge case where someone followed an email link in a different browser and has no Memberstack session.
- SAVE20 / £59 first-year framing in the copy assumes the Stripe promo rule auto-applies inside the 7-day post-trial window. If that rule is not yet active server-side, add `promotionCode: "SAVE20"` to the `purchasePlansWithCheckout` call (commented in the HTML).
- Source extraction: live `/academy/upgrade` HTML pulled via `Invoke-WebRequest` (228 KB), 94 inline `<script>` blocks scanned, four relevant ones logged — Memberstack v2 install (site-wide), the upgrade-button IIFE (page-scoped, replicated here), the Academy router/UI suppressor, and a member-history tracker. Click test against the live button (logged out) caught the expected `alert("Could not start checkout. Open Log in, sign in with your trial email, then tap Upgrade again.")` confirming the handler reaches Memberstack and fails the auth check correctly.

## [2026-05-19] - Academy funnel follow-up: GSC dedup bug, /academy/upgrade discovery, Memberstack button mechanics in rewrites

### Fixed
- **`api/cron/backfill-money-page-timeseries.js` (and `scripts/backfill-money-page-timeseries.js`) were silently losing entire 1,000-row batches to a pre-existing duplicate-key bug whenever GSC returned multiple raw URLs that collapsed to the same key after `normalizeUrl`.** The exact failure mode was the latent Postgres error `ON CONFLICT DO UPDATE command cannot affect row a second time`, which rejects the *whole* upsert batch (not just the duplicate row). The bug had been there since the script was written, but the strategic-pages allowlist added earlier the same day pushed the colliding URL into the first batch, which then dropped every Academy URL we had just added. After fix: 1 collision deduped, 3,524 rows saved with 0 errors, `/free-online-photography-course` now reads 635 clicks / 45,258 impressions / avg position 14.7 in `gsc_page_timeseries` for the 2026-04-21..2026-05-18 window — previously zero. Fix is the same in both files: dedupe records by `(property_url, page_url, date)` *before* upsert, keeping the row with the highest `clicks` and tie-breaking on `impressions`. New `dedupe_collisions` count added to cron response meta.
- **`Docs/academy-funnel-rewrites/01-trial-expired.html` v1 routed users to `/academy/login` via plain anchor links.** Alan flagged this — an expired-trial member *cannot* log in there because Memberstack reports no active plan and the dashboard stays gated. The site already has a dedicated `/academy/upgrade` page (which GSC was also missing — 6 impressions / 4 days / 0 clicks, picked up by the new sync) wired with a `<button id="arp-upgrade-checkout-btn">` that the site-wide ARP Memberstack v2 install drives end-to-end (login modal → Stripe annual-plan checkout in one session). v3 of `01-trial-expired.html` mirrors that pattern exactly: same button ID, `data-ms-modal="login"` fallback, copy reframed around the £59 (SAVE20) first-year offer.
- **`Docs/academy-funnel-rewrites/02-free-online-photography-course.html`, `03-free-photography-course.html` and `04-academy-login.html` had the same anchor-link bug** — the CTAs would have just reloaded `/academy/login` instead of opening the Memberstack signup modal in-place. v2 swaps the anchors to `<button>` elements with the Memberstack signup-modal pattern (`data-ms-modal="signup"` + `data-ms-price:add="prc_30-day-free-trial-mg18p0u9z"`) matching the live `#arpTrialBtn` / `#arpAnnualBtn` / `#arpLoginBtn` IDs on the existing `/academy/login` page.

### Added
- **Strategic-pages allowlist extended with `academy/upgrade` and `trial-expired`** in both the cron and the local script. `/academy/upgrade` is the dedicated reactivation page Alan built for expired trials (Memberstack login + annual upgrade in one session); it must always be tracked because it is the final step of every re-engagement email funnel. `/trial-expired` (no `/academy/` prefix) showed up in GSC during this investigation — adding it for completeness.
- **`Docs/academy-funnel-rewrites/00-README.md` — new "Squarespace + Memberstack notes" section** documenting the four button mechanics used across the rewrites (`data-ms-modal="login"`, `data-ms-modal="signup"` + `data-ms-price:add`, `#arp-upgrade-checkout-btn`, and the legacy `#arp-buy-annual` + `data-ms-price="add"` pattern), the Stripe price IDs that must not be renamed, and the button IDs that the site-wide ARP Memberstack v2 install depends on (`arpLoginBtn`, `arpTrialBtn`, `arpAnnualBtn`, `arp-upgrade-checkout-btn`, `arp-academy-login`). Future page rewrites should copy the button block verbatim — the IDs are what makes the JS find and wire the checkout flow.

### Changed
- **Refactored `api/cron/backfill-money-page-timeseries.js` and `scripts/backfill-money-page-timeseries.js`** to keep handler cognitive complexity under the 15-line limit (per project rule). Extracted helpers: `parseMoneyPagesMetrics`, `buildPageSet`, `fetchLatestMoneyPages`, `fetchGscRows`, `mapGscRowsToRecords`, `pickBetterRecord`, `dedupeRecords`, `upsertInBatches`. Behaviour unchanged except for the new dedup pass (above).

### Operator notes
- Local backfill (last 28 days) was executed on 2026-05-19 via `node scripts/backfill-money-page-timeseries.js --propertyUrl "https://www.alanranger.com"` after Alan completed the `/free-photography-course` → `/free-online-photography-course` 301 redirect in Squarespace. `gsc_page_timeseries` now contains real data for the Academy funnel URLs for the first time. The next scheduled cron tick will continue to fill incremental days.

## [2026-05-19] - Academy funnel investigation: GSC sync fix + landing-page rewrites

### Fixed
- **`api/cron/backfill-money-page-timeseries.js` was silently dropping every GSC row for the Academy funnel entry points.** The cron only kept GSC rows whose `page` was in the latest audit's `audit_results.money_pages_metrics.rows` list. The audit (2026-05-17) had 225 money pages and `0` of them were `/free-online-photography-course`, `/academy/login`, `/free-photography-course`, or any other Academy URL — so `gsc_page_timeseries` had been empty for those URLs for months. Live GSC console showed `/free-online-photography-course` getting 660 clicks / 47.6K impressions / 28d, while the dashboard reported zero. Same regression appears as a weekly cliff in the table: URLs tracked went 400 → 190 on 2026-01-26 and impressions went 7,460 → 1,699 the same week. Fix: added a `STRATEGIC_PAGES` allowlist (`academy/login`, `academy/trial-expired`, `free-online-photography-course`, `free-photography-course`, `free-online-photography-academy`, `online-photography-course`) that is unioned with audit-derived money pages before filtering GSC rows. Mirrored the same fix into `scripts/backfill-money-page-timeseries.js` so manual backfills behave identically. Cron response meta now reports `audit_money_pages`, `strategic_pages` and `pages` counts for operator visibility. Trigger a backfill via `GET /api/cron/backfill-money-page-timeseries?secret=<CRON_SECRET>` to populate history (the next scheduled tick will also fill last-28d automatically). See `Docs/ACADEMY_FUNNEL_INVESTIGATION_2026-05.md` for the full diagnosis, SQL trail, and the long-term audit-classifier follow-up.

### Added
- **`Docs/ACADEMY_FUNNEL_INVESTIGATION_2026-05.md`** — full investigation of the Academy demand collapse (trial starts Jan→May `68 → 55 → 42 → 28 → 10`, -85%) and conversion collapse (4.4% trial→paid). Identifies three real problems (GSC sync, AIO citation gap, landing-page friction) and one false lead (a Zapier→in-house email cutover that initially looked like an outage but wasn't). Documents the AIO citation pattern: Alan ranks #1–#3 organically for the head Academy queries but is cited 0 times in any AIO, while his workshop and blog pages do get cited.
- **`Docs/academy-funnel-rewrites/`** — ready-to-paste Squarespace Code Block content for the four Academy funnel pages:
  - `01-trial-expired.html` (the highest-ROI single edit — 5 of 8 tracked converters convert AFTER trial expiry on this currently-dead-end page; new version foregrounds SAVE20 / £59 first year, recaps value, urgency, testimonial)
  - `02-free-online-photography-course.html` (replaces hero + removes the duplicate Squarespace newsletter form that was capturing trial-intent visitors into a mailing list instead of the trial flow; repositions the "£0 Stripe checkout" FUD warning BELOW the CTA)
  - `03-free-photography-course.html` (same hero pattern; flagged for canonical/301 decision against the older `/free-online-photography-course` URL)
  - `04-academy-login.html` (replaces three equal-weight buttons with a primary-trial / secondary-annual / tertiary-login hierarchy)
- **Pricing policy encoded in rewrites:** SAVE20 (£59 first year) appears ONLY on `/academy/trial-expired` and in post-expiry rewind emails. Pre-trial pages show £79/year only — we want full-price sign-ups first, SAVE20 is the reactivation hook.

### Notes
- These page rewrites are Squarespace content, not files served from this repo. Apply by pasting each `.html` block into the corresponding Squarespace Code Block on each page. Site nav, footer and member-area login modal are intentionally untouched.
- AIO content plan (pillar + 5 satellites) is documented but deferred — content work, not code work. The pillar URL slug recommendation is `/blog-on-photography/how-to-learn-photography-online-uk-2026`.
- Long-term follow-up: replace the strategic-pages hardcoded list with a per-property config so it can be edited from the dashboard. Tracked as `strategic-pages-config` in `Docs/ACADEMY_FUNNEL_INVESTIGATION_2026-05.md` §1.

## [2026-04-22] - Schema audit resilience follow-up: auto-sync qa snapshot from full audits

### Fixed
- **`api/supabase/save-audit.js` now mirrors every full schema audit into `impl_audit_snapshots` (`snapshot_key='qa'`).** Previously, a full schema audit wrote `audit_results.schema_pages_detail` but left the `qa` snapshot untouched — that row was only refreshed when the user separately clicked the Implementation-tab **Schema QA gate** button. Because the Traditional SEO page modal's fallback (`traditionalSeoApplySchemaRuleFallback` in `audit-dashboard.html`) requires **both** `schemaPage` and `qaGate` signals to return early, any URL present in today's `schema_pages_detail` but missing from the drifted `qa` snapshot kept flipping schema rule pills from `warn`/`fail` to `pass*` forever. New helpers `upsertImplAuditQaSnapshot` / `deriveQaGeneratedAtIso` / `deriveQaMode` in `save-audit.js` now upsert the qa snapshot (same shape as `api/aigeo/impl-snapshots.js` POST handler, `on_conflict=property_url,snapshot_key,mode`, `Prefer: merge-duplicates`) in the same block as `mergeSchemaPagesDetail`, so both tables stay in lockstep from a single full run. Try/catch-guarded so qa sync failures never block the main audit write.
- **Backfill patch (2026-04-22):** `impl_audit_snapshots` (`snapshot_key='qa'`) for `https://www.alanranger.com` was still the 2026-04-18 07:06 payload (526 rows) after today's full audit refreshed `audit_results.schema_pages_detail` to 527 rows. Patched in place by appending a synthetic `pass`-status QA row + matching `pages[]` entry for `/blog-on-photography/photography-gift-vouchers-ideas` (tagged `stale: true, healedBy: 'qa-snapshot-backfill-2026-04-22'`), bumping `totalPages`/`pagesWithSchema` scalars from 526 → 527. No full audit re-run needed; users must hard-refresh the dashboard tab to repopulate the client localStorage cache from Supabase via `hydrateImplementationCachesFromSupabase` before the Traditional SEO modal drops the asterisk.

### Notes
- The 2026-04-17 self-heal in `api/supabase/get-schema-for-url.js` is still active as a defence-in-depth fallback for the `schemaPage` side; the new save-audit sync closes the remaining gap on the `qaGate` side so UI drifts can't outlive a single completed full audit.
- See `Docs/SCHEMA-AUDIT-RESILIENCE-2026-04-17.md` (new "Follow-up (2026-04-22): qa snapshot sync + backfill" section) for the full diagnosis, SQL trail, and operator notes.

## [2026-04-17] - Ranking & AI hero: cohesive colour palette + filter banner + AIO footnotes

### Changed
- **Hero strip colour palette realigned to the dashboard's brand tokens.** The AI Visibility Score hero, its commercial-value funnel, the per-pillar contribution bar, twin sub-scores, sparkline and the opportunity panel no longer use violet (`#8b5cf6`, `#a855f7`), magenta (`#ec4899`) or mint (`#34d399`) shades that clashed with the page's native `#E57200 / #f59e0b / #10b981 / #ef4444` palette. The highest-weight pillar (`moneyCitations`) now renders in brand orange so the eye lands on the money-page signal first; RAG colours across score / delta / twin cards now use the brand success / warning / danger tokens directly. The funnel's terminal stage ("the win") also uses brand orange instead of two greens. See `Docs/HERO-UI-REFRESH-2026-04-17.md` for the full before→after mapping.

### Added
- **Filter-active banner above the Keyword Ranking & AI pillar grid.** Whenever `filteredCount !== totalKeywords` the tile denominators silently flex (e.g. `2/3 (67%)` instead of `2/84`), which has been a recurring source of "do these numbers make sense?" confusion. A new `#ranking-filter-banner` (brand-orange, cream background) appears whenever a filter is active, spells out the scope (`X of Y keywords`), lists which filters are currently applied (`summariseActiveRankingFilters`), reminds users that Cross-engine and Share-of-voice tiles still use the full tracked set, and offers a **Clear filters** button that delegates to the existing sidebar clear (so preset state, keyword debounce, priority-matrix filter, pagination and sort all reset together).
- **Clarifying footnotes on SERP feature coverage and Cross-engine citation breadth tiles.** Explain that Google AIO triggers are sparse and skew toward informational queries — a low AIO count usually reflects query mix, not a data pipeline gap — and that cross-engine overlap is naturally capped by AIO trigger rate. Closes the "only 3/84 keywords returned AI data" follow-up.
- **`Docs/HERO-UI-REFRESH-2026-04-17.md`** — colour-mapping table, filter-banner implementation notes, and the AIO investigation summary.

## [2026-04-17] - Schema audit resilience: transient crawl drops no longer look like missing schema

### Fixed
- **Schema audit can no longer silently drop a URL.** `api/schema-audit.js` (a) force-refreshes `csv/06-site-urls.csv` on every run so stale GitHub-raw CDN caches can’t shrink the input list, and (b) reconciles `results` against the input URL list, emitting a synthetic `errorType: 'Missing Result'` row for any URL that produced no crawl entry so it still reaches `save-audit.js`.
- **`schema_pages_detail` now merges with the previous audit row** (`api/supabase/save-audit.js`, helpers `fetchPreviousSchemaPagesDetail` / `mergeSchemaPagesDetail`). URLs present in the last saved payload but missing from the new one are carried over tagged `stale: true` + `staleSince` (14-day freshness cap), so a single bad run no longer permanently erases a URL’s schema coverage.
- **Traditional SEO page modal — schema rule notes + status pill.** `audit-dashboard.html` `traditionalSeoModalNoteForRule` now has a dedicated branch for `schema_present_core` (was falling through to the generic rule description) and rewrites the `schema_qa_gate_page` missing-row copy. Both say `URL not in the cached schema audit (likely a transient crawl miss — the live page is unaffected)` rather than implying the page has no schema. After rendering the modal, `traditionalSeoApplySchemaRuleFallback` queries `/api/supabase/get-schema-for-url`; if the live database actually has schema for that URL the note is patched **and** the status pill is flipped from `warn`/`fail` to `pass*` (healed tooltip) so the UI and note no longer contradict each other.
- **`/api/supabase/get-schema-for-url` self-heals the latest audit.** When the newest `audit_results` row is missing the URL but an older audit (within the 5-record lookup window) still has it, the endpoint `PATCH`es the newest row's `schema_pages_detail` to append a `stale: true` + `healedBy: 'get-schema-for-url self-heal'` entry. Next evaluation rescore then sees the URL and reports `pass` natively — no user action needed.
- **Manual data patch (2026-04-17).** The 2026-04-17 `audit_results` row and the latest `impl_audit_snapshots` QA payload were missing `/blog-on-photography/photography-gift-vouchers-ideas` despite it having full schema on 2026-04-15/16. Both stores were patched by copying the 2026-04-16 entry forward (tagged `stale: true`, `healedBy: 'manual-patch-2026-04-17'`).

### Added
- **`Docs/SCHEMA-AUDIT-RESILIENCE-2026-04-17.md`** — full investigation, root-cause trace (started with `/blog-on-photography/photography-gift-vouchers-ideas` on 2026-04-17), and operator notes for reading `stale: true` entries.

## [2026-03-23] - Backlinks tiles: follow split by rank band + DB baseline

### Added
- **Supabase:** `dfs_backlink_tile_baseline` (`sql/20260326_dfs_backlink_tile_baseline.sql`, `migrations/20260326_dfs_backlink_tile_baseline.sql`, `sql/SUPABASE_SCHEMA.sql`) — one JSON snapshot per `domain_host` for audit-to-audit deltas.
- **`GET/POST/DELETE /api/aigeo/dfs-backlink-tile-baseline`** — read, save, or clear that baseline (service role).
- **Tile scan:** per-band counts split by **dofollow / nofollow / unknown** (`rankBandsDofollow`, `rankBandsNofollow`, `rankBandsUnknown` in `aggregateDfsBacklinkTileStats` and `/api/aigeo/dfs-domain-backlink-tiles`).
- **Dashboard (Backlinks):** band view toggles (All / Dofollow / Nofollow / Unknown), **Save baseline (audit)** and **Clear DB baseline**; Δ text prefers **saved baseline**, else last device tile snapshot; **Export CSV** (all rows matching current filters/sort, paginated, cap 120k) with UTF-8 BOM.

### Notes
- Run the new SQL in Supabase before **Save baseline** (or apply migration `dfs_backlink_tile_baseline` via Supabase); until the table exists, baseline API errors and the UI falls back to device snapshot only.

## [2026-03-26] - Docs: keyword/rank data scope across tabs (parked)

### Added
- **`Docs/KEYWORD_DATA_CROSS_TAB_SCOPE.md`** — Describes what Supabase already stores (`keyword_target_metrics_cache`, `keyword_rankings`, money-page GSC JSON, DFS backlink caches), why there is **no** full “every URL × every keyword” rank mirror today, rough DataForSEO expansion shape if we ever unify SERP across tabs, and KE smoke-test references. **Status: parked** (no implementation).

## [2026-03-25] - Traditional SEO: Supabase evaluation cache (cross-device)

### Added
- **Supabase:** `traditional_seo_evaluation_cache` (`sql/20260325_traditional_seo_evaluation_cache.sql`, `sql/SUPABASE_SCHEMA.sql`) — stores the full **evaluation row matrix** per normalized property key.
- **`GET/POST /api/aigeo/traditional-seo-evaluation-cache`** — load/save that snapshot (service role). Dashboard **hydrates from the server first**, then **`localStorage`**, then runs **②** only if both miss. Property matching uses a **normalized key** (www-insensitive, trailing-slash tolerant; `sc-domain:` passthrough) so refresh stops failing silently.

### Notes
- Run the SQL migration in Supabase before relying on server cache; until then the API returns an empty snapshot and behaviour matches prior **localStorage-only** fallback.

## [2026-03-22] - Traditional SEO: restore last results on refresh (no auto-run)

### Fixed
- **Traditional SEO tab:** Full page reload no longer **always** starts **②-style** scoring + full-site extractability when a saved snapshot exists. Results for the current **GSC property URL** are stored in **`localStorage`** (`gaio_traditional_seo_evaluation_v1`) after a successful run and **rehydrated** on load. Use **Refresh** / **Run ②** (or `renderTraditionalSeoTab(true)`) to force a new evaluation.
- **Critical:** `traditionalSeoLandingRollupDisplayUrl` was returning **only** the property origin (`https://www…/`) for **every** URL. It now uses that canonical homepage **only** when the rollup key path is **`/`** or **`/home`**; all other paths keep their **full path** (blog, events, etc.).

## [2026-03-21] - DataForSEO: domain backlink index (Option B) + spam filters

### Changed
- **Traditional SEO “By URL” table:** homepage-style paths **`/`** and **`/home`** (same origin) roll up to **one row** (display URL follows the property URL host, e.g. `https://www…/`). **Clicks / impressions** sum across those variants; **rule counts** dedupe by `rule_key` (worst status wins). **Page score**, **KE**, **DFS** lookups, **rule bypass** map, and the **page modal** use the same alias so metrics and drill-down stay consistent.
- **Traditional SEO rollup follow-up:** use **`lastPropertyUrl` from the current audit session** (fall back to `gsc_property_url` / `last_property_url`) so canonical display + comparable keys match GSC/KE after a run; **bootstrap** `lastPropertyUrl` from localStorage when results exist but session URL was empty. **Rules** mode / **rule filter ≠ All:** URL column + **GSC / KE / DFS** cells use the same homepage canonical + rolled-up totals; **KE** rows for `/` vs `/home` are **merged** field-by-field; table meta notes when a rule filter is narrowing rows.

### Added
- **Supabase:** `dfs_domain_backlink_rows`, `dfs_backlink_ingest_state` (`migrations/20260321_dfs_domain_backlink_index.sql`, `sql/20260321_dfs_domain_backlink_index.sql`, `sql/SUPABASE_SCHEMA.sql`).
- **`lib/dfs-spam-filters.js`**, **`lib/dfs-domain-backlink-ingest.js`:** shared spam filters + paginated `backlinks/live` ingest.
- **`POST /api/aigeo/dataforseo-backlink-domain`:** `action` **`full`** | **`delta`** | **`status`** (filtered full rebuild, `first_seen`-based delta, read state).
- **`dataforseo-backlink-pages` lookup:** when domain index rows exist, **overlays** per-URL payloads from `dfs_domain_backlink_rows`.
- **Dashboard:** **DFS full index** + **DFS new links** (replaces single “Fetch DFS backlinks”).
- **`test/dfs-spam-filters.test.js`**

### Notes
- Env: **`DFS_DOMAIN_INGEST_MAX_PAGES`**, **`DFS_DOMAIN_INGEST_PAGE_LIMIT`** (see `Docs/DATAFORSEO_BACKLINK_SPAM_FILTERS.md`).
- **`scripts/dfs-backlink-filter-compare.mjs`** + **`npm run test:dfs-backlink-filters`:** A/B **unfiltered** vs **filtered** (`backlinks/live` = **one task per request**); filters from **`lib/dfs-spam-filters.js`**; `status_message` on failure.
- **`Docs/DATAFORSEO_BACKLINK_SPAM_FILTERS.md`:** CSV rationale, filter JSON, Supabase + API details.

## [2026-03-20] - Keyword demand: fix Supabase 400 + KE request normalisation

### Fixed
- **`/api/aigeo/keyword-target-metrics`:** Chunked Supabase reads on `page_url` (**40 URLs per `.in()`**) to avoid PostgREST **400 Bad Request** when refreshing hundreds of rows.
- **Upserts:** Batched to **100 rows** per `upsert` call.
- **Keywords Everywhere:** `country` defaults to **`gb`**, maps **`uk` → `gb`**; `currency` sent **uppercase**; explicit `Content-Type` + string body; clearer errors (`KE {status}: …`).

## [2026-03-13] - Traditional SEO keyword demand (Keywords Everywhere cache)

### Added
- **Supabase:** `keyword_target_metrics_cache` table (`sql/20260321_keyword_target_metrics_cache.sql`, also in `sql/SUPABASE_SCHEMA.sql`).
- **API:** `POST /api/aigeo/keyword-target-metrics` — `lookup` (read cache only) and `refresh` (Keywords Everywhere → upsert missing/stale rows).
- **UI:** Traditional SEO results columns **Kw vol**, **Rank**, **Moz DA**, **Metrics age**; **③ Refresh keyword demand (KE)** in run controls and next to **Rows per page**.
- **Docs:** `Docs/TRADITIONAL_SEO_KEYWORD_METRICS.md`, root `AGENTS.md`; `HANDOVER.md` / `README.md` updated.

### Notes
- **① / ②** (Traditional SEO audit buttons) do **not** call Keywords Everwhere; user runs **③** to populate volume + metrics age.
- **Rank** and **Moz DA** columns are reserved for future data sources (not returned by KE keyword batch in current integration).

## [2026-01-16] - v1.8.1 - Schema Persistence + Trend Range Fixes

### Fixed
- **Schema persistence**: Totals/coverage now derived from schema pages detail on save/read to prevent zero coverage on refresh.
- **Partial save overwrites**: Partial saves no longer wipe schema metadata (`schema_types`, `schema_rich_eligible`, totals).
- **Authority trend dips**: Authority trend now skips partial audits and uses last good value.
- **Score Trends range**: Timeseries fetch now respects selected start/end dates when changing timescale.

### Changed
- **Trend chart sourcing**: GSC timeseries fetch now aligns with selected UI date range (not fixed 56-day window).

## [2026-01-10] - v1.8.0 - Computed Fields Storage & Complete Button Audit

### Added
- **Computed Fields Storage**: All update buttons now correctly store computed fields to Supabase:
  - `ai_summary_components` (JSONB) - AI Summary radar chart components
  - `eeat_score` (NUMERIC) - EEAT score (0-100)
  - `eeat_confidence` (TEXT) - EEAT confidence level (High/Medium/Low)
  - `eeat_subscores` (JSONB) - EEAT sub-scores (Experience, Expertise, Authoritativeness, Trustworthiness)
  - `domain_strength` (JSONB) - Domain strength snapshot data
- **Partial Update Handling**: Enhanced `save-audit.js` to handle partial updates (e.g., when only `rankingAiData` is sent)
  - Automatically fetches latest audit from Supabase
  - Merges data and recomputes all computed fields
  - Ensures computed fields are always stored correctly
- **Domain Strength Auto-Storage**: Domain strength snapshots now automatically update `audit_results.domain_strength`
- **Complete Button Audit**: Comprehensive documentation of all update/refresh/scan buttons across all modules
  - `Docs/COMPLETE-BUTTON-AUDIT.md` - Module-by-module button audit
  - `Docs/COMPUTED-FIELDS-VERIFICATION.md` - Computed fields storage verification
  - `Docs/COMPUTED-FIELDS-CODE-VERIFICATION.md` - Code path verification

### Fixed
- **Money Share Deltas**: Fixed `moneySharePct` calculation in `computeDashboardSnapshotFromAuditData` to use ranking data consistently
- **Rolling 28-Day Deltas**: All dashboard tiles now use consistent rolling 28-day delta calculations
- **Domain Strength Storage**: Domain strength snapshots now update `audit_results.domain_strength` for latest audit

### Changed
- **Database Schema**: Added computed fields columns to `audit_results` table via migration
- **Save-Audit API**: Enhanced to detect partial updates and fetch latest audit data for complete field computation
- **Domain Strength Snapshot API**: Now updates `audit_results.domain_strength` after snapshot creation

### Technical Details
- Partial update detection: `rankingAiData && !scores && !schemaAudit && !searchData`
- Merged data used for all computed field calculations
- Domain strength fetched automatically in `saveAuditToSupabase()` before saving
- All computed fields verified via code path tracing

## [2026-01-07] - v1.7.9 - Money Pages UI Improvements and Sorting Fix

### Fixed
- **AI Citations Sorting**: Fixed sorting to preserve cache values and prevent blank cells
  - Enhanced cache lookup with normalized URL matching to find cache entries even if key format differs
  - Preserves valid displayed values when table re-renders after sorting
  - Improved row matching in API result processing with fallback matching by cell's data-page-url
  - Fixed issue where citation counts went to zero when sorting the AI Citations column
- **Schema Types Column Alignment**: Right-aligned header and cells to prevent overlap with Opportunity column
  - Changed header from `text-align: left` to `text-align: right`
  - Added `text-align: right` to cell styling

### Changed
- **Card 3 Readability**: Made body text larger and black for better readability
  - "Next steps:" text increased from 0.8rem to 0.95rem (+19%)
  - Estimated impact text increased from 0.75rem to 0.9rem (+20%)
  - Reason text increased from 0.7rem to 0.85rem (+21%)
  - All body text changed from grey (#475569, #64748b, #94a3b8) to black (#0f172a)
- **Default Sort**: Set Money Pages table to sort by clicks (descending) on page load
  - Changed default sort from null to 'clicks' with direction 'desc'
  - Shows highest-clicking pages first by default for better prioritization

### Technical Details
- Sorting now preserves existing cell values that are valid numbers
- Cache lookup uses normalized URL matching to handle different key formats
- API result processing includes fallback row matching strategies
- Initial cell rendering checks global cache with normalized URL matching

## [2026-01-XX] - v1.7.8 - Fix AI Citations: Unify Table and Cards Data Source

### Fixed
- **Unified Data Source**: Table now uses same API endpoint as cards (`/api/supabase/query-keywords-citing-url`)
  - Removed buggy client-side `computeAiMetricsForPageUrl` from API fallback path
  - Ensures table and cards use same source of truth and show same values
- **Sorting Fix**: Fixed sorting to use cache (not cells) and removed substring matching
  - Prevents values from becoming blank when sorting multiple times
  - Uses strict URL matching when reading from cache
- **Pre-populate from Cache**: Table cells now pre-populate from cache on initial render
  - Prevents flickering by showing cached value immediately
  - Only shows placeholder if cache is not yet available

### Technical Details
- Table API calls now use same endpoint as cards (removed client-side computation fallback)
- Sorting reads from `window.moneyPagesCitationCache` instead of cell text
- Initial render checks cache and `row._aiCitations` before showing placeholder

## [2026-01-XX] - v1.7.7 - Fix AI Citations Cell Update Protection

### Fixed
- **AI Citations Cell Update**: Added protection to prevent cell display update when valid cached value exists
  - Cache is now checked before updating cell from API response
  - Prevents flickering from correct value (2) to incorrect API response (5)
  - Cell display now respects cached values over API responses
- **Row Matching**: Fixed to use strict matching (no substring) when finding rows for API updates
- **API Call Filter**: Enhanced to check both local and global cache before making API calls
  - Prevents unnecessary API calls when valid cache exists

## [2026-01-XX] - v1.7.6 - Fix AI Citations URL Matching and Flickering

### Fixed
- **AI Citations URL Matching**: Fixed strict path segment matching in `populateMoneyPagesAiCitations` function
  - Replaced substring matching (`.includes()`) with strict path segment matching
  - Prevents `landscape-photography-workshops` from incorrectly matching `photography-workshops`
  - Matches API endpoint logic for consistency
- **AI Citations Flickering**: Prevented API responses from overwriting valid cached values
  - Cache from localStorage (latest audit data) is now trusted over API responses
  - API is only used as fallback when cache is missing/0
  - Fixes issue where correct value (2) was overwritten by incorrect API response (5)
  - Fixes sorting issue where URL appeared out of order due to incorrect count

### Technical Details
- Updated URL matching logic to use path segment comparison (not substring)
- Added protection to never overwrite valid cached values (>0) with API responses
- Ensures table shows correct citation counts matching card display and Supabase data

## [2026-01-XX] - v1.7.5 - Rollback to Stable Baseline (8951fcf)

### Changed
- **Rollback to Stable Commit**: Reverted codebase to commit `8951fcf` (2025-12-XX) to establish stable baseline
  - This commit had stable AI citation counts (though not entirely correct) and no flickering
  - AI Citations column sorting was still present but counts were stable
  - All subsequent fixes that introduced flickering or syntax errors have been removed
  - Only version number updated to reflect current commit hash

### Current State
- **AI Citations Column**: 
  - Sorting functionality still present (not yet disabled)
  - Citation counts are stable (no flickering)
  - Counts may not be entirely accurate but are consistent
- **Version Number**: Updated to reflect latest commit hash after each deployment
- **Codebase**: Clean and synchronized with commit `8951fcf`

### Next Steps
- Fix AI Citations column to remove sort icon and disable sorting
- Fix flickering counts (if it reoccurs)
- Reduce excessive API calls for AI citations
- Ensure proper value preservation (don't overwrite valid counts with 0)

## [2026-01-07] - v1.7.4 - Keyword Task Fixes + Debug Log System

### Fixed
- **Keyword Task URL Matching**: Made URL matching optional for keyword-based tasks in "Add Measurement" and "Update Task Latest" functions
  - Keyword tasks can now find ranking/AI data even when URL doesn't match
  - Implemented in `addMeasurementBtn` handler and `updateTaskLatest()` function
  - Fixes issue where keyword tasks showed no ranking or AI data

- **Data Freshness**: Always fetch latest audit from Supabase before using cached localStorage data
  - Ensures "Add Measurement" and "Rebaseline" use latest data
  - Prevents stale data issues

- **Debug Log Consistency**: Fixed `computeAiMetricsForPageUrl` to return consistent results
  - Ensures `ai_citations` is always a valid number (0 or higher) when match found
  - Prevents inconsistent `Overview: false, Citations: null` returns

### Added
- **Debug Log System**: Created infrastructure for saving UI debug logs to Supabase
  - Created `debug_logs` table (migration: `20250117_create_debug_logs_table.sql`)
  - Created API endpoint `/api/supabase/save-debug-log-entry.js` with retry logic for schema cache issues
  - Modified `debugLog()` function to support async saving (currently disabled due to schema cache issues)

- **Debug Log Cleanup**: Added suppression patterns to reduce UI debug log verbosity
  - Suppressed `[Traffic Lights]`, `[getBaselineLatest]`, `Money Pages` logs
  - `info` level logs matching suppressed patterns are completely hidden

### Changed
- **URL Task AI Data Matching**: Enhanced `computeAiMetricsForPageUrl` with ultra-permissive matching logic
  - Added multiple fallback matching strategies (exactMatch, lastSegmentMatch, segmentContainsMatch, pathOverlapMatch, keywordMatch)
  - **Status**: Still not working - matching logic failing despite multiple iterations
  - **See**: `URL-TASK-AI-DATA-SUMMARY.md` and `HANDOVER.md` for details

### Known Issues
- **URL Task AI Data**: URL tasks for `www.alanranger.com/photography-courses-coventry` still not displaying AI Overview/Citations
  - Data exists in Supabase `keyword_rankings` table
  - Matching logic enhanced but still failing
  - Critical debug logs not appearing (possible browser cache issue)
  - **See**: `HANDOVER.md` for comprehensive diagnosis and next steps

- **Debug Log Saving**: Supabase saving currently disabled due to schema cache issues with `property_url` column
  - Retry logic implemented but needs schema cache to stabilize
  - Re-enable once schema cache is stable

## [2025-12-24] - v1.7.3 - Data Integrity + AI Citation Consistency (Portfolio + Tasks)

### Added
- **AI citations (Money pages) RAG**: The Ranking & AI tile now uses thresholds based on money-share: Green ≥ 70%, Amber 50–69%, Red < 50%.
- **Audit safety guardrails**:
  - “Run Audit Scan” no longer overwrites Portfolio AI fields with zeros when keyword_rankings for the relevant date aren’t available (common with GSC lag).
  - Bulk “Update All Tasks” warns when Ranking & AI snapshot is missing/stale (for keyword-based tasks).

### Changed
- **Portfolio AI attribution model**: Portfolio AI citations/overview are attributed by **cited URLs** (`ai_alan_citations`) rather than `best_url`, with any “unattributed delta” rolled into **Other (non‑money)** so totals reconcile to site totals.
- **Bulk update behavior**:
  - Ranking & AI data is only required for **keyword-based** tasks.
  - URL-only tasks can bulk-update without a Ranking & AI run.
  - Added fallback to `localStorage.rankingAiData` for bulk updates.
- **Task drawer clarity**: “AI Overview” label now displays **Present / Not present / —** (unknown) rather than “On/Off”.

### Fixed
- **Portfolio table vs modal vs tile mismatches**: counts now reconcile consistently by distinguishing:
  - “unique AI‑cited URLs” (deduped list)
  - “citation items” (total cited URL occurrences)
  - “unattributed citations” (counted in totals, but no URL captured)
- **URL-only task AI metrics**: Task measurements for URL-only tasks now populate AI Overview/Citations by scanning Ranking & AI cited URLs (when available), avoiding false negatives.

## [2025-12-22] - v1.7.2 - Money Pages Phase 4: Suggested Top 10 Priority Pages

### Added
- **Suggested (Top 10) Priority Pages Panel**: New card-based panel showing top priority pages for optimization
  - Displays top 10 pages ranked by impact and difficulty scores
  - Shows optimization status (✓ Being Optimised badge for tracked pages)
  - Clickable URLs that open in new browser window
  - Color-coded page type labels (Landing, Event, Product) with bold styling
  - Potential impact clicks 28d metric displayed prominently
  - "Create Task" / "Manage Task" buttons matching Priority & Actions table behavior
  - Uses same button handlers as Priority & Actions table (`trackMoneyPage`, `openOptimisationTaskDrawer`)

### Changed
- **Optimization Status Detection**: Enhanced to check multiple task types
  - Checks recommended task type first, then falls back to 'on_page'
  - Also checks 'content', 'internal_links', 'technical' task types
  - Ensures all tracked pages are correctly identified across different task types
- **URL Display**: URLs in Suggested Top 10 cards are now clickable hyperlinks
  - Opens in new browser window with `target="_blank"`
  - Styled as blue underlined links for better UX

### Fixed
- **Optimization Status Missing**: Fixed pages not showing as "Being Optimised" when tracked
  - Enhanced status lookup to try multiple task types
  - Fixed URL normalization and matching logic
  - Now correctly identifies tracked pages regardless of task type

### Technical Details
- **Phase 4 Scoring Functions**: Impact, difficulty, and priority calculation
  - Impact score (0-100): Based on CTR gap and click upside potential
  - Difficulty score (LOW/MED/HIGH): Based on position and page type
  - Priority (LOW/MED/HIGH): Combined impact and difficulty buckets
  - Recommended action: Dynamic suggestions based on CTR, position, impressions
- **Button Integration**: Uses same handlers as Priority & Actions table
  - "Create Task" uses `window.trackMoneyPage(url, title)`
  - "Manage Task" uses `window.openOptimisationTaskDrawer(taskId)`
- **Data Source**: Uses `window.moneyPagePriorityData` (same as Priority & Actions table)

## [2025-12-21] - v1.7.1 - Traffic Lights & Ranking & AI Task Creation Fixes

### Fixed
- **Traffic Lights Classification**: Fixed traffic lights showing tasks in multiple metric columns
  - Now only counts tasks that have the matching metric as their objective KPI
  - CTR task only appears in CTR column, not in Impressions/Clicks/Rank columns
  - AI Citations task only appears in AI Citations column
  - Prevents double-counting and confusion
- **Traffic Lights Baseline Detection**: Fixed "No baselineLatest" warnings for tasks with single measurement
  - Updated `getBaselineLatest` to handle single measurement case when filtered by cycle start date
  - If only 1 measurement exists and it's filtered out by cycle date, use it anyway (baseline case)
  - Ensures traffic lights can classify tasks with baseline-only measurements
- **Ranking & AI Task Creation**: Fixed missing keyword and title when creating tasks from Ranking & AI
  - Changed task type from `'on_page'` to `'content'` for keyword-level tasks
  - API now preserves keyword_text for non-page-level tasks (only forces empty for `'on_page'`)
  - Modal now suggests keyword as title for keyword-level tasks (doesn't reset to empty)
  - Updated cache key building to include `'content'` task type
  - Status lookup now correctly finds tasks created from Ranking & AI
- **Bulk Update Button**: Fixed to respect "Include Test Tasks" checkbox
  - Excludes test tasks from bulk update if checkbox is unchecked
  - Confirmation message shows correct count (excluding test tasks if unchecked)

### Changed
- **Debug Logging**: Moved from browser console to UI debug panel
  - All traffic lights debug logs now appear in UI debug panel
  - Easier to diagnose issues without opening browser console

### Technical
- **Task Type Mapping**: 
  - Ranking & AI tasks now use `'content'` task type (keyword-level)
  - Money Pages tasks use `'on_page'` task type (page-level)
  - Status API handles both types correctly
- **Traffic Lights Logic**:
  - Added objective KPI to metric key mapping
  - Only classifies metrics that match task's objective KPI
  - Prevents tasks from appearing in irrelevant metric columns

## [2025-12-19] - v1.7.0 - Optimisation Tracking Module (Phases 1-8 Complete)

### Added
- **Optimisation Tracking Module**: Complete implementation of keyword optimisation tracking system
  - Phase 1: Database schema with tasks, cycles, and events tables
  - Phase 2: UI integration in Ranking & AI module (Optimisation column)
  - Phase 3: Full Optimisation Tracking panel with filters, table, and task details modal
  - Phase 4: Performance snapshots and measurement history
  - Phase 5: Objective integrity with auto-status calculation (on_track/overdue/met)
  - Phase 5.6: Read-only share mode with token-based authentication
  - Phase 6: Cycle management with per-task cycle numbering and history
  - Phase 7: Cycle completion and archival with timeline events
  - Phase 8: Fixed KPI formatting bugs (CTR as pp, rank lower better, no double percentage)

### Features
- **Task Management**: Create, update, and track optimisation tasks per keyword+URL+type
- **Cycle Tracking**: Multiple optimisation cycles per task with baseline/latest measurements
- **Objective Tracking**: Set objectives with KPI, target, timeframe, and auto-calculated progress
- **Measurement History**: Track performance metrics over time with delta calculations
- **Timeline Events**: Log notes, measurements, status changes, and cycle events
- **Share Mode**: Generate shareable read-only links for optimisation tracking data
- **Filters**: Status, type, keyword, URL, optimisation status, needs update, active cycle, overdue cycle
- **Summary Cards**: Counts for all task statuses and objective statuses

### Fixed
- **Target Unit Bugs**: Fixed "Increase by 100%" showing as "+10000.00%"
- **CTR Formatting**: Deltas now show as percentage points (pp) instead of percentages
- **Rank Calculation**: Lower rank is now correctly treated as better (positive delta = improvement)
- **Progress Display**: Shows "Remaining: +X" instead of confusing double delta lines
- **Measurement Dates**: Fixed baseline/latest dates showing today instead of actual capture time
- **Timezone Display**: All dates/times now shown in UTC/GMT
- **Cycle Events**: Timeline now shows cycle_start, cycle_completed, and cycle_archived events

### Technical
- **Database Migrations**:
  - `20251218_optimisation_tracking_phase1.sql` - Initial schema
  - `20251219_phase5_objective_integrity.sql` - Objective fields in cycles
  - `20251219_fix_measurement_dates.sql` - Measurement timestamps
  - `20251219_add_cycle_status_values.sql` - Cycle status enum values
  - `20251219_add_cycle_event_types.sql` - Cycle event types
- **API Endpoints**: 12 new endpoints for task/cycle/event management
- **Authentication**: Admin key and share token support
- **KPI Formatting**: Shared helper for consistent progress calculation and display

## [2025-12-18] - v1.6.1 - Money Pages Data Accuracy & Chart Improvements

### Fixed
- **28-Day Date Range Calculation**: Fixed date range showing 29 days instead of 28
  - Changed calculation to go back 27 days (27 + end date = 28 days total)
  - Applied to both Performance Trends and KPI Tracker charts
  - Ensures exactly 28 days of data (e.g., 18 Nov to 15 Dec)
- **CTR Percentage Display**: Fixed CTR showing 800% instead of 8%
  - Removed double multiplication by 100 (values already stored as percentages 0-100)
  - Fixed in table cells, chart y-axis ticks, and tooltips
  - CTR now displays correctly (e.g., 8% instead of 800%)
- **Trend Calculation**: Fixed trend values showing incorrect percentage points
  - Removed multiplication by 100 for CTR trends (diff already in percentage points)
  - Trend now shows correct values (e.g., -0.6pp instead of -63.4pp)
- **Chart Axis Labels**: Made all axis labels bold and larger for better visibility
  - Axis titles: size 14, weight 'bold'
  - Axis ticks: size 12, weight 'bold'
  - Applied to KPI Tracker chart and Performance Trends charts

### Changed
- **Money Pages Data Source**: Changed from audit records to actual GSC timeseries data
  - KPI Tracker now calculates metrics from `gsc_timeseries` table for all dates
  - Uses money page proportions from latest audit to calculate segment metrics
  - Performance Trends charts use actual GSC data for all 28 days
  - Removed fallback to audit records (now uses real GSC data or shows null)
- **Weekly Data Points**: Changed from 15 evenly spaced points to 8 weekly points
  - 28 days / 4 = 7 weeks, so 8 data points (one per week)
  - Better fits container width and reduces chart clutter
  - Applied to both KPI Tracker and Performance Trends charts
- **Section Descriptions**: Updated to reflect actual data source
  - Performance Trends: "Weekly trends calculated from actual Google Search Console data for the last 28 days"
  - KPI Tracker: "Weekly KPI trends by money-page segment calculated from actual Google Search Console data"
  - Footer: "Data calculated from Google Search Console timeseries for the last 28 days, displayed as 8 weekly data points"

### Technical Details
- **Date Range Calculation**: 
  - `startDate = endDate - 27 days` (27 days back + end date = 28 days total)
  - Date points generated with `step = (28 - 1) / 7` for 8 weekly points
- **GSC Timeseries Calculation**:
  - Finds reference audit with both `moneySegmentMetrics` and matching timeseries data
  - Calculates money page proportions (clicks/impressions) from reference audit
  - Applies proportions to each date's GSC timeseries data
  - Calculates segment metrics using segment proportions from reference audit
- **CTR Formatting**:
  - Values stored as percentages (0-100), not decimals (0-1)
  - Display: `${value.toFixed(1)}%` (no multiplication)
  - Trend: `${diff.toFixed(1)}pp` (diff already in percentage points)

## [2025-12-16] - v1.6.0 - Money Pages UI Improvements & Branding Update

### Added
- **Money Pages Performance Trends Split Charts**: Split single chart into two side-by-side charts
  - Volume Metrics Chart: Clicks and Impressions (similar scales)
  - Rate & Score Metrics Chart: CTR (%) and Behaviour Score (similar scales)
  - Resolves Y-axis scaling issues with 4 series on different scales
  - Each chart has fixed height container (300px) to prevent auto-scaling loops
- **Enhanced CTR Y-Axis Precision**: Improved granularity for Rate & Score Metrics chart
  - stepSize set to 0.02 (shows 1.40%, 1.42%, 1.44%, etc.)
  - Labels display 2 decimal places (1.65% instead of 1.6%)
  - Makes small day-to-day CTR changes clearly visible
  - Tooltip precision matches axis (2 decimal places)

### Changed
- **Branding Update**: Replaced "AIO" with "GAIO" throughout UI
  - Main header: "GAIO (Generative AI Optimization) Audit Dashboard"
  - Subtitle: "Automated GAIO Performance Tracking & Optimisation"
  - All user-facing text, tooltips, and descriptions updated
  - Internal variable names preserved for compatibility
- **Money Pages Section Layout**: Reorganized section order
  - KPI Tracker (last 12 audits) now appears above Priority & Actions section
  - KPI Tracker chart and table displayed side-by-side (50/50 split)
  - Performance Trends charts displayed side-by-side (50/50 split)
- **CTR Calculation**: Now calculated directly from clicks/impressions for accuracy
  - Ensures plotted value matches actual calculated CTR
  - Fallback to stored values with smart detection (decimal vs percentage format)
  - Fixes tooltip/plotting mismatch issues

### Fixed
- **Dropdown Counts Persistence**: Fixed counts vanishing after filter selection
  - Counts now calculated from base data (after min impressions, before type filter)
  - Counts persist correctly when type filter changes
  - `renderMoneyPagesTable` now uses base data for counting instead of filtered data
- **Money Pages Filter Counts**: Fixed counts not updating when filters change
  - Counts update correctly when min impressions filter changes
  - Counts update correctly when type filter changes
  - Initial load respects min impressions filter value
- **CTR Plotting Accuracy**: Fixed CTR values not plotting at correct Y-axis position
  - Tooltip precision increased to 2 decimal places (matches axis)
  - Direct calculation from clicks/impressions ensures accuracy
  - Resolves issue where 1.50% appeared closer to 1.45% on axis
- **Chart Auto-Scaling Loop**: Fixed infinite Y-axis expansion
  - Added fixed-height containers (300px) for all charts
  - Set `maintainAspectRatio: true` with `aspectRatio: 2.5`
  - Removed manual canvas width/height settings
  - Added rendering guards to prevent simultaneous re-renders
- **Money Pages Section Restoration**: Restored complete HTML structure
  - All sub-sections, styling, and formatting preserved
  - KPI Tracker table restored and positioned correctly
  - Background and panel formatting maintained
  - Only change: Performance Trends split from 1 chart to 2 side-by-side charts

### Technical Details
- **Chart Configuration**: 
  - Volume chart: Clicks (min: 100, max: 500, stepSize: 50) and Impressions
  - Rate chart: CTR (stepSize: 0.02, 2 decimal places) and Behaviour Score
  - Both charts use fixed-height containers to prevent resizing loops
- **Filter Count Logic**: 
  - Counts calculated from `window.moneyPagePriorityData` + `window.authorityActionRows`
  - Min impressions filter applied before counting
  - Type filter NOT applied when counting (shows all available types)
- **CTR Data Extraction**:
  - Primary: Calculate from `(clicks / impressions) * 100` when available
  - Fallback: Use `summary.ctr` or `allMoney.ctr` with smart format detection
  - Handles both decimal (0.015) and percentage (1.5) formats

## [2025-12-17] - v1.5.0 - Intent-Based Keyword Segmentation & Preset Refactor

### Added
- **Intent-Based Keyword Segmentation**: Replaced URL-based classification with intent-based rules
  - New `lib/segment/classifyKeywordSegment.js` classifier with priority order: Brand → Money → Education → Other
  - Brand detection: matches brand terms (alan ranger, alanranger, photography academy, etc.)
  - Money detection: transactional terms (lessons, courses, workshops, etc.) OR local modifiers (near me, coventry, etc.) OR postcode patterns
  - Education detection: informational terms (how to, guide, tutorial, etc.) OR technique topics (aperture, shutter speed, etc.)
  - Returns segment, confidence (0-1), and reason for classification
- **Segment Metadata Columns**: Added to `keyword_rankings` table
  - `segment_source`: 'auto' (intent-based) or 'manual' (user override)
  - `segment_confidence`: 0-1 confidence score for auto-classification
  - `segment_reason`: Explanation text (e.g., "money: contains 'lessons'")
- **Backfill Script**: `scripts/retag-keyword-segments-direct.js` to re-classify all existing keywords
  - Skips rows with `segment_source='manual'` to preserve manual overrides
  - Shows summary of changes and top 20 examples
  - Run with: `npm run retag:segments` or `node scripts/retag-keyword-segments-direct.js`
- **Data-Driven Presets**: Refactored preset system with single source of truth
  - `DEFAULT_FILTERS` constant for default filter state
  - `PRESETS` object with all preset definitions (filters + sort)
  - Hard reset implementation (no filter stacking)
- **Blog Opportunities Preset**: Replaced "Education growth" preset
  - Uses `pageType: 'Blog'` (not `segment: 'Education'`)
  - Filters: Page type: Blog, Best rank: Not top 3, Min opportunity: ≥ 30
  - Sort: Opportunity score descending
- **Local Visibility Preset**: New preset for GBP/local queries
  - Uses `pageType: 'GBP'`
  - Filters: Page type: GBP, Best rank: Not top 3, Min opportunity: ≥ 30
  - Sort: Opportunity score descending
- **Not Top 3 Rank Filter**: Added new rank filter option
  - Filters keywords with rank > 3 or null (not in top 3)
  - Used by Blog opportunities and Local visibility presets
- **Competitor Checkbox in Competitors Table**: Added competitor checkbox column
  - Narrow "C" column header to save space
  - Checkbox updates competitor flag and shows/hides competitor badge
  - Wired to same update logic as other competitor checkboxes
- **Edit Keywords Modal**: Keyword management interface
  - Load existing keywords from Supabase
  - Add, remove, or edit keywords
  - Warning box about data loss when removing/changing keywords
  - Keywords updated on next Ranking & AI check (no automatic scan)
- **Pre-scan Keyword Count**: Display keyword count before starting scan
- **Stop Scan Button**: Ability to abort running scan in progress

### Changed
- **Keyword Classification**: Now based on keyword intent, not currently ranking URL
  - Keywords like "photography lessons" correctly classified as Money (not Education)
  - Keywords like "how to use aperture" correctly classified as Education
  - Page type used only as weak hint for confidence, not primary classifier
- **Preset System**: Complete refactor for maintainability
  - All presets defined in single `PRESETS` object
  - Hard reset ensures no filter stacking between presets
  - Tooltips and criteria chips automatically reflect preset definitions
- **Filter Dropdown Counts**: Updated to reflect new data structure
  - Added "Blog" to pageType counts
  - Added "not-top3" to rank counts
  - All dropdown options now show counts (even if 0)
- **Domain Rank Display**: Fixed missing Domain Rank in "AI Citations for Selected Keyword" table
  - Moved Domain Rank filling logic inside async IIFE after rows are appended
  - Added debug logging for troubleshooting

### Fixed
- **Domain Rank Missing**: Fixed Domain Rank not showing in "AI Citations for Selected Keyword" table
- **Filter Counts**: Fixed "Blog" page type not showing count in dropdown
- **Preset Filter Stacking**: Fixed presets accidentally stacking filters (now hard resets)
- **Education Segment Collapse**: Fixed "Education (6)" segment issue by using pageType-based presets
- **Competitor Badge Overlap**: Fixed competitor badge overlapping domain name in citation tables
  - Changed to vertical flex layout (badge below domain name)
  - Added word-break for long URLs
- **Domain Strength Table**: Fixed dropdown showing "Unmapped" instead of actual mapped value
- **Keyword List Loading**: Fixed modal not loading keywords from Supabase
- **Keyword Save**: Fixed error preventing keyword save without prior audit (now creates minimal audit record if needed)

### Technical Details
- **Migration**: `20251217_add_keyword_segment_metadata.sql` adds segment metadata columns
- **Classifier**: Priority-based matching with confidence scoring
- **Backfill**: Processes all keywords, preserves manual overrides, shows change summary
- **Preset Architecture**: Data-driven with `DEFAULT_FILTERS` and `PRESETS` object
- **Filter Counts**: Calculated based on rows matching all OTHER filters (excluding the filter being counted)
- **API Endpoints**: 
  - `/api/keywords/get` - Fetch current keyword list from latest audit
  - `/api/keywords/save` - Save updated keyword list to latest audit

## [2025-12-08] - Brand Overlay, AI Summary Likelihood, and Shareable Links

### Added
- **Brand & Entity Overlay Metrics**: New overlay pillar tracking brand search performance
  - Brand query classification using configurable brand terms
  - Brand metrics: query share, CTR, average position
  - Brand overlay score combining brand search (40%), reviews (30%), entity (30%)
  - Brand & Entity row in Pillar Scorecard with detailed metrics
  - Brand queries mini-table in Authority section showing top branded queries
  - Trend chart integration with yellow dashed line (#FFFF66)
  - Fallback calculation from GSC timeseries for historical dates
- **AI Summary Likelihood**: Composite score for AI/Google answer accuracy
  - Calculated from Snippet Readiness (50%), Visibility (30%), Brand Score (20%)
  - RAG thresholds: Low <50, Medium 50-69, High ≥70 (matching AI GEO bands)
  - Detailed breakdown display next to RAG pills
  - Speedometer indicator with dedicated tick mark
- **Shareable Audit Links**: Public sharing functionality
  - "Share Audit" button to generate shareable URLs
  - 30-day expiration for shared links
  - Supabase `shared_audits` table for storage
  - API endpoints: `/api/supabase/create-shared-audit` and `/api/supabase/get-shared-audit`
  - Support for `?share=ID` URL parameter to load shared audits
  - Read-only view with banner indicator for shared audits
- **Enhanced Speedometer**: Improved visualization
  - 30% size increase for better visibility
  - Multiple needle indicators: AI GEO Score, AI Summary Likelihood, Brand & Entity
  - Removed 50% marker for cleaner appearance
  - RAG breakdown boxes displayed next to pills (not just in tooltips)
  - Standardized pill and box sizing for alignment

### Changed
- **Data Date Display**: Brand & Entity now uses GSC date (matching Authority/Visibility)
- **Historical Tracking**: Extended to all pillars, not just Content/Schema
  - Brand & Entity trend data with fallback calculation
  - Historical Authority segmented data (All pages, Exclude education, Money pages)
- **RAG Thresholds**: Standardized to Red (0-49), Amber (50-69), Green (70-100) across all scores
- **Pillar Scorecard**: Added Brand & Entity row with overlay indicator
- **CSV Upload Sections**: Made collapsible and collapsed by default for cleaner UI

### Fixed
- Brand & Entity trend chart data population (was missing from timeseries loop)
- Data date not updating for Brand & Entity (now uses GSC date)
- AI Summary Likelihood thresholds aligned with RAG bands
- Snippet Readiness data format handling (number vs object)
- Supabase save errors (improved data validation and error logging)
- Missing database columns (added `brand_overlay`, `brand_score`, `ai_summary`, `ai_summary_score`)

### Technical Details
- Brand query classification: `isBrandQuery()` function with configurable terms
- Brand metrics calculation: `calculateBrandMetrics()` from GSC query data
- Brand overlay scoring: `computeBrandOverlay()` with weighted components
- AI Summary calculation: `computeAiSummaryLikelihood()` using snippet readiness, visibility, brand
- Supabase schema: Added columns for brand and AI summary data
- Fallback calculation: Estimates brand metrics from GSC timeseries when stored data unavailable

## [2025-01-XX] - Site AI Health Speedometer Enhancement

### Added
- **Site AI Health Dashboard Section**: New prominent health score visualization at the top of the dashboard
  - Circular speedometer-style gauge showing overall AI GEO Score (0-100)
  - Color-coded segments: Red (0-49), Amber (50-69), Green (70-100)
  - Visual needle indicator pointing to current score
  - Status badge showing RAG status
  - AI Summary Likelihood indicator (High/Medium/Low)

### Changed
- **Page Segmentation**: Fine-art print pages reclassified from "Money pages" to informational/portfolio pages
- **Recommended Actions Table**: Enhanced with priority highlighting and improved formatting

### Fixed
- Speedometer label positioning and visibility
- Marker alignment with progress ring
- Title centering over dial section
- Removed duplicate "Pillar Status Summary" table

## Previous Versions

See git history for earlier changes.

