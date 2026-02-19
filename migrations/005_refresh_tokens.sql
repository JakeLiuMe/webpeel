-- Migration 005: Create refresh_tokens table for JWT refresh flow
-- Enables short-lived access tokens (1h) with revocable refresh tokens (30d)

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,  -- the jti (JWT ID claim)
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires ON refresh_tokens(expires_at);
