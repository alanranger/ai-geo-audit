-- Monday brief redesign (batch 8 task 15).
-- booking_sheet_sales_targets: Alan's own targets from the "Sales YYYY" tab (cached cell values at upload):
--   monthly_target / working_days / weighting = rows "Monthly Target" / "Working Days" / "Weighting" (K..V = Jan..Dec);
--   category_targets = column J per category row ({ "1": 666.67, ... } keyed by category_order);
--   ytd_actual / ytd_var = the tab's "YTD Actual" / "YTD Var to target" cells.
create table if not exists public.booking_sheet_sales_targets (
  property_url text not null,
  year integer not null,
  monthly_target numeric[] not null,
  working_days integer[] not null,
  weighting numeric[] not null,
  category_targets jsonb not null default '{}'::jsonb,
  category_labels jsonb not null default '{}'::jsonb,
  ytd_actual numeric,
  ytd_var numeric,
  annual_target numeric,
  source_workbook text,
  imported_at timestamptz not null default now(),
  primary key (property_url, year)
);
alter table public.booking_sheet_sales_targets enable row level security;

-- ceo_brief_actions: card C actions Alan marked done. An action is hidden for 28 days after actioned_at.
create table if not exists public.ceo_brief_actions (
  id uuid primary key default gen_random_uuid(),
  property_url text not null,
  action_key text not null,
  actioned_at timestamptz not null default now(),
  actioned_by text,
  note text
);
create index if not exists ceo_brief_actions_key on public.ceo_brief_actions (property_url, action_key, actioned_at desc);
alter table public.ceo_brief_actions enable row level security;
