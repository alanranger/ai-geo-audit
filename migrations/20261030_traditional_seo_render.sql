-- Traditional SEO rendered-audit snapshots (fault monitor folded into Trad SEO).
-- RLS on, no policies: service role only.

create table if not exists public.traditional_seo_render_pages (
  run_id uuid not null,
  url_key text not null,
  page_url text not null,
  checked_at timestamptz not null default now(),
  outcome text not null default 'checked',
  reason text,
  http_status integer,
  extract_row jsonb not null default '{}'::jsonb,
  findings jsonb not null default '{}'::jsonb,
  html_len integer not null default 0,
  primary key (run_id, url_key)
);
create index if not exists idx_trad_seo_render_pages_checked
  on public.traditional_seo_render_pages (checked_at desc);

create table if not exists public.traditional_seo_broken_link_pages (
  run_id uuid not null,
  url_key text not null,
  page_url text not null,
  checked_at timestamptz not null default now(),
  outcome text not null default 'checked',
  status text not null default 'warn',
  note text,
  primary key (run_id, url_key)
);

alter table public.traditional_seo_render_pages enable row level security;
alter table public.traditional_seo_broken_link_pages enable row level security;
