/**
 * Activity endpoint - provides recent API request history
 */
import { Router } from 'express';
import { PostgresAuthStore } from '../pg-auth-store.js';
export function createActivityRouter(authStore) {
    const router = Router();
    router.get('/v1/activity', async (req, res) => {
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
                    message: 'Activity endpoint requires PostgreSQL backend',
                });
                return;
            }
            const pgStore = authStore;
            const limit = parseInt(req.query.limit) || 50;
            // Get recent requests from usage_logs
            const activityQuery = `
        SELECT 
          id,
          url,
          method,
          status_code,
          processing_time_ms,
          created_at
        FROM usage_logs
        WHERE account_id = $1
        ORDER BY created_at DESC
        LIMIT $2
      `;
            const result = await pgStore.pool.query(activityQuery, [accountId, limit]);
            // Transform to frontend format
            const requests = result.rows.map((row) => ({
                id: row.id,
                url: row.url || 'N/A',
                status: (row.status_code >= 200 && row.status_code < 300) ? 'success' : 'error',
                responseTime: row.processing_time_ms || 0,
                mode: row.method || 'basic',
                timestamp: row.created_at,
            }));
            res.json({ requests });
        }
        catch (error) {
            console.error('Activity error:', error);
            res.status(500).json({
                error: 'internal_error',
                message: 'Failed to retrieve activity',
            });
        }
    });
    return router;
}
//# sourceMappingURL=activity.js.map