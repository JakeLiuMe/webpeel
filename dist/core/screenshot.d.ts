/**
 * Screenshot helper (Playwright)
 *
 * Returns a base64-encoded screenshot for a given URL.
 */
import type { PageAction } from '../types.js';
export type ScreenshotFormat = 'png' | 'jpeg';
export interface ScreenshotOptions {
    fullPage?: boolean;
    width?: number;
    height?: number;
    /** png | jpeg | jpg (jpg is treated as jpeg) */
    format?: 'png' | 'jpeg' | 'jpg';
    /** JPEG quality (1-100). Ignored for PNG. */
    quality?: number;
    /** Wait in ms after page load (domcontentloaded) */
    waitFor?: number;
    timeout?: number;
    userAgent?: string;
    headers?: Record<string, string>;
    cookies?: string[];
    stealth?: boolean;
    actions?: PageAction[];
}
export interface ScreenshotResult {
    url: string;
    format: ScreenshotFormat;
    contentType: string;
    /** Base64-encoded image bytes (no data: prefix) */
    screenshot: string;
}
export declare function takeScreenshot(url: string, options?: ScreenshotOptions): Promise<ScreenshotResult>;
//# sourceMappingURL=screenshot.d.ts.map