/**
 * Stats endpoint - provides dashboard statistics
 */

import { Router, Request, Response } from 'express';
import { PostgresAuthStore } from '../pg-auth-store.js';
import { AuthStore } from '../auth-store.js';

export function createStatsRouter(authStore: AuthStore): Router {
  const router = Router();

  router.get('/v1/stats', async (req: Request, res: Response) => {
    try {
      // Require authentication
      if (!req.auth?.keyInfo) {
        res.status(401).json({
          error: 'unauthorized',
          message: 'Valid API key required',
        });
        return;
      }

      const accountId = req.auth.keyInfo.accountId;

      // Only works with PostgreSQL backend
      if (!(authStore instanceof PostgresAuthStore)) {
        res.status(501).json({
          error: 'not_implemented',
          message: 'Stats endpoint requires PostgreSQL backend',
        });
        return;
      }

      const pgStore = authStore as any;

      // Get stats from usage_logs table
      const statsQuery = `
        SELECT 
          COUNT(*) as total_requests,
          AVG(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
          AVG(processing_time_ms) as avg_response_time
        FROM usage_logs
        WHERE account_id = $1
      `;

      const result = await pgStore.pool.query(statsQuery, [accountId]);
      
      if (result.rows.length === 0) {
        // No data yet - return defaults
        res.json({
          totalRequests: 0,
          successRate: 100,
          avgResponseTime: 0,
        });
        return;
      }

      const row = result.rows[0];

      res.json({
        totalRequests: parseInt(row.total_requests) || 0,
        successRate: parseFloat(row.success_rate) || 100,
        avgResponseTime: Math.round(parseFloat(row.avg_response_time)) || 0,
      });
    } catch (error: any) {
      console.error('Stats error:', error);
      res.status(500).json({
        error: 'internal_error',
        message: 'Failed to retrieve stats',
      });
    }
  });

  return router;
}
