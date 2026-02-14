/**
 * Local response cache for WebPeel CLI
 *
 * Caches fetch results in ~/.webpeel/cache/ with TTL support.
 * Cache key is a hash of URL + relevant options.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
const CACHE_DIR = join(homedir(), '.webpeel', 'cache');
/**
 * Parse a TTL string like "5m", "1h", "30s", "1d" into milliseconds
 */
export function parseTTL(ttl) {
    const match = ttl.match(/^(\d+)(s|m|h|d)$/);
    if (!match) {
        throw new Error(`Invalid TTL format: "${ttl}". Use: 30s, 5m, 1h, 1d`);
    }
    const value = parseInt(match[1]);
    const unit = match[2];
    switch (unit) {
        case 's': return value * 1000;
        case 'm': return value * 60 * 1000;
        case 'h': return value * 60 * 60 * 1000;
        case 'd': return value * 24 * 60 * 60 * 1000;
        default: throw new Error(`Unknown TTL unit: ${unit}`);
    }
}
/**
 * Generate a cache key from URL + options
 */
function cacheKey(url, options) {
    const relevant = {
        url,
        render: options?.render || false,
        stealth: options?.stealth || false,
        selector: options?.selector || null,
        format: options?.format || 'markdown',
    };
    const hash = createHash('sha256').update(JSON.stringify(relevant)).digest('hex').slice(0, 16);
    return hash;
}
/**
 * Get a cached result if it exists and hasn't expired
 */
export function getCache(url, options) {
    const key = cacheKey(url, options);
    const filePath = join(CACHE_DIR, `${key}.json`);
    if (!existsSync(filePath))
        return null;
    try {
        const entry = JSON.parse(readFileSync(filePath, 'utf-8'));
        const age = Date.now() - entry.cachedAt;
        if (age > entry.ttlMs) {
            // Expired — delete and return null
            try {
                unlinkSync(filePath);
            }
            catch { }
            return null;
        }
        return entry.result;
    }
    catch {
        return null;
    }
}
/**
 * Store a result in the cache
 */
export function setCache(url, result, ttlMs, options) {
    if (!existsSync(CACHE_DIR)) {
        mkdirSync(CACHE_DIR, { recursive: true });
    }
    const key = cacheKey(url, options);
    const entry = {
        url,
        result,
        cachedAt: Date.now(),
        ttlMs,
        options: options ? JSON.stringify(options) : undefined,
    };
    writeFileSync(join(CACHE_DIR, `${key}.json`), JSON.stringify(entry));
}
/**
 * Clear expired cache entries (or all entries)
 */
export function clearCache(all = false) {
    if (!existsSync(CACHE_DIR))
        return 0;
    const files = readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
    let cleared = 0;
    for (const file of files) {
        const filePath = join(CACHE_DIR, file);
        try {
            if (all) {
                unlinkSync(filePath);
                cleared++;
            }
            else {
                const entry = JSON.parse(readFileSync(filePath, 'utf-8'));
                if (Date.now() - entry.cachedAt > entry.ttlMs) {
                    unlinkSync(filePath);
                    cleared++;
                }
            }
        }
        catch {
            // Skip corrupt files
        }
    }
    return cleared;
}
/**
 * Get cache stats
 */
export function cacheStats() {
    if (!existsSync(CACHE_DIR))
        return { entries: 0, sizeBytes: 0, dir: CACHE_DIR };
    const files = readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
    let sizeBytes = 0;
    for (const file of files) {
        try {
            const stat = statSync(join(CACHE_DIR, file));
            sizeBytes += stat.size;
        }
        catch { }
    }
    return { entries: files.length, sizeBytes, dir: CACHE_DIR };
}
//# sourceMappingURL=cache.js.map