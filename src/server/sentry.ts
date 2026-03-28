/**
 * Optional Sentry integration for the API server.
 *
 * Enabled only when SENTRY_DSN is set.
 * This keeps local/self-hosted setups dependency-light by default.
 */

import * as Sentry from '@sentry/node';
import type { ErrorRequestHandler, RequestHandler } from 'express';

export interface SentryHooks {
  enabled: boolean;
  requestHandler?: RequestHandler;
  errorHandler?: ErrorRequestHandler;
  captureException: (error: Error, context?: Record<string, any>) => void;
}

function parseSampleRate(value: string | undefined): number | undefined {
  if (!value) return undefined;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    console.warn(`Ignoring invalid SENTRY_TRACES_SAMPLE_RATE="${value}" (expected 0.0 - 1.0)`);
    return undefined;
  }

  return parsed;
}

export function createSentryHooks(): SentryHooks {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) {
    return {
      enabled: false,
      captureException: () => {},
    };
  }

  const environment = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'production';
  const tracesSampleRate = parseSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE);

  Sentry.init({
    dsn,
    enabled: true,
    environment,
    release: process.env.SENTRY_RELEASE || process.env.npm_package_version,
    tracesSampleRate: tracesSampleRate ?? 0.01, // 1% default (not undefined)

    // Smart error filtering — reduce noise from expected/non-actionable errors
    beforeSend(event, hint) {
      const error = hint?.originalException;

      // Skip expected operational errors that aren't bugs
      if (error && typeof error === 'object' && 'code' in error) {
        const code = (error as any).code;
        const skipCodes = [
          'JOB_CANCELLED',       // User/system cancelled — not a bug
          'ROBOTS_DENIED',       // Site blocks us — expected
          'RATE_LIMITED',        // Our own rate limit — expected
          'BLOCKED',             // Bot detection — expected
          'BLOCKED_CLOUDFLARE',  // Cloudflare challenge — expected
          'BLOCKED_CAPTCHA',     // CAPTCHA — expected
          'BLOCKED_WAF',         // WAF — expected
          'AUTH_REQUIRED',       // Login wall — expected
          'INVALID_URL',         // User error — not a bug
        ];
        if (skipCodes.includes(code)) return null;
      }

      // Skip Playwright session-closed errors (expected during high load)
      const msg = (error instanceof Error ? error.message : String(error || '')).toLowerCase();
      if (
        msg.includes('cdpsession.send') ||
        msg.includes('target page, context or browser has been closed') ||
        msg.includes('protocol error') ||
        msg.includes('session closed') ||
        msg.includes('target closed') ||
        msg.includes('navigation interrupted')
      ) {
        return null;
      }

      // Skip rate limit responses (429s are normal operations)
      if (event.request?.url && event.extra?.statusCode === 429) {
        return null;
      }

      return event;
    },

    // Ignore common non-actionable errors
    ignoreErrors: [
      'ECONNRESET',
      'ENOTFOUND',
      'ETIMEDOUT',
      'socket hang up',
      'write EPIPE',
    ],
  });

  console.log(`Sentry enabled (environment: ${environment})`);

  const captureException = (error: Error, context?: Record<string, any>) => {
    Sentry.withScope((scope) => {
      if (context) {
        if (context.tags) {
          scope.setTags(context.tags);
        }
        if (context.extra) {
          scope.setExtras(context.extra);
        }
        // Any remaining top-level keys go as extras
        const { tags, extra, ...rest } = context;
        if (Object.keys(rest).length > 0) {
          scope.setExtras(rest);
        }
      }
      Sentry.captureException(error);
    });
  };

  return {
    enabled: true,
    requestHandler: Sentry.Handlers.requestHandler(),
    errorHandler: Sentry.Handlers.errorHandler(),
    captureException,
  };
}
