-- Domain Strength v1.2: Seed obvious domains with domain_type
-- Purpose: Seed alanranger.com, google.com, youtube.com with appropriate domain_type

-- Add domain_type column if it doesn't exist (for existing installations)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'domain_strength_domains' 
    AND column_name = 'domain_type'
  ) THEN
    ALTER TABLE public.domain_strength_domains ADD COLUMN domain_type text null;
    CREATE INDEX IF NOT EXISTS idx_domain_strength_domains_domain_type 
      ON public.domain_strength_domains (domain_type);
  END IF;
END $$;

-- Seed obvious domains (upsert to avoid duplicates)
INSERT INTO public.domain_strength_domains (domain, label, domain_type, segment, updated_at)
VALUES
  ('alanranger.com', 'Alan Ranger Photography', 'your_site', 'your_site', now()),
  ('google.com', 'Google', 'platform', 'platform', now()),
  ('youtube.com', 'YouTube', 'platform', 'platform', now())
ON CONFLICT (domain) 
DO UPDATE SET
  domain_type = EXCLUDED.domain_type,
  segment = COALESCE(EXCLUDED.segment, EXCLUDED.domain_type),
  label = COALESCE(EXCLUDED.label, domain_strength_domains.label),
  updated_at = now();

