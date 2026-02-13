-- Migration 004: Create usage_logs table for request tracking
-- Required by /v1/stats and /v1/activity endpoints

CREATE TABLE IF NOT EXISTS usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  
  -- Request details
  endpoint VARCHAR(50) NOT NULL,
  url TEXT,
  method VARCHAR(20) NOT NULL DEFAULT 'basic',
  
  -- Usage metrics
  processing_time_ms INTEGER,
  
  -- Response
  status_code INTEGER,
  error TEXT,
  
  -- Request metadata
  ip_address INET,
  user_agent TEXT,
  
  -- Timestamp
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_logs_user_created ON usage_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs(created_at DESC);

-- Auto-cleanup: delete logs older than 90 days (run periodically)
-- DELETE FROM usage_logs WHERE created_at < NOW() - INTERVAL '90 days';
