/**
 * Auth store abstraction for API key validation and usage tracking
 * Designed to easily swap from in-memory to PostgreSQL
 */
import { timingSafeEqual } from 'crypto';
/**
 * Validate API key format and strength
 * SECURITY: Enforce minimum complexity
 */
function validateKeyFormat(key) {
    // Minimum 32 characters
    if (key.length < 32) {
        return false;
    }
    // Must contain alphanumeric characters
    if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
        return false;
    }
    return true;
}
/**
 * Timing-safe key comparison
 * SECURITY: Prevent timing attacks on key validation
 */
function timingSafeKeyCompare(a, b) {
    // Ensure equal length for comparison
    if (a.length !== b.length) {
        // Compare against dummy to prevent timing leak
        const dummy = 'x'.repeat(Math.max(a.length, b.length));
        timingSafeEqual(Buffer.from(dummy), Buffer.from(dummy));
        return false;
    }
    try {
        return timingSafeEqual(Buffer.from(a), Buffer.from(b));
    }
    catch {
        return false;
    }
}
/**
 * In-memory auth store for development and self-hosted deployments
 */
export class InMemoryAuthStore {
    keys = new Map();
    usage = new Map();
    constructor() {
        // SECURITY: Demo key only in development mode
        // Removed hardcoded demo key - use addKey() or environment variables
        if (process.env.NODE_ENV === 'development' && process.env.DEMO_KEY) {
            this.addKey({
                key: process.env.DEMO_KEY,
                tier: 'pro',
                rateLimit: 300,
                createdAt: new Date(),
            });
        }
    }
    async validateKey(key) {
        // Basic validation
        if (!key || typeof key !== 'string') {
            return null;
        }
        // SECURITY: Timing-safe comparison to prevent timing attacks
        for (const [storedKey, keyInfo] of this.keys.entries()) {
            if (timingSafeKeyCompare(key, storedKey)) {
                return keyInfo;
            }
        }
        // Constant-time operation for invalid key
        return null;
    }
    async trackUsage(key, credits) {
        const current = this.usage.get(key) || 0;
        this.usage.set(key, current + credits);
    }
    addKey(keyInfo) {
        // SECURITY: Validate key format before adding
        if (!validateKeyFormat(keyInfo.key)) {
            throw new Error('Invalid API key format: must be at least 32 characters, alphanumeric with - or _');
        }
        this.keys.set(keyInfo.key, keyInfo);
    }
    getUsage(key) {
        return this.usage.get(key) || 0;
    }
}
//# sourceMappingURL=auth-store.js.map