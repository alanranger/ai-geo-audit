-- Domain Strength v1.3: Domain type classification fields
-- Purpose: Add fields to track domain_type source, confidence, and reason

-- Ensure domain_strength_domains table exists with all required fields
create table if not exists public.domain_strength_domains (
  domain text primary key,
  label text,
  domain_type text,
  domain_type_source text,
  domain_type_confidence int,
  domain_type_reason text,
  segment text null, -- Keep for backward compatibility
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Add columns if they don't exist (idempotent)
alter table public.domain_strength_domains
  add column if not exists label text;

alter table public.domain_strength_domains
  add column if not exists domain_type text;

alter table public.domain_strength_domains
  add column if not exists domain_type_source text;

alter table public.domain_strength_domains
  add column if not exists domain_type_confidence int;

alter table public.domain_strength_domains
  add column if not exists domain_type_reason text;

alter table public.domain_strength_domains
  add column if not exists segment text;

alter table public.domain_strength_domains
  add column if not exists notes text;

alter table public.domain_strength_domains
  add column if not exists created_at timestamptz;

alter table public.domain_strength_domains
  add column if not exists updated_at timestamptz;

-- Set defaults for created_at and updated_at if null
update public.domain_strength_domains
set created_at = now()
where created_at is null;

update public.domain_strength_domains
set updated_at = now()
where updated_at is null;

-- Make created_at and updated_at not null
alter table public.domain_strength_domains
  alter column created_at set default now(),
  alter column created_at set not null;

alter table public.domain_strength_domains
  alter column updated_at set default now(),
  alter column updated_at set not null;

-- Create indexes
create index if not exists idx_domain_strength_domains_domain_type
  on public.domain_strength_domains(domain_type);

create index if not exists idx_domain_strength_domains_domain_type_source
  on public.domain_strength_domains(domain_type_source);

-- updated_at trigger
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_domain_strength_domains_updated_at on public.domain_strength_domains;

create trigger trg_domain_strength_domains_updated_at
before update on public.domain_strength_domains
for each row execute function public.set_updated_at();

