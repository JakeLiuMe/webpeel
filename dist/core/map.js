/**
 * Domain URL mapping
 * Combines sitemap discovery with link crawling to discover all URLs on a domain
 */
import { discoverSitemap } from './sitemap.js';
import { peel } from '../index.js';
export async function mapDomain(startUrl, options = {}) {
    const startTime = Date.now();
    const { useSitemap = true, crawlHomepage = true, maxUrls = 5000, timeout = 10000, includePatterns = [], excludePatterns = [], } = options;
    const urlObj = new URL(startUrl);
    const domain = urlObj.hostname;
    const allUrls = new Set();
    let sitemapUrls = [];
    // Compile filter patterns
    const includeRegexes = includePatterns.map(p => new RegExp(p));
    const excludeRegexes = excludePatterns.map(p => new RegExp(p));
    function shouldInclude(url) {
        if (excludeRegexes.some(r => r.test(url)))
            return false;
        if (includeRegexes.length > 0 && !includeRegexes.some(r => r.test(url)))
            return false;
        return true;
    }
    // Step 1: Sitemap discovery
    if (useSitemap) {
        const sitemap = await discoverSitemap(domain, { timeout, maxUrls });
        sitemapUrls = sitemap.sitemapUrls;
        for (const entry of sitemap.urls) {
            if (allUrls.size >= maxUrls)
                break;
            if (shouldInclude(entry.url)) {
                allUrls.add(entry.url);
            }
        }
    }
    // Step 2: Crawl homepage for additional links
    if (crawlHomepage && allUrls.size < maxUrls) {
        try {
            const result = await peel(startUrl, { timeout });
            for (const link of result.links) {
                if (allUrls.size >= maxUrls)
                    break;
                try {
                    const linkUrl = new URL(link);
                    if (linkUrl.hostname === domain && shouldInclude(link)) {
                        allUrls.add(link);
                    }
                }
                catch { /* skip invalid URLs */ }
            }
        }
        catch { /* skip homepage crawl errors */ }
    }
    return {
        urls: Array.from(allUrls).sort(),
        sitemapUrls,
        total: allUrls.size,
        elapsed: Date.now() - startTime,
    };
}
//# sourceMappingURL=map.js.map