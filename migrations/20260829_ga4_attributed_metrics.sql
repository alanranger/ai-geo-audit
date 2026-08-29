-- Carry bot-excluded ("attributed") figures alongside the raw GA4 totals in
-- ga4_site_metrics_28d.
--
-- Why: ~73% of GA4 sessions land in the Unassigned channel group with
-- source=(not set) / medium=(not set) and engage at 2.8% vs 50.8% for real
-- traffic. That bucket is automated. Sessions and page_views are therefore
-- inflated ~3.75x; enquiry events are only ~8% inflated (bots rarely fire them).
--
-- Raw columns are kept unchanged so nothing downstream silently double-counts or
-- breaks. Consumers opt in to the attributed_* columns.

ALTER TABLE public.ga4_site_metrics_28d
  ADD COLUMN IF NOT EXISTS attributed_sessions_28d integer NULL,
  ADD COLUMN IF NOT EXISTS attributed_page_views_28d integer NULL,
  ADD COLUMN IF NOT EXISTS attributed_enquiry_events_28d integer NULL,
  ADD COLUMN IF NOT EXISTS attributed_money_page_enquiry_events_28d integer NULL,
  ADD COLUMN IF NOT EXISTS unattributed_sessions_28d integer NULL,
  ADD COLUMN IF NOT EXISTS unattributed_page_views_28d integer NULL,
  ADD COLUMN IF NOT EXISTS unattributed_enquiry_events_28d integer NULL,
  ADD COLUMN IF NOT EXISTS event_counts_attributed jsonb NULL;

COMMENT ON COLUMN public.ga4_site_metrics_28d.attributed_sessions_28d IS
  'Sessions excluding the Unassigned (automated) channel group. Use this for any user-facing session count or conversion denominator.';
COMMENT ON COLUMN public.ga4_site_metrics_28d.unattributed_sessions_28d IS
  'Sessions in the Unassigned (automated) channel group. Retained for auditability - excluded, never deleted.';
COMMENT ON COLUMN public.ga4_site_metrics_28d.attributed_enquiry_events_28d IS
  'Enquiry-intent events excluding the Unassigned channel group. Bot share here is small (~8%) but non-zero.';
COMMENT ON COLUMN public.ga4_site_metrics_28d.sessions_28d IS
  'RAW sessions including automated Unassigned traffic (~73% of total). Kept for continuity/auditability - prefer attributed_sessions_28d for display.';
