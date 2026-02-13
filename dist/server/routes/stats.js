/**
 * Stats endpoint - provides dashboard statistics
 */
import { Router } from 'express';
import { PostgresAuthStore } from '../pg-auth-store.js';
export function createStatsRouter(authStore) {
    const router = Router();
    router.get('/v1/stats', async (req, res) => {
        try {
            // Require authentication
            if (!req.auth?.keyInfo) {
                res.status(401).json({
                    error: 'unauthorized',
                    message: 'Valid API key required',
                });
                return;
            }
            const userId = req.auth.keyInfo.accountId; // accountId maps to user_id in DB
            // Only works with PostgreSQL backend
            if (!(authStore instanceof PostgresAuthStore)) {
                res.status(501).json({
                    error: 'not_implemented',
                    message: 'Stats endpoint requires PostgreSQL backend',
                });
                return;
            }
            // Access pool via any cast (pool is private but we need direct DB access)
            const pgStore = authStore;
            // Get stats from usage_logs table
            const statsQuery = `
        SELECT 
          COUNT(*) as total_requests,
          AVG(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1.0 ELSE 0.0 END) * 100 as success_rate,
          AVG(processing_time_ms) as avg_response_time
        FROM usage_logs
        WHERE user_id = $1
      `;
            const result = await pgStore.pool.query(statsQuery, [userId]);
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
        }
        catch (error) {
            console.error('Stats error:', error);
            res.status(500).json({
                error: 'internal_error',
                message: 'Failed to retrieve stats',
            });
        }
    });
    return router;
}
//# sourceMappingURL=stats.js.map