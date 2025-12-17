-- Migration: Add locations column to audit_results table
-- Date: 2025-12-17
-- Purpose: Store locations array from Google Business Profile API

-- Add locations column to store array of location objects from GBP API
ALTER TABLE public.audit_results
ADD COLUMN IF NOT EXISTS locations JSONB;

-- Add comment to document the column
COMMENT ON COLUMN public.audit_results.locations IS 'Array of location objects from Google Business Profile API. Each location contains: name, address, phone, website, serviceArea';

