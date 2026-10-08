-- Yearly cost-rise fractions for stepped survival/stretch GP lines (Strategy §4 chart).
alter table public.business_targets
  add column if not exists cost_rise_by_year jsonb;

comment on column public.business_targets.cost_rise_by_year is
  'YoY cost rise INTO that year (fraction). Used to back-calculate survival/stretch GP before the base year.';

update public.business_targets
set cost_rise_by_year = '{"2021":0.15,"2022":0.15,"2023":0.15,"2024":0.15,"2025":0.20,"2026":0.20}'::jsonb,
    updated_at = now()
where property_url = 'https://www.alanranger.com'
  and (cost_rise_by_year is null or cost_rise_by_year = '{}'::jsonb);
