/**
 * Bull queue setup for WebPeel microservices.
 *
 * Used by:
 *   - API container  (API_MODE=queue)  — to enqueue fetch/render jobs
 *   - Worker container (WORKER_MODE=1) — to process jobs and write results
 *
 * Queue names:
 *   - "webpeel:fetch"  — HTTP-only fetches (no browser)
 *   - "webpeel:render" — Browser/Playwright fetches (render=true)
 *
 * Job result format stored in Redis:
 *   key: webpeel:result:<jobId>
 *   value: JSON string of { status, result?, error? }
 *   TTL: 24h
 *
 * No secrets in code. All config via env vars:
 *   REDIS_URL      — e.g. redis://redis:6379 (default)
 *   REDIS_PASSWORD — optional password
 */

import Bull from 'bull';

// ─── Shared job payload ──────────────────────────────────────────────────────

export interface FetchJobPayload {
  jobId: string;
  url: string;
  format?: 'markdown' | 'text' | 'html' | 'clean';
  render?: boolean;
  wait?: number;
  maxTokens?: number;
  budget?: number;
  stealth?: boolean;
  screenshot?: boolean;
  fullPage?: boolean;
  selector?: string;
  exclude?: string[];
  includeTags?: string[];
  excludeTags?: string[];
  images?: boolean;
  actions?: any[];
  timeout?: number;
  lite?: boolean;
  raw?: boolean;
  noDomainApi?: boolean;
  readable?: boolean;
  question?: string;
  // Auth context (userId for usage tracking)
  userId?: string;
}

// ─── Redis connection config ─────────────────────────────────────────────────

function getRedisConfig(): Bull.QueueOptions['redis'] {
  const url = process.env.REDIS_URL || 'redis://redis:6379';
  const password = process.env.REDIS_PASSWORD || undefined;

  // Parse the URL to extract host/port (Bull accepts host+port or full URL)
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port || '6379', 10),
      password,
      db: parseInt(parsed.pathname?.slice(1) || '0', 10) || 0,
    };
  } catch {
    // Fallback defaults
    return {
      host: 'redis',
      port: 6379,
      password,
    };
  }
}

const sharedOpts: Bull.QueueOptions = {
  redis: getRedisConfig(),
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: { age: 86400, count: 1000 }, // Keep 24h or 1000 jobs, whichever hits first
    removeOnFail: { age: 259200 }, // Keep failed jobs 72h for debugging
    timeout: 120_000, // 2 min hard timeout per job
  },
  // Lock will be extended by workers every 30s — initial lock should be generous
  settings: {
    lockDuration: 60_000, // 60s initial lock (default: 30s)
  },
};

// ─── Queue singletons ────────────────────────────────────────────────────────

let _fetchQueue: Bull.Queue<FetchJobPayload> | null = null;
let _renderQueue: Bull.Queue<FetchJobPayload> | null = null;

export function getFetchQueue(): Bull.Queue<FetchJobPayload> {
  if (!_fetchQueue) {
    _fetchQueue = new Bull<FetchJobPayload>('webpeel:fetch', sharedOpts);
  }
  return _fetchQueue;
}

export function getRenderQueue(): Bull.Queue<FetchJobPayload> {
  if (!_renderQueue) {
    _renderQueue = new Bull<FetchJobPayload>('webpeel:render', sharedOpts);
  }
  return _renderQueue;
}

// ─── Result helpers (Redis key = webpeel:result:<jobId>) ─────────────────────

export const RESULT_KEY_PREFIX = 'webpeel:result:';
export const RESULT_TTL_SECONDS = 86_400; // 24 hours

export interface JobResult {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  result?: any;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

// ─── Graceful teardown ───────────────────────────────────────────────────────

export async function closeQueues(): Promise<void> {
  const closes: Promise<void>[] = [];
  if (_fetchQueue) closes.push(_fetchQueue.close());
  if (_renderQueue) closes.push(_renderQueue.close());
  await Promise.all(closes);
  _fetchQueue = null;
  _renderQueue = null;
}
