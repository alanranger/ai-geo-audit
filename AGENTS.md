# AI GEO Audit — notes for AI coding agents

## Read first

1. **`HANDOVER.md`** — architecture, buttons, Supabase projects, user preferences (no `console.log`; complexity preference; diagnose-before-change).
2. **`Docs/TRADITIONAL_SEO_KEYWORD_METRICS.md`** — Traditional SEO **③** Keywords Everywhere cache, API, DB, deploy pitfalls.
3. **`Docs/TRADITIONAL_SEO_BACKLINKS_DFS.md`** — Backlinks product spec: DFS summary tile, per-URL modal, disavow toggle, explicit fetch (no auto-spend on load).
4. **`Docs/DATAFORSEO_BACKLINK_SPAM_FILTERS.md`** — Spam URL filters, domain index tables, **`POST /api/aigeo/dataforseo-backlink-domain`** (`full` / `delta` / `status`), `npm run test:dfs-backlink-filters`.

## Critical gotchas

- **Vercel deploys from Git.** If the user only edits files in Dropbox, **nothing reaches production** until `git commit` + `git push` to `main` (repo: `ai-geo-audit`).
- **Supabase project:** production dashboard uses **`igzvwbvgvmzvvzoclufx`** (MCP: `user-supabase-ai-chat`). Do not confuse with **`user-supabase-academy`** (`dqrtcsvqsfgbqmnonkpt`).
- **API routes:** files under `api/` map 1:1 to URLs — do not rename without updating callers.
- **Main UI:** `audit-dashboard.html` (very large). `audit-dashboard-latest.html` is a **redirect stub** to `audit-dashboard.html` with a cache-buster.

## Traditional SEO keyword columns (short)

- **① / ②** = audit scoring only.  
- **③** = keyword **volume** + **metrics age** via KE → `keyword_target_metrics_cache`.  
- **Pg bl:** disavow in `public/` (`disavow-alanranger-com.txt` + long-name copy); modal loads **`/api/aigeo/disavow-list`** (SPA rewrite used to serve HTML for `.txt` URLs). **`DISAVOW_FILE_PATH`** overrides server read path.  
- **Rank / Moz DA** columns = placeholders until another source writes those fields.
- If **③** failed with **Bad Request**, older builds hit PostgREST limits on huge `.in('page_url', …)` filters — fixed by **chunking reads** in `api/aigeo/keyword-target-metrics.js` (see `Docs/CHANGELOG.md` **2026-03-20**).

## Where to put new docs

- Feature/spec write-ups → **`Docs/`**  
- Root **`README.md` / `HANDOVER.md`** only for entry points (per project conventions in `HANDOVER.md`).
