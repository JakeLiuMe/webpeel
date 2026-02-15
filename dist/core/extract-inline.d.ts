/**
 * Inline structured extraction using BYOK LLM
 *
 * After fetching page content, pass it + a JSON schema + optional prompt
 * to an LLM and get back structured JSON matching the schema.
 *
 * Supports OpenAI, Anthropic, and Google (same BYOK pattern as /v1/answer).
 */
export type LLMProvider = 'openai' | 'anthropic' | 'google';
export interface InlineExtractOptions {
    /** JSON Schema describing the desired output structure */
    schema?: Record<string, any>;
    /** Natural language prompt describing what to extract */
    prompt?: string;
    /** LLM provider (required) */
    llmProvider: LLMProvider;
    /** LLM API key — BYOK (required) */
    llmApiKey: string;
    /** LLM model name (optional — uses provider default) */
    llmModel?: string;
}
export interface InlineExtractResult {
    /** Extracted structured data */
    data: Record<string, any>;
    /** Tokens consumed */
    tokensUsed: {
        input: number;
        output: number;
    };
}
/**
 * Extract structured JSON from page content using an LLM (BYOK).
 *
 * @param content - Page content (markdown or text)
 * @param options - Extraction options including schema, prompt, and LLM credentials
 * @returns Extracted structured data + token usage
 */
export declare function extractInlineJson(content: string, options: InlineExtractOptions): Promise<InlineExtractResult>;
//# sourceMappingURL=extract-inline.d.ts.map