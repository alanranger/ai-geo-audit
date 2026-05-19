# Canonical decision — two near-duplicate Academy landing pages

> **REVERSAL — 2026-05-19 (later the same day)**
>
> Alan clarified that `/free-photography-course` is **not** a duplicate
> landing page — it is the **banner page** that anchors the FREE Online
> Photography Course section on the home page (the cream/peach poster with
> "FREE Online Photography Course" + ENROL NOW). Removing it would break the
> home-page banner experience.
>
> The 301 redirect described below for `/free-photography-course →
> /free-online-photography-course` was **removed by Alan from Squarespace
> URL Mappings on 2026-05-19**. The page is now back to serving 200 OK with
> banner content (see `03-free-photography-course.html` v4 for the new
> banner-page rewrite).
>
> The `/online-photography-course → /free-online-photography-course` 301
> remains live and correct (different URL, no banner role).
>
> Treat the section below as **historical / partially invalidated**. The
> diagnosis of duplicate intent was right; the proposed fix was wrong for
> `/free-photography-course` because it ignored the home-page anchor role.

---

There are currently two pages targeting the same intent ("learn photography
online for free with Alan Ranger Academy"):

| URL | GSC clicks / 28d | Impressions / 28d | CTR | Avg position | Notes |
|---|---:|---:|---:|---:|---|
| `/free-online-photography-course` | **660** | **47.6K** | 1.4% | 14.3 | Older URL. Ranks #1 organically for `free online photography course` (480/mo) and #2 for `online photography course` (1,000/mo). Strongest backlink and click history. |
| `/free-photography-course` | (not in current GSC sample) | — | — | — | Newer / cleaner variant. Same H1 region: "Start your FREE Online Photography Course Today". |

Hosting both is splitting Google's signal between the two URLs. Almost
certainly costing rankings on the head term `online photography course`
(currently #2 — could be #1 if signal was consolidated).

## Recommendation

**Keep `/free-online-photography-course` as the canonical URL.**

Why:
- 660 clicks / 47.6K impressions of demonstrated demand
- #1 organic rank on `free online photography course`
- #2 organic rank on `online photography course` (1,000 vol / month)
- Probable backlink history (since it's the older URL)

**301-redirect `/free-photography-course` → `/free-online-photography-course`.**

In Squarespace:

1. Settings → Advanced → **URL Mappings**
2. Add a line:
   ```
   /free-photography-course -> /free-online-photography-course 301
   ```
3. Save. Verify with `curl -I https://www.alanranger.com/free-photography-course`
   — should return `301` with a `Location: …/free-online-photography-course`
   header.

## Status (2026-05-19, end of day)

- **301 was applied and then reversed.** Alan briefly applied the
  `/free-photography-course → /free-online-photography-course` 301 in
  Squarespace URL Mappings, then removed it when he realised the page is
  the home-page banner anchor. The mapping line has been deleted.
- **The `/online-photography-course → /free-online-photography-course`
  301 remains live** — confirmed via `curl -I` (302→301 chain ending at the
  canonical URL). This one is a true canonical move (no banner role).
- **GSC backfill is still valid.** The sync fix that added Academy URLs to
  the `STRATEGIC_PAGES` allowlist in `api/cron/backfill-money-page-timeseries.js`
  is correct independent of the redirect reversal —
  `/free-online-photography-course` now reads 635 clicks / 45,258 impressions
  / avg position 14.7 for the 2026-04-21 → 2026-05-18 window in
  `gsc_page_timeseries`. That fix stays in.
- **Page rewrite v3** (`02-free-online-photography-course.html`) is the
  current deployable content for the canonical destination. It includes
  Course + FAQPage JSON-LD, an inline author trust block, the YouTube
  comparison table and six pre-trial FAQ entries — designed to close the
  AIO citation gap documented in `ACADEMY_FUNNEL_INVESTIGATION_2026-05.md`.
- **`03-free-photography-course.html` v4** (the file in this folder) is no
  longer a stub. It is the new banner-page content: two Code Blocks
  (Benefits + testimonial; consolidated CTA + teaser to the canonical
  page) that sit below the native Squarespace Banner / Poster section. See
  the file header for the exact "what to delete from the live page"
  checklist.

## Apply order (already followed)

1. Apply the v3 rewrite from `02-free-online-photography-course.html` to
   the canonical page (destination in its best converting shape first).
2. Apply the 301 in Squarespace URL Mappings.
3. Wait 1–2 weeks. Watch the keyword_rankings table — `online photography
   course` should move from #2 toward #1 as signal consolidates.

## Once the redirect is live — verify

After 7 days, run this SQL to confirm Google has processed the redirect
and consolidated signal:

```sql
select audit_date, keyword, best_rank_group, best_url
from public.keyword_rankings
where keyword in ('online photography course','free online photography course','photography course online')
  and audit_date >= current_date - 14
order by audit_date desc, keyword;
```

You should see:

- `best_url` consistently pointing at `/free-online-photography-course`
- `best_rank_group` for `online photography course` trending toward 1
- `/free-photography-course` no longer appearing as a best_url for any of
  these keywords (it should now 301 server-side before DataForSEO can
  index it as a distinct page)
