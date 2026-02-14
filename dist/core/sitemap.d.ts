/**
 * Sitemap discovery and parsing
 * Discovers URLs from sitemap.xml files
 */
export interface SitemapUrl {
    url: string;
    lastmod?: string;
    changefreq?: string;
    priority?: number;
}
export interface SitemapResult {
    urls: SitemapUrl[];
    sitemapUrls: string[];
    elapsed: number;
}
/**
 * Discover all URLs from a domain's sitemap.xml
 * Handles sitemap index files (recursive), gzip compression, and common locations
 */
export declare function discoverSitemap(domain: string, options?: {
    timeout?: number;
    maxUrls?: number;
}): Promise<SitemapResult>;
//# sourceMappingURL=sitemap.d.ts.map