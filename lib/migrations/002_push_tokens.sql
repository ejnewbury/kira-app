-- Push notification tokens for Kira app
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor)

CREATE TABLE IF NOT EXISTS kira_push_tokens (
  device_id TEXT PRIMARY KEY,
  token TEXT NOT NULL,
  platform TEXT DEFAULT 'android',
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Allow service role full access (personal app, permissive RLS)
ALTER TABLE kira_push_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON kira_push_tokens
  FOR ALL USING (true) WITH CHECK (true);
