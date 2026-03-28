/**
 * Usage API endpoints — professional usage tracking
 *
 * GET /v1/usage            — current period usage (credits, remaining, period dates)
 * GET /v1/usage/historical — per-week history (last 12 weeks)
 * GET /v1/usage/daily      — daily breakdown for current week
 */

import { Router, Request, Response } from 'express';
import pg from 'pg';

const { Pool } = pg;

// ─── ISO week helpers ────────────────────────────────────────────────────────

/** Parse an ISO week string (e.g. "2026-W13") → Monday 00:00 UTC */
function isoWeekToMonday(week: string): Date {
  const [yearStr, wStr] = week.split('-W');
  const year = parseInt(yearStr, 10);
  const weekNum = parseInt(wStr, 10);

  // ISO week 1 = the week containing Jan 4th
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4DayOfWeek = jan4.getUTCDay() || 7; // Mon=1 … Sun=7
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - (jan4DayOfWeek - 1) + (weekNum - 1) * 7);
  return monday;
}

/** Return the current ISO week string, e.g. "2026-W13" */
function getCurrentWeek(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const weekNum = Math.ceil(
    ((now.getTime() - jan4.getTime()) / 86_400_000 + jan4.getUTCDay() + 1) / 7
  );
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

/** Subtract `n` weeks from a week string */
function subtractWeeks(week: string, n: number): string {
  const monday = isoWeekToMonday(week);
  monday.setUTCDate(monday.getUTCDate() - n * 7);
  const year = monday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const weekNum = Math.ceil(
    ((monday.getTime() - jan4.getTime()) / 86_400_000 + jan4.getUTCDay() + 1) / 7
  );
  return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

// ─── 501 stub (no DB configured) ─────────────────────────────────────────────

function noDB(req: Request, res: Response): void {
  res.status(501).json({
    success: false,
    error: {
      type: 'not_configured',
      message: 'Usage tracking requires PostgreSQL backend',
      docs: 'https://webpeel.dev/docs/errors#not_configured',
    },
    requestId: req.requestId,
  });
}

// ─── Router factory ───────────────────────────────────────────────────────────

export function createUsageRouter(): Router {
  const router = Router();
  const dbUrl = process.env.DATABASE_URL;

  if (!dbUrl) {
    router.get('/v1/usage', noDB);
    router.get('/v1/usage/historical', noDB);
    router.get('/v1/usage/daily', noDB);
    return router;
  }

  const pool = new Pool({
    connectionString: dbUrl,
    ssl: dbUrl.includes('sslmode=require')
      ? { rejectUnauthorized: process.env.PG_REJECT_UNAUTHORIZED !== 'false' }
      : undefined,
    max: 5,
  });

  // ── GET /v1/usage ─────────────────────────────────────────────────────────

  router.get('/v1/usage', async (req: Request, res: Response) => {
    try {
      if (!req.auth?.keyInfo?.accountId) {
        res.status(401).json({
          success: false,
          error: { type: 'unauthorized', message: 'Valid API key required', docs: 'https://webpeel.dev/docs/authentication' },
          requestId: req.requestId,
        });
        return;
      }

      const userId = req.auth.keyInfo.accountId;
      const currentWeek = getCurrentWeek();
      const now = new Date();
      const currentHour = now.toISOString().substring(0, 13); // "2026-03-26T10"

      // Plan
      const planResult = await pool.query(
        'SELECT tier, weekly_limit, burst_limit FROM users WHERE id = $1',
        [userId]
      );
      if (planResult.rows.length === 0) {
        res.status(404).json({ success: false, error: { type: 'user_not_found', message: 'User not found' }, requestId: req.requestId });
        return;
      }
      const plan = planResult.rows[0];
      const weeklyLimit: number = plan.weekly_limit || 125;
      const burstLimit: number = plan.burst_limit || 25;

      // Weekly usage (sum across all active API keys)
      const weeklyResult = await pool.query(
        `SELECT
          COALESCE(SUM(wu.basic_count), 0)   AS basic_count,
          COALESCE(SUM(wu.stealth_count), 0) AS stealth_count,
          COALESCE(SUM(wu.captcha_count), 0) AS captcha_count,
          COALESCE(SUM(wu.search_count), 0)  AS search_count,
          COALESCE(SUM(wu.total_count), 0)   AS total_count,
          COALESCE(MAX(wu.rollover_credits), 0) AS rollover_credits
        FROM api_keys ak
        LEFT JOIN weekly_usage wu
          ON wu.api_key_id = ak.id AND wu.week = $2
        WHERE ak.user_id = $1 AND ak.is_active = true`,
        [userId, currentWeek]
      );

      const weekly = weeklyResult.rows[0];
      const creditsUsed = parseInt(weekly.total_count) || 0;
      const rolloverCredits = parseInt(weekly.rollover_credits) || 0;
      const creditsTotal = weeklyLimit + rolloverCredits;
      const creditsRemaining = Math.max(0, creditsTotal - creditsUsed);

      // Period dates
      const weekStart = isoWeekToMonday(currentWeek);
      const weekEnd = new Date(weekStart);
      weekEnd.setUTCDate(weekStart.getUTCDate() + 7);

      // Burst usage
      const burstResult = await pool.query(
        `SELECT COALESCE(SUM(bu.count), 0) AS burst_used
        FROM api_keys ak
        LEFT JOIN burst_usage bu
          ON bu.api_key_id = ak.id AND bu.hour_bucket = $2
        WHERE ak.user_id = $1 AND ak.is_active = true`,
        [userId, currentHour]
      );
      const burstUsed = parseInt(burstResult.rows[0]?.burst_used) || 0;
      const minutesRemaining = 59 - now.getUTCMinutes();

      res.json({
        success: true,
        data: {
          plan: {
            tier: plan.tier,
            weeklyLimit,
            burstLimit,
          },
          currentPeriod: {
            week: currentWeek,
            start: weekStart.toISOString(),
            end: weekEnd.toISOString(),
            creditsUsed,
            creditsRemaining,
            creditsTotal,
            rolloverCredits,
            percentUsed: creditsTotal > 0 ? Math.round((creditsUsed / creditsTotal) * 1000) / 10 : 0,
            breakdown: {
              fetch: parseInt(weekly.basic_count) || 0,
              search: parseInt(weekly.search_count) || 0,
              stealth: parseInt(weekly.stealth_count) || 0,
              captcha: parseInt(weekly.captcha_count) || 0,
            },
          },
          burst: {
            currentHour,
            used: burstUsed,
            limit: burstLimit,
            remaining: Math.max(0, burstLimit - burstUsed),
            resetsIn: minutesRemaining <= 0 ? '< 1m' : `${minutesRemaining}m`,
          },
          canFetch: creditsRemaining > 0 && burstUsed < burstLimit,
          upgradeUrl: 'https://webpeel.dev/pricing',
        },
      });
    } catch (err: any) {
      console.error('[usage] GET /v1/usage error:', err);
      res.status(500).json({
        success: false,
        error: { type: 'internal_error', message: 'Failed to retrieve usage', docs: 'https://webpeel.dev/docs/errors#internal_error' },
        requestId: req.requestId,
      });
    }
  });

  // ── GET /v1/usage/historical ──────────────────────────────────────────────

  router.get('/v1/usage/historical', async (req: Request, res: Response) => {
    try {
      if (!req.auth?.keyInfo?.accountId) {
        res.status(401).json({
          success: false,
          error: { type: 'unauthorized', message: 'Valid API key required', docs: 'https://webpeel.dev/docs/authentication' },
          requestId: req.requestId,
        });
        return;
      }

      const userId = req.auth.keyInfo.accountId;
      const currentWeek = getCurrentWeek();
      const oldestWeek = subtractWeeks(currentWeek, 11); // 12 weeks total

      const result = await pool.query(
        `SELECT
          wu.week,
          SUM(wu.basic_count)   AS basic_count,
          SUM(wu.stealth_count) AS stealth_count,
          SUM(wu.captcha_count) AS captcha_count,
          SUM(wu.search_count)  AS search_count,
          SUM(wu.total_count)   AS total_count
        FROM api_keys ak
        JOIN weekly_usage wu ON wu.api_key_id = ak.id
        WHERE ak.user_id = $1
          AND wu.week >= $2
          AND wu.week <= $3
        GROUP BY wu.week
        ORDER BY wu.week DESC`,
        [userId, oldestWeek, currentWeek]
      );

      const periods = result.rows.map((row) => {
        const weekStart = isoWeekToMonday(row.week);
        const weekEnd = new Date(weekStart);
        weekEnd.setUTCDate(weekStart.getUTCDate() + 7);
        return {
          week: row.week,
          start: weekStart.toISOString(),
          end: weekEnd.toISOString(),
          creditsUsed: parseInt(row.total_count) || 0,
          breakdown: {
            fetch: parseInt(row.basic_count) || 0,
            search: parseInt(row.search_count) || 0,
            stealth: parseInt(row.stealth_count) || 0,
            captcha: parseInt(row.captcha_count) || 0,
          },
        };
      });

      const total = periods.reduce((sum, p) => sum + p.creditsUsed, 0);

      res.json({
        success: true,
        data: { periods, total },
      });
    } catch (err: any) {
      console.error('[usage] GET /v1/usage/historical error:', err);
      res.status(500).json({
        success: false,
        error: { type: 'internal_error', message: 'Failed to retrieve historical usage', docs: 'https://webpeel.dev/docs/errors#internal_error' },
        requestId: req.requestId,
      });
    }
  });

  // ── GET /v1/usage/daily ───────────────────────────────────────────────────

  router.get('/v1/usage/daily', async (req: Request, res: Response) => {
    try {
      if (!req.auth?.keyInfo?.accountId) {
        res.status(401).json({
          success: false,
          error: { type: 'unauthorized', message: 'Valid API key required', docs: 'https://webpeel.dev/docs/authentication' },
          requestId: req.requestId,
        });
        return;
      }

      const userId = req.auth.keyInfo.accountId;
      const currentWeek = getCurrentWeek();
      const weekStart = isoWeekToMonday(currentWeek);
      const weekEnd = new Date(weekStart);
      weekEnd.setUTCDate(weekStart.getUTCDate() + 7);

      const result = await pool.query(
        `SELECT
          DATE(created_at)                                               AS date,
          COUNT(*)                                                       AS requests,
          ROUND(
            100.0 * SUM(CASE WHEN status_code < 400 THEN 1 ELSE 0 END)
            / NULLIF(COUNT(*), 0), 1
          )                                                              AS success_rate,
          ROUND(AVG(processing_time_ms))                                 AS avg_response_time
        FROM usage_logs
        WHERE user_id = $1
          AND created_at >= $2
          AND created_at < $3
        GROUP BY DATE(created_at)
        ORDER BY DATE(created_at) ASC`,
        [userId, weekStart.toISOString(), weekEnd.toISOString()]
      );

      const days = result.rows.map((row) => ({
        date: row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date),
        requests: parseInt(row.requests) || 0,
        successRate: parseFloat(row.success_rate) || 0,
        avgResponseTime: parseInt(row.avg_response_time) || 0,
      }));

      res.json({
        success: true,
        data: { days },
      });
    } catch (err: any) {
      console.error('[usage] GET /v1/usage/daily error:', err);
      res.status(500).json({
        success: false,
        error: { type: 'internal_error', message: 'Failed to retrieve daily usage', docs: 'https://webpeel.dev/docs/errors#internal_error' },
        requestId: req.requestId,
      });
    }
  });

  return router;
}
