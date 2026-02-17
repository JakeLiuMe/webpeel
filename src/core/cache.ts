/**
 * In-memory LRU response cache.
 */

interface CacheEntry<T = unknown> {
  result: T;
  timestamp: number;
}

const MAX_ENTRIES = 1000;
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

let cacheTTL = DEFAULT_TTL_MS;
const responseCache = new Map<string, CacheEntry>();

function normalizeUrl(url: string): string {
  try {
    const normalized = new URL(url);
    normalized.hash = '';
    normalized.hostname = normalized.hostname.toLowerCase();

    if ((normalized.protocol === 'http:' && normalized.port === '80') ||
        (normalized.protocol === 'https:' && normalized.port === '443')) {
      normalized.port = '';
    }

    if (!normalized.pathname) {
      normalized.pathname = '/';
    }

    const sortedParams = [...normalized.searchParams.entries()]
      .sort(([a], [b]) => a.localeCompare(b));
    normalized.search = '';
    for (const [key, value] of sortedParams) {
      normalized.searchParams.append(key, value);
    }

    return normalized.toString();
  } catch {
    return url.trim();
  }
}

function getCacheEntry<T = unknown>(key: string): T | null {
  const entry = responseCache.get(key);
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.timestamp > cacheTTL) {
    responseCache.delete(key);
    return null;
  }

  // LRU touch: move to the end when read.
  responseCache.delete(key);
  responseCache.set(key, entry);

  return entry.result as T;
}

function setCacheEntry<T = unknown>(key: string, result: T): void {
  if (responseCache.has(key)) {
    responseCache.delete(key);
  }

  responseCache.set(key, {
    result,
    timestamp: Date.now(),
  });

  while (responseCache.size > MAX_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    responseCache.delete(oldestKey);
  }
}

export function getCached<T = unknown>(url: string): T | null {
  return getCacheEntry<T>(normalizeUrl(url));
}

export function setCached<T = unknown>(url: string, result: T): void {
  setCacheEntry(normalizeUrl(url), result);
}

export function clearCache(): void {
  responseCache.clear();
}

export function setCacheTTL(ms: number): void {
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new Error('Cache TTL must be a positive number of milliseconds');
  }

  cacheTTL = ms;
}
