/**
 * Stale-While-Revalidate cache — premium server-only optimisation.
 *
 * Wraps the core LRU cache with SWR semantics:
 *   • Fresh entries are served immediately.
 *   • Stale entries (within the SWR window) are served AND trigger a
 *     background revalidation so the next caller gets a fresh result.
 *   • Expired entries (past the SWR window) are evicted.
 *
 * This module is NOT shipped in the npm package — it lives under
 * `src/server/` which is excluded from the package.json `files` list.
 */

import {
  getCachedWithSWR,
  markRevalidating,
  setCached,
} from '../../core/cache.js';
import type {
  StrategyHooks,
  StrategyResult,
  CacheCheckResult,
} from '../../core/strategy-hooks.js';

/* ---------- hook implementations ---------------------------------------- */

function checkCache(url: string): CacheCheckResult | null {
  const entry = getCachedWithSWR<StrategyResult>(url);
  if (!entry) return null;
  return { value: entry.value, stale: entry.stale };
}

function markRevalidatingHook(url: string): boolean {
  return markRevalidating(url);
}

function setCache(url: string, result: StrategyResult): void {
  setCached(url, result);
}

/* ---------- public export ----------------------------------------------- */

export function createSWRCacheHooks(): Pick<
  StrategyHooks,
  'checkCache' | 'markRevalidating' | 'setCache'
> {
  return {
    checkCache,
    markRevalidating: markRevalidatingHook,
    setCache,
  };
}
