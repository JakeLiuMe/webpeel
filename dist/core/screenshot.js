/**
 * Screenshot helper (Playwright)
 *
 * Returns a base64-encoded screenshot for a given URL.
 */
import { browserScreenshot } from './fetcher.js';
export async function takeScreenshot(url, options = {}) {
    const format = (options.format === 'jpg' ? 'jpeg' : (options.format || 'png'));
    const { buffer, finalUrl } = await browserScreenshot(url, {
        fullPage: options.fullPage || false,
        width: options.width,
        height: options.height,
        format,
        quality: options.quality,
        waitMs: options.waitFor,
        timeoutMs: options.timeout,
        userAgent: options.userAgent,
        headers: options.headers,
        cookies: options.cookies,
        stealth: options.stealth,
        actions: options.actions,
    });
    return {
        url: finalUrl,
        format,
        contentType: format === 'png' ? 'image/png' : 'image/jpeg',
        screenshot: buffer.toString('base64'),
    };
}
//# sourceMappingURL=screenshot.js.map