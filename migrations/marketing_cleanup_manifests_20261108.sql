-- Stage C clean-up (Part 5 / V08, 8 Nov 2026): review → frozen manifest → approval → per-record ledger → verification.
-- This build executes nothing for real: execution is a dry run that records what would happen ("would_do").
create table if not exists public.marketing_cleanup_manifests (
  manifest_id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by text not null,
  mode text not null check (mode in ('test','review')),
  action text not null check (action in ('retain','exclude_routine','reengage_proposal','unsubscribe','archive_profile','review_identity','delete_record')),
  query jsonb,
  query_english text,
  query_version int,
  status text not null default 'frozen' check (status in ('frozen','approved','executed_dry_run','verified','cancelled')),
  counts jsonb not null default '{}'::jsonb,
  items_hash text,
  approved_by text, approved_at timestamptz, approval_text text,
  executed_at timestamptz, verified_at timestamptz, verify_result jsonb,
  status_history jsonb not null default '[]'::jsonb
);
create table if not exists public.marketing_cleanup_items (
  manifest_id uuid not null references public.marketing_cleanup_manifests(manifest_id) on delete cascade,
  person_id uuid not null,
  email text,
  state text not null check (state in ('eligible','protected')),
  protected_reason text,
  op_key text not null unique,
  outcome text check (outcome in ('would_do','skipped_changed','needs_review')),
  outcome_at timestamptz,
  recheck jsonb,
  primary key (manifest_id, person_id)
);
alter table public.marketing_cleanup_manifests enable row level security;
alter table public.marketing_cleanup_items enable row level security;
revoke all on public.marketing_cleanup_manifests from anon, authenticated;
revoke all on public.marketing_cleanup_items from anon, authenticated;
