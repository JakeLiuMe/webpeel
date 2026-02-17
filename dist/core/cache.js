/**
 * In-memory LRU response cache.
 */
const MAX_ENTRIES = 1000;
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cacheTTL = DEFAULT_TTL_MS;
const responseCache = new Map();
function normalizeUrl(url) {
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
    }
    catch {
        return url.trim();
    }
}
function getCacheEntry(key) {
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
    return entry.result;
}
function setCacheEntry(key, result) {
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
export function getCached(url) {
    return getCacheEntry(normalizeUrl(url));
}
export function setCached(url, result) {
    setCacheEntry(normalizeUrl(url), result);
}
export function clearCache() {
    responseCache.clear();
}
export function setCacheTTL(ms) {
    if (!Number.isFinite(ms) || ms <= 0) {
        throw new Error('Cache TTL must be a positive number of milliseconds');
    }
    cacheTTL = ms;
}
//# sourceMappingURL=cache.js.map