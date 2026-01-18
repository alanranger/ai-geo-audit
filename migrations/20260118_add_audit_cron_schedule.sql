-- Add audit_cron_schedule table for configurable cron jobs
-- Stores per-job frequency/time and last/next run timestamps

CREATE TABLE IF NOT EXISTS audit_cron_schedule (
  job_key TEXT PRIMARY KEY,
  frequency TEXT NOT NULL DEFAULT 'daily',
  time_of_day TEXT NOT NULL DEFAULT '11:00',
  last_run_at TIMESTAMP,
  next_run_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_cron_schedule_next_run
  ON audit_cron_schedule(next_run_at);
