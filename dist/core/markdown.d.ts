/**
 * HTML to Markdown conversion with smart cleanup
 */
/**
 * Extract content matching a CSS selector
 * Returns filtered HTML or full HTML if selector matches nothing
 */
export declare function selectContent(html: string, selector: string, exclude?: string[]): string;
/**
 * Convert HTML to clean, readable Markdown
 */
export declare function htmlToMarkdown(html: string): string;
/**
 * Convert HTML to plain text (strip all formatting)
 */
export declare function htmlToText(html: string): string;
/**
 * Estimate token count (very rough approximation)
 * Rule of thumb: 1 token ≈ 4 characters for English text
 */
export declare function estimateTokens(text: string): number;
//# sourceMappingURL=markdown.d.ts.map