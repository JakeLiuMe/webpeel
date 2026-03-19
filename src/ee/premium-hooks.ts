/**
 * Premium strategy hooks — server-only optimisations.
 *
 * Call `registerPremiumHooks()` once at server startup to activate:
 *   • SWR (stale-while-revalidate) response cache
 *   • Domain intelligence (learns which sites need browser/stealth)
 *   • Parallel race strategy (starts browser if simple fetch is slow)
 *   • 55+ domain extractors (Twitter, Reddit, GitHub, HN, Wikipedia, etc.)
 *   • SPA auto-detection (travel, jobs, real estate sites)
 *   • Content stability detection (smart DOM mutation monitoring)
 *
 * These modules are NOT shipped in the npm package.
 */

import { registerStrategyHooks } from '../core/strategy-hooks.js';
import { createSWRCacheHooks } from './swr-cache.js';
import { createDomainIntelHooks } from './domain-intel.js';
import { extractDomainData, getDomainExtractor } from './domain-extractors.js';
import { SPA_DOMAINS, SPA_URL_PATTERNS } from './spa-detection.js';
import { waitForContentStable } from './stability.js';

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

    // Premium domain extraction (55+ extractors)
    extractDomainData,

    // Premium domain extractor lookup
    getDomainExtractor: (url: string) => getDomainExtractor(url),

    // Premium SPA detection
    getSPADomains: () => SPA_DOMAINS,
    getSPAPatterns: () => SPA_URL_PATTERNS,

    // Premium content stability (DOM mutation monitoring)
    waitForContentStable,
  });
}
