/**
 * Adaptive Domain Learning — Store and Reuse Successful Extraction Patterns
 *
 * Remembers which extraction method works best per domain and reuses that
 * knowledge on subsequent fetches. Backed by an in-memory LRU cache with
 * optional Postgres persistence (TODO).
 */

import { LRUCache } from 'lru-cache';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DomainMemoryEntry {
  domain: string;
  /** Best method that succeeded: 'simple' | 'browser' | 'stealth' | 'cloaked' | 'domain-api' */
  bestMethod: string;
  /** Average response time in ms for the best method */
  avgResponseMs: number;
  /** Success count for the best method */
  successCount: number;
  /** Last successful fetch timestamp */
  lastSuccess: number;
  /** Content quality score (0-1) from the best method */
  avgQuality: number;
  /** Whether this domain requires JavaScript rendering */
  requiresJs: boolean;
  /** Whether this domain has anti-bot protection */
  hasAntibot: boolean;
  /** Total fetch attempts across all methods */
  totalAttempts: number;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/** In-memory cache: 5 000 domains, 1-hour TTL */
const memoryCache = new LRUCache<string, DomainMemoryEntry>({
  max: 5000,
  ttl: 3_600_000,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract and normalise the hostname from a URL string.
 * Strips leading "www." so that www.example.com and example.com share an entry.
 */
function normaliseDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.replace(/^www\./, '');
  } catch {
    // If the URL is already just a hostname (e.g. "example.com"), use as-is.
    return url.toLowerCase().replace(/^www\./, '');
  }
}

/** Methods that imply JS rendering was needed. */
const JS_METHODS = new Set(['browser', 'stealth']);

/** Methods that imply anti-bot protection. */
const ANTIBOT_METHODS = new Set(['stealth', 'cloaked']);

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Record a fetch result for a domain.
 * Call this after every successful fetch to build up domain knowledge.
 */
export function recordFetchResult(
  url: string,
  result: {
    method: string;
    responseMs: number;
    quality: number; // 0-1 content quality
    wasBlocked: boolean;
    hadJavascript: boolean; // true if JS rendering was needed
  },
): void {
  const domain = normaliseDomain(url);
  const existing = memoryCache.get(domain);

  if (existing) {
    // Decide whether the incoming method should become the new bestMethod.
    // We upgrade if the incoming quality is strictly higher.
    const isBetterMethod = result.quality > existing.avgQuality;

    if (isBetterMethod) {
      existing.bestMethod = result.method;
    }

    // Rolling averages: (old * count + new) / (count + 1)
    const count = existing.successCount;
    existing.avgResponseMs =
      (existing.avgResponseMs * count + result.responseMs) / (count + 1);
    existing.avgQuality =
      (existing.avgQuality * count + result.quality) / (count + 1);

    existing.successCount += 1;
    existing.totalAttempts += 1;
    existing.lastSuccess = Date.now();

    // Accumulate flags — once set they stay set.
    if (JS_METHODS.has(result.method) || result.hadJavascript) {
      existing.requiresJs = true;
    }
    if (ANTIBOT_METHODS.has(result.method) || result.wasBlocked) {
      existing.hasAntibot = true;
    }

    memoryCache.set(domain, existing);
  } else {
    // Brand-new entry
    const entry: DomainMemoryEntry = {
      domain,
      bestMethod: result.method,
      avgResponseMs: result.responseMs,
      successCount: 1,
      lastSuccess: Date.now(),
      avgQuality: result.quality,
      requiresJs: JS_METHODS.has(result.method) || result.hadJavascript,
      hasAntibot: ANTIBOT_METHODS.has(result.method) || result.wasBlocked,
      totalAttempts: 1,
    };
    memoryCache.set(domain, entry);
  }
}

/**
 * Get the recommended method for a domain based on past experience.
 * Returns null if no history exists.
 */
export function getRecommendedMethod(
  url: string,
): {
  method: string;
  confidence: number; // 0-1, based on successCount
  avgResponseMs: number;
  requiresJs: boolean;
} | null {
  const domain = normaliseDomain(url);
  const entry = memoryCache.get(domain);
  if (!entry) return null;

  // Confidence ramp: 1 → 0.3, 5+ → 0.8, 10+ → 0.95
  let confidence: number;
  if (entry.successCount >= 10) {
    confidence = 0.95;
  } else if (entry.successCount >= 5) {
    // Linear interpolation between 0.8 and 0.95 for 5..9
    confidence = 0.8 + ((entry.successCount - 5) / 5) * 0.15;
  } else if (entry.successCount >= 2) {
    // Linear interpolation between 0.3 and 0.8 for 1..4
    confidence = 0.3 + ((entry.successCount - 1) / 4) * 0.5;
  } else {
    confidence = 0.3;
  }

  return {
    method: entry.bestMethod,
    confidence,
    avgResponseMs: entry.avgResponseMs,
    requiresJs: entry.requiresJs,
  };
}

/**
 * Get full domain memory entry.
 */
export function getDomainMemory(domain: string): DomainMemoryEntry | null {
  // Accept both raw domain and full URL.
  const key = normaliseDomain(domain);
  return memoryCache.get(key) ?? null;
}

/**
 * Get stats about the domain memory cache.
 */
export function getDomainMemoryStats(): {
  totalDomains: number;
  topDomains: Array<{
    domain: string;
    bestMethod: string;
    successCount: number;
  }>;
} {
  const entries: DomainMemoryEntry[] = [];

  // LRUCache v11 supports for..of iteration
  for (const [, value] of memoryCache.entries()) {
    if (value) entries.push(value);
  }

  // Sort by successCount descending, take top 20
  entries.sort((a, b) => b.successCount - a.successCount);
  const topDomains = entries.slice(0, 20).map((e) => ({
    domain: e.domain,
    bestMethod: e.bestMethod,
    successCount: e.successCount,
  }));

  return {
    totalDomains: memoryCache.size,
    topDomains,
  };
}

// ---------------------------------------------------------------------------
// Postgres sync stubs (wire later)
// ---------------------------------------------------------------------------

/** Persist current in-memory cache to Postgres. */
export async function syncToPostgres(): Promise<void> {
  // TODO: INSERT/UPSERT all entries from memoryCache into a
  // `domain_memory` table keyed on `domain`.
}

/** Load domain memory from Postgres into the in-memory cache on startup. */
export async function loadFromPostgres(): Promise<void> {
  // TODO: SELECT * FROM domain_memory and populate memoryCache
  // with each row, respecting the LRU max-size limit.
}
