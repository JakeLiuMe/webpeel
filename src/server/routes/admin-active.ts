/**
 * Admin active-users endpoint — admin tier only
 *
 * GET /v1/admin/active — currently active API users (24h + 7d windows)
 */

import { Router, Request, Response } from 'express';
import pg from 'pg';

const { Pool } = pg;

function noDB(req: Request, res: Response): void {
  res.status(501).json({
    success: false,
    error: {
      type: 'not_configured',
      message: 'Admin endpoints require PostgreSQL backend',
      docs: 'https://webpeel.dev/docs/errors#not_configured',
    },
    requestId: req.requestId,
  });
}

function adminOnly(req: Request, res: Response): boolean {
  if (req.auth?.tier !== 'admin') {
    res.status(403).json({
      success: false,
      error: { type: 'forbidden', message: 'Admin access required', docs: 'https://webpeel.dev/docs/authentication' },
      requestId: req.requestId,
    });
    return false;
  }
  return true;
}

export function createAdminActiveRouter(): Router {
  const router = Router();
  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    router.get('/v1/admin/active', noDB);
    return router;
  }

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes('sslmode=require')
      ? { rejectUnauthorized: process.env.PG_REJECT_UNAUTHORIZED !== 'false' }
      : undefined,
    max: 5,
  });

  router.get('/v1/admin/active', async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;

    try {
      // Total registered users
      const totalResult = await pool.query('SELECT COUNT(*) AS count FROM users');
      const totalRegistered = parseInt(totalResult.rows[0].count) || 0;

      // Active 24h — users whose API key was used in the last 24h
      // Join with usage_logs to get today's request count per user
      const active24hResult = await pool.query(`
        SELECT
          u.id        AS user_id,
          u.email,
          u.tier,
          MAX(ak.last_used_at) AS last_seen,
          COUNT(ul.id)         AS requests_today
        FROM users u
        JOIN api_keys ak ON ak.user_id = u.id AND ak.is_active = true
        LEFT JOIN usage_logs ul
          ON ul.user_id::text = u.id::text
          AND ul.created_at >= NOW() - INTERVAL '24 hours'
        WHERE ak.last_used_at > NOW() - INTERVAL '24 hours'
        GROUP BY u.id, u.email, u.tier
        ORDER BY last_seen DESC
      `);

      const active24h = active24hResult.rows.map((r) => ({
        userId: r.user_id,
        email: r.email,
        tier: r.tier,
        lastSeen: r.last_seen instanceof Date ? r.last_seen.toISOString() : String(r.last_seen),
        requestsToday: parseInt(r.requests_today) || 0,
      }));

      // Active 7d — users whose API key was used in the last 7 days
      const active7dResult = await pool.query(`
        SELECT
          u.id        AS user_id,
          u.email,
          u.tier,
          MAX(ak.last_used_at) AS last_seen,
          COUNT(ul.id)         AS requests_7d
        FROM users u
        JOIN api_keys ak ON ak.user_id = u.id AND ak.is_active = true
        LEFT JOIN usage_logs ul
          ON ul.user_id::text = u.id::text
          AND ul.created_at >= NOW() - INTERVAL '7 days'
        WHERE ak.last_used_at > NOW() - INTERVAL '7 days'
        GROUP BY u.id, u.email, u.tier
        ORDER BY last_seen DESC
      `);

      const active7d = active7dResult.rows.map((r) => ({
        userId: r.user_id,
        email: r.email,
        tier: r.tier,
        lastSeen: r.last_seen instanceof Date ? r.last_seen.toISOString() : String(r.last_seen),
        requestsLast7d: parseInt(r.requests_7d) || 0,
      }));

      res.json({
        success: true,
        data: {
          active24h,
          active7d,
          totalRegistered,
        },
      });
    } catch (err: any) {
      console.error('[admin-active] error:', err);
      res.status(500).json({
        success: false,
        error: { type: 'internal_error', message: 'Failed to retrieve active users', docs: 'https://webpeel.dev/docs/errors#internal_error' },
        requestId: req.requestId,
      });
    }
  });

  return router;
}
