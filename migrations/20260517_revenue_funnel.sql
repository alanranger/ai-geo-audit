-- =============================================================================
-- Revenue Funnel module: priorities + revenue snapshots
-- 2026-05-17 — Adds the editable priority list (rendered on the new Revenue
-- Funnel tab) and the manual/Squarespace revenue snapshot table that powers
-- the "Revenue per 1k impressions" KPI and the bottom-of-funnel chart.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Priorities table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.revenue_funnel_priorities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_url text NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  title text NOT NULL,
  description text,
  pages_affected text[] NOT NULL DEFAULT '{}',
  primary_kpi text,                              -- e.g. 'ctr_28d', 'ai_citations', 'money_page_click_share', 'enquiries'
  kpi_target_value numeric,
  kpi_target_direction text NOT NULL DEFAULT 'up' CHECK (kpi_target_direction IN ('up','down')),
  kpi_baseline_value numeric,
  estimated_lift text,                           -- human-readable, e.g. "+50K clicks / 28d"
  status text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started','in_progress','done','paused','cancelled')),
  optimisation_task_id uuid REFERENCES public.optimisation_tasks(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz,
  is_seeded boolean NOT NULL DEFAULT false        -- true for the 8 initial AI-suggested priorities
);

CREATE INDEX IF NOT EXISTS revenue_funnel_priorities_property_idx
  ON public.revenue_funnel_priorities (property_url, sort_order);

CREATE INDEX IF NOT EXISTS revenue_funnel_priorities_task_idx
  ON public.revenue_funnel_priorities (optimisation_task_id);

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION public.revenue_funnel_priorities_touch()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  IF NEW.status = 'done' AND (OLD.status IS DISTINCT FROM 'done') THEN
    NEW.done_at = now();
  END IF;
  IF NEW.status <> 'done' AND OLD.status = 'done' THEN
    NEW.done_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS revenue_funnel_priorities_touch_tg ON public.revenue_funnel_priorities;
CREATE TRIGGER revenue_funnel_priorities_touch_tg
BEFORE UPDATE ON public.revenue_funnel_priorities
FOR EACH ROW EXECUTE FUNCTION public.revenue_funnel_priorities_touch();

-- ---------------------------------------------------------------------------
-- 2. Revenue snapshots (manual entry + Squarespace import hook)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.revenue_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_url text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  revenue_amount numeric NOT NULL,
  currency text NOT NULL DEFAULT 'GBP',
  source text NOT NULL DEFAULT 'manual'
    CHECK (source IN ('manual','squarespace_csv','squarespace_api','other')),
  transactions integer,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS revenue_snapshots_property_period_idx
  ON public.revenue_snapshots (property_url, period_end DESC);

CREATE UNIQUE INDEX IF NOT EXISTS revenue_snapshots_unique_period_idx
  ON public.revenue_snapshots (property_url, period_start, period_end, source);

-- ---------------------------------------------------------------------------
-- 3. Seed the 8 initial priorities for alanranger.com
-- ---------------------------------------------------------------------------
INSERT INTO public.revenue_funnel_priorities
  (property_url, sort_order, title, description, pages_affected, primary_kpi,
   kpi_target_value, kpi_target_direction, estimated_lift, status, is_seeded)
VALUES
  -- 1. Reclaim AI Overview citations on the three biggest leakers
  ('https://www.alanranger.com', 10,
   'Restructure top-3 blog leak pages for AI Overview citation',
   'Add FAQ/HowTo schema, put the authored answer in the first 80 words, surface paid-course CTA above the fold. AI Overview is answering the query in place — we need to be cited and pull the click back.',
   ARRAY['/blog-on-photography/how-to-back-up-photos',
         '/blog-on-photography/photo-print-sizes-resize-photos',
         '/blog-on-photography/jpeg-vs-raw-the-key-differences'],
   'ctr_28d', 1.5, 'up', '+~50K clicks/28d (recover blog CTR to 1.5%)', 'not_started', true),

  -- 2. Get cited for the local-photographer terms where you already rank #1/#2
  ('https://www.alanranger.com', 20,
   'Win AI Overview citation for "photographer coventry" cluster',
   'You rank #1/#2 for "photographer coventry" and "photographer in coventry" but are not cited in AI Overview. Add LocalBusiness + Person schema, FAQ snippet, and an above-fold answer block on hire-a-photographer.',
   ARRAY['/hire-a-professional-photographer-in-coventry'],
   'ai_citations', 1, 'up', '+enquiries from local intent traffic', 'not_started', true),

  -- 3. Build a dedicated PAID online course landing page
  ('https://www.alanranger.com', 30,
   'Build a paid Online Photography Course landing page',
   'High-impression queries "online photography course" / "photography lessons online" are all routing to the FREE course. Build a paid landing page with price, modules, testimonials, and a single Buy CTA.',
   ARRAY['/online-photography-course-paid'],
   'money_page_click_share', 3, 'up', '+3 percentage points money-page click share', 'not_started', true),

  -- 4. Conversion lift on the existing hire-a-photographer page
  ('https://www.alanranger.com', 40,
   'Add booking widget, price + reviews above fold on hire-a-photographer',
   'Page ranks well but conversion is invisible. Add visible price, booking widget, top 3 reviews, and trust badges above the fold.',
   ARRAY['/hire-a-professional-photographer-in-coventry'],
   'enquiries', 3, 'up', 'Target ~3% click->enquiry conv', 'not_started', true),

  -- 5. Money-page CTA injection across top blog traffic
  ('https://www.alanranger.com', 50,
   'Inject money-page CTA into top 10 highest-impression blog articles',
   'Top blog articles (back-up photos, print sizes, jpeg vs raw, exposure triangle, etc.) currently route attention to the free course or further articles. Add an in-content "Book a 1:1" / "Join paid course" block half-way through each article.',
   ARRAY['/blog-on-photography/*'],
   'money_page_click_share', 5, 'up', '+5pp money-page click share', 'not_started', true),

  -- 6. Audit who IS being cited so we can match them
  ('https://www.alanranger.com', 60,
   'Audit competitor citations in AI Overview for top 10 money keywords',
   'For each top-10 commercial keyword where Alan is not cited, capture which 3 domains/pages ARE cited, what schema they have, how their answer is structured. Output: a target-page checklist.',
   ARRAY[]::text[],
   NULL, NULL, 'up', 'List, not a metric — feeds priorities 1, 2 and 5', 'not_started', true),

  -- 7. Close out the overdue Optimisation Tracking cycles honestly
  ('https://www.alanranger.com', 70,
   'Close all overdue optimisation cycles + stop re-grinding the same pages',
   'Tracker shows ~25 overdue cycles. Either complete (KPI met / not met with reason) or abandon. Restores trust in the tracker before adding new tasks below it.',
   ARRAY[]::text[],
   NULL, NULL, 'up', 'Tracker hygiene', 'not_started', true),

  -- 8. Fix the EE-A-T / Authority dashboard inconsistency
  ('https://www.alanranger.com', 80,
   'Resolve EE-A-T / Authority score inconsistency in dashboard',
   'Overview cards/radar/snippet show 52/74 while trend chart + scorecard show 50/75 (different data sources). Until this is reconciled you cannot trust the dashboard for decisions.',
   ARRAY[]::text[],
   NULL, NULL, 'up', 'Dashboard trust', 'not_started', true)
ON CONFLICT DO NOTHING;
