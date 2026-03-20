# AI GEO Audit — notes for AI coding agents

## Read first

1. **`HANDOVER.md`** — architecture, buttons, Supabase projects, user preferences (no `console.log`; complexity preference; diagnose-before-change).
2. **`Docs/TRADITIONAL_SEO_KEYWORD_METRICS.md`** — Traditional SEO **③** Keywords Everywhere cache, API, DB, deploy pitfalls.

## Critical gotchas

- **Vercel deploys from Git.** If the user only edits files in Dropbox, **nothing reaches production** until `git commit` + `git push` to `main` (repo: `ai-geo-audit`).
- **Supabase project:** production dashboard uses **`igzvwbvgvmzvvzoclufx`** (MCP: `user-supabase-ai-chat`). Do not confuse with **`user-supabase-academy`** (`dqrtcsvqsfgbqmnonkpt`).
- **API routes:** files under `api/` map 1:1 to URLs — do not rename without updating callers.
- **Main UI:** `audit-dashboard.html` (very large). `audit-dashboard-latest.html` is a **redirect stub** to `audit-dashboard.html` with a cache-buster.

## Traditional SEO keyword columns (short)

- **① / ②** = audit scoring only.  
- **③** = keyword **volume** + **metrics age** via KE → `keyword_target_metrics_cache`.  
- **Rank / Moz DA** columns = placeholders until another source writes those fields.

## Where to put new docs

- Feature/spec write-ups → **`Docs/`**  
- Root **`README.md` / `HANDOVER.md`** only for entry points (per project conventions in `HANDOVER.md`).
