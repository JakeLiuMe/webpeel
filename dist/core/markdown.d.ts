/**
 * HTML to Markdown conversion with smart cleanup
 */
/**
 * Filter HTML by including or excluding specific tags/selectors
 * Applied BEFORE markdown conversion for precise content control
 *
 * @param html - HTML to filter
 * @param includeTags - Only keep content from these elements (e.g., ['article', 'main', '.content'])
 * @param excludeTags - Remove these elements (e.g., ['nav', 'footer', 'header', '.sidebar'])
 * @returns Filtered HTML
 */
export declare function filterByTags(html: string, includeTags?: string[], excludeTags?: string[]): string;
/**
 * Extract content matching a CSS selector
 * Returns filtered HTML or full HTML if selector matches nothing
 */
export declare function selectContent(html: string, selector: string, exclude?: string[]): string;
/**
 * Try to detect the main content area of a page.
 * Returns the main content HTML, or the full cleaned HTML if no main content detected.
 */
export declare function detectMainContent(html: string): {
    html: string;
    detected: boolean;
};
/**
 * Calculate content quality score (0-1)
 * Measures how clean and useful the extracted content is
 */
export declare function calculateQuality(content: string, originalHtml: string): number;
/**
 * Convert HTML to clean, readable Markdown
 * @param html - HTML to convert
 */
export declare function htmlToMarkdown(html: string, _options?: {
    raw?: boolean;
}): string;
/**
 * Convert HTML to plain text (strip all formatting)
 */
export declare function htmlToText(html: string): string;
/**
 * Estimate token count (very rough approximation)
 * Rule of thumb: 1 token ≈ 4 characters for English text
 */
export declare function estimateTokens(text: string): number;
/**
 * Truncate content to fit within a token budget
 * Intelligently preserves structure (headings, first paragraph)
 */
export declare function truncateToTokenBudget(content: string, maxTokens: number): string;
//# sourceMappingURL=markdown.d.ts.map