/**
 * Domain Intelligence — premium server-only optimisation.
 *
 * Learns from historical fetch outcomes which domains require browser or
 * stealth mode, so subsequent requests skip the slow simple→browser
 * escalation path and go straight to the right strategy.
 *
 * Uses an exponential moving average for latency tracking and requires a
 * minimum sample count before issuing recommendations to avoid false
 * positives from one-off failures.
 *
 * This module is NOT shipped in the npm package.
 */
/* ---------- configuration ----------------------------------------------- */
const MAX_DOMAINS = 500;
const TTL_MS = 60 * 60 * 1000; // 1 hour
const EMA_ALPHA = 0.3;
const MIN_SAMPLES = 3;
/* ---------- state ------------------------------------------------------- */
const domainIntel = new Map();
const methodCounts = new Map();
/* ---------- internals --------------------------------------------------- */
function domainKey(url) {
    try {
        return new URL(url).hostname.toLowerCase();
    }
    catch {
        return '';
    }
}
function prune(now) {
    for (const [key, intel] of domainIntel) {
        if (now - intel.lastSeen > TTL_MS) {
            domainIntel.delete(key);
            methodCounts.delete(key);
        }
    }
}
/* ---------- hook implementations ---------------------------------------- */
function getDomainRecommendation(url) {
    const key = domainKey(url);
    if (!key)
        return null;
    const intel = domainIntel.get(key);
    if (!intel)
        return null;
    const now = Date.now();
    if (now - intel.lastSeen > TTL_MS) {
        domainIntel.delete(key);
        methodCounts.delete(key);
        return null;
    }
    if (intel.sampleCount < MIN_SAMPLES)
        return null;
    const counts = methodCounts.get(key);
    if (!counts)
        return null;
    // LRU touch
    domainIntel.delete(key);
    domainIntel.set(key, intel);
    // All samples needed stealth → recommend stealth
    if (counts.stealth === intel.sampleCount && intel.needsStealth) {
        return { mode: 'stealth' };
    }
    // All samples needed browser (never succeeded with simple) → recommend browser
    if (counts.simple === 0 &&
        counts.browser + counts.stealth === intel.sampleCount &&
        intel.needsBrowser) {
        return { mode: 'browser' };
    }
    return null;
}
function recordDomainResult(url, method, latencyMs) {
    const key = domainKey(url);
    if (!key)
        return;
    const now = Date.now();
    prune(now);
    const existing = domainIntel.get(key);
    const sanitizedLatency = Number.isFinite(latencyMs) && latencyMs > 0
        ? latencyMs
        : (existing?.avgLatencyMs ?? 0);
    const next = existing
        ? {
            needsBrowser: existing.needsBrowser ||
                method === 'browser' ||
                method === 'stealth',
            needsStealth: existing.needsStealth || method === 'stealth',
            avgLatencyMs: existing.avgLatencyMs === 0
                ? sanitizedLatency
                : existing.avgLatencyMs * (1 - EMA_ALPHA) +
                    sanitizedLatency * EMA_ALPHA,
            lastSeen: now,
            sampleCount: existing.sampleCount + 1,
        }
        : {
            needsBrowser: method === 'browser' || method === 'stealth',
            needsStealth: method === 'stealth',
            avgLatencyMs: sanitizedLatency,
            lastSeen: now,
            sampleCount: 1,
        };
    const existingCounts = methodCounts.get(key) ?? {
        simple: 0,
        browser: 0,
        stealth: 0,
    };
    existingCounts[method] += 1;
    // Delete-then-set for LRU ordering
    domainIntel.delete(key);
    domainIntel.set(key, next);
    methodCounts.set(key, existingCounts);
    // Evict oldest when over capacity
    while (domainIntel.size > MAX_DOMAINS) {
        const oldest = domainIntel.keys().next().value;
        if (!oldest)
            break;
        domainIntel.delete(oldest);
        methodCounts.delete(oldest);
    }
}
/* ---------- cleanup ----------------------------------------------------- */
export function clearDomainIntel() {
    domainIntel.clear();
    methodCounts.clear();
}
/* ---------- public export ----------------------------------------------- */
export function createDomainIntelHooks() {
    return {
        getDomainRecommendation,
        recordDomainResult,
    };
}
//# sourceMappingURL=domain-intel.js.map