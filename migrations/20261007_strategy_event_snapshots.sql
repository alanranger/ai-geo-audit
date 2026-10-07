-- Daily snapshots of upcoming Squarespace events + product variant stock/price.
-- Powers +wk pace, F5 run rate, empty-run fill, and "0 sales in 14 days" from 7 Oct 2026.

CREATE TABLE IF NOT EXISTS public.strategy_event_snapshots (
  id bigserial PRIMARY KEY,
  property_url text NOT NULL DEFAULT 'https://www.alanranger.com',
  snapshot_date date NOT NULL,
  event_date date NOT NULL,
  event_key text NOT NULL,
  title text NOT NULL,
  event_type text NOT NULL,
  product_url text NULL,
  price numeric NULL,
  sale_price numeric NULL,
  on_sale boolean NOT NULL DEFAULT false,
  qty_in_stock integer NULL,
  capacity integer NULL,
  sheet_booked integer NOT NULL DEFAULT 0,
  places_left integer NULL,
  session_tag text NULL,
  raw jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_url, snapshot_date, event_key)
);

CREATE INDEX IF NOT EXISTS strategy_event_snapshots_prop_date_idx
  ON public.strategy_event_snapshots (property_url, snapshot_date DESC);

CREATE INDEX IF NOT EXISTS strategy_event_snapshots_event_idx
  ON public.strategy_event_snapshots (property_url, event_date, event_key);

COMMENT ON TABLE public.strategy_event_snapshots IS
  'Daily capture of upcoming workshop/course events + variant price/stock for Strategy tab pace, run rate, and true fill.';
