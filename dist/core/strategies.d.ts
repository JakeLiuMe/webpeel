/**
 * Smart escalation strategy: try simple fetch first, escalate to browser if needed
 */
import { type FetchResult } from './fetcher.js';
export interface StrategyOptions {
    /** Force browser mode (skip simple fetch) */
    forceBrowser?: boolean;
    /** Use stealth mode to bypass bot detection */
    stealth?: boolean;
    /** Wait time after page load in browser mode (ms) */
    waitMs?: number;
    /** Custom user agent */
    userAgent?: string;
    /** Request timeout (ms) */
    timeoutMs?: number;
    /** Capture a screenshot of the page */
    screenshot?: boolean;
    /** Full-page screenshot (default: viewport only) */
    screenshotFullPage?: boolean;
    /** Custom HTTP headers to send */
    headers?: Record<string, string>;
    /** Cookies to set (key=value pairs) */
    cookies?: string[];
}
export interface StrategyResult extends FetchResult {
    /** Which strategy succeeded: 'simple' | 'browser' | 'stealth' */
    method: 'simple' | 'browser' | 'stealth';
}
/**
 * Smart fetch with automatic escalation
 *
 * Strategy:
 * 1. Try simple HTTP fetch first (fast, ~200ms)
 * 2. If blocked (403, 503, Cloudflare, empty body) → try browser
 * 3. If browser gets blocked (403, CAPTCHA) → try stealth mode
 * 4. If stealth mode is explicitly requested → skip to stealth
 *
 * Returns the result along with which method worked
 */
export declare function smartFetch(url: string, options?: StrategyOptions): Promise<StrategyResult>;
//# sourceMappingURL=strategies.d.ts.map