-- Domain Strength: Add competitor flag and notes
-- Purpose: Allow manual marking of domains as competitors and add notes

alter table public.domain_strength_domains
  add column if not exists is_competitor boolean not null default false,
  add column if not exists competitor_notes text;

-- Create index for competitor queries
create index if not exists idx_domain_strength_domains_is_competitor
  on public.domain_strength_domains(is_competitor)
  where is_competitor = true;

