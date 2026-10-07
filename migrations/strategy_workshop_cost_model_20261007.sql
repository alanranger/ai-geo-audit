-- Strategy diary GP columns: Workshop Costs tab model (net GP £ by occupancy 1-6).
-- Written by POST /api/aigeo/booking-sheet-upload via lib/booking-sheet-workshop-costs.mjs.
create table if not exists public.booking_sheet_workshop_cost_model (
  property_url text primary key,
  model jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.booking_sheet_workshop_cost_model enable row level security;
