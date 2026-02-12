/**
 * PostgreSQL-backed auth store for production deployments
 * Uses SHA-256 hashing for API keys and tracks monthly usage with rollover
 */

import pg from 'pg';
import crypto from 'crypto';
import { AuthStore, ApiKeyInfo } from './auth-store.js';

const { Pool } = pg;

export interface UsageInfo {
  period: string;
  fetchCount: number;
  searchCount: number;
  browserCount: number;
  rolloverCredits: number;
  monthlyLimit: number;
  totalUsed: number;
  totalAvailable: number;
  remaining: number;
}

/**
 * PostgreSQL auth store for production
 */
export class PostgresAuthStore implements AuthStore {
  private pool: pg.Pool;

  constructor(connectionString?: string) {
    const dbUrl = connectionString || process.env.DATABASE_URL;
    
    if (!dbUrl) {
      throw new Error('DATABASE_URL environment variable is required for PostgresAuthStore');
    }

    this.pool = new Pool({
      connectionString: dbUrl,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }

  /**
   * Hash API key with SHA-256
   * SECURITY: Never store raw API keys
   */
  private hashKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex');
  }

  /**
   * Get current period in YYYY-MM format
   */
  private getCurrentPeriod(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Get previous period in YYYY-MM format
   */
  private getPreviousPeriod(): string {
    const now = new Date();
    const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;
  }

  /**
   * Validate API key and return user info
   * SECURITY: Uses SHA-256 hash comparison, updates last_used_at
   */
  async validateKey(key: string): Promise<ApiKeyInfo | null> {
    if (!key || typeof key !== 'string') {
      return null;
    }

    const keyHash = this.hashKey(key);
    
    try {
      const result = await this.pool.query(
        `SELECT 
          ak.id,
          ak.user_id,
          ak.key_prefix,
          ak.name,
          u.tier,
          u.rate_limit,
          u.monthly_limit,
          u.email
        FROM api_keys ak
        JOIN users u ON ak.user_id = u.id
        WHERE ak.key_hash = $1 AND ak.is_active = true`,
        [keyHash]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];

      // Update last_used_at (fire and forget, don't wait)
      this.pool.query(
        'UPDATE api_keys SET last_used_at = now() WHERE id = $1',
        [row.id]
      ).catch(err => console.error('Failed to update last_used_at:', err));

      return {
        key,
        tier: row.tier,
        rateLimit: row.rate_limit,
        accountId: row.user_id,
        createdAt: new Date(),
      };
    } catch (error) {
      console.error('Failed to validate API key:', error);
      return null;
    }
  }

  /**
   * Track usage for an API key
   * SECURITY: Uses UPSERT to prevent race conditions
   */
  async trackUsage(key: string, credits: number): Promise<void> {
    const keyHash = this.hashKey(key);
    const period = this.getCurrentPeriod();

    try {
      // Get API key ID and user ID
      const keyResult = await this.pool.query(
        'SELECT id, user_id FROM api_keys WHERE key_hash = $1',
        [keyHash]
      );

      if (keyResult.rows.length === 0) {
        return;
      }

      const { id: apiKeyId, user_id: userId } = keyResult.rows[0];

      // UPSERT usage record
      await this.pool.query(
        `INSERT INTO usage (user_id, api_key_id, period, fetch_count, updated_at)
        VALUES ($1, $2, $3, $4, now())
        ON CONFLICT (api_key_id, period)
        DO UPDATE SET 
          fetch_count = usage.fetch_count + $4,
          updated_at = now()`,
        [userId, apiKeyId, period, credits]
      );
    } catch (error) {
      console.error('Failed to track usage:', error);
      throw error;
    }
  }

  /**
   * Get usage info for an API key with rollover calculation
   */
  async getUsage(key: string): Promise<UsageInfo | null> {
    const keyHash = this.hashKey(key);
    const currentPeriod = this.getCurrentPeriod();
    const previousPeriod = this.getPreviousPeriod();

    try {
      const result = await this.pool.query(
        `SELECT 
          u.monthly_limit,
          COALESCE(curr.fetch_count, 0) + COALESCE(curr.search_count, 0) + COALESCE(curr.browser_count, 0) as current_used,
          COALESCE(prev.fetch_count, 0) + COALESCE(prev.search_count, 0) + COALESCE(prev.browser_count, 0) as prev_used,
          COALESCE(curr.rollover_credits, 0) as rollover_credits,
          COALESCE(curr.fetch_count, 0) as fetch_count,
          COALESCE(curr.search_count, 0) as search_count,
          COALESCE(curr.browser_count, 0) as browser_count
        FROM api_keys ak
        JOIN users u ON ak.user_id = u.id
        LEFT JOIN usage curr ON curr.api_key_id = ak.id AND curr.period = $2
        LEFT JOIN usage prev ON prev.api_key_id = ak.id AND prev.period = $3
        WHERE ak.key_hash = $1`,
        [keyHash, currentPeriod, previousPeriod]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const row = result.rows[0];
      const monthlyLimit = row.monthly_limit;
      const currentUsed = row.current_used;
      const prevUsed = row.prev_used;
      const rolloverCredits = row.rollover_credits;

      // Calculate rollover: MIN(unused_last_month, monthly_limit)
      const prevUnused = Math.max(0, monthlyLimit - prevUsed);
      const calculatedRollover = Math.min(prevUnused, monthlyLimit);

      // Update rollover if it's the first access this month
      if (rolloverCredits === 0 && calculatedRollover > 0) {
        await this.pool.query(
          `INSERT INTO usage (user_id, api_key_id, period, rollover_credits, updated_at)
          SELECT user_id, id, $2, $3, now()
          FROM api_keys WHERE key_hash = $1
          ON CONFLICT (api_key_id, period)
          DO UPDATE SET rollover_credits = $3`,
          [keyHash, currentPeriod, calculatedRollover]
        );
      }

      const effectiveRollover = rolloverCredits > 0 ? rolloverCredits : calculatedRollover;
      const totalAvailable = monthlyLimit + effectiveRollover;
      const remaining = Math.max(0, totalAvailable - currentUsed);

      return {
        period: currentPeriod,
        fetchCount: row.fetch_count,
        searchCount: row.search_count,
        browserCount: row.browser_count,
        rolloverCredits: effectiveRollover,
        monthlyLimit,
        totalUsed: currentUsed,
        totalAvailable,
        remaining,
      };
    } catch (error) {
      console.error('Failed to get usage:', error);
      return null;
    }
  }

  /**
   * Check if API key has exceeded monthly limit
   */
  async checkLimit(key: string): Promise<{ allowed: boolean; usage?: UsageInfo }> {
    const usage = await this.getUsage(key);
    
    if (!usage) {
      return { allowed: false };
    }

    const allowed = usage.remaining > 0;
    
    return { allowed, usage };
  }

  /**
   * Generate a cryptographically secure API key
   * Format: wp_live_ + 32 random hex chars (total 40 chars)
   */
  static generateApiKey(): string {
    const randomBytes = crypto.randomBytes(16).toString('hex');
    return `wp_live_${randomBytes}`;
  }

  /**
   * Get key prefix (first 12 characters for display)
   */
  static getKeyPrefix(key: string): string {
    return key.substring(0, 12);
  }

  /**
   * Close the database pool
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
