/**
 * Lightweight in-memory response cache with LRU eviction.
 */
const MAX_ENTRIES = 1000;
let cacheTTL = 300000; // 5 minutes
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
export function getCached(url) {
    const key = normalizeUrl(url);
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
export function setCached(url, result) {
    const key = normalizeUrl(url);
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