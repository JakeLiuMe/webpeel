-- Migration 014: Add updated_at column to jobs table
-- The pg-job-queue.ts code references updated_at in cleanupOldJobs() and updateJob(),
-- but this column was never added to the schema in production.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Update existing rows so updated_at matches completed_at (if set) or created_at
UPDATE jobs SET updated_at = COALESCE(completed_at, created_at);

-- Create index for efficient cleanup queries
CREATE INDEX IF NOT EXISTS idx_jobs_updated_at ON jobs(updated_at);
