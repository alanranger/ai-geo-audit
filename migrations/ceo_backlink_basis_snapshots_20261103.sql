-- Monday brief backlinks (QUESTION 2026-11-03 item 1): one snapshot per week of the figures the brief shows,
-- taken from the live-only dfs_domain_backlink_rows index, with the basis tag it was built on. Next week's
-- deltas compare against this row; a different basis tag shows "—" automatically.
create table if not exists public.ceo_backlink_basis_snapshots (
  property_url text not null,
  week_start date not null,
  basis_tag text not null,
  ingest_run_at timestamptz,
  figures jsonb not null,
  captured_at timestamptz not null default now(),
  primary key (property_url, week_start)
);
alter table public.ceo_backlink_basis_snapshots enable row level security;
