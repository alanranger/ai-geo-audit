-- Alan's standing email budgets per Squarespace billing cycle (QUESTION-2026-11-11 billing-cycle-tile-reserves-and-free-
-- to-spend; decided by Alan via GPT, 10–11 Nov 2026): the monthly Light & Logic full-list email 700 and an ad-hoc reserve
-- 700. Stored with the other email rules in business_targets.campaign_targets.email (the Targets row every tab reads;
-- the Targets panel and Marketing settings save it). As a Targets save does, this writes a row dated 2026-11-11 copied
-- from the latest, so the earlier row stays as history. Idempotent: re-running only re-applies the two figures.

insert into public.business_targets (
  property_url, effective_from, survival_gp_monthly, stretch1_gp_monthly, stretch2_gp_monthly, survival_gp_annual,
  stretch1_gp_annual, stretch2_gp_annual, section_g_config, defcon_edges_proposed, defcon_edges_live, notes,
  cost_rise_by_year, funnel_targets, roadmap_targets, campaign_targets, kpi_targets
)
select l.property_url, date '2026-11-11', l.survival_gp_monthly, l.stretch1_gp_monthly, l.stretch2_gp_monthly, l.survival_gp_annual,
  l.stretch1_gp_annual, l.stretch2_gp_annual, l.section_g_config, l.defcon_edges_proposed, l.defcon_edges_live,
  'Email budgets per billing cycle: Light & Logic 700 + ad-hoc reserve 700 (Alan via GPT, 10–11 Nov 2026)',
  l.cost_rise_by_year, l.funnel_targets, l.roadmap_targets, l.campaign_targets, l.kpi_targets
from (
  select * from public.business_targets where property_url = 'https://www.alanranger.com'
  order by effective_from desc, id desc limit 1
) l
where not exists (select 1 from public.business_targets where property_url = 'https://www.alanranger.com' and effective_from = date '2026-11-11');

update public.business_targets
set campaign_targets = coalesce(campaign_targets, '{}'::jsonb) || jsonb_build_object('email',
      coalesce(campaign_targets->'email', '{}'::jsonb) || jsonb_build_object(
        'light_and_logic_budget_sends', 700,
        'adhoc_reserve_sends', 700,
        'email_budget_note', 'Light & Logic monthly full-list email 700 + ad-hoc reserve 700 per billing cycle — Alan via GPT, 10–11 Nov 2026'
      )),
    updated_at = now()
where property_url = 'https://www.alanranger.com' and effective_from = date '2026-11-11';
