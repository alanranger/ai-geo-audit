-- Accountability log for scripts that write master tables (pages_master, etc.)
CREATE TABLE IF NOT EXISTS public.master_table_mutations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  table_name text NOT NULL,
  script_name text NOT NULL,
  args text NOT NULL DEFAULT '',
  row_count integer NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  property_url text NOT NULL DEFAULT 'https://www.alanranger.com'
);

CREATE INDEX IF NOT EXISTS master_table_mutations_created_at_idx
  ON public.master_table_mutations (created_at DESC);

CREATE INDEX IF NOT EXISTS master_table_mutations_table_name_idx
  ON public.master_table_mutations (table_name, created_at DESC);
