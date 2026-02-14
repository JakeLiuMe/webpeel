/**
 * Domain URL mapping
 * Combines sitemap discovery with link crawling to discover all URLs on a domain
 */

import { discoverSitemap } from './sitemap.js';
import { peel } from '../index.js';

export interface MapOptions {
  /** Include sitemap URLs (default: true) */
  useSitemap?: boolean;
  /** Crawl the homepage for additional links (default: true) */
  crawlHomepage?: boolean;
  /** Maximum URLs to discover (default: 5000) */
  maxUrls?: number;
  /** Timeout per request in ms (default: 10000) */
  timeout?: number;
  /** Include URL patterns matching these regexes only */
  includePatterns?: string[];
  /** Exclude URL patterns matching these regexes */
  excludePatterns?: string[];
}

export interface MapResult {
  /** All discovered URLs (deduplicated) */
  urls: string[];
  /** Sitemap URLs used */
  sitemapUrls: string[];
  /** Total URLs discovered */
  total: number;
  /** Time elapsed in ms */
  elapsed: number;
}

export async function mapDomain(startUrl: string, options: MapOptions = {}): Promise<MapResult> {
  const startTime = Date.now();
  const {
    useSitemap = true,
    crawlHomepage = true,
    maxUrls = 5000,
    timeout = 10000,
    includePatterns = [],
    excludePatterns = [],
  } = options;

  const urlObj = new URL(startUrl);
  const domain = urlObj.hostname;
  const allUrls = new Set<string>();
  let sitemapUrls: string[] = [];

  // Compile filter patterns
  const includeRegexes = includePatterns.map(p => new RegExp(p));
  const excludeRegexes = excludePatterns.map(p => new RegExp(p));

  function shouldInclude(url: string): boolean {
    if (excludeRegexes.some(r => r.test(url))) return false;
    if (includeRegexes.length > 0 && !includeRegexes.some(r => r.test(url))) return false;
    return true;
  }

  // Step 1: Sitemap discovery
  if (useSitemap) {
    const sitemap = await discoverSitemap(domain, { timeout, maxUrls });
    sitemapUrls = sitemap.sitemapUrls;
    for (const entry of sitemap.urls) {
      if (allUrls.size >= maxUrls) break;
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
        if (allUrls.size >= maxUrls) break;
        try {
          const linkUrl = new URL(link);
          if (linkUrl.hostname === domain && shouldInclude(link)) {
            allUrls.add(link);
          }
        } catch { /* skip invalid URLs */ }
      }
    } catch { /* skip homepage crawl errors */ }
  }

  return {
    urls: Array.from(allUrls).sort(),
    sitemapUrls,
    total: allUrls.size,
    elapsed: Date.now() - startTime,
  };
}
