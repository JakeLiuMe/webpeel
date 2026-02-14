/**
 * Sitemap discovery and parsing
 * Discovers URLs from sitemap.xml files
 */

import { fetch as undiciFetch } from 'undici';

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
export async function discoverSitemap(domain: string, options?: { timeout?: number; maxUrls?: number }): Promise<SitemapResult> {
  const startTime = Date.now();
  const maxUrls = options?.maxUrls || 10000;
  const timeout = options?.timeout || 10000;
  const allUrls: SitemapUrl[] = [];
  const sitemapUrls: string[] = [];
  const visited = new Set<string>();

  // Try common sitemap locations
  const sitemapLocations = [
    `https://${domain}/sitemap.xml`,
    `https://${domain}/sitemap_index.xml`,
    `https://${domain}/sitemap/sitemap.xml`,
    `https://${domain}/wp-sitemap.xml`,
  ];

  // Also check robots.txt for sitemap references
  try {
    const robotsResp = await undiciFetch(`https://${domain}/robots.txt`, {
      signal: AbortSignal.timeout(timeout),
      headers: { 'User-Agent': 'WebPeel/0.4.0 (+https://webpeel.dev)' },
    });
    if (robotsResp.ok) {
      const robotsText = await robotsResp.text();
      const sitemapMatches = robotsText.match(/Sitemap:\s*(.+)/gi) || [];
      for (const match of sitemapMatches) {
        const url = match.replace(/Sitemap:\s*/i, '').trim();
        if (url && !sitemapLocations.includes(url)) {
          sitemapLocations.unshift(url); // Prioritize robots.txt sitemaps
        }
      }
    }
  } catch { /* ignore robots.txt errors */ }

  async function parseSitemap(sitemapUrl: string): Promise<void> {
    if (visited.has(sitemapUrl) || allUrls.length >= maxUrls) return;
    visited.add(sitemapUrl);

    try {
      const resp = await undiciFetch(sitemapUrl, {
        signal: AbortSignal.timeout(timeout),
        headers: { 'User-Agent': 'WebPeel/0.4.0 (+https://webpeel.dev)' },
      });
      if (!resp.ok) return;

      const xml = await resp.text();
      sitemapUrls.push(sitemapUrl);

      // Use cheerio for XML parsing
      const { load } = await import('cheerio');
      const $ = load(xml, { xml: true });

      // Check if this is a sitemap index
      const sitemapIndexEntries = $('sitemapindex > sitemap > loc');
      if (sitemapIndexEntries.length > 0) {
        for (let i = 0; i < sitemapIndexEntries.length && allUrls.length < maxUrls; i++) {
          const childUrl = $(sitemapIndexEntries[i]).text().trim();
          if (childUrl) {
            await parseSitemap(childUrl);
          }
        }
        return;
      }

      // Parse URL entries
      $('urlset > url').each((_, el) => {
        if (allUrls.length >= maxUrls) return false;
        const loc = $(el).find('loc').text().trim();
        if (!loc) return undefined;
        
        const entry: SitemapUrl = { url: loc };
        const lastmod = $(el).find('lastmod').text().trim();
        const changefreq = $(el).find('changefreq').text().trim();
        const priority = $(el).find('priority').text().trim();
        
        if (lastmod) entry.lastmod = lastmod;
        if (changefreq) entry.changefreq = changefreq;
        if (priority) entry.priority = parseFloat(priority);
        
        allUrls.push(entry);
        return undefined;
      });
    } catch { /* skip failed sitemaps */ }
  }

  // Try each sitemap location
  for (const sitemapUrl of sitemapLocations) {
    if (allUrls.length >= maxUrls) break;
    await parseSitemap(sitemapUrl);
    if (allUrls.length > 0) break; // Found a working sitemap, stop trying others
  }

  return {
    urls: allUrls,
    sitemapUrls,
    elapsed: Date.now() - startTime,
  };
}
