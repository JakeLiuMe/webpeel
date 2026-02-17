/**
 * Premium strategy hooks — server-only optimisations.
 *
 * Call `registerPremiumHooks()` once at server startup to activate:
 *   • SWR (stale-while-revalidate) response cache
 *   • Domain intelligence (learns which sites need browser/stealth)
 *   • Parallel race strategy (starts browser if simple fetch is slow)
 *
 * These modules are NOT shipped in the npm package.
 */
export { clearDomainIntel } from './domain-intel.js';
/**
 * Wire all premium hooks into the core strategy layer.
 *
 * Must be called before any request is served.
 */
export declare function registerPremiumHooks(): void;
//# sourceMappingURL=index.d.ts.map