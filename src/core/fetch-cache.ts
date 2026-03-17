/**
 * In-memory LRU fetch cache for WebPeel
 *
 * Caches pipeline results to avoid redundant fetches for identical requests.
 * Supports TTL-based expiry and LRU eviction when maxEntries is exceeded.
 * Exported as a singleton: import { fetchCache } from './fetch-cache.js'
 */

export interface FetchCacheEntry {
  content: string;
  title: string;
  metadata: any;
  method: string;
  tokens: number;
  links?: any[];
  timestamp: number;
}

export interface FetchCacheStats {
  size: number;
  hits: number;
  misses: number;
  hitRate: number;
}

export class FetchCache {
  private cache: Map<string, FetchCacheEntry>;
  private maxEntries: number;
  private defaultTTL: number; // ms
  private hits: number;
  private misses: number;

  constructor(maxEntries = 500, defaultTTLSeconds = 300) {
    this.cache = new Map();
    this.maxEntries = maxEntries;
    this.defaultTTL = defaultTTLSeconds * 1000;
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Generate a stable cache key from url + relevant fetch options.
   * Different option combinations produce different cache entries.
   */
  getKey(
    url: string,
    options: { render?: boolean; stealth?: boolean; budget?: number } = {}
  ): string {
    const render = options.render ? '1' : '0';
    const stealth = options.stealth ? '1' : '0';
    const budget = options.budget !== undefined ? String(options.budget) : '';
    return `${url}|r:${render}|s:${stealth}|b:${budget}`;
  }

  /**
   * Retrieve a cached entry. Returns null if missing or expired.
   * On hit: entry is moved to the end of the Map (LRU refresh).
   */
  get(key: string): FetchCacheEntry | null {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return null;
    }

    const ageMs = Date.now() - entry.timestamp;
    if (ageMs > this.defaultTTL) {
      // Expired — evict and return null
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    // LRU touch: move to end
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.hits++;
    return entry;
  }

  /**
   * Store an entry in the cache.
   * If the cache is at capacity, the least recently used entry is evicted.
   */
  set(key: string, entry: FetchCacheEntry): void {
    // Remove existing to refresh position
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    this.cache.set(key, entry);

    // LRU eviction: remove oldest entry (first in Map iteration order)
    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) {
        this.cache.delete(oldestKey);
      } else {
        break;
      }
    }
  }

  /** Clear all entries and reset stats. */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /** Return cache stats. hitRate is in [0, 1]. */
  stats(): FetchCacheStats {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : Math.round((this.hits / total) * 100) / 100,
    };
  }
}

/** Singleton fetch cache — shared across all requests (5 min TTL, 500 entries). */
export const fetchCache = new FetchCache(500, 300);

/** Singleton search cache — shorter TTL since results change faster (60 s). */
export const searchCache = new FetchCache(500, 60);
