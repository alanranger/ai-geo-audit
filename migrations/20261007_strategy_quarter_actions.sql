-- Strategy tab: editable quarter actions with due weeks + tick state.

CREATE TABLE IF NOT EXISTS public.strategy_quarter_actions (
  id bigserial PRIMARY KEY,
  property_url text NOT NULL DEFAULT 'https://www.alanranger.com',
  action_key text NOT NULL,
  quarter_key text NOT NULL,
  label text NOT NULL,
  due_week_start date NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_ticked boolean NOT NULL DEFAULT false,
  ticked_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_url, action_key)
);

CREATE INDEX IF NOT EXISTS strategy_quarter_actions_prop_q_idx
  ON public.strategy_quarter_actions (property_url, quarter_key, sort_order);

COMMENT ON TABLE public.strategy_quarter_actions IS
  'Strategy & KPIs tab quarter action checklist. Alan ticks on the dashboard; overdue unticked actions feed Monday brief.';
