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
import type { StrategyHooks } from '../../core/strategy-hooks.js';
export declare function clearDomainIntel(): void;
export declare function createDomainIntelHooks(): Pick<StrategyHooks, 'getDomainRecommendation' | 'recordDomainResult'>;
//# sourceMappingURL=domain-intel.d.ts.map