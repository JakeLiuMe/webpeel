/**
 * WebPeel Audit Logging Middleware
 *
 * Records who accessed which API endpoints and the outcome.
 * Designed to be privacy-safe:
 *  - Logs userId, keyId, method, path, status, duration, IP, user-agent
 *  - Does NOT log: request bodies, auth headers, query params (may contain API keys)
 *  - Only logs /v1/ endpoints (skips health checks, static files)
 *
 * When DATABASE_URL is set, also writes to usage_logs table (fire-and-forget).
 */

import { Request, Response, NextFunction } from 'express';
import '../types.js'; // Augments Express.Request with requestId
import { createLogger } from '../logger.js';
import pg from 'pg';

const auditLog = createLogger('audit');

// ── Singleton audit DB pool ───────────────────────────────────────────────────
// One small pool shared by all requests — created lazily on first /v1/ request.
let _auditPool: pg.Pool | null = null;

function getAuditPool(): pg.Pool {
  if (!_auditPool && process.env.DATABASE_URL) {
    _auditPool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('sslmode=require')
        ? { rejectUnauthorized: process.env.PG_REJECT_UNAUTHORIZED !== 'false' }
        : undefined,
      max: 3,
      idleTimeoutMillis: 30_000,
    });
  }
  return _auditPool!;
}

export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  const startTime = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - startTime;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const auth = (req as any).auth as { keyInfo?: { accountId?: string; key?: string } } | undefined;
    const userId = auth?.keyInfo?.accountId || 'anonymous';
    // Use a truncated prefix of the key as a safe identifier (never log the full key)
    const rawKey = auth?.keyInfo?.key;
    const keyId = rawKey ? rawKey.slice(0, 8) + '...' : 'none';

    const clientIp =
      (req.headers['cf-connecting-ip'] as string) ||
      (req.headers['x-forwarded-for'] as string) ||
      req.ip;

    // Only log API endpoints (skip health checks, static files)
    if (req.path.startsWith('/v1/')) {
      auditLog.info(`${req.method} ${req.path}`, {
        action: `${req.method} ${req.path}`,
        userId,
        keyId,
        statusCode: res.statusCode,
        duration,
        ip: clientIp,
        userAgent: req.headers['user-agent']?.slice(0, 100),
        // DO NOT log: request body, auth headers, query params (may contain API keys or secrets)
      });

      // ── Fire-and-forget DB write ────────────────────────────────────────────
      // Only runs when DATABASE_URL is set. Never slows down the response.
      if (process.env.DATABASE_URL) {
        const dbUserId = userId !== 'anonymous' ? userId : null;
        const urlParam = typeof req.query?.url === 'string' ? req.query.url.slice(0, 2048) : null;

        getAuditPool()
          .query(
            `INSERT INTO usage_logs
              (user_id, url, endpoint, method, status_code, processing_time_ms, ip_address, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
            [dbUserId, urlParam, req.path, req.method, res.statusCode, duration, clientIp]
          )
          .catch(() => {
            // Ignore audit DB failures — never propagate to the request
          });
      }
    }
  });

  next();
}
