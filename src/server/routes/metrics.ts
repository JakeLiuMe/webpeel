/**
 * Prometheus metrics endpoint for WebPeel.
 *
 * Exposed at GET /metrics (behind auth — admin only).
 *
 * Metrics:
 * - webpeel_requests_total — counter by method, path, status
 * - webpeel_request_duration_seconds — histogram by method, status
 * - webpeel_active_requests — gauge of in-flight requests
 * - webpeel_fetch_duration_seconds — histogram of peel() execution time
 * - webpeel_fetch_method_total — counter by fetch method (simple/browser/stealth)
 * - webpeel_errors_total — counter by error code
 * - webpeel_queue_jobs — gauge of queued/active/failed jobs
 * - webpeel_memory_usage_bytes — gauge from system monitor
 */

import { Router, Request, Response, NextFunction } from 'express';
import client from 'prom-client';

// Create a custom registry (don't use default to avoid conflicts)
const register = new client.Registry();

// Default metrics (CPU, memory, event loop, etc.)
client.collectDefaultMetrics({ register, prefix: 'webpeel_' });

// ─── Custom metrics ──────────────────────────────────────────────────────────

export const httpRequestsTotal = new client.Counter({
  name: 'webpeel_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status'] as const,
  registers: [register],
});

export const httpRequestDuration = new client.Histogram({
  name: 'webpeel_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'status'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [register],
});

export const activeRequests = new client.Gauge({
  name: 'webpeel_active_requests',
  help: 'Number of active (in-flight) requests',
  registers: [register],
});

export const fetchDuration = new client.Histogram({
  name: 'webpeel_fetch_duration_seconds',
  help: 'Duration of peel() fetch operations',
  labelNames: ['method', 'success'] as const,
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120],
  registers: [register],
});

export const fetchMethodCounter = new client.Counter({
  name: 'webpeel_fetch_method_total',
  help: 'Fetch method used',
  labelNames: ['method'] as const,
  registers: [register],
});

export const errorsTotal = new client.Counter({
  name: 'webpeel_errors_total',
  help: 'Total errors by error code',
  labelNames: ['code'] as const,
  registers: [register],
});

export const queueJobs = new client.Gauge({
  name: 'webpeel_queue_jobs',
  help: 'Queue job counts',
  labelNames: ['queue', 'state'] as const,
  registers: [register],
});

export const memoryUsageBytes = new client.Gauge({
  name: 'webpeel_memory_usage_bytes',
  help: 'Application memory usage in bytes',
  labelNames: ['type'] as const,
  registers: [register],
});

// ─── Metrics collection middleware ───────────────────────────────────────────

/**
 * Express middleware that records request metrics.
 * Add EARLY in the middleware chain (after request ID, before routes).
 */
export function metricsMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = process.hrtime.bigint();
    activeRequests.inc();

    res.on('finish', () => {
      activeRequests.dec();

      const durationNs = Number(process.hrtime.bigint() - start);
      const durationS = durationNs / 1e9;

      // Normalize path to avoid high-cardinality labels
      const normalizedPath = normalizePath(req.path);

      httpRequestsTotal.inc({
        method: req.method,
        path: normalizedPath,
        status: res.statusCode.toString(),
      });

      httpRequestDuration.observe(
        { method: req.method, status: res.statusCode.toString() },
        durationS
      );
    });

    next();
  };
}

/** Normalize request path to reduce cardinality (UUIDs, IDs → :id) */
function normalizePath(path: string): string {
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
    .replace(/\/wp_[a-z]+_[a-f0-9]+/gi, '/:key')
    .replace(/\/\d+/g, '/:id')
    .replace(/\?.*$/, ''); // strip query params
}

// ─── Helper functions for recording metrics from other modules ───────────────

/** Record a peel() operation result */
export function recordFetch(method: string, durationMs: number, success: boolean): void {
  fetchDuration.observe({ method, success: success.toString() }, durationMs / 1000);
  fetchMethodCounter.inc({ method });
}

/** Record an error by code */
export function recordError(code: string): void {
  errorsTotal.inc({ code });
}

/** Update memory gauge */
export function updateMemoryMetrics(): void {
  const mem = process.memoryUsage();
  memoryUsageBytes.set({ type: 'rss' }, mem.rss);
  memoryUsageBytes.set({ type: 'heapUsed' }, mem.heapUsed);
  memoryUsageBytes.set({ type: 'heapTotal' }, mem.heapTotal);
  memoryUsageBytes.set({ type: 'external' }, mem.external);
}

// Update memory metrics every 15s
setInterval(updateMemoryMetrics, 15_000);

// ─── Router ──────────────────────────────────────────────────────────────────

export function createMetricsRouter(): Router {
  const router = Router();

  router.get('/metrics', async (req: Request, res: Response) => {
    // Only allow admin tier to access metrics
    if (req.auth?.tier !== 'admin') {
      // Also allow unauthenticated access from localhost/K8s internal (Prometheus scraper)
      const ip = req.ip || '';
      const isInternal =
        ip === '127.0.0.1' ||
        ip === '::1' ||
        ip.startsWith('10.') ||
        ip.startsWith('172.');
      if (!isInternal) {
        res.status(403).json({
          success: false,
          error: { type: 'forbidden', message: 'Metrics require admin access' },
        });
        return;
      }
    }

    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  });

  return router;
}
