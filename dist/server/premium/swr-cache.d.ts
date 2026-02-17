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
import type { StrategyHooks } from '../../core/strategy-hooks.js';
export declare function createSWRCacheHooks(): Pick<StrategyHooks, 'checkCache' | 'markRevalidating' | 'setCache'>;
//# sourceMappingURL=swr-cache.d.ts.map