/**
 * Admin analytics endpoint — admin tier only
 *
 * GET /v1/admin/stats — platform-wide usage and user metrics
 */

import { Router, Request, Response } from 'express';
import pg from 'pg';

const { Pool } = pg;

function noDB(req: Request, res: Response): void {
  res.status(501).json({
    success: false,
    error: {
      type: 'not_configured',
      message: 'Admin stats require PostgreSQL backend',
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

export function createAdminStatsRouter(): Router {
  const router = Router();
  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    router.get('/v1/admin/stats', noDB);
    return router;
  }

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes('sslmode=require')
      ? { rejectUnauthorized: process.env.PG_REJECT_UNAUTHORIZED !== 'false' }
      : undefined,
    max: 5,
  });

  router.get('/v1/admin/stats', async (req: Request, res: Response) => {
    if (!adminOnly(req, res)) return;

    try {
      // ── User stats ──────────────────────────────────────────────────────────
      const userTotalsResult = await pool.query(`
        SELECT
          COUNT(*) AS total,
          COUNT(CASE WHEN tier = 'free'    THEN 1 END) AS free_count,
          COUNT(CASE WHEN tier = 'pro'     THEN 1 END) AS pro_count,
          COUNT(CASE WHEN tier = 'max'     THEN 1 END) AS max_count,
          COUNT(CASE WHEN tier = 'admin'   THEN 1 END) AS admin_count
        FROM users
      `);
      const userTotals = userTotalsResult.rows[0];

      // Active users (7d / 30d) — based on api_keys.last_used_at
      const activeResult = await pool.query(`
        SELECT
          COUNT(DISTINCT CASE WHEN ak.last_used_at > NOW() - INTERVAL '7 days'  THEN ak.user_id END) AS active_7d,
          COUNT(DISTINCT CASE WHEN ak.last_used_at > NOW() - INTERVAL '30 days' THEN ak.user_id END) AS active_30d
        FROM api_keys ak
      `);
      const active = activeResult.rows[0];

      // New users this week (Mon–now)
      const newThisWeekResult = await pool.query(`
        SELECT COUNT(*) AS count FROM users
        WHERE created_at >= date_trunc('week', NOW() AT TIME ZONE 'UTC')
      `);
      const newThisWeek = parseInt(newThisWeekResult.rows[0].count) || 0;

      // ── Request stats ───────────────────────────────────────────────────────
      const reqStatsResult = await pool.query(`
        SELECT
          COUNT(CASE WHEN created_at >= CURRENT_DATE AT TIME ZONE 'UTC' THEN 1 END)              AS today,
          COUNT(CASE WHEN created_at >= date_trunc('week',  NOW() AT TIME ZONE 'UTC') THEN 1 END) AS this_week,
          COUNT(CASE WHEN created_at >= date_trunc('month', NOW() AT TIME ZONE 'UTC') THEN 1 END) AS this_month,
          ROUND(AVG(processing_time_ms))                                                           AS avg_response_time,
          ROUND(
            100.0 * SUM(CASE WHEN status_code < 400 THEN 1 ELSE 0 END)
            / NULLIF(COUNT(*), 0), 1
          )                                                                                        AS success_rate
        FROM usage_logs
      `);
      const reqStats = reqStatsResult.rows[0];

      // By endpoint
      const byEndpointResult = await pool.query(`
        SELECT
          endpoint,
          COUNT(*)                       AS count,
          ROUND(AVG(processing_time_ms)) AS avg_time
        FROM usage_logs
        WHERE endpoint IS NOT NULL
        GROUP BY endpoint
        ORDER BY count DESC
        LIMIT 20
      `);
      const byEndpoint = byEndpointResult.rows.map((r) => ({
        endpoint: r.endpoint,
        count: parseInt(r.count) || 0,
        avgTime: parseInt(r.avg_time) || 0,
      }));

      // ── Top users ────────────────────────────────────────────────────────────
      const topUsersResult = await pool.query(`
        SELECT
          u.id   AS user_id,
          u.email,
          u.tier,
          COUNT(ul.id) AS request_count
        FROM usage_logs ul
        JOIN users u ON u.id::text = ul.user_id::text
        GROUP BY u.id, u.email, u.tier
        ORDER BY request_count DESC
        LIMIT 10
      `);
      const topUsers = topUsersResult.rows.map((r) => ({
        userId: r.user_id,
        email: r.email,
        tier: r.tier,
        requestCount: parseInt(r.request_count) || 0,
      }));

      // ── Signups by day (last 30 days) ─────────────────────────────────────
      const signupsResult = await pool.query(`
        SELECT
          DATE(created_at) AS date,
          COUNT(*)         AS count
        FROM users
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `);
      const signupsByDay = signupsResult.rows.map((r) => ({
        date: r.date instanceof Date ? r.date.toISOString().slice(0, 10) : String(r.date),
        count: parseInt(r.count) || 0,
      }));

      res.json({
        success: true,
        data: {
          users: {
            total: parseInt(userTotals.total) || 0,
            active7d: parseInt(active.active_7d) || 0,
            active30d: parseInt(active.active_30d) || 0,
            newThisWeek,
            byTier: {
              free: parseInt(userTotals.free_count) || 0,
              pro: parseInt(userTotals.pro_count) || 0,
              max: parseInt(userTotals.max_count) || 0,
              admin: parseInt(userTotals.admin_count) || 0,
            },
          },
          requests: {
            today: parseInt(reqStats.today) || 0,
            thisWeek: parseInt(reqStats.this_week) || 0,
            thisMonth: parseInt(reqStats.this_month) || 0,
            avgResponseTime: parseInt(reqStats.avg_response_time) || 0,
            successRate: parseFloat(reqStats.success_rate) || 0,
            byEndpoint,
          },
          topUsers,
          signupsByDay,
        },
      });
    } catch (err: any) {
      console.error('[admin-stats] error:', err);
      res.status(500).json({
        success: false,
        error: { type: 'internal_error', message: 'Failed to retrieve admin stats', docs: 'https://webpeel.dev/docs/errors#internal_error' },
        requestId: req.requestId,
      });
    }
  });

  return router;
}
