-- Strategy "Prospects" pipeline (QUESTION-2026-11-09 (i)): non-dated enquiries (1-2-1, mentoring, commissions,
-- corporate training, Academy, vouchers / gifts) feeding the Remedy plan's lever 3 by CASH month.
-- Personal data: RLS on with no policies, so only the service role (server API) can read or write; anon and
-- authenticated have no access. Nothing here is ever copied to Drive.
create table if not exists public.prospect_enquiry (
  id text primary key default gen_random_uuid()::text,
  client_or_org text not null,
  person_id uuid,
  type text not null check (type in ('1-2-1', 'mentoring', 'commission', 'corporate training', 'Academy', 'voucher / gift', 'other')),
  value_gbp numeric(10, 2) not null default 0 check (value_gbp >= 0),
  stage text not null default 'qualify' check (stage in ('qualify', 'quote', 'scheduled', 'booked_paid', 'closed_lost')),
  cash_month date,
  next_action text,
  next_action_date date,
  owner text not null default 'Alan' check (owner in ('Alan', 'GPT', 'Claude')),
  last_touch_at timestamptz,
  source text check (source is null or source in ('email', 'phone', 'web form', 'referral')),
  lost_reason text,
  notes text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists prospect_enquiry_stage_idx on public.prospect_enquiry (stage);
create index if not exists prospect_enquiry_cash_month_idx on public.prospect_enquiry (cash_month);
comment on table public.prospect_enquiry is 'Non-dated enquiries (Strategy Prospects). Personal data: service role only. Weighted £ = value × stage probability, in the cash month.';
comment on column public.prospect_enquiry.person_id is 'Optional link to public.customer_person.person_id.';

-- Every create / stage change / edit, with who and when; the Booking Sheet match for booked_paid lives here.
create table if not exists public.prospect_enquiry_history (
  id bigserial primary key,
  enquiry_id text not null references public.prospect_enquiry (id) on delete cascade,
  at timestamptz not null default now(),
  by text not null,
  from_stage text,
  to_stage text,
  changes jsonb not null default '{}'::jsonb,
  matched_sale jsonb
);
create index if not exists prospect_enquiry_history_enquiry_idx on public.prospect_enquiry_history (enquiry_id, at);
comment on table public.prospect_enquiry_history is 'Stage changes and edits per enquiry; matched_sale = the Booking Sheet sale a booked_paid enquiry was matched to.';

-- Stage probabilities (Alan decides; real conversion is shown beside them once 20+ enquiries have closed, never auto-switched).
create table if not exists public.prospect_stage_config (
  stage text primary key check (stage in ('qualify', 'quote', 'scheduled', 'booked_paid')),
  probability numeric(4, 3) not null check (probability >= 0 and probability <= 1),
  label text not null,
  sort smallint not null,
  set_by text not null default 'migration 2026-11-09 (Alan approved mock-up 15:11)',
  updated_at timestamptz not null default now()
);
insert into public.prospect_stage_config (stage, probability, label, sort) values
  ('qualify', 0.20, 'Qualify', 1), ('quote', 0.40, 'Quote', 2), ('scheduled', 0.75, 'Scheduled', 3), ('booked_paid', 1.00, 'Booked / paid', 4)
on conflict (stage) do nothing;

alter table public.prospect_enquiry enable row level security;
alter table public.prospect_enquiry_history enable row level security;
alter table public.prospect_stage_config enable row level security;
revoke all on public.prospect_enquiry, public.prospect_enquiry_history, public.prospect_stage_config from anon, authenticated;
revoke all on sequence public.prospect_enquiry_history_id_seq from anon, authenticated;
