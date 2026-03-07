/**
 * Link extraction from HTML
 * Extracts all <a href="..."> tags and returns deduplicated { url, text } pairs
 */
import { load } from 'cheerio';

export interface ExtractedLink {
  url: string;
  text: string;
}

/**
 * Extract all links from an HTML string.
 * Returns a deduplicated list of { url, text } pairs, excluding anchors,
 * javascript: hrefs, mailto:, and tel: links.
 */
export function extractLinks(html: string, baseUrl?: string): ExtractedLink[] {
  if (!html) return [];

  const $ = load(html);
  const seen = new Set<string>();
  const links: ExtractedLink[] = [];

  $('a[href]').each((_i, el) => {
    const href = $(el).attr('href') || '';
    if (
      !href ||
      href.startsWith('#') ||
      href.startsWith('javascript:') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:') ||
      href.startsWith('data:')
    ) {
      return;
    }

    let url = href;
    // Resolve relative URLs when baseUrl is provided
    if (baseUrl && !href.match(/^https?:\/\//)) {
      try {
        url = new URL(href, baseUrl).href;
      } catch {
        return; // Skip unresolvable relative URLs
      }
    }

    if (!seen.has(url)) {
      seen.add(url);
      const text = $(el).text().trim().replace(/\s+/g, ' ');
      links.push({ url, text });
    }
  });

  return links;
}
