/**
 * POST /v1/agent
 *
 * Autonomous web agent — search → fetch → extract (LLM or BM25)
 *
 * User provides a natural language prompt. The agent:
 * 1. Searches the web for relevant URLs (or uses caller-provided URLs)
 * 2. Fetches the top pages in parallel (no browser escalation, 5s timeout)
 * 3a. If schema + llmApiKey provided: extracts structured data via LLM
 * 3b. Otherwise: uses BM25 sentence scoring for a free, LLM-free answer
 *
 * Returns: { success, data|answer, sources, method, elapsed, tokensUsed }
 *
 * Two modes:
 *   - agent-llm:  schema + llmApiKey → LLM extraction (BYOK)
 *   - agent-bm25: no LLM key → BM25 text answer (always free)
 *
 * 5-minute in-memory cache. Max 10 sources per request.
 */

import { Router, Request, Response } from 'express';
import { peel } from '../../index.js';
import { extractWithLLM } from '../../core/llm-extract.js';
import { getBestSearchProvider } from '../../core/search-provider.js';
import { quickAnswer } from '../../core/quick-answer.js';
import { createLogger } from '../../core/logger.js';
import crypto from 'crypto';

const log = createLogger('agent');

// ---------------------------------------------------------------------------
// In-memory result cache — 5-minute TTL
// ---------------------------------------------------------------------------

interface CacheEntry {
  result: Record<string, unknown>;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached(key: string): Record<string, unknown> | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.result;
}

function setCache(key: string, result: Record<string, unknown>): void {
  // GC: evict expired entries when over 100
  if (cache.size >= 100) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (v.expiresAt < now) cache.delete(k);
    }
  }
  cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL });
}

// ---------------------------------------------------------------------------
// Route factory
// ---------------------------------------------------------------------------

export function createAgentRouter(): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    const {
      prompt,
      schema,
      llmApiKey,
      llmProvider,
      llmModel,
      urls,
      sources: maxSources,
    } = req.body || {};

    // Validate required param
    if (!prompt?.trim()) {
      return res.status(400).json({
        success: false,
        error: {
          type: 'missing_prompt',
          message: 'Provide a prompt describing what you want to find',
          hint: 'POST /v1/agent { "prompt": "Find Stripe pricing plans" }',
          docs: 'https://webpeel.dev/docs/api-reference',
        },
        requestId: (req as any).requestId || crypto.randomUUID(),
      });
    }

    const startMs = Date.now();
    const numSources = Math.min(maxSources || 5, 10);
    const requestId = (req as any).requestId || crypto.randomUUID();

    // Cache check
    const cacheKey = `${prompt.trim()}:${JSON.stringify(schema || {})}`;
    const cached = getCached(cacheKey);
    if (cached) {
      return res.json({ ...cached, cached: true, requestId });
    }

    try {
      // -----------------------------------------------------------------------
      // Step 1: Resolve source URLs — use caller-provided or search the web
      // -----------------------------------------------------------------------
      let sourceUrls: Array<{ url: string; title?: string; snippet?: string }> = [];

      if (Array.isArray(urls) && urls.length > 0) {
        sourceUrls = (urls as string[]).map((u) => ({ url: u }));
      } else {
        log.info(`Searching web for: "${prompt}"`);
        const { provider, apiKey: searchApiKey } = getBestSearchProvider();
        let searchResults: Array<{ url: string; title: string; snippet: string }> = [];
        try {
          searchResults = await provider.searchWeb(prompt.trim(), {
            count: numSources,
            apiKey: searchApiKey,
          });
        } catch (err: any) {
          log.warn('Search failed:', err.message);
        }
        sourceUrls = searchResults.slice(0, numSources).map((r) => ({
          url: r.url,
          title: r.title,
          snippet: r.snippet,
        }));
      }

      if (sourceUrls.length === 0) {
        return res.json({
          success: false,
          error: {
            type: 'no_sources',
            message: 'Could not find relevant pages for this query',
          },
          prompt,
          elapsed: Date.now() - startMs,
          requestId,
        });
      }

      // -----------------------------------------------------------------------
      // Step 2: Fetch pages in parallel (HTTP only, no browser, 5s timeout)
      // -----------------------------------------------------------------------
      log.info(`Fetching ${sourceUrls.length} sources in parallel`);
      const PER_SOURCE_TIMEOUT_MS = 5000;

      const fetchPromises = sourceUrls.map(async (source) => {
        try {
          const result = await Promise.race([
            peel(source.url, {
              render: false,
              noEscalate: true,
              format: 'markdown',
              timeout: PER_SOURCE_TIMEOUT_MS,
              budget: 3000,
            }),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('per-source timeout')), PER_SOURCE_TIMEOUT_MS),
            ),
          ]);
          return {
            url: source.url,
            title: (result as any).title || source.title || '',
            content: ((result as any).content || '').slice(0, 15000),
            tokens: (result as any).tokens || 0,
          };
        } catch {
          return null;
        }
      });

      const fetchSettled = await Promise.allSettled(fetchPromises);
      const fetchResults = fetchSettled
        .map((r) => (r.status === 'fulfilled' ? r.value : null))
        .filter(Boolean) as Array<{ url: string; title: string; content: string; tokens: number }>;

      if (fetchResults.length === 0) {
        return res.json({
          success: false,
          error: {
            type: 'fetch_failed',
            message: 'Could not fetch any of the found pages',
          },
          prompt,
          sources: sourceUrls.map((s) => ({ url: s.url })),
          elapsed: Date.now() - startMs,
          requestId,
        });
      }

      // -----------------------------------------------------------------------
      // Step 3: Extract or answer
      // -----------------------------------------------------------------------
      const combinedContent = fetchResults
        .map((r) => `### ${r.title || r.url}\nURL: ${r.url}\n\n${r.content}`)
        .join('\n\n---\n\n');

      const totalTokens = fetchResults.reduce((sum, r) => sum + r.tokens, 0);

      let result: Record<string, unknown>;

      if (schema && llmApiKey) {
        // ── LLM extraction path ──────────────────────────────────────────────
        log.info('Using LLM extraction');

        const extracted = await extractWithLLM({
          content: combinedContent.slice(0, 30000),
          schema,
          llmApiKey,
          llmProvider: llmProvider || 'openai',
          llmModel,
          prompt: `Based on these web pages, ${prompt}`,
          url: fetchResults[0].url,
        });

        const llmTokensUsed =
          (extracted.tokensUsed?.input ?? 0) + (extracted.tokensUsed?.output ?? 0);

        result = {
          success: true,
          data: extracted.items,
          sources: fetchResults.map((r) => ({ url: r.url, title: r.title })),
          method: 'agent-llm',
          llm: {
            provider: extracted.provider || llmProvider || 'openai',
            model: extracted.model || llmModel || 'default',
          },
          tokensUsed: totalTokens + llmTokensUsed,
          elapsed: Date.now() - startMs,
          requestId,
        };
      } else {
        // ── BM25 text answer path (no LLM needed) ───────────────────────────
        log.info('Using BM25 text extraction');

        const qa = quickAnswer({
          question: prompt,
          content: combinedContent,
          maxPassages: 3,
          maxChars: 2000,
        });

        result = {
          success: true,
          answer: qa.answer || combinedContent.slice(0, 2000),
          confidence: qa.confidence ?? 0,
          sources: fetchResults.map((r) => ({ url: r.url, title: r.title })),
          method: 'agent-bm25',
          tokensUsed: totalTokens,
          elapsed: Date.now() - startMs,
          requestId,
        };
      }

      // Cache the result
      setCache(cacheKey, result);

      return res.json(result);
    } catch (err: any) {
      log.error('Agent error:', err.message);
      return res.status(500).json({
        success: false,
        error: {
          type: 'agent_error',
          message: err.message || 'An unexpected error occurred',
        },
        prompt,
        elapsed: Date.now() - startMs,
        requestId,
      });
    }
  });

  return router;
}
