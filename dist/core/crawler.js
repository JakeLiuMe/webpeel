/**
 * Web crawler functionality
 * Crawls a starting URL and follows links matching specified patterns
 */
import { peel } from '../index.js';
import { fetch as undiciFetch } from 'undici';
import { createHash } from 'crypto';
import { discoverSitemap } from './sitemap.js';
/**
 * Parse robots.txt and return disallowed paths for User-agent: *
 */
async function fetchRobotsTxt(domain) {
    const robotsUrl = `https://${domain}/robots.txt`;
    try {
        const response = await undiciFetch(robotsUrl, {
            headers: {
                'User-Agent': 'WebPeel/0.3.1 (+https://webpeel.dev)',
            },
            signal: AbortSignal.timeout(5000), // 5 second timeout
        });
        if (!response.ok) {
            // If robots.txt doesn't exist, allow everything
            return { disallowedPaths: [] };
        }
        const text = await response.text();
        const lines = text.split('\n');
        const disallowedPaths = [];
        let crawlDelay;
        let relevantSection = false;
        for (const line of lines) {
            const trimmed = line.trim();
            // Check for User-agent: *
            if (trimmed.toLowerCase().startsWith('user-agent:')) {
                const agent = trimmed.substring('user-agent:'.length).trim();
                relevantSection = agent === '*';
                continue;
            }
            if (!relevantSection)
                continue;
            // Parse Disallow directives
            if (trimmed.toLowerCase().startsWith('disallow:')) {
                const path = trimmed.substring('disallow:'.length).trim();
                if (path) {
                    disallowedPaths.push(path);
                }
            }
            // Parse Crawl-delay directive
            if (trimmed.toLowerCase().startsWith('crawl-delay:')) {
                const delay = parseInt(trimmed.substring('crawl-delay:'.length).trim());
                if (!isNaN(delay)) {
                    crawlDelay = delay * 1000; // Convert to milliseconds
                }
            }
        }
        return { disallowedPaths, crawlDelay };
    }
    catch {
        // If we can't fetch robots.txt, allow everything
        return { disallowedPaths: [] };
    }
}
/**
 * Check if a URL is allowed by robots.txt rules
 */
function isAllowedByRobots(url, rules) {
    const urlObj = new URL(url);
    const path = urlObj.pathname;
    for (const disallowed of rules.disallowedPaths) {
        // Simple prefix matching (proper robots.txt parsing would handle wildcards)
        if (path.startsWith(disallowed)) {
            return false;
        }
    }
    return true;
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
export async function crawl(startUrl, options = {}) {
    const { maxPages = 10, maxDepth = 2, allowedDomains, excludePatterns = [], respectRobotsTxt = true, rateLimitMs = 1000, sitemapFirst = false, strategy = 'bfs', deduplication = true, includePatterns = [], onProgress, ...peelOptions } = options;
    const crawlStartTime = Date.now();
    // Validate limits
    const validatedMaxPages = Math.min(Math.max(maxPages, 1), 100);
    const validatedMaxDepth = Math.min(Math.max(maxDepth, 1), 5);
    const validatedRateLimit = Math.max(rateLimitMs, 100); // Min 100ms between requests
    // Parse starting URL
    const startUrlObj = new URL(startUrl);
    const startDomain = startUrlObj.hostname;
    // Default: only crawl same domain as starting URL
    const validatedAllowedDomains = allowedDomains && allowedDomains.length > 0
        ? allowedDomains
        : [startDomain];
    // Compile exclude patterns
    const excludeRegexes = excludePatterns.map(pattern => new RegExp(pattern));
    // Compile include patterns
    const includeRegexes = includePatterns.map(pattern => new RegExp(pattern));
    // Fetch robots.txt if needed
    let robotsRules = { disallowedPaths: [] };
    if (respectRobotsTxt) {
        robotsRules = await fetchRobotsTxt(startDomain);
        // Use crawl-delay from robots.txt if it's larger than our rate limit
        if (robotsRules.crawlDelay && robotsRules.crawlDelay > validatedRateLimit) {
            console.error(`[Crawler] Using Crawl-delay from robots.txt: ${robotsRules.crawlDelay}ms`);
        }
    }
    const effectiveRateLimit = robotsRules.crawlDelay || validatedRateLimit;
    // State tracking
    const results = [];
    const visited = new Set();
    const contentFingerprints = new Set();
    let failedCount = 0;
    const queue = [
        { url: startUrl, depth: 0, parent: null },
    ];
    // Sitemap-first: Discover URLs from sitemap before crawling
    if (sitemapFirst) {
        try {
            const sitemap = await discoverSitemap(startDomain, { timeout: 10000, maxUrls: validatedMaxPages });
            for (const entry of sitemap.urls) {
                const entryUrl = entry.url;
                try {
                    const entryUrlObj = new URL(entryUrl);
                    if (validatedAllowedDomains.includes(entryUrlObj.hostname)) {
                        queue.push({ url: entryUrl, depth: 1, parent: startUrl });
                    }
                }
                catch { /* skip invalid URLs */ }
            }
        }
        catch { /* skip sitemap errors */ }
    }
    while (queue.length > 0 && results.length < validatedMaxPages) {
        // Use DFS (stack) or BFS (queue) strategy
        const item = strategy === 'dfs' ? queue.pop() : queue.shift();
        const { url, depth, parent } = item;
        // Skip if already visited
        if (visited.has(url))
            continue;
        visited.add(url);
        // Skip if depth exceeded
        if (depth > validatedMaxDepth)
            continue;
        // Validate URL
        let urlObj;
        try {
            urlObj = new URL(url);
        }
        catch {
            continue; // Skip invalid URLs
        }
        // Check if domain is allowed
        if (!validatedAllowedDomains.includes(urlObj.hostname)) {
            continue;
        }
        // Check exclude patterns
        if (excludeRegexes.some(regex => regex.test(url))) {
            continue;
        }
        // Check include patterns
        if (includeRegexes.length > 0 && !includeRegexes.some(regex => regex.test(url))) {
            continue;
        }
        // Check robots.txt
        if (respectRobotsTxt && !isAllowedByRobots(url, robotsRules)) {
            console.error(`[Crawler] Skipping ${url} (disallowed by robots.txt)`);
            continue;
        }
        // Fetch the page
        try {
            const result = await peel(url, {
                ...peelOptions,
                format: 'markdown',
            });
            // Deduplication: compute content fingerprint
            let fingerprint;
            if (deduplication) {
                fingerprint = createHash('sha256').update(result.content).digest('hex');
                if (contentFingerprints.has(fingerprint)) {
                    // Skip duplicate content
                    continue;
                }
                contentFingerprints.add(fingerprint);
            }
            const crawlResult = {
                url: result.url,
                title: result.title,
                markdown: result.content,
                links: result.links,
                depth,
                parent,
                elapsed: result.elapsed,
            };
            if (fingerprint) {
                crawlResult.fingerprint = fingerprint;
            }
            results.push(crawlResult);
            // Call progress callback
            if (onProgress) {
                onProgress({
                    crawled: results.length,
                    queued: queue.length,
                    failed: failedCount,
                    currentUrl: url,
                    elapsed: Date.now() - crawlStartTime,
                });
            }
            // Add discovered links to queue
            if (depth < validatedMaxDepth) {
                for (const link of result.links) {
                    if (!visited.has(link)) {
                        queue.push({
                            url: link,
                            depth: depth + 1,
                            parent: url,
                        });
                    }
                }
            }
            // Rate limiting
            if (results.length < validatedMaxPages) {
                await new Promise(resolve => setTimeout(resolve, effectiveRateLimit));
            }
        }
        catch (error) {
            // Log error and continue
            failedCount++;
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[Crawler] Failed to fetch ${url}: ${errorMessage}`);
            results.push({
                url,
                title: '',
                markdown: '',
                links: [],
                depth,
                parent,
                elapsed: 0,
                error: errorMessage,
            });
            // Call progress callback even for failed pages
            if (onProgress) {
                onProgress({
                    crawled: results.length,
                    queued: queue.length,
                    failed: failedCount,
                    currentUrl: url,
                    elapsed: Date.now() - crawlStartTime,
                });
            }
        }
    }
    return results;
}
//# sourceMappingURL=crawler.js.map