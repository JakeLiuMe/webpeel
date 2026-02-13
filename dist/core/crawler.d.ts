/**
 * Web crawler functionality
 * Crawls a starting URL and follows links matching specified patterns
 */
import type { PeelOptions } from '../types.js';
export interface CrawlOptions extends Omit<PeelOptions, 'format'> {
    /** Maximum number of pages to crawl (default: 10, max: 100) */
    maxPages?: number;
    /** Maximum depth to crawl (default: 2, max: 5) */
    maxDepth?: number;
    /** Only crawl URLs from these domains (default: same domain as starting URL) */
    allowedDomains?: string[];
    /** Exclude URLs matching these patterns (regex strings) */
    excludePatterns?: string[];
    /** Respect robots.txt (default: true) */
    respectRobotsTxt?: boolean;
    /** Rate limit between requests in milliseconds (default: 1000ms = 1 req/sec) */
    rateLimitMs?: number;
}
export interface CrawlResult {
    /** URL of the crawled page */
    url: string;
    /** Page title */
    title: string;
    /** Markdown content */
    markdown: string;
    /** All links found on this page (absolute URLs) */
    links: string[];
    /** Depth level (0 = starting URL) */
    depth: number;
    /** Parent URL that linked to this page (null for starting URL) */
    parent: string | null;
    /** Time elapsed fetching this page (ms) */
    elapsed: number;
    /** Error message if page failed to fetch */
    error?: string;
}
/**
 * Crawl a website starting from a URL
 *
 * @param startUrl - Starting URL to crawl from
 * @param options - Crawl options
 * @returns Array of crawl results
 *
 * @example
 * ```typescript
 * import { crawl } from 'webpeel';
 *
 * const results = await crawl('https://example.com', {
 *   maxPages: 20,
 *   maxDepth: 2,
 * });
 *
 * console.log(`Crawled ${results.length} pages`);
 * ```
 */
export declare function crawl(startUrl: string, options?: CrawlOptions): Promise<CrawlResult[]>;
//# sourceMappingURL=crawler.d.ts.map