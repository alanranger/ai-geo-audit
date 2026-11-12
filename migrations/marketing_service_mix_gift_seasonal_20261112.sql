-- Seasonal Gift vouchers target for Marketing tile 6c (QUESTION-2026-11-12 service-mix-gift-and-prints-targets, Alan
-- 12 Nov 10:31): vouchers only, Nov–Dec 2026. Read from the stored gifts initiative (the approved target line on Booking
-- Sheet category 8, "Gift voucher issue receipts", and its window), not retyped: amount 1,100 over 1 Nov → 31 Dec =
-- £550/month; the gift 1-to-1 part of the £2,100 lands in Courses / 1-2-1 and is not counted here. Outside the window the
-- tile uses the Booking Sheet "8. Gift Vouchers Inc" monthly target (lib/marketing/service-mix.mjs seasonalTargetOf), so
-- it reverts automatically from 1 Jan 2027. Stored in business_targets.campaign_targets.service_mix.seasonal_targets on
-- the 2026-11-12 row (as a Targets save does, a dated row copied from the latest if today's row does not exist yet).
-- Idempotent: re-running replaces only the gift_vouchers entry.

insert into public.business_targets (
  property_url, effective_from, survival_gp_monthly, stretch1_gp_monthly, stretch2_gp_monthly, survival_gp_annual,
  stretch1_gp_annual, stretch2_gp_annual, section_g_config, defcon_edges_proposed, defcon_edges_live, notes,
  cost_rise_by_year, funnel_targets, roadmap_targets, campaign_targets, kpi_targets
)
select l.property_url, date '2026-11-12', l.survival_gp_monthly, l.stretch1_gp_monthly, l.stretch2_gp_monthly, l.survival_gp_annual,
  l.stretch1_gp_annual, l.stretch2_gp_annual, l.section_g_config, l.defcon_edges_proposed, l.defcon_edges_live,
  'Gift vouchers seasonal target Nov–Dec 2026 (Alan via Claude, 12 Nov)',
  l.cost_rise_by_year, l.funnel_targets, l.roadmap_targets, l.campaign_targets, l.kpi_targets
from (
  select * from public.business_targets where property_url = 'https://www.alanranger.com'
  order by effective_from desc, id desc limit 1
) l
where not exists (select 1 from public.business_targets where property_url = 'https://www.alanranger.com' and effective_from = date '2026-11-12');

update public.business_targets b
set campaign_targets = coalesce(b.campaign_targets, '{}'::jsonb) || jsonb_build_object('service_mix',
      coalesce(b.campaign_targets->'service_mix', '{}'::jsonb) || jsonb_build_object('seasonal_targets',
        coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(b.campaign_targets->'service_mix'->'seasonal_targets', '[]'::jsonb)) x where x->>'row' <> 'gift_vouchers'), '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object(
          'row', 'gift_vouchers',
          'from', i.target->'window'->>'start',
          'to', i.target->'window'->>'end',
          'amount', v.amount,
          'source', 'strategy_initiatives "' || i.title || '": approved target line on Booking Sheet 8 (' || v.label || '), vouchers only',
          'set_by', 'Alan via Claude 12 Nov',
          'history', jsonb_build_array(jsonb_build_object('at', now(), 'by', 'Alan via Claude', 'note', 'Approved 12 Nov 10:31 (QUESTION-2026-11-12-service-mix-gift-and-prints-targets): vouchers £' || v.amount || ' over the window; reverts to the Booking Sheet monthly target afterwards'))
        )))),
    updated_at = now()
from public.strategy_initiatives i
cross join lateral (
  select (l->>'amount')::numeric as amount, l->>'label' as label
  from jsonb_array_elements(coalesce(i.target->'lines', '[]'::jsonb)) l
  where l->>'category' = '8' limit 1
) v
where b.property_url = 'https://www.alanranger.com' and b.effective_from = date '2026-11-12'
  and i.property_url = 'https://www.alanranger.com' and i.target->'window'->>'start' is not null;
