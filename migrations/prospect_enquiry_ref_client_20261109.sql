-- Prospects update (QUESTION-2026-11-09 (i), revised 15:13): a short enquiry ref (ENQ-0001, generated), the date the
-- enquiry was received (required), and the client ID (customer_person) on every enquiry. The table had 0 rows when
-- this ran, so the new NOT NULL columns need no backfill. Personal data stays service-role only (RLS unchanged).
create sequence if not exists public.prospect_enquiry_ref_seq;
revoke all on sequence public.prospect_enquiry_ref_seq from anon, authenticated;

alter table public.prospect_enquiry
  add column if not exists enquiry_ref text not null default ('ENQ-' || lpad(nextval('public.prospect_enquiry_ref_seq')::text, 4, '0')),
  add column if not exists enquiry_date date not null;
create unique index if not exists prospect_enquiry_ref_idx on public.prospect_enquiry (enquiry_ref);
alter table public.prospect_enquiry alter column person_id set not null;
-- No foreign key on purpose: Marketing clean-up tools may remove customer_person rows; the API validates the link.

comment on column public.prospect_enquiry.enquiry_ref is 'Short human ref, generated: ENQ-0001, ENQ-0002, …';
comment on column public.prospect_enquiry.enquiry_date is 'Date the enquiry was received (required).';
comment on column public.prospect_enquiry.person_id is 'The client ID: an existing customer_person (email, then exact unique name) or a new "prospect" record (no consent change).';
