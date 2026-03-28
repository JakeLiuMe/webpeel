/**
 * WebPeel Typed Error System
 *
 * Every error thrown in the pipeline should use these types.
 * The `retryable` flag tells the retry system whether to attempt again.
 * The `code` enables smart routing, logging, and Sentry filtering.
 */

export type ErrorCode =
  // Network errors
  | 'NETWORK_ERROR'           // Generic network failure
  | 'DNS_RESOLUTION_FAILED'   // Cannot resolve hostname
  | 'CONNECTION_REFUSED'      // Target actively refused
  | 'CONNECTION_RESET'        // Connection reset by peer
  | 'SSL_ERROR'               // TLS/SSL handshake failure
  | 'SOCKET_TIMEOUT'          // TCP-level timeout
  // HTTP errors
  | 'HTTP_CLIENT_ERROR'       // 4xx (non-retryable usually)
  | 'HTTP_SERVER_ERROR'       // 5xx (retryable)
  | 'HTTP_TOO_MANY_REQUESTS'  // 429 (retryable with backoff)
  // Timeout errors
  | 'TIMEOUT'                 // Generic timeout
  | 'FETCH_TIMEOUT'           // HTTP fetch timed out
  | 'RENDER_TIMEOUT'          // Browser render timed out
  | 'NAVIGATION_TIMEOUT'      // Page navigation timed out
  // Bot detection / blocking
  | 'BLOCKED'                 // Generic bot block
  | 'BLOCKED_CLOUDFLARE'      // Cloudflare challenge
  | 'BLOCKED_CAPTCHA'         // CAPTCHA required
  | 'BLOCKED_WAF'             // WAF blocked (Akamai, PerimeterX, etc.)
  | 'BLOCKED_GEO'             // Geographic restriction
  | 'BLOCKED_RATE_LIMIT'      // Target site rate limited us
  // Browser errors
  | 'BROWSER_CRASH'           // Chromium crashed
  | 'BROWSER_OOM'             // Browser out of memory
  | 'BROWSER_LAUNCH_FAILED'   // Failed to start browser
  | 'BROWSER_CONTEXT_ERROR'   // Context/page creation failed
  // Content errors
  | 'EMPTY_CONTENT'           // Page returned no content
  | 'INVALID_URL'             // URL is malformed
  | 'UNSUPPORTED_PROTOCOL'    // Not HTTP/HTTPS
  | 'ROBOTS_DENIED'           // robots.txt blocks us
  | 'AUTH_REQUIRED'           // Login wall detected
  // Infrastructure errors
  | 'PROXY_ERROR'             // Proxy connection failed
  | 'PROXY_EXHAUSTED'         // All proxies tried and failed
  | 'CIRCUIT_OPEN'            // Circuit breaker is open
  | 'MEMORY_LIMIT'            // System memory too high
  | 'RATE_LIMITED'            // Our own rate limit hit
  // Job/queue errors
  | 'JOB_TIMEOUT'             // Bull job exceeded timeout
  | 'JOB_CANCELLED'           // Job was cancelled
  | 'JOB_STALLED'             // Job stalled and was re-queued
  // Catch-all
  | 'UNKNOWN';                // Unclassified error

export class WebPeelError extends Error {
  public readonly code: ErrorCode;
  public readonly retryable: boolean;
  public readonly statusCode: number;
  public readonly context?: Record<string, any>;
  public readonly timestamp: string;

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      retryable?: boolean;
      statusCode?: number;
      context?: Record<string, any>;
      cause?: Error;
    } = {}
  ) {
    super(message);
    this.name = 'WebPeelError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.statusCode = options.statusCode ?? 500;
    this.context = options.context;
    this.timestamp = new Date().toISOString();
    if (options.cause) {
      this.cause = options.cause;
    }
  }

  /** Serialize for transport across processes (worker ↔ API) */
  serialize(): Record<string, any> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      statusCode: this.statusCode,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }

  /** Deserialize from JSON (e.g., from Bull job result) */
  static deserialize(data: Record<string, any>): WebPeelError {
    const err = new WebPeelError(data.code, data.message, {
      retryable: data.retryable,
      statusCode: data.statusCode,
      context: data.context,
    });
    err.stack = data.stack;
    return err;
  }

  /** Convert a generic Error into the most appropriate WebPeelError */
  static fromError(err: Error, fallbackCode: ErrorCode = 'UNKNOWN'): WebPeelError {
    if (err instanceof WebPeelError) return err;

    const msg = err.message?.toLowerCase() || '';

    // DNS errors
    if (msg.includes('getaddrinfo') || msg.includes('enotfound') || msg.includes('dns')) {
      return new WebPeelError('DNS_RESOLUTION_FAILED', err.message, { retryable: true, statusCode: 502, cause: err });
    }
    // Connection errors
    if (msg.includes('econnrefused')) {
      return new WebPeelError('CONNECTION_REFUSED', err.message, { retryable: true, statusCode: 502, cause: err });
    }
    if (msg.includes('econnreset') || msg.includes('socket hang up')) {
      return new WebPeelError('CONNECTION_RESET', err.message, { retryable: true, statusCode: 502, cause: err });
    }
    // SSL errors
    if (msg.includes('ssl') || msg.includes('tls') || msg.includes('certificate') || msg.includes('cert_')) {
      return new WebPeelError('SSL_ERROR', err.message, { retryable: false, statusCode: 502, cause: err });
    }
    // Timeout errors
    if (msg.includes('timeout') || msg.includes('etimedout') || msg.includes('timed out')) {
      if (msg.includes('navigation')) return new WebPeelError('NAVIGATION_TIMEOUT', err.message, { retryable: true, statusCode: 504, cause: err });
      if (msg.includes('render') || msg.includes('browser')) return new WebPeelError('RENDER_TIMEOUT', err.message, { retryable: true, statusCode: 504, cause: err });
      return new WebPeelError('FETCH_TIMEOUT', err.message, { retryable: true, statusCode: 504, cause: err });
    }
    // Browser errors
    if (msg.includes('browser') && (msg.includes('crash') || msg.includes('killed'))) {
      return new WebPeelError('BROWSER_CRASH', err.message, { retryable: true, statusCode: 500, cause: err });
    }
    if (msg.includes('browsertype.launch') || msg.includes('failed to launch')) {
      return new WebPeelError('BROWSER_LAUNCH_FAILED', err.message, { retryable: true, statusCode: 500, cause: err });
    }
    // Blocked
    if (msg.includes('cloudflare') || msg.includes('cf-') || msg.includes('challenge')) {
      return new WebPeelError('BLOCKED_CLOUDFLARE', err.message, { retryable: true, statusCode: 403, cause: err });
    }
    if (msg.includes('captcha') || msg.includes('recaptcha')) {
      return new WebPeelError('BLOCKED_CAPTCHA', err.message, { retryable: false, statusCode: 403, cause: err });
    }
    if (msg.includes('blocked') || msg.includes('forbidden') || msg.includes('access denied')) {
      return new WebPeelError('BLOCKED', err.message, { retryable: true, statusCode: 403, cause: err });
    }

    return new WebPeelError(fallbackCode, err.message, { retryable: false, statusCode: 500, cause: err });
  }
}

/** Helper factory functions for common errors */
export const Errors = {
  timeout: (msg: string, ctx?: Record<string, any>) =>
    new WebPeelError('TIMEOUT', msg, { retryable: true, statusCode: 504, context: ctx }),
  fetchTimeout: (url: string, ms: number) =>
    new WebPeelError('FETCH_TIMEOUT', `Fetch timed out after ${ms}ms: ${url}`, { retryable: true, statusCode: 504, context: { url, timeoutMs: ms } }),
  renderTimeout: (url: string, ms: number) =>
    new WebPeelError('RENDER_TIMEOUT', `Render timed out after ${ms}ms: ${url}`, { retryable: true, statusCode: 504, context: { url, timeoutMs: ms } }),
  blocked: (url: string, reason?: string) =>
    new WebPeelError('BLOCKED', `Blocked: ${url}${reason ? ` (${reason})` : ''}`, { retryable: true, statusCode: 403, context: { url, reason } }),
  invalidUrl: (url: string) =>
    new WebPeelError('INVALID_URL', `Invalid URL: ${url}`, { retryable: false, statusCode: 400, context: { url } }),
  networkError: (msg: string, cause?: Error) =>
    new WebPeelError('NETWORK_ERROR', msg, { retryable: true, statusCode: 502, cause }),
  proxyError: (msg: string) =>
    new WebPeelError('PROXY_ERROR', msg, { retryable: true, statusCode: 502 }),
  proxyExhausted: () =>
    new WebPeelError('PROXY_EXHAUSTED', 'All proxy attempts exhausted', { retryable: false, statusCode: 502 }),
  circuitOpen: (name: string) =>
    new WebPeelError('CIRCUIT_OPEN', `Circuit breaker open: ${name}`, { retryable: false, statusCode: 503 }),
  memoryLimit: (usage: number) =>
    new WebPeelError('MEMORY_LIMIT', `Memory usage too high: ${(usage * 100).toFixed(1)}%`, { retryable: false, statusCode: 503, context: { memoryPct: usage } }),
  emptyContent: (url: string) =>
    new WebPeelError('EMPTY_CONTENT', `No content extracted from ${url}`, { retryable: false, statusCode: 422, context: { url } }),
  authRequired: (url: string) =>
    new WebPeelError('AUTH_REQUIRED', `Authentication required: ${url}`, { retryable: false, statusCode: 403, context: { url } }),
  rateLimited: (identifier: string) =>
    new WebPeelError('RATE_LIMITED', `Rate limit exceeded for ${identifier}`, { retryable: false, statusCode: 429 }),
  jobCancelled: (jobId: string) =>
    new WebPeelError('JOB_CANCELLED', `Job ${jobId} was cancelled`, { retryable: false, context: { jobId } }),
  browserCrash: (msg: string) =>
    new WebPeelError('BROWSER_CRASH', msg, { retryable: true, statusCode: 500 }),
  unknown: (msg: string, cause?: Error) =>
    new WebPeelError('UNKNOWN', msg, { retryable: false, statusCode: 500, cause }),
};

/** Check if an error is retryable (works for both WebPeelError and generic Error) */
export function isRetryable(err: Error): boolean {
  if (err instanceof WebPeelError) return err.retryable;
  // Heuristic for generic errors
  const msg = err.message?.toLowerCase() || '';
  return (
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('socket hang up') ||
    msg.includes('getaddrinfo') ||
    msg.includes('network')
  );
}
