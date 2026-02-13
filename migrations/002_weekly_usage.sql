-- Migration 002: Weekly Usage Model (Claude Code-style)
-- Changes from monthly credits to weekly reset with burst limits and extra usage
-- 
-- The new model has three layers:
-- 1. Burst limit: per-hour cap to prevent hammering
-- 2. Weekly limit: main usage gate, resets every Monday 00:00 UTC
-- 3. Extra usage: pay-as-you-go overflow with spending caps

-- ============================================
-- 1. Update users table with new limit columns
-- ============================================

-- Add weekly_limit (replaces monthly_limit)
ALTER TABLE users ADD COLUMN IF NOT EXISTS weekly_limit INTEGER NOT NULL DEFAULT 125;

-- Add burst_limit (per-hour)
ALTER TABLE users ADD COLUMN IF NOT EXISTS burst_limit INTEGER NOT NULL DEFAULT 25;

-- Add extra_usage columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_usage_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_usage_balance NUMERIC(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_usage_spending_limit NUMERIC(10,2) NOT NULL DEFAULT 50.00;
ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_usage_spent NUMERIC(10,2) NOT NULL DEFAULT 0.00;
ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_usage_period_start TIMESTAMPTZ DEFAULT date_trunc('month', now());
ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_reload_enabled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_reload_amount NUMERIC(10,2) DEFAULT 25.00;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_reload_threshold NUMERIC(10,2) DEFAULT 5.00;

-- Update existing free users to weekly limits
UPDATE users SET weekly_limit = 125, burst_limit = 25 WHERE tier = 'free';
UPDATE users SET weekly_limit = 1250, burst_limit = 100 WHERE tier = 'pro';
UPDATE users SET weekly_limit = 6250, burst_limit = 500 WHERE tier = 'max';

-- ============================================
-- 2. Create weekly_usage table
-- ============================================

CREATE TABLE IF NOT EXISTS weekly_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  
  -- Week identifier (ISO week: YYYY-WXX format, e.g. "2026-W07")
  week TEXT NOT NULL,
  
  -- Usage counts by type
  basic_count INTEGER NOT NULL DEFAULT 0,     -- HTTP-only fetches
  stealth_count INTEGER NOT NULL DEFAULT 0,   -- Stealth browser fetches
  captcha_count INTEGER NOT NULL DEFAULT 0,   -- CAPTCHA-solved fetches
  search_count INTEGER NOT NULL DEFAULT 0,    -- DuckDuckGo searches
  
  -- Computed total (basic + stealth + captcha + search)
  total_count INTEGER GENERATED ALWAYS AS (basic_count + stealth_count + captcha_count + search_count) STORED,
  
  -- Rollover from previous week (max = weekly_limit)
  rollover_credits INTEGER NOT NULL DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  
  UNIQUE(api_key_id, week)
);

CREATE INDEX IF NOT EXISTS idx_weekly_usage_user_week ON weekly_usage(user_id, week);
CREATE INDEX IF NOT EXISTS idx_weekly_usage_key_week ON weekly_usage(api_key_id, week);

-- ============================================
-- 3. Create extra_usage_logs table
-- ============================================

CREATE TABLE IF NOT EXISTS extra_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
  
  -- Request details
  fetch_type TEXT NOT NULL CHECK (fetch_type IN ('basic', 'stealth', 'captcha', 'search')),
  url TEXT,
  
  -- Billing
  cost NUMERIC(10,4) NOT NULL,  -- Cost in dollars (e.g. 0.0020 for basic)
  
  -- Metadata
  processing_time_ms INTEGER,
  status_code INTEGER,
  
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_extra_usage_user ON extra_usage_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_extra_usage_period ON extra_usage_logs(user_id, created_at);

-- ============================================
-- 4. Create burst tracking table (in-memory preferred, DB fallback)
-- ============================================

CREATE TABLE IF NOT EXISTS burst_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id UUID NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  hour_bucket TEXT NOT NULL,  -- Format: YYYY-MM-DDTHH (UTC hour)
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(api_key_id, hour_bucket)
);

CREATE INDEX IF NOT EXISTS idx_burst_key_hour ON burst_usage(api_key_id, hour_bucket);

-- ============================================
-- 5. Updated views
-- ============================================

-- Drop old views if they exist
DROP VIEW IF EXISTS daily_usage;
DROP VIEW IF EXISTS account_stats;

-- Weekly usage summary
CREATE OR REPLACE VIEW weekly_usage_summary AS
SELECT 
  u.id as user_id,
  u.email,
  u.tier,
  u.weekly_limit,
  wu.week,
  wu.basic_count,
  wu.stealth_count,
  wu.captcha_count,
  wu.search_count,
  wu.total_count,
  wu.rollover_credits,
  (u.weekly_limit + wu.rollover_credits) as total_available,
  GREATEST(0, (u.weekly_limit + wu.rollover_credits) - wu.total_count) as remaining
FROM users u
LEFT JOIN api_keys ak ON ak.user_id = u.id
LEFT JOIN weekly_usage wu ON wu.api_key_id = ak.id
ORDER BY wu.week DESC;

-- Account overview
CREATE OR REPLACE VIEW account_overview AS
SELECT 
  u.id,
  u.email,
  u.tier,
  u.weekly_limit,
  u.burst_limit,
  u.extra_usage_enabled,
  u.extra_usage_balance,
  u.extra_usage_spent,
  u.extra_usage_spending_limit,
  COUNT(DISTINCT ak.id) as api_keys_count,
  COALESCE(SUM(wu.total_count), 0) as lifetime_requests
FROM users u
LEFT JOIN api_keys ak ON ak.user_id = u.id AND ak.is_active = true
LEFT JOIN weekly_usage wu ON wu.user_id = u.id
GROUP BY u.id;

-- ============================================
-- 6. Helper function: Get current ISO week
-- ============================================

CREATE OR REPLACE FUNCTION get_current_week() RETURNS TEXT AS $$
BEGIN
  RETURN to_char(now(), 'IYYY-"W"IW');
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 7. Helper function: Get current hour bucket  
-- ============================================

CREATE OR REPLACE FUNCTION get_current_hour() RETURNS TEXT AS $$
BEGIN
  RETURN to_char(now(), 'YYYY-MM-DD"T"HH24');
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 8. Helper function: Get week reset time
-- ============================================

CREATE OR REPLACE FUNCTION get_week_reset_time() RETURNS TIMESTAMPTZ AS $$
BEGIN
  -- Returns next Monday 00:00 UTC
  RETURN date_trunc('week', now() + interval '7 days');
END;
$$ LANGUAGE plpgsql;
