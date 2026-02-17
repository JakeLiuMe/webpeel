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
import { getCachedWithSWR, markRevalidating, setCached, } from '../../core/cache.js';
/* ---------- hook implementations ---------------------------------------- */
function checkCache(url) {
    const entry = getCachedWithSWR(url);
    if (!entry)
        return null;
    return { value: entry.value, stale: entry.stale };
}
function markRevalidatingHook(url) {
    return markRevalidating(url);
}
function setCache(url, result) {
    setCached(url, result);
}
/* ---------- public export ----------------------------------------------- */
export function createSWRCacheHooks() {
    return {
        checkCache,
        markRevalidating: markRevalidatingHook,
        setCache,
    };
}
//# sourceMappingURL=swr-cache.js.map