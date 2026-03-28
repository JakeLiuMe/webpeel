/**
 * Smart retry with exponential backoff and jitter.
 * Inspired by Crawl4AI's RateLimiter — the cleanest implementation found.
 *
 * Features:
 * - Exponential backoff with ±25% jitter (prevents thundering herd)
 * - Per-domain delay tracking (optional)
 * - Success reduces delay by 25% (gradual recovery)
 * - Configurable retry predicate
 */

import { isRetryable } from '../errors.js';
import { createLogger } from './logger.js';

const log = createLogger('retry');

export interface RetryOptions {
  /** Max retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in ms (default: 1000) */
  baseDelayMs?: number;
  /** Max delay cap in ms (default: 30000) */
  maxDelayMs?: number;
  /** Add ±25% jitter (default: true) */
  jitter?: boolean;
  /** Custom predicate: should we retry this error? (default: isRetryable) */
  retryOn?: (error: Error, attempt: number) => boolean;
  /** Called before each retry (for logging/metrics) */
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;
  /** Label for logging */
  label?: string;
}

/**
 * Execute a function with retry logic.
 * Throws the last error if all retries are exhausted.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30_000,
    jitter = true,
    retryOn = (err) => isRetryable(err),
    onRetry,
    label = 'operation',
  } = options;

  let delay = baseDelayMs;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      // If we succeeded after retries, log it
      if (attempt > 0) {
        log.info(`${label} succeeded after ${attempt} retries`);
      }
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Last attempt or non-retryable — throw immediately
      if (attempt === maxRetries || !retryOn(lastError, attempt)) {
        throw lastError;
      }

      // Calculate delay with exponential backoff and jitter
      const jitterFactor = jitter ? (0.75 + Math.random() * 0.5) : 1;
      const actualDelay = Math.min(delay * jitterFactor, maxDelayMs);

      if (onRetry) {
        onRetry(lastError, attempt + 1, actualDelay);
      }
      log.info(`${label} attempt ${attempt + 1} failed: ${lastError.message}. Retrying in ${Math.round(actualDelay)}ms`);

      await new Promise(r => setTimeout(r, actualDelay));

      // Exponential increase for next attempt
      delay = Math.min(delay * 2, maxDelayMs);
    }
  }

  throw lastError ?? new Error('Retry exhausted with no error');
}

/**
 * Per-domain rate state tracker.
 * Adapts delay per target domain based on success/failure patterns.
 * Useful for avoiding rate limits on target sites.
 */
export class DomainRateLimiter {
  private domains = new Map<string, {
    delay: number;
    failCount: number;
    lastHit: number;
  }>();
  private baseDelay: number;
  private maxDelay: number;
  private rateLimitCodes: number[];

  constructor(options: {
    baseDelay?: number;
    maxDelay?: number;
    rateLimitCodes?: number[];
  } = {}) {
    this.baseDelay = options.baseDelay ?? 1000;
    this.maxDelay = options.maxDelay ?? 60_000;
    this.rateLimitCodes = options.rateLimitCodes ?? [429, 503];
  }

  /** Get the hostname from a URL */
  private getDomain(url: string): string {
    try { return new URL(url).hostname; } catch { return url; }
  }

  /** Wait if needed before making a request to this domain */
  async throttle(url: string): Promise<void> {
    const domain = this.getDomain(url);
    const state = this.domains.get(domain);
    if (!state) return;

    const elapsed = Date.now() - state.lastHit;
    const waitTime = Math.max(0, state.delay - elapsed);
    if (waitTime > 0) {
      await new Promise(r => setTimeout(r, waitTime));
    }
    state.lastHit = Date.now();
  }

  /** Record a response status for adaptive delay */
  recordResult(url: string, statusCode: number): void {
    const domain = this.getDomain(url);
    let state = this.domains.get(domain);

    if (!state) {
      state = { delay: 0, failCount: 0, lastHit: Date.now() };
      this.domains.set(domain, state);
    }

    if (this.rateLimitCodes.includes(statusCode)) {
      state.failCount++;
      // Exponential backoff with ±25% jitter
      const jitter = 0.75 + Math.random() * 0.5;
      state.delay = Math.min((state.delay || this.baseDelay) * 2 * jitter, this.maxDelay);
      log.warn(`Domain ${domain} rate limited (${statusCode}). Delay: ${Math.round(state.delay)}ms`);
    } else {
      // Gradual recovery on success
      state.delay = Math.max(0, state.delay * 0.75);
      state.failCount = 0;
    }
  }

  /** Get current state for diagnostics */
  getStats(): Record<string, { delay: number; failCount: number }> {
    const stats: Record<string, { delay: number; failCount: number }> = {};
    for (const [domain, state] of this.domains) {
      stats[domain] = { delay: Math.round(state.delay), failCount: state.failCount };
    }
    return stats;
  }
}

/** Singleton domain rate limiter for the fetch layer */
export const domainLimiter = new DomainRateLimiter();
