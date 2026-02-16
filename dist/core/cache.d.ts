/**
 * Lightweight in-memory response cache with LRU eviction.
 */
export declare function getCached<T = unknown>(url: string): T | null;
export declare function setCached<T = unknown>(url: string, result: T): void;
export declare function clearCache(): void;
export declare function setCacheTTL(ms: number): void;
//# sourceMappingURL=cache.d.ts.map