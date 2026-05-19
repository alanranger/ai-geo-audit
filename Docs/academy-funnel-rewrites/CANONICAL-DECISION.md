# Canonical decision — two near-duplicate Academy landing pages

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

## Timing

- Apply the page rewrite from `02-free-online-photography-course.html` FIRST
  (so the destination page is in its best converting shape).
- Then apply the 301.
- Wait 1–2 weeks. Watch the keyword_rankings table — `online photography course`
  should move from #2 toward #1 as signal consolidates.

## What about the work in 03-free-photography-course.html?

That file exists as a backup option in case Alan wants to A/B the two pages
for a week before redirecting (e.g. to see if the cleaner page converts
better at the same traffic level). If you're going straight to the 301
redirect, you can skip applying it — the URL will be a 301 and any content
on it won't be served.

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
