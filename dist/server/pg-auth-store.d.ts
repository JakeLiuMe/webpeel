/**
 * PostgreSQL-backed auth store for production deployments
 * Uses SHA-256 hashing for API keys and tracks monthly usage with rollover
 */
import { AuthStore, ApiKeyInfo } from './auth-store.js';
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
export declare class PostgresAuthStore implements AuthStore {
    private pool;
    constructor(connectionString?: string);
    /**
     * Hash API key with SHA-256
     * SECURITY: Never store raw API keys
     */
    private hashKey;
    /**
     * Get current period in YYYY-MM format
     */
    private getCurrentPeriod;
    /**
     * Get previous period in YYYY-MM format
     */
    private getPreviousPeriod;
    /**
     * Validate API key and return user info
     * SECURITY: Uses SHA-256 hash comparison, updates last_used_at
     */
    validateKey(key: string): Promise<ApiKeyInfo | null>;
    /**
     * Track usage for an API key
     * SECURITY: Uses UPSERT to prevent race conditions
     */
    trackUsage(key: string, credits: number): Promise<void>;
    /**
     * Get usage info for an API key with rollover calculation
     */
    getUsage(key: string): Promise<UsageInfo | null>;
    /**
     * Check if API key has exceeded monthly limit
     */
    checkLimit(key: string): Promise<{
        allowed: boolean;
        usage?: UsageInfo;
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