/**
 * AI-powered content summarization using OpenAI-compatible APIs
 */
export interface SummarizeOptions {
    /** OpenAI-compatible API base URL (default: https://api.openai.com/v1) */
    apiBase?: string;
    /** API key for the LLM */
    apiKey: string;
    /** Model to use (default: gpt-4o-mini) */
    model?: string;
    /** Max length of summary in words */
    maxWords?: number;
}
/**
 * Summarize content using an OpenAI-compatible LLM API
 */
export declare function summarizeContent(content: string, options: SummarizeOptions): Promise<string>;
//# sourceMappingURL=summarize.d.ts.map