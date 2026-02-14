/**
 * Extract structured metadata from HTML
 */
import * as cheerio from 'cheerio';
/**
 * Extract page title using fallback chain:
 * og:title → twitter:title → title tag → h1
 */
function extractTitle($) {
    // Try Open Graph title
    let title = $('meta[property="og:title"]').attr('content');
    if (title)
        return title.trim();
    // Try Twitter title
    title = $('meta[name="twitter:title"]').attr('content');
    if (title)
        return title.trim();
    // Try title tag
    title = $('title').text();
    if (title)
        return title.trim();
    // Fallback to first h1
    title = $('h1').first().text();
    if (title)
        return title.trim();
    return '';
}
/**
 * Extract page description using fallback chain:
 * og:description → twitter:description → meta description
 */
function extractDescription($) {
    // Try Open Graph description
    let desc = $('meta[property="og:description"]').attr('content');
    if (desc)
        return desc.trim();
    // Try Twitter description
    desc = $('meta[name="twitter:description"]').attr('content');
    if (desc)
        return desc.trim();
    // Try standard meta description
    desc = $('meta[name="description"]').attr('content');
    if (desc)
        return desc.trim();
    return undefined;
}
/**
 * Extract author from meta tags
 */
function extractAuthor($) {
    // Try article:author
    let author = $('meta[property="article:author"]').attr('content');
    if (author)
        return author.trim();
    // Try author meta tag
    author = $('meta[name="author"]').attr('content');
    if (author)
        return author.trim();
    return undefined;
}
/**
 * Extract published date from meta tags
 * Returns ISO 8601 date string if found
 */
function extractPublished($) {
    // Try article:published_time
    let published = $('meta[property="article:published_time"]').attr('content');
    if (published) {
        try {
            return new Date(published).toISOString();
        }
        catch {
            // Invalid date, continue
        }
    }
    // Try datePublished schema.org
    published = $('meta[itemprop="datePublished"]').attr('content');
    if (published) {
        try {
            return new Date(published).toISOString();
        }
        catch {
            // Invalid date, continue
        }
    }
    return undefined;
}
/**
 * Extract Open Graph image URL
 */
function extractImage($) {
    // Try og:image
    let image = $('meta[property="og:image"]').attr('content');
    if (image)
        return image.trim();
    // Try twitter:image
    image = $('meta[name="twitter:image"]').attr('content');
    if (image)
        return image.trim();
    return undefined;
}
/**
 * Extract canonical URL
 */
function extractCanonical($) {
    const canonical = $('link[rel="canonical"]').attr('href');
    if (canonical)
        return canonical.trim();
    // Fallback to og:url
    const ogUrl = $('meta[property="og:url"]').attr('content');
    if (ogUrl)
        return ogUrl.trim();
    return undefined;
}
/**
 * Extract all links from page
 * Returns absolute URLs, deduplicated
 */
export function extractLinks(html, baseUrl) {
    const $ = cheerio.load(html);
    const links = new Set();
    $('a[href]').each((_, elem) => {
        const href = $(elem).attr('href');
        if (!href)
            return;
        try {
            const absoluteUrl = new URL(href, baseUrl);
            // SECURITY: Only allow HTTP and HTTPS protocols
            if (!['http:', 'https:'].includes(absoluteUrl.protocol)) {
                return;
            }
            // Skip anchor-only links (e.g., href="#section")
            const baseNormalized = new URL(baseUrl);
            if (absoluteUrl.hash &&
                absoluteUrl.origin === baseNormalized.origin &&
                absoluteUrl.pathname === baseNormalized.pathname &&
                absoluteUrl.search === baseNormalized.search) {
                return;
            }
            links.add(absoluteUrl.href);
        }
        catch {
            // Invalid URL, skip
        }
    });
    return Array.from(links).sort();
}
/**
 * Extract all images from HTML
 * Resolves relative URLs to absolute and extracts metadata
 *
 * @param html - HTML to extract images from
 * @param baseUrl - Base URL for resolving relative paths
 * @returns Array of image information, deduplicated by src
 */
export function extractImages(html, baseUrl) {
    const $ = cheerio.load(html);
    const images = new Map();
    // Extract <img> tags
    $('img[src]').each((_, elem) => {
        const $img = $(elem);
        const src = $img.attr('src');
        if (!src)
            return;
        try {
            const absoluteUrl = new URL(src, baseUrl);
            // SECURITY: Only allow HTTP and HTTPS protocols
            if (!['http:', 'https:'].includes(absoluteUrl.protocol)) {
                return;
            }
            const alt = $img.attr('alt') || '';
            const title = $img.attr('title');
            const widthStr = $img.attr('width');
            const heightStr = $img.attr('height');
            const width = widthStr ? parseInt(widthStr, 10) : undefined;
            const height = heightStr ? parseInt(heightStr, 10) : undefined;
            const imageInfo = {
                src: absoluteUrl.href,
                alt,
                title,
                width: width && !isNaN(width) ? width : undefined,
                height: height && !isNaN(height) ? height : undefined,
            };
            // Deduplicate by src
            images.set(absoluteUrl.href, imageInfo);
        }
        catch {
            // Invalid URL, skip
        }
    });
    // Extract <picture><source> tags
    $('picture source[srcset]').each((_, elem) => {
        const $source = $(elem);
        const srcset = $source.attr('srcset');
        if (!srcset)
            return;
        // Parse srcset (format: "url 1x, url 2x" or "url 100w, url 200w")
        const srcsetParts = srcset.split(',').map(s => s.trim());
        srcsetParts.forEach(part => {
            const url = part.split(/\s+/)[0];
            if (!url)
                return;
            try {
                const absoluteUrl = new URL(url, baseUrl);
                // SECURITY: Only allow HTTP and HTTPS protocols
                if (!['http:', 'https:'].includes(absoluteUrl.protocol)) {
                    return;
                }
                // Try to get alt from parent picture's img
                const alt = $source.closest('picture').find('img').attr('alt') || '';
                const imageInfo = {
                    src: absoluteUrl.href,
                    alt,
                };
                images.set(absoluteUrl.href, imageInfo);
            }
            catch {
                // Invalid URL, skip
            }
        });
    });
    // Extract CSS background images
    $('[style*="background"]').each((_, elem) => {
        const style = $(elem).attr('style');
        if (!style)
            return;
        // Match url() in CSS
        const urlMatches = style.match(/url\(['"]?([^'")\s]+)['"]?\)/g);
        if (!urlMatches)
            return;
        urlMatches.forEach(match => {
            const url = match.replace(/url\(['"]?([^'")\s]+)['"]?\)/, '$1');
            if (!url)
                return;
            try {
                const absoluteUrl = new URL(url, baseUrl);
                // SECURITY: Only allow HTTP and HTTPS protocols
                if (!['http:', 'https:'].includes(absoluteUrl.protocol)) {
                    return;
                }
                const imageInfo = {
                    src: absoluteUrl.href,
                    alt: '', // Background images don't have alt text
                };
                images.set(absoluteUrl.href, imageInfo);
            }
            catch {
                // Invalid URL, skip
            }
        });
    });
    return Array.from(images.values());
}
/**
 * Extract all metadata from HTML
 */
export function extractMetadata(html, _url) {
    const $ = cheerio.load(html);
    const title = extractTitle($);
    const metadata = {
        description: extractDescription($),
        author: extractAuthor($),
        published: extractPublished($),
        image: extractImage($),
        canonical: extractCanonical($),
    };
    return { title, metadata };
}
//# sourceMappingURL=metadata.js.map