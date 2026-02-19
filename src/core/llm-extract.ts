/**
 * LLM-based extraction: sends markdown/text content to an LLM
 * with instructions to extract structured data.
 *
 * Supports OpenAI-compatible APIs (OpenAI, Anthropic via proxy, local models).
 */

export interface LLMExtractionOptions {
  content: string;        // The markdown/text content to extract from
  instruction?: string;   // User instruction (e.g., "extract hotel names and prices")
  schema?: object;        // Optional JSON schema for structured output
  apiKey?: string;        // API key (or from OPENAI_API_KEY env)
  baseUrl?: string;       // API base URL (default: https://api.openai.com/v1)
  model?: string;         // Model name (default: gpt-4o-mini for cost efficiency)
  maxTokens?: number;     // Max response tokens (default: 4000)
}

export interface LLMExtractionResult {
  items: Array<Record<string, any>>;  // Extracted items
  tokensUsed: { input: number; output: number };
  model: string;
  cost?: number;          // Estimated cost in USD
}

// Cost per 1M tokens (input, output) for known models
const MODEL_COSTS: Record<string, [number, number]> = {
  'gpt-4o-mini': [0.15, 0.60],
  'gpt-4o': [2.50, 10.0],
};

const SYSTEM_PROMPT = `You are a data extraction assistant. Extract structured data from the provided web content.
Return a JSON array of objects. Each object represents one item/listing found on the page.
Always include these fields when available: title, price, link, rating, description, image.
If the user provides additional instructions, follow them.
Return ONLY valid JSON — no markdown, no explanation, just the array.`;

/**
 * Build the user message from content + optional instruction + optional schema.
 */
export function buildUserMessage(content: string, instruction?: string, schema?: object): string {
  // Truncate content if over 100K chars
  const truncated = content.length > 100_000 ? content.slice(0, 50_000) : content;

  let msg = `Here is the web content to extract data from:\n\n${truncated}`;

  if (schema) {
    msg += `\n\nExtract data matching this schema: ${JSON.stringify(schema, null, 2)}`;
  }

  if (instruction) {
    msg += `\n\nAdditional instruction: ${instruction}`;
  }

  return msg;
}

/**
 * Calculate estimated cost in USD for a given model and token counts.
 */
export function estimateCost(model: string, inputTokens: number, outputTokens: number): number | undefined {
  // Normalize model key (strip version suffixes like -2024-11-20 for matching)
  const key = Object.keys(MODEL_COSTS).find(k => model.startsWith(k) || model === k);
  if (!key) return undefined;
  const [inputRate, outputRate] = MODEL_COSTS[key]!;
  return (inputTokens / 1_000_000) * inputRate + (outputTokens / 1_000_000) * outputRate;
}

/**
 * Parse the LLM response text into an items array.
 * Handles both `{ "items": [...] }` and `[...]` formats.
 */
export function parseItems(text: string): Array<Record<string, any>> {
  const trimmed = text.trim();

  // Try to parse as-is first
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Try to extract JSON from the text (sometimes LLMs add preamble despite instructions)
    const arrayMatch = trimmed.match(/\[[\s\S]*\]/);
    const objMatch = trimmed.match(/\{[\s\S]*\}/);
    if (arrayMatch) {
      try { parsed = JSON.parse(arrayMatch[0]); } catch { /* fall through */ }
    } else if (objMatch) {
      try { parsed = JSON.parse(objMatch[0]); } catch { /* fall through */ }
    }
    if (parsed === undefined) {
      throw new Error(`Failed to parse LLM response as JSON: ${trimmed.slice(0, 200)}`);
    }
  }

  // Handle { items: [...] } or { data: [...] } or { results: [...] }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, any>;
    if (Array.isArray(obj['items'])) return obj['items'];
    if (Array.isArray(obj['data'])) return obj['data'];
    if (Array.isArray(obj['results'])) return obj['results'];
    // Single object — wrap in array
    return [obj];
  }

  // Handle bare array
  if (Array.isArray(parsed)) {
    return parsed;
  }

  return [];
}

/**
 * Extract structured data from content using an LLM.
 */
export async function extractWithLLM(options: LLMExtractionOptions): Promise<LLMExtractionResult> {
  const {
    content,
    instruction,
    schema,
    baseUrl = 'https://api.openai.com/v1',
    model = 'gpt-4o-mini',
    maxTokens = 4000,
  } = options;

  const apiKey = options.apiKey || process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error(
      'LLM extraction requires an API key.\n' +
      'Set OPENAI_API_KEY environment variable or use --llm-key <key>'
    );
  }

  const userMessage = buildUserMessage(content, instruction, schema);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status === 401) {
      throw new Error(`LLM API authentication failed (401). Check your API key.`);
    }
    if (response.status === 429) {
      throw new Error(`LLM API rate limit exceeded (429). Please wait and retry.`);
    }
    throw new Error(`LLM API error: HTTP ${response.status}${body ? ` — ${body.slice(0, 200)}` : ''}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
    model?: string;
  };

  const rawText = data.choices?.[0]?.message?.content ?? '';
  const items = parseItems(rawText);

  const inputTokens = data.usage?.prompt_tokens ?? 0;
  const outputTokens = data.usage?.completion_tokens ?? 0;
  const resolvedModel = data.model ?? model;
  const cost = estimateCost(resolvedModel, inputTokens, outputTokens);

  return {
    items,
    tokensUsed: { input: inputTokens, output: outputTokens },
    model: resolvedModel,
    cost,
  };
}
