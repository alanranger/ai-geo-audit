-- Create debug_logs table for storing individual UI debug log entries
-- This allows automatic saving of each debugLog() call to Supabase for easy searching and inspection

CREATE TABLE IF NOT EXISTS debug_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  message TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('info', 'warn', 'error', 'success')),
  property_url TEXT,
  session_id TEXT, -- Optional: track browser sessions
  user_agent TEXT, -- Optional: track browser/device
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast queries by timestamp (most recent first)
CREATE INDEX IF NOT EXISTS idx_debug_logs_timestamp 
ON debug_logs(timestamp DESC);

-- Index for filtering by type (warnings/errors)
CREATE INDEX IF NOT EXISTS idx_debug_logs_type 
ON debug_logs(type) 
WHERE type IN ('warn', 'error');

-- Index for filtering by property_url
CREATE INDEX IF NOT EXISTS idx_debug_logs_property_url 
ON debug_logs(property_url) 
WHERE property_url IS NOT NULL;

-- Index for searching message content (full-text search)
CREATE INDEX IF NOT EXISTS idx_debug_logs_message_search 
ON debug_logs USING gin(to_tsvector('english', message));

-- Add comment
COMMENT ON TABLE debug_logs IS 'Stores individual UI debug log entries from debugLog() function calls. Each entry is automatically saved to Supabase for easy searching and inspection without requiring copy-paste.';
