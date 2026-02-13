/**
 * PostgreSQL-backed auth store for production deployments
 * Uses SHA-256 hashing for API keys and tracks WEEKLY usage with burst limits
 */
import { AuthStore, ApiKeyInfo } from './auth-store.js';
export interface WeeklyUsageInfo {
    week: string;
    basicCount: number;
    stealthCount: number;
    captchaCount: number;
    searchCount: number;
    totalUsed: number;
    weeklyLimit: number;
    rolloverCredits: number;
    totalAvailable: number;
    remaining: number;
    percentUsed: number;
    resetsAt: string;
}
export interface BurstInfo {
    hourBucket: string;
    count: number;
    limit: number;
    remaining: number;
    resetsIn: string;
}
export interface ExtraUsageInfo {
    enabled: boolean;
    balance: number;
    spent: number;
    spendingLimit: number;
    autoReload: boolean;
    percentUsed: number;
    resetsAt: string;
}
/**
 * PostgreSQL auth store for production
 */
export declare class PostgresAuthStore implements AuthStore {
    private pool;
    constructor(connectionString?: string);
    /**
     * Hash API key with SHA-256
     * SECURITY: Never store raw API keys
     */
    private hashKey;
    /**
     * Get current ISO week in YYYY-WXX format (e.g., "2026-W07")
     */
    private getCurrentWeek;
    /**
     * Get previous ISO week in YYYY-WXX format
     */
    private getPreviousWeek;
    /**
     * Get next Monday 00:00 UTC (week reset time)
     */
    private getWeekResetTime;
    /**
     * Get current hour bucket in YYYY-MM-DDTHH format (UTC)
     */
    private getCurrentHour;
    /**
     * Get human-readable time until next hour
     */
    private getTimeUntilNextHour;
    /**
     * Validate API key and return user info
     * SECURITY: Uses SHA-256 hash comparison, updates last_used_at
     */
    validateKey(key: string): Promise<ApiKeyInfo | null>;
    /**
     * Track weekly usage for an API key
     * SECURITY: Uses UPSERT to prevent race conditions
     */
    trackUsage(key: string, fetchType: 'basic' | 'stealth' | 'captcha' | 'search'): Promise<void>;
    /**
     * Track burst usage (hourly limit)
     */
    trackBurstUsage(key: string): Promise<void>;
    /**
     * Check burst limit (hourly)
     */
    checkBurstLimit(key: string): Promise<{
        allowed: boolean;
        burst: BurstInfo;
    }>;
    /**
     * Get weekly usage info for an API key with rollover calculation
     */
    getUsage(key: string): Promise<WeeklyUsageInfo | null>;
    /**
     * Check if API key has exceeded weekly limit
     */
    checkLimit(key: string): Promise<{
        allowed: boolean;
        usage?: WeeklyUsageInfo;
    }>;
    /**
     * Get extra usage info for a user
     */
    getExtraUsageInfo(key: string): Promise<ExtraUsageInfo | null>;
    /**
     * Check if extra usage can be used
     */
    canUseExtraUsage(key: string): Promise<boolean>;
    /**
     * Track extra usage and deduct from balance
     */
    trackExtraUsage(key: string, fetchType: 'basic' | 'stealth' | 'captcha' | 'search', url?: string, processingTimeMs?: number, statusCode?: number): Promise<{
        success: boolean;
        cost: number;
        newBalance: number;
    }>;
    /**
     * Generate a cryptographically secure API key
     * Format: wp_live_ + 32 random hex chars (total 40 chars)
     */
    static generateApiKey(): string;
    /**
     * Get key prefix (first 12 characters for display)
     */
    static getKeyPrefix(key: string): string;
    /**
     * Close the database pool
     */
    close(): Promise<void>;
}
//# sourceMappingURL=pg-auth-store.d.ts.map