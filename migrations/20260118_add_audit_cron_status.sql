-- Add status columns to audit_cron_schedule

ALTER TABLE audit_cron_schedule
ADD COLUMN IF NOT EXISTS last_status TEXT;

ALTER TABLE audit_cron_schedule
ADD COLUMN IF NOT EXISTS last_error TEXT;
