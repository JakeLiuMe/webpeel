/**
 * Local response cache for WebPeel CLI
 *
 * Caches fetch results in ~/.webpeel/cache/ with TTL support.
 * Cache key is a hash of URL + relevant options.
 */
/**
 * Parse a TTL string like "5m", "1h", "30s", "1d" into milliseconds
 */
export declare function parseTTL(ttl: string): number;
/**
 * Get a cached result if it exists and hasn't expired
 */
export declare function getCache(url: string, options?: Record<string, any>): any | null;
/**
 * Store a result in the cache
 */
export declare function setCache(url: string, result: any, ttlMs: number, options?: Record<string, any>): void;
/**
 * Clear expired cache entries (or all entries)
 */
export declare function clearCache(all?: boolean): number;
/**
 * Get cache stats
 */
export declare function cacheStats(): {
    entries: number;
    sizeBytes: number;
    dir: string;
};
//# sourceMappingURL=cache.d.ts.map