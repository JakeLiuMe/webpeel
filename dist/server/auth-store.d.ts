/**
 * Auth store abstraction for API key validation and usage tracking
 * Designed to easily swap from in-memory to PostgreSQL
 */
export interface ApiKeyInfo {
    key: string;
    tier: 'free' | 'starter' | 'pro' | 'enterprise' | 'max';
    rateLimit: number;
    accountId?: string;
    createdAt: Date;
}
export interface AuthStore {
    validateKey(key: string): Promise<ApiKeyInfo | null>;
    trackUsage(key: string, creditsOrType: number | 'basic' | 'stealth' | 'captcha' | 'search'): Promise<void>;
}
/**
 * In-memory auth store for development and self-hosted deployments
 */
export declare class InMemoryAuthStore implements AuthStore {
    private keys;
    private usage;
    constructor();
    validateKey(key: string): Promise<ApiKeyInfo | null>;
    trackUsage(key: string, creditsOrType: number | 'basic' | 'stealth' | 'captcha' | 'search'): Promise<void>;
    addKey(keyInfo: ApiKeyInfo): void;
    getUsage(key: string): number;
}
//# sourceMappingURL=auth-store.d.ts.map