-- Context Sync table for bidirectional phone ↔ desktop communication
-- Run this on the Kira Supabase project (kira-assistant)

CREATE TABLE IF NOT EXISTS context_sync (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('phone', 'desktop')),
  event_type TEXT NOT NULL CHECK (event_type IN (
    'conversation_summary',
    'action_item',
    'personal_fact',
    'session_context',
    'handoff'
  )),
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  acknowledged BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast polling by source
CREATE INDEX IF NOT EXISTS idx_context_sync_source ON context_sync(source, created_at DESC);

-- Enable realtime for push-based sync
ALTER PUBLICATION supabase_realtime ADD TABLE context_sync;

-- Auto-cleanup old entries (keep 30 days)
-- Run as a Supabase cron or manual cleanup
-- DELETE FROM context_sync WHERE created_at < NOW() - INTERVAL '30 days';
