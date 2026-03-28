/**
 * Redis-backed rate limiting middleware.
 *
 * Uses `rate-limiter-flexible` for atomic Redis operations — works correctly
 * across all 6 K8s API pods (shared state via Redis).
 *
 * Falls back to in-memory when REDIS_URL is not set (CLI/local dev).
 *
 * Features:
 * - Per-key (API key or IP) rate limiting
 * - Tier-based limits: free=50/hr, pro=100/hr, max=500/hr
 * - Route-based cost weighting: crawl=5x, render=3x, batch/screenshot=2x
 * - Per-IP rate limiting ON TOP of API key limits (abuse prevention)
 * - Exempt paths for health/docs endpoints
 */

import { Request, Response, NextFunction } from 'express';
import '../types.js';

// ─── Tier burst limits ───────────────────────────────────────────────────────

const TIER_BURST_LIMITS: Record<string, number> = {
  free: 50,
  pro: 100,
  max: 500,
  admin: 999999,
};

/** Global per-IP limit regardless of API key (prevents shared-key abuse) */
const GLOBAL_IP_LIMIT = 1000; // per hour

// ─── Exempt paths ────────────────────────────────────────────────────────────

const EXEMPT_PATHS = [
  '/health',
  '/ready',
  '/openapi.json',
  '/openapi.yaml',
  '/docs',
  '/v1/usage',
  '/v1/me',
  '/v1/keys',
  '/v1/activity',
  '/v1/stats',
];

// ─── RateLimiter class (Redis or in-memory) ──────────────────────────────────

export class RateLimiter {
  private keyLimiter: any; // RateLimiterRedis or RateLimiterMemory
  private ipLimiter: any;  // separate limiter for per-IP limits
  private windowMs: number;
  private initialized = false;
  private initPromise: Promise<void>;

  constructor(windowMs: number = 3_600_000) { // 1 hour
    this.windowMs = windowMs;
    this.initPromise = this.init();
  }

  private async init(): Promise<void> {
    const duration = Math.floor(this.windowMs / 1000); // seconds

    try {
      // Try Redis first
      const redisUrl = process.env.REDIS_URL;
      if (redisUrl) {
        // Dynamic import to avoid hard dependency
        const [{ RateLimiterRedis }, IoRedisModule] = await Promise.all([
          import('rate-limiter-flexible'),
          import('ioredis'),
        ]);
        const IoRedis = (IoRedisModule as any).default ?? IoRedisModule;

        const parsed = new URL(redisUrl);
        const redisClient = new IoRedis({
          host: parsed.hostname,
          port: parseInt(parsed.port || '6379', 10),
          password: process.env.REDIS_PASSWORD || undefined,
          db: parseInt(parsed.pathname?.slice(1) || '0', 10) || 0,
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          lazyConnect: true,
        });

        await redisClient.connect();

        // Key-based limiter (per API key or unauthenticated IP)
        this.keyLimiter = new RateLimiterRedis({
          storeClient: redisClient,
          keyPrefix: 'rl:key',
          points: 500, // max tier limit — actual check done per-tier
          duration,
          blockDuration: 0, // don't block, just check
        });

        // IP-based limiter (global per-IP cap, on top of key limits)
        this.ipLimiter = new RateLimiterRedis({
          storeClient: redisClient,
          keyPrefix: 'rl:ip',
          points: GLOBAL_IP_LIMIT,
          duration,
          blockDuration: 0,
        });

        console.log('[rate-limit] Redis-backed rate limiting active (shared across pods)');
        this.initialized = true;
        return;
      }
    } catch (err) {
      console.warn('[rate-limit] Failed to init Redis rate limiter, falling back to in-memory:', (err as Error).message);
    }

    // Fallback: in-memory
    const { RateLimiterMemory } = await import('rate-limiter-flexible');
    this.keyLimiter = new RateLimiterMemory({
      keyPrefix: 'rl:key',
      points: 500,
      duration: Math.floor(this.windowMs / 1000),
    });
    this.ipLimiter = new RateLimiterMemory({
      keyPrefix: 'rl:ip',
      points: GLOBAL_IP_LIMIT,
      duration: Math.floor(this.windowMs / 1000),
    });
    console.log('[rate-limit] In-memory rate limiting active (single-pod only)');
    this.initialized = true;
  }

  async waitForInit(): Promise<void> {
    if (!this.initialized) await this.initPromise;
  }

  /**
   * Check if request is allowed.
   * Returns { allowed, remaining, retryAfter? }
   */
  async checkLimit(identifier: string, limit: number, cost: number = 1): Promise<{
    allowed: boolean;
    remaining: number;
    retryAfter?: number;
  }> {
    await this.waitForInit();

    try {
      const res = await this.keyLimiter.consume(identifier, cost);
      // rate-limiter-flexible tracks points consumed; we need to check against the per-tier limit
      const consumed = res.consumedPoints;
      if (consumed > limit) {
        // Over the tier limit — reject
        const msBeforeNext = res.msBeforeNext;
        return {
          allowed: false,
          remaining: 0,
          retryAfter: Math.ceil(msBeforeNext / 1000),
        };
      }
      return {
        allowed: true,
        remaining: Math.max(0, limit - consumed),
      };
    } catch (rejRes: any) {
      // RateLimiterRes when rate limited
      if (rejRes && rejRes.msBeforeNext !== undefined) {
        return {
          allowed: false,
          remaining: 0,
          retryAfter: Math.ceil(rejRes.msBeforeNext / 1000),
        };
      }
      // Unexpected error — allow through (fail-open)
      console.error('[rate-limit] Error checking rate limit:', rejRes);
      return { allowed: true, remaining: limit };
    }
  }

  /**
   * Check per-IP limit (global cap regardless of API key).
   */
  async checkIpLimit(ip: string, cost: number = 1): Promise<{
    allowed: boolean;
    remaining: number;
    retryAfter?: number;
  }> {
    await this.waitForInit();

    try {
      const res = await this.ipLimiter.consume(ip, cost);
      return {
        allowed: true,
        remaining: Math.max(0, GLOBAL_IP_LIMIT - res.consumedPoints),
      };
    } catch (rejRes: any) {
      if (rejRes && rejRes.msBeforeNext !== undefined) {
        return {
          allowed: false,
          remaining: 0,
          retryAfter: Math.ceil(rejRes.msBeforeNext / 1000),
        };
      }
      return { allowed: true, remaining: GLOBAL_IP_LIMIT };
    }
  }

  /**
   * Backward compat: cleanup is no-op for Redis (TTL handles it).
   * Kept for in-memory fallback and for app.ts which calls it on an interval.
   */
  cleanup(): void {
    // No-op for Redis; RateLimiterMemory handles its own cleanup
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export function createRateLimitMiddleware(limiter: RateLimiter) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Skip rate limiting for exempt endpoints
      if (EXEMPT_PATHS.some(p => req.path === p || req.path.startsWith(p + '/'))) {
        return next();
      }

      // Resolve real client IP (Cloudflare → x-forwarded-for → x-real-ip → req.ip)
      const forwardedFor = req.headers['x-forwarded-for'];
      const firstForwardedIp = typeof forwardedFor === 'string'
        ? forwardedFor.split(',')[0].trim()
        : Array.isArray(forwardedFor) ? forwardedFor[0] : undefined;

      const clientIp = (req.headers['cf-connecting-ip'] as string)
        || firstForwardedIp
        || (req.headers['x-real-ip'] as string)
        || req.ip
        || 'unknown';

      // Key-based identifier: prefer API key, fall back to IP
      const keyIdentifier = req.auth?.keyInfo?.key || `ip:${clientIp}`;

      // Tier-based limit
      const tier = req.auth?.tier || 'free';
      const limit = TIER_BURST_LIMITS[tier] || 50;

      // Route-based cost weighting
      let cost = 1;
      const path = req.path;
      if (path.includes('/crawl') || path.includes('/map')) cost = 5;
      else if (path.includes('/batch')) cost = 2;
      else if (path.includes('/screenshot')) cost = 2;
      else if (req.query.render === 'true' || (req.body as any)?.render === true) cost = 3;

      // Check 1: Per-key rate limit
      const keyResult = await limiter.checkLimit(keyIdentifier, limit, cost);

      // Check 2: Per-IP rate limit (on top of key limit, prevents shared-key abuse)
      const ipResult = await limiter.checkIpLimit(clientIp, cost);

      // Use the more restrictive result
      const allowed = keyResult.allowed && ipResult.allowed;
      const remaining = Math.min(keyResult.remaining, ipResult.remaining);
      const retryAfter = !allowed
        ? Math.max(keyResult.retryAfter || 0, ipResult.retryAfter || 0)
        : undefined;

      // Set rate limit headers
      const now = Date.now();
      const resetTimestamp = Math.ceil((now + (limiter as any).windowMs) / 1000);
      res.setHeader('X-RateLimit-Limit', limit.toString());
      res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining).toString());
      res.setHeader('X-RateLimit-Reset', resetTimestamp.toString());

      if (req.auth?.tier) {
        res.setHeader('X-WebPeel-Plan', req.auth.tier);
      }

      if (!allowed) {
        const retryAfterSecs = retryAfter || 60;
        res.setHeader('Retry-After', retryAfterSecs.toString());

        const upgradeHint = tier === 'free'
          ? ' Upgrade to Pro ($9/mo) for 100/hr burst limit → https://webpeel.dev/pricing'
          : tier === 'pro'
          ? ' Upgrade to Max ($29/mo) for 500/hr burst limit → https://webpeel.dev/pricing'
          : '';

        // Determine which limit was hit
        const reason = !keyResult.allowed
          ? `Hourly rate limit exceeded (${limit} requests/hr on ${tier} plan)`
          : `Global IP rate limit exceeded (${GLOBAL_IP_LIMIT} requests/hr)`;

        res.status(429).json({
          success: false,
          error: {
            type: 'rate_limited',
            message: `${reason}. Try again in ${retryAfterSecs}s.`,
            hint: `Retry after ${retryAfterSecs} seconds.${upgradeHint}`,
            docs: 'https://webpeel.dev/docs/errors#rate-limited',
          },
          metadata: { requestId: req.requestId },
        });
        return;
      }

      next();
    } catch (_error) {
      // Fail-open: if rate limiter errors, allow the request through
      console.error('[rate-limit] Middleware error, failing open:', _error);
      next();
    }
  };
}
