-- Add columns for computed fields that are needed for historical delta calculations
-- These fields are computed from existing audit data but not currently stored

ALTER TABLE audit_results
ADD COLUMN IF NOT EXISTS ai_summary_components JSONB,
ADD COLUMN IF NOT EXISTS eeat_score NUMERIC,
ADD COLUMN IF NOT EXISTS eeat_confidence TEXT,
ADD COLUMN IF NOT EXISTS eeat_subscores JSONB,
ADD COLUMN IF NOT EXISTS domain_strength JSONB;

-- Add comments for documentation
COMMENT ON COLUMN audit_results.ai_summary_components IS 'AI Summary components: {snippetReadiness, visibility, brand} - computed from snippetReadiness, visibility_score, brand_score';
COMMENT ON COLUMN audit_results.eeat_score IS 'EEAT score (0-100) - computed from authority, content schema, local entity, domain strength, AI citations';
COMMENT ON COLUMN audit_results.eeat_confidence IS 'EEAT confidence level: High, Medium, Low - based on data availability';
COMMENT ON COLUMN audit_results.eeat_subscores IS 'EEAT subscores: {experience, expertise, authoritativeness, trustworthiness}';
COMMENT ON COLUMN audit_results.domain_strength IS 'Domain strength snapshot: {selfScore, topCompetitorScore, strongerCount, competitorsCount, snapshotDate}';
