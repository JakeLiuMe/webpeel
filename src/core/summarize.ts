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
 * Truncate content to roughly 4000 tokens (~16000 characters)
 * This leaves room for system prompt and response
 */
function truncateContent(content: string): string {
  const MAX_CHARS = 16000; // ~4000 tokens
  
  if (content.length <= MAX_CHARS) {
    return content;
  }
  
  // Truncate and add ellipsis
  return content.slice(0, MAX_CHARS) + '\n\n[Content truncated for summarization...]';
}

/**
 * Summarize content using an OpenAI-compatible LLM API
 */
export async function summarizeContent(
  content: string,
  options: SummarizeOptions
): Promise<string> {
  const {
    apiBase = 'https://api.openai.com/v1',
    apiKey,
    model = 'gpt-4o-mini',
    maxWords = 150,
  } = options;

  // Validate inputs
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error('API key is required for summarization');
  }

  if (!content || content.trim().length === 0) {
    throw new Error('Content is required for summarization');
  }

  // Truncate content to fit within token limits
  const truncatedContent = truncateContent(content);

  // Build the prompt
  const prompt = `Summarize the following web page content concisely in ${maxWords} words or fewer. Focus on the key information.

Content:
${truncatedContent}`;

  // Call the OpenAI-compatible API
  const apiUrl = `${apiBase.replace(/\/$/, '')}/chat/completions`;

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3, // Lower temperature for more focused summaries
        max_tokens: maxWords * 2, // Rough estimate: 1 word ≈ 1.5-2 tokens
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`LLM API error: HTTP ${response.status} - ${errorText}`);
    }

    const result = await response.json() as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
      error?: {
        message: string;
      };
    };

    // Check for API error
    if (result.error) {
      throw new Error(`LLM API error: ${result.error.message}`);
    }

    // Extract summary from response
    const summary = result.choices?.[0]?.message?.content?.trim();

    if (!summary) {
      throw new Error('LLM API returned empty response');
    }

    return summary;
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Summarization failed: ${error.message}`);
    }
    throw new Error('Summarization failed: Unknown error');
  }
}
