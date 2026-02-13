/**
 * WebPeel - Fast web fetcher for AI agents
 *
 * Main library export
 */
import { smartFetch } from './core/strategies.js';
import { htmlToMarkdown, htmlToText, estimateTokens, selectContent } from './core/markdown.js';
import { extractMetadata, extractLinks } from './core/metadata.js';
import { cleanup } from './core/fetcher.js';
export * from './types.js';
/**
 * Fetch and extract content from a URL
 *
 * @param url - URL to fetch
 * @param options - Fetch options
 * @returns Extracted content and metadata
 *
 * @example
 * ```typescript
 * import { peel } from 'webpeel';
 *
 * const result = await peel('https://example.com');
 * console.log(result.content); // Markdown content
 * console.log(result.metadata); // Structured metadata
 * ```
 */
export async function peel(url, options = {}) {
    const startTime = Date.now();
    let { render = false, wait = 0, format = 'markdown', timeout = 30000, userAgent, screenshot = false, screenshotFullPage = false, selector, exclude, headers, cookies, } = options;
    // Detect PDF URLs and force browser rendering
    const isPdf = url.toLowerCase().endsWith('.pdf');
    if (isPdf) {
        render = true;
    }
    // If screenshot is requested, force render mode
    if (screenshot) {
        render = true;
    }
    try {
        // Fetch the page
        const fetchResult = await smartFetch(url, {
            forceBrowser: render,
            waitMs: wait,
            userAgent,
            timeoutMs: timeout,
            screenshot,
            screenshotFullPage,
            headers,
            cookies,
        });
        // Apply selector filtering if requested
        let html = fetchResult.html;
        if (selector) {
            html = selectContent(html, selector, exclude);
        }
        // Extract metadata and title
        const { title, metadata } = extractMetadata(html, fetchResult.url);
        // Extract links
        const links = extractLinks(html, fetchResult.url);
        // Convert content to requested format
        let content;
        switch (format) {
            case 'html':
                content = html;
                break;
            case 'text':
                content = htmlToText(html);
                break;
            case 'markdown':
            default:
                content = htmlToMarkdown(html);
                break;
        }
        // Calculate elapsed time and token estimate
        const elapsed = Date.now() - startTime;
        const tokens = estimateTokens(content);
        // Convert screenshot buffer to base64 if present
        const screenshotBase64 = fetchResult.screenshot?.toString('base64');
        return {
            url: fetchResult.url,
            title,
            content,
            metadata,
            links,
            tokens,
            method: fetchResult.method,
            elapsed,
            screenshot: screenshotBase64,
        };
    }
    catch (error) {
        // Clean up browser resources on error
        await cleanup();
        throw error;
    }
}
/**
 * Fetch multiple URLs in batch with concurrency control
 *
 * @param urls - Array of URLs to fetch
 * @param options - Fetch options (including concurrency)
 * @returns Array of results or errors
 *
 * @example
 * ```typescript
 * import { peelBatch } from 'webpeel';
 *
 * const urls = ['https://example.com', 'https://example.org'];
 * const results = await peelBatch(urls, { concurrency: 3 });
 * ```
 */
export async function peelBatch(urls, options = {}) {
    const { concurrency = 3, ...peelOpts } = options;
    const results = [];
    // Process in batches
    for (let i = 0; i < urls.length; i += concurrency) {
        const batch = urls.slice(i, i + concurrency);
        const batchResults = await Promise.allSettled(batch.map(url => peel(url, peelOpts)));
        batchResults.forEach((result, j) => {
            if (result.status === 'fulfilled') {
                results.push(result.value);
            }
            else {
                results.push({
                    url: batch[j],
                    error: result.reason?.message || 'Unknown error'
                });
            }
        });
    }
    return results;
}
/**
 * Clean up any browser resources
 * Call this when you're done using WebPeel
 */
export { cleanup };
//# sourceMappingURL=index.js.map