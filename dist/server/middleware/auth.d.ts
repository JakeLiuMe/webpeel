/**
 * API key authentication middleware with SOFT LIMIT enforcement
 *
 * Philosophy: Never fully block users. When weekly limits are exceeded,
 * degrade to HTTP-only mode instead of returning 429.
 * BURST limits (hourly) are HARD limits and return 429.
 */
import { Request, Response, NextFunction } from 'express';
import { AuthStore, ApiKeyInfo } from '../auth-store.js';
declare global {
    namespace Express {
        interface Request {
            auth?: {
                keyInfo: ApiKeyInfo | null;
                tier: 'free' | 'starter' | 'pro' | 'enterprise' | 'max';
                rateLimit: number;
                softLimited: boolean;
                extraUsageAvailable: boolean;
            };
        }
    }
}
export declare function createAuthMiddleware(authStore: AuthStore): (req: Request, res: Response, next: NextFunction) => Promise<void>;
//# sourceMappingURL=auth.d.ts.map