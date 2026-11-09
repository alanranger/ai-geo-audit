-- Prospects (QUESTION-2026-11-09 (p), Alan authorised via GPT): market, value basis, review flag and load de-duplication.
--   customer_market: D2C / B2B by the PURPOSE of this opportunity (personal tuition / workshops = D2C; commercial
--     photography / business training = B2B; a JLR-funded leisure workshop is D2C, the funder goes in notes);
--   value_basis: agreed / quoted / estimated / unknown (+ value_basis_note: rationale and source). value_gbp stays the
--     full order value; an unknown value is not a £0 sale: excluded from totals, its count shown;
--   review_status: recent / revalidate (a flag only: nothing is lost or closed by age);
--   source_ref: the source message id (Gmail), unique per client, so a re-run load updates instead of duplicating.
-- The table had 0 rows when this ran. Personal data stays service-role only (RLS unchanged, no policies).
alter table public.prospect_enquiry
  add column if not exists customer_market text not null default 'unclassified',
  add column if not exists value_basis text not null default 'unknown',
  add column if not exists value_basis_note text,
  add column if not exists review_status text not null default 'recent',
  add column if not exists source_ref text;

alter table public.prospect_enquiry drop constraint if exists prospect_enquiry_customer_market_chk;
alter table public.prospect_enquiry add constraint prospect_enquiry_customer_market_chk check (customer_market in ('D2C', 'B2B', 'unclassified'));
alter table public.prospect_enquiry drop constraint if exists prospect_enquiry_value_basis_chk;
alter table public.prospect_enquiry add constraint prospect_enquiry_value_basis_chk check (value_basis in ('agreed', 'quoted', 'estimated', 'unknown'));
alter table public.prospect_enquiry drop constraint if exists prospect_enquiry_review_status_chk;
alter table public.prospect_enquiry add constraint prospect_enquiry_review_status_chk check (review_status in ('recent', 'revalidate'));

create unique index if not exists prospect_enquiry_source_ref_person_idx on public.prospect_enquiry (source_ref, person_id) where source_ref is not null;
create index if not exists prospect_enquiry_market_idx on public.prospect_enquiry (customer_market);

-- Which channel made each change (the API's via, or prospect_upsert's 'claude' / 'gpt').
alter table public.prospect_enquiry_history add column if not exists via text;
alter table public.prospect_enquiry_history drop constraint if exists prospect_enquiry_history_via_chk;
alter table public.prospect_enquiry_history add constraint prospect_enquiry_history_via_chk check (via is null or via in ('dashboard', 'gpt', 'claude', 'cursor'));

comment on column public.prospect_enquiry.customer_market is 'D2C / B2B by the purpose of this opportunity (not the email domain); unclassified until tagged.';
comment on column public.prospect_enquiry.value_basis is 'agreed / quoted / estimated / unknown. Unknown is excluded from totals (count shown), never a £0 sale.';
comment on column public.prospect_enquiry.value_basis_note is 'Rationale and source of the value (estimates especially).';
comment on column public.prospect_enquiry.review_status is 'recent / revalidate: a visible flag only; no auto-loss or auto-closure by age.';
comment on column public.prospect_enquiry.source_ref is 'Source message id (e.g. Gmail message id); unique per person_id for load de-duplication.';
comment on column public.prospect_enquiry_history.via is 'Channel of the change: dashboard / gpt / claude / cursor.';
