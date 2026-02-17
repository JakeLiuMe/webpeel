/**
 * Premium strategy hooks — server-only optimisations.
 *
 * Call `registerPremiumHooks()` once at server startup to activate:
 *   • SWR (stale-while-revalidate) response cache
 *   • Domain intelligence (learns which sites need browser/stealth)
 *   • Parallel race strategy (starts browser if simple fetch is slow)
 *
 * These modules are NOT shipped in the npm package.
 */

import { registerStrategyHooks } from '../../core/strategy-hooks.js';
import { createSWRCacheHooks } from './swr-cache.js';
import { createDomainIntelHooks } from './domain-intel.js';

export { clearDomainIntel } from './domain-intel.js';

/**
 * Wire all premium hooks into the core strategy layer.
 *
 * Must be called before any request is served.
 */
export function registerPremiumHooks(): void {
  const cacheHooks = createSWRCacheHooks();
  const intelHooks = createDomainIntelHooks();

  registerStrategyHooks({
    // SWR cache
    checkCache: cacheHooks.checkCache,
    markRevalidating: cacheHooks.markRevalidating,
    setCache: cacheHooks.setCache,

    // Domain intelligence
    getDomainRecommendation: intelHooks.getDomainRecommendation,
    recordDomainResult: intelHooks.recordDomainResult,

    // Parallel race strategy
    shouldRace: () => true,
    getRaceTimeoutMs: () => 2000,
  });
}
