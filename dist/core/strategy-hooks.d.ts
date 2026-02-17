/**
 * Strategy hooks — plugin interface for premium server-side optimizations.
 *
 * The base `smartFetch()` in strategies.ts provides solid simple→browser→stealth
 * escalation.  Hooks allow the server (or any host) to layer on caching, domain
 * intelligence, and parallel-race strategies *without* shipping that logic in
 * the npm package.
 *
 * Register hooks once at startup via `registerStrategyHooks()`.
 * All hook methods are optional — unset hooks are simply skipped.
 */
import type { FetchResult } from './fetcher.js';
export interface StrategyResult extends FetchResult {
    method: 'simple' | 'browser' | 'stealth' | 'cached';
}
export interface DomainRecommendation {
    mode: 'browser' | 'stealth';
}
export interface CacheCheckResult {
    /** Cached response to serve immediately. */
    value: StrategyResult;
    /** When true the caller should trigger a background revalidation. */
    stale: boolean;
}
export interface StrategyHooks {
    /**
     * Look up `url` in the cache.
     * Return `null` for a cache miss.
     * When `stale` is true the result can be served but should be refreshed.
     */
    checkCache?(url: string): CacheCheckResult | null;
    /**
     * Attempt to mark `url` as "currently revalidating" so that only one
     * background refresh runs at a time.  Return `true` if this call won
     * the race (caller should revalidate), `false` otherwise.
     */
    markRevalidating?(url: string): boolean;
    /**
     * Store a fresh result in the cache.
     */
    setCache?(url: string, result: StrategyResult): void;
    /**
     * Return a recommendation for how to fetch `url` based on historical
     * success/failure data for the domain.  Return `null` to let the default
     * escalation logic decide.
     */
    getDomainRecommendation?(url: string): DomainRecommendation | null;
    /**
     * Record the outcome of a fetch so the intelligence layer can learn.
     */
    recordDomainResult?(url: string, method: 'simple' | 'browser' | 'stealth', latencyMs: number): void;
    /**
     * Whether to use the parallel race strategy (fire browser after a short
     * timeout if simple fetch hasn't resolved).  Default: false (no race).
     */
    shouldRace?(): boolean;
    /**
     * Timeout (ms) before the race starts a parallel browser fetch.
     * Only called when `shouldRace()` returns true.  Default: 2000.
     */
    getRaceTimeoutMs?(): number;
}
/**
 * Register premium strategy hooks.  Should be called once at server startup.
 * Calling again replaces the previous hooks entirely.
 */
export declare function registerStrategyHooks(hooks: StrategyHooks): void;
/**
 * Clear all registered hooks (useful in tests).
 */
export declare function clearStrategyHooks(): void;
/**
 * Retrieve the current hooks (internal — used by strategies.ts).
 */
export declare function getStrategyHooks(): Readonly<StrategyHooks>;
//# sourceMappingURL=strategy-hooks.d.ts.map