-- Pick n Mix plan history from the plan statement files (G:\Dropbox\1. Bookings\Pick n Mix Agreements), read-only
-- import from Alan's PC. One row per plan, per payment and per allocated event; every file read is listed with its
-- outcome so unreliable layouts are visible, never guessed. Service-role only (RLS on, no anon / authenticated).
create table if not exists public.pnm_plans (
  plan_key text primary key,
  source_file text not null,
  sheet text not null,
  file_modified timestamptz,
  client_name text,
  email text,
  plan_type text,
  starts date,
  ends date,
  paid_total numeric not null default 0,
  imported_at timestamptz not null default now()
);
create table if not exists public.pnm_plan_payments (
  plan_key text not null references public.pnm_plans(plan_key) on delete cascade,
  line_no integer not null,
  amount numeric not null,
  paid_on date,
  raw_date date,
  date_reliable boolean not null,
  scheduled_only boolean not null default false,
  primary key (plan_key, line_no)
);
create table if not exists public.pnm_plan_events (
  plan_key text not null references public.pnm_plans(plan_key) on delete cascade,
  line_no integer not null,
  item text,
  price_before numeric,
  price_after numeric,
  event_date date,
  order_ref integer,
  primary key (plan_key, line_no)
);
create table if not exists public.pnm_plan_files (
  source_file text not null,
  sheet text not null,
  status text not null check (status in ('imported', 'superseded', 'skipped_name', 'unparsed', 'unreadable')),
  problem text,
  file_modified timestamptz,
  read_at timestamptz not null default now(),
  primary key (source_file, sheet)
);
create index if not exists pnm_plans_email_idx on public.pnm_plans (lower(email));
alter table public.pnm_plans enable row level security;
alter table public.pnm_plan_payments enable row level security;
alter table public.pnm_plan_events enable row level security;
alter table public.pnm_plan_files enable row level security;
revoke all on public.pnm_plans, public.pnm_plan_payments, public.pnm_plan_events, public.pnm_plan_files from anon, authenticated;
