-- Migration 013: Add separate 80% and 90% alert tracking columns
-- Replaces the single alert_sent_at with per-threshold timestamps
-- to support sending both an 80% warning and a 90% critical alert per week.

ALTER TABLE users ADD COLUMN IF NOT EXISTS alert_sent_80_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS alert_sent_90_at TIMESTAMPTZ DEFAULT NULL;

-- Index for efficient queries across users who have alerts configured
CREATE INDEX IF NOT EXISTS idx_users_alert_80_at ON users(alert_sent_80_at) WHERE alert_sent_80_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_alert_90_at ON users(alert_sent_90_at) WHERE alert_sent_90_at IS NOT NULL;

-- Keep alert_sent_at for backwards compatibility (used by old threshold system)
-- New code will use alert_sent_80_at and alert_sent_90_at instead.
