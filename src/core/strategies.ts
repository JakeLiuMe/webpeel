/**
 * Smart escalation strategy: try simple fetch first, escalate to browser if needed.
 *
 * Premium server-side optimisations (SWR cache, domain intelligence, parallel
 * race) are injected via the hook system in `strategy-hooks.ts`.  When no hooks
 * are registered the strategy degrades gracefully to a simple escalation path
 * that works great for CLI / npm library usage.
 */

import { simpleFetch, browserFetch, retryFetch, type FetchResult } from './fetcher.js';
import { getCached, setCached as setBasicCache } from './cache.js';
import { resolveAndCache } from './dns-cache.js';
import { BlockedError, NetworkError } from '../types.js';
import {
  getStrategyHooks,
  type StrategyResult,
  type DomainRecommendation,
} from './strategy-hooks.js';

// Re-export StrategyResult so existing consumers don't break.
export type { StrategyResult } from './strategy-hooks.js';

/* ---------- hardcoded domain rules -------------------------------------- */

function shouldForceBrowser(url: string): DomainRecommendation | null {
  try {
    const hostname = new URL(url).hostname.toLowerCase();

    // Reddit often returns an HTML shell via simple fetch
    if (hostname === 'reddit.com' || hostname.endsWith('.reddit.com')) {
      return { mode: 'browser' };
    }

    // npmjs blocks simple fetch with 403 frequently
    if (
      hostname === 'npmjs.com' ||
      hostname === 'www.npmjs.com' ||
      hostname.endsWith('.npmjs.com')
    ) {
      return { mode: 'browser' };
    }

    // These are known to aggressively block automation
    if (hostname === 'glassdoor.com' || hostname.endsWith('.glassdoor.com')) {
      return { mode: 'stealth' };
    }
    if (hostname === 'bloomberg.com' || hostname.endsWith('.bloomberg.com')) {
      return { mode: 'stealth' };
    }
    if (hostname === 'indeed.com' || hostname.endsWith('.indeed.com')) {
      return { mode: 'stealth' };
    }
  } catch {
    // Ignore URL parsing errors; validation happens inside fetchers.
  }

  return null;
}

/* ---------- helpers ------------------------------------------------------ */

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function shouldEscalateSimpleError(error: unknown): boolean {
  if (error instanceof BlockedError) return true;
  return error instanceof NetworkError && error.message.includes('TLS/SSL');
}

function looksLikeShellPage(result: FetchResult): boolean {
  const ct = (result.contentType || '').toLowerCase();
  if (!ct.includes('html')) return false;
  const text = result.html.replace(/<[^>]*>/g, '').trim();
  return text.length < 500 && result.html.length > 1000;
}

function prefetchDns(url: string): void {
  try {
    const hostname = new URL(url).hostname;
    void resolveAndCache(hostname).catch(() => {});
  } catch {
    // Ignore invalid URL.
  }
}

/* ---------- public option / result types -------------------------------- */

export interface StrategyOptions {
  forceBrowser?: boolean;
  stealth?: boolean;
  waitMs?: number;
  userAgent?: string;
  timeoutMs?: number;
  screenshot?: boolean;
  screenshotFullPage?: boolean;
  headers?: Record<string, string>;
  cookies?: string[];
  actions?: Array<{
    type:
      | 'wait'
      | 'click'
      | 'scroll'
      | 'type'
      | 'fill'
      | 'select'
      | 'press'
      | 'hover'
      | 'waitForSelector'
      | 'screenshot';
    selector?: string;
    value?: string;
    key?: string;
    ms?: number;
    to?: 'top' | 'bottom' | number;
    timeout?: number;
  }>;
  keepPageOpen?: boolean;
  noCache?: boolean;
  raceTimeoutMs?: number;
  location?: {
    country?: string;
    languages?: string[];
  };
}

/* ---------- browser-level fetch helper ---------------------------------- */

interface BrowserStrategyOptions {
  userAgent?: string;
  waitMs: number;
  timeoutMs: number;
  screenshot: boolean;
  screenshotFullPage: boolean;
  headers?: Record<string, string>;
  cookies?: string[];
  actions?: StrategyOptions['actions'];
  keepPageOpen: boolean;
  effectiveStealth: boolean;
  signal?: AbortSignal;
}

async function fetchWithBrowserStrategy(
  url: string,
  options: BrowserStrategyOptions,
): Promise<StrategyResult> {
  const {
    userAgent,
    waitMs,
    timeoutMs,
    screenshot,
    screenshotFullPage,
    headers,
    cookies,
    actions,
    keepPageOpen,
    effectiveStealth,
    signal,
  } = options;

  try {
    const result = await browserFetch(url, {
      userAgent,
      waitMs,
      timeoutMs,
      screenshot,
      screenshotFullPage,
      headers,
      cookies,
      stealth: effectiveStealth,
      actions,
      keepPageOpen,
      signal,
    });

    return {
      ...result,
      method: effectiveStealth ? 'stealth' : 'browser',
    };
  } catch (error) {
    if (isAbortError(error)) throw error;

    // If browser gets blocked, try stealth as fallback (unless already stealth)
    if (!effectiveStealth && error instanceof BlockedError) {
      const result = await browserFetch(url, {
        userAgent,
        waitMs,
        timeoutMs,
        screenshot,
        screenshotFullPage,
        headers,
        cookies,
        stealth: true,
        actions,
        keepPageOpen,
        signal,
      });
      return { ...result, method: 'stealth' };
    }

    // If Cloudflare detected, retry with extra wait time
    if (
      error instanceof NetworkError &&
      error.message.toLowerCase().includes('cloudflare')
    ) {
      const result = await browserFetch(url, {
        userAgent,
        waitMs: 5000,
        timeoutMs,
        screenshot,
        screenshotFullPage,
        headers,
        cookies,
        stealth: effectiveStealth,
        actions,
        keepPageOpen,
        signal,
      });
      return { ...result, method: effectiveStealth ? 'stealth' : 'browser' };
    }

    throw error;
  }
}

/* ---------- main entry point -------------------------------------------- */

/**
 * Smart fetch with automatic escalation.
 *
 * Without hooks: simple fetch → browser → stealth escalation.
 * With premium hooks: SWR cache → domain intel → parallel race → escalation.
 */
export async function smartFetch(
  url: string,
  options: StrategyOptions = {},
): Promise<StrategyResult> {
  const {
    forceBrowser = false,
    stealth = false,
    waitMs = 0,
    userAgent,
    timeoutMs = 30000,
    screenshot = false,
    screenshotFullPage = false,
    headers,
    cookies,
    actions,
    keepPageOpen = false,
    noCache = false,
    raceTimeoutMs = 2000,
  } = options;

  const hooks = getStrategyHooks();
  const fetchStartMs = Date.now();

  const recordMethod = (method: StrategyResult['method']): void => {
    if (method === 'cached') return;
    hooks.recordDomainResult?.(url, method, Date.now() - fetchStartMs);
  };

  /* ---- determine effective mode ---------------------------------------- */

  // Hardcoded rules always take priority, then hook-based domain intelligence.
  const forced = shouldForceBrowser(url);
  const recommended = hooks.getDomainRecommendation?.(url) ?? null;
  const selected = forced ?? recommended;

  let effectiveForceBrowser = forceBrowser;
  let effectiveStealth = stealth;

  if (selected) {
    effectiveForceBrowser = true;
    if (selected.mode === 'stealth') effectiveStealth = true;
  }

  prefetchDns(url);

  /* ---- cache eligibility ----------------------------------------------- */

  const canUseCache =
    !noCache &&
    !effectiveForceBrowser &&
    !effectiveStealth &&
    !screenshot &&
    !keepPageOpen &&
    !actions?.length &&
    !headers &&
    !cookies &&
    waitMs === 0 &&
    !userAgent;

  /* ---- hook-based cache check (premium) -------------------------------- */

  if (canUseCache && hooks.checkCache) {
    const cached = hooks.checkCache(url);
    if (cached) {
      if (cached.stale && hooks.markRevalidating?.(url)) {
        // Background revalidation — fire-and-forget
        void (async () => {
          try {
            const fresh = await simpleFetch(url, userAgent, timeoutMs);
            if (!looksLikeShellPage(fresh)) {
              hooks.setCache?.(url, { ...fresh, method: 'simple' as const });
            }
          } catch {
            // Stale entry continues serving.
          }
        })();
      }
      return { ...cached.value, method: 'cached' };
    }
  }

  /* ---- basic cache check (non-premium fallback) ------------------------ */

  if (canUseCache && !hooks.checkCache) {
    const basicCached = getCached<StrategyResult>(url);
    if (basicCached) {
      return { ...basicCached, method: 'cached' };
    }
  }

  /* ---- browser-level options ------------------------------------------- */

  let shouldUseBrowser =
    effectiveForceBrowser || screenshot || effectiveStealth;

  const browserOptions: BrowserStrategyOptions = {
    userAgent,
    waitMs,
    timeoutMs,
    screenshot,
    screenshotFullPage,
    headers,
    cookies,
    actions,
    keepPageOpen,
    effectiveStealth,
  };

  /* ---- Strategy: simple fetch (with optional race) --------------------- */

  if (!shouldUseBrowser) {
    const simpleAbortController = new AbortController();

    const simplePromise = retryFetch(
      () =>
        simpleFetch(
          url,
          userAgent,
          timeoutMs,
          headers,
          simpleAbortController.signal,
        ),
      3,
    ).then((result) => {
      if (looksLikeShellPage(result)) {
        throw new BlockedError(
          'Shell page detected. Browser rendering required.',
        );
      }
      return result;
    });

    // Determine race timeout — hooks can override
    const useRace = hooks.shouldRace?.() ?? false;
    const effectiveRaceTimeout = useRace
      ? (hooks.getRaceTimeoutMs?.() ?? raceTimeoutMs)
      : raceTimeoutMs;

    let raceTimer: ReturnType<typeof setTimeout> | undefined;
    const simpleOrTimeout = await Promise.race([
      simplePromise
        .then(
          (result) => ({ type: 'simple-success' as const, result }),
        )
        .catch((error) => ({ type: 'simple-error' as const, error })),
      new Promise<{ type: 'race-timeout' }>((resolve) => {
        raceTimer = setTimeout(
          () => resolve({ type: 'race-timeout' }),
          Math.max(effectiveRaceTimeout, 0),
        );
      }),
    ]);

    if (raceTimer) clearTimeout(raceTimer);

    if (simpleOrTimeout.type === 'simple-success') {
      const strategyResult: StrategyResult = {
        ...simpleOrTimeout.result,
        method: 'simple',
      };
      if (canUseCache) {
        hooks.setCache?.(url, strategyResult) ?? setBasicCache(url, strategyResult);
      }
      recordMethod('simple');
      return strategyResult;
    }

    if (simpleOrTimeout.type === 'simple-error') {
      if (!shouldEscalateSimpleError(simpleOrTimeout.error)) {
        throw simpleOrTimeout.error;
      }
      shouldUseBrowser = true;
    } else {
      // Race timeout — only start parallel browser if hooks say to race
      if (useRace) {
        // Parallel race: simple still running, start browser too
        const browserAbortController = new AbortController();
        let simpleError: unknown;
        let browserError: unknown;

        const simpleCandidate = simplePromise
          .then((result) => ({ source: 'simple' as const, result }))
          .catch((error) => {
            simpleError = error;
            throw error;
          });

        const browserCandidate = fetchWithBrowserStrategy(url, {
          ...browserOptions,
          signal: browserAbortController.signal,
        })
          .then((result) => ({ source: 'browser' as const, result }))
          .catch((error) => {
            browserError = error;
            throw error;
          });

        try {
          const winner = await Promise.any([
            simpleCandidate,
            browserCandidate,
          ]);

          if (winner.source === 'simple') {
            browserAbortController.abort();
            const strategyResult: StrategyResult = {
              ...winner.result,
              method: 'simple',
            };
            if (canUseCache) {
              hooks.setCache?.(url, strategyResult) ?? setBasicCache(url, strategyResult);
            }
            recordMethod('simple');
            return strategyResult;
          }

          simpleAbortController.abort();
          if (canUseCache) {
            hooks.setCache?.(url, winner.result) ?? setBasicCache(url, winner.result);
          }
          recordMethod(winner.result.method);
          return winner.result;
        } catch {
          if (
            simpleError &&
            !shouldEscalateSimpleError(simpleError) &&
            !isAbortError(simpleError)
          ) {
            throw simpleError;
          }
          if (browserError) throw browserError;
          if (simpleError) throw simpleError;
          throw new Error(
            'Both simple and browser fetch attempts failed',
          );
        }
      } else {
        // No race — just wait for the simple fetch to finish
        const simpleResult = await simplePromise
          .then(
            (result) => ({ type: 'simple-success' as const, result }),
          )
          .catch((error) => ({ type: 'simple-error' as const, error }));

        if (simpleResult.type === 'simple-success') {
          const strategyResult: StrategyResult = {
            ...simpleResult.result,
            method: 'simple',
          };
          if (canUseCache) {
            hooks.setCache?.(url, strategyResult) ?? setBasicCache(url, strategyResult);
          }
          recordMethod('simple');
          return strategyResult;
        }

        if (!shouldEscalateSimpleError(simpleResult.error)) {
          throw simpleResult.error;
        }
        shouldUseBrowser = true;
      }
    }
  }

  /* ---- browser / stealth fallback -------------------------------------- */

  const browserResult = await fetchWithBrowserStrategy(url, browserOptions);
  if (canUseCache) {
    hooks.setCache?.(url, browserResult) ?? setBasicCache(url, browserResult);
  }
  recordMethod(browserResult.method);
  return browserResult;
}

/* ---------- legacy export for tests ------------------------------------- */

/**
 * @deprecated Use `clearStrategyHooks()` from strategy-hooks.ts instead.
 */
export { clearStrategyHooks as clearDomainIntel } from './strategy-hooks.js';
