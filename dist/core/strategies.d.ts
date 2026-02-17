/**
 * Smart escalation strategy: try simple fetch first, escalate to browser if needed.
 *
 * Premium server-side optimisations (SWR cache, domain intelligence, parallel
 * race) are injected via the hook system in `strategy-hooks.ts`.  When no hooks
 * are registered the strategy degrades gracefully to a simple escalation path
 * that works great for CLI / npm library usage.
 */
import { type StrategyResult } from './strategy-hooks.js';
export type { StrategyResult } from './strategy-hooks.js';
export interface StrategyOptions {
    forceBrowser?: boolean;
    stealth?: boolean;
    waitMs?: number;
    userAgent?: string;
    timeoutMs?: number;
    screenshot?: boolean;
    screenshotFullPage?: boolean;
    headers?: Record<string, string>;
    cookies?: string[];
    actions?: Array<{
        type: 'wait' | 'click' | 'scroll' | 'type' | 'fill' | 'select' | 'press' | 'hover' | 'waitForSelector' | 'screenshot';
        selector?: string;
        value?: string;
        key?: string;
        ms?: number;
        to?: 'top' | 'bottom' | number;
        timeout?: number;
    }>;
    keepPageOpen?: boolean;
    noCache?: boolean;
    raceTimeoutMs?: number;
    location?: {
        country?: string;
        languages?: string[];
    };
}
/**
 * Smart fetch with automatic escalation.
 *
 * Without hooks: simple fetch → browser → stealth escalation.
 * With premium hooks: SWR cache → domain intel → parallel race → escalation.
 */
export declare function smartFetch(url: string, options?: StrategyOptions): Promise<StrategyResult>;
/**
 * @deprecated Use `clearStrategyHooks()` from strategy-hooks.ts instead.
 */
export { clearStrategyHooks as clearDomainIntel } from './strategy-hooks.js';
//# sourceMappingURL=strategies.d.ts.map