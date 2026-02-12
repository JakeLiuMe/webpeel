/**
 * API key authentication middleware with usage enforcement
 */

import { Request, Response, NextFunction } from 'express';
import { AuthStore, ApiKeyInfo } from '../auth-store.js';
import { PostgresAuthStore } from '../pg-auth-store.js';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        keyInfo: ApiKeyInfo | null;
        tier: 'free' | 'starter' | 'pro' | 'enterprise' | 'max';
        rateLimit: number;
      };
    }
  }
}

export function createAuthMiddleware(authStore: AuthStore) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Extract API key from Authorization header or X-API-Key header
      const authHeader = req.headers.authorization;
      const apiKeyHeader = req.headers['x-api-key'];

      // SECURITY: Skip API key auth for public/JWT-protected endpoints
      // These routes either need no auth or use their own JWT middleware
      const isPublicEndpoint = 
        req.path === '/health' || 
        req.path.startsWith('/v1/auth/') ||
        req.path === '/v1/webhooks/stripe' ||
        req.path === '/v1/me' ||
        req.path.startsWith('/v1/keys') ||
        req.path === '/v1/usage';

      if (isPublicEndpoint) {
        req.auth = { keyInfo: null, tier: 'free', rateLimit: 10 };
        return next();
      }

      let apiKey: string | null = null;

      if (authHeader?.startsWith('Bearer ')) {
        apiKey = authHeader.slice(7);
      } else if (apiKeyHeader && typeof apiKeyHeader === 'string') {
        apiKey = apiKeyHeader;
      }
      
      if (!apiKey) {
        res.status(401).json({
          error: 'missing_key',
          message: 'API key is required. Provide via Authorization: Bearer <key> or X-API-Key header.',
        });
        return;
      }

      // Validate API key if provided
      let keyInfo: ApiKeyInfo | null = null;
      if (apiKey) {
        keyInfo = await authStore.validateKey(apiKey);
        if (!keyInfo) {
          res.status(401).json({
            error: 'invalid_key',
            message: 'Invalid API key',
          });
          return;
        }

        // Check usage limits (only for PostgresAuthStore)
        if (authStore instanceof PostgresAuthStore) {
          const { allowed, usage } = await authStore.checkLimit(apiKey);
          
          if (!allowed && usage) {
            res.status(429).json({
              error: 'limit_exceeded',
              message: `Monthly limit exceeded. Used ${usage.totalUsed}/${usage.totalAvailable} credits.`,
              upgrade_url: 'https://webpeel.dev/pricing',
              usage: {
                used: usage.totalUsed,
                limit: usage.totalAvailable,
                period: usage.period,
              },
            });
            return;
          }

          // Add usage headers
          if (usage) {
            res.setHeader('X-Monthly-Limit', usage.totalAvailable.toString());
            res.setHeader('X-Monthly-Used', usage.totalUsed.toString());
            res.setHeader('X-Monthly-Remaining', usage.remaining.toString());

            // Warn if over 80% usage
            const usagePercent = (usage.totalUsed / usage.totalAvailable) * 100;
            if (usagePercent >= 80) {
              res.setHeader(
                'X-Usage-Warning',
                `You've used ${usagePercent.toFixed(0)}% of your monthly quota. Consider upgrading at https://webpeel.dev/pricing`
              );
            }
          }
        }
      }

      // Set auth context on request
      req.auth = {
        keyInfo,
        tier: keyInfo?.tier || 'free',
        rateLimit: keyInfo?.rateLimit || 10,
      };

      next();
    } catch (error) {
      const err = error as Error;
      res.status(500).json({
        error: 'auth_error',
        message: err.message || 'Authentication failed',
      });
    }
  };
}
