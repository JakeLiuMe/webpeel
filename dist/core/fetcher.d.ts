/**
 * Core fetching logic: simple HTTP and browser-based fetching
 */
export interface FetchResult {
    html: string;
    url: string;
    statusCode?: number;
    screenshot?: Buffer;
    contentType?: string;
    /** Playwright page object (only available in browser/stealth mode, must be closed by caller) */
    page?: import('playwright-core').Page;
    /** Playwright browser object (only available in browser/stealth mode, must be closed by caller) */
    browser?: import('playwright-core').Browser;
}
/**
 * Simple HTTP fetch using native fetch + Cheerio
 * Fast and lightweight, but can be blocked by Cloudflare/bot detection
 * SECURITY: Manual redirect handling with SSRF re-validation
 */
export declare function simpleFetch(url: string, userAgent?: string, timeoutMs?: number, customHeaders?: Record<string, string>): Promise<FetchResult>;
/**
 * Fetch using headless Chromium via Playwright
 * Slower but can handle JavaScript-heavy sites and bypass some bot detection
 */
export declare function browserFetch(url: string, options?: {
    userAgent?: string;
    waitMs?: number;
    timeoutMs?: number;
    screenshot?: boolean;
    screenshotFullPage?: boolean;
    headers?: Record<string, string>;
    cookies?: string[];
    stealth?: boolean;
    actions?: Array<{
        type: 'wait' | 'click' | 'scroll' | 'type' | 'fill' | 'select' | 'press' | 'hover' | 'waitForSelector' | 'screenshot';
        selector?: string;
        value?: string;
        key?: string;
        ms?: number;
        to?: 'top' | 'bottom' | number;
        timeout?: number;
    }>;
    /** Keep the browser page open after fetch (caller must close page + browser) */
    keepPageOpen?: boolean;
}): Promise<FetchResult>;
/**
 * Retry a fetch operation with exponential backoff
 */
export declare function retryFetch<T>(fn: () => Promise<T>, maxAttempts?: number, baseDelayMs?: number): Promise<T>;
/**
 * Clean up browser resources
 */
export declare function cleanup(): Promise<void>;
//# sourceMappingURL=fetcher.d.ts.map