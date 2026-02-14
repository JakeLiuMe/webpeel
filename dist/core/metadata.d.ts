/**
 * Extract structured metadata from HTML
 */
import type { PageMetadata } from '../types.js';
/**
 * Extract all links from page
 * Returns absolute URLs, deduplicated
 */
export declare function extractLinks(html: string, baseUrl: string): string[];
/**
 * Extract all images from HTML
 * Resolves relative URLs to absolute and extracts metadata
 *
 * @param html - HTML to extract images from
 * @param baseUrl - Base URL for resolving relative paths
 * @returns Array of image information, deduplicated by src
 */
export declare function extractImages(html: string, baseUrl: string): import('../types.js').ImageInfo[];
/**
 * Extract all metadata from HTML
 */
export declare function extractMetadata(html: string, _url: string): {
    title: string;
    metadata: PageMetadata;
};
//# sourceMappingURL=metadata.d.ts.map