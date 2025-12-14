-- Add table: domain_rank_history
-- Purpose: Store DataForSEO Backlinks summary metrics over time (domain rank time-series)

create table if not exists public.domain_rank_history (
  id bigserial primary key,
  -- Link this snapshot to a specific audit (audit_results.id is UUID in this project)
  audit_id uuid,

  -- Domain we measured (for now always alanranger.com)
  domain text not null,

  -- DataForSEO Backlinks > summary metrics
  rank integer,                       -- "rank" from backlinks.summary (0–100 scale)
  backlinks integer,
  referring_domains integer,
  backlinks_spam_score integer,
  crawled_pages integer,

  created_at timestamptz default now()
);

-- Optional FK link to audit_results (present in this project)
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'audit_results'
  ) then
    alter table public.domain_rank_history
      add constraint domain_rank_history_audit_fk
      foreign key (audit_id) references public.audit_results(id) on delete set null;
  end if;
exception
  when duplicate_object then
    -- constraint already exists
    null;
end $$;

