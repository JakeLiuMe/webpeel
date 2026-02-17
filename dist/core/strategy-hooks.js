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
/* ---------- singleton registry ------------------------------------------- */
let registeredHooks = {};
/**
 * Register premium strategy hooks.  Should be called once at server startup.
 * Calling again replaces the previous hooks entirely.
 */
export function registerStrategyHooks(hooks) {
    registeredHooks = { ...hooks };
}
/**
 * Clear all registered hooks (useful in tests).
 */
export function clearStrategyHooks() {
    registeredHooks = {};
}
/**
 * Retrieve the current hooks (internal — used by strategies.ts).
 */
export function getStrategyHooks() {
    return registeredHooks;
}
//# sourceMappingURL=strategy-hooks.js.map