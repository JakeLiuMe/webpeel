/**
 * Route-level HTTP verification for selective evidence aggregation.
 *
 * Purpose:
 * - verify the real HTTP boundary for /v1/ask and /v1/search/smart
 * - ensure the selective-evidence system is actually wired into responses/prompts
 * - keep tests deterministic (all network/LLM calls mocked)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createAskRouter } from '../server/routes/ask.js';
import { createSmartSearchRouter } from '../server/routes/smart-search/index.js';
import { createDeepResearchRouter } from '../server/routes/deep-research.js';
import { InMemoryAuthStore } from '../server/auth-store.js';

vi.mock('../index.js', () => ({
  peel: vi.fn(),
}));

vi.mock('../core/search-provider.js', () => ({
  getBestSearchProvider: vi.fn(),
  getSearchProvider: vi.fn(),
}));

vi.mock('../core/quick-answer.js', () => ({
  quickAnswer: vi.fn(),
}));

vi.mock('../server/routes/smart-search/llm.js', () => ({
  callLLMQuick: vi.fn(),
  sanitizeSearchQuery: vi.fn((q: string) => q),
  PROMPT_INJECTION_DEFENSE: '',
}));

// Route-level HTTP verification only; deep-research core is covered separately
vi.mock('../core/deep-research.js', () => ({
  runDeepResearch: vi.fn(),
}));

import { peel } from '../index.js';
import { getBestSearchProvider } from '../core/search-provider.js';
import { quickAnswer } from '../core/quick-answer.js';
import { callLLMQuick } from '../server/routes/smart-search/llm.js';
import { runDeepResearch } from '../core/deep-research.js';

const mockPeel = vi.mocked(peel);
const mockGetBestSearchProvider = vi.mocked(getBestSearchProvider);
const mockQuickAnswer = vi.mocked(quickAnswer);
const mockCallLLMQuick = vi.mocked(callLLMQuick);
const mockRunDeepResearch = vi.mocked(runDeepResearch);

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { keyInfo: { accountId: 'test-user', key: 'wp_test' } };
    req.requestId = 'test-request-id';
    next();
  });
  app.use(createAskRouter());
  app.use(createSmartSearchRouter(new InMemoryAuthStore()));
  app.use(createDeepResearchRouter());
  return app;
}

function setupSearch(results: Array<{ url: string; title: string; snippet: string }>) {
  mockGetBestSearchProvider.mockReturnValue({
    provider: { searchWeb: vi.fn().mockResolvedValue(results) },
    apiKey: undefined,
  } as any);
}

describe('selective evidence HTTP verification', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  it('POST /v1/ask returns selective-evidence metadata and keeps the authoritative answer', async () => {
    setupSearch([
      {
        url: 'https://openai.com/pricing',
        title: 'OpenAI Pricing',
        snippet: 'Official GPT-4 pricing',
      },
      {
        url: 'https://randomblog.xyz/openai-pricing',
        title: 'Random blog pricing post',
        snippet: 'Unofficial summary',
      },
    ]);

    mockPeel.mockImplementation(async (url: string) => {
      if (url.includes('openai.com')) {
        return {
          url,
          title: 'OpenAI Pricing',
          content: 'GPT-4 costs $30 per 1M input tokens and $60 per 1M output tokens. GPT-4o costs $2.50 per 1M input tokens.',
          metadata: {},
          freshness: {},
        } as any;
      }
      return {
        url,
        title: 'Blog Pricing Summary',
        content: 'I think OpenAI pricing is pretty expensive compared to others.',
        metadata: {},
        freshness: {},
      } as any;
    });

    mockQuickAnswer.mockImplementation(({ url }: any) => {
      if (String(url).includes('openai.com')) {
        return {
          answer: 'GPT-4 costs $30 per 1M input tokens and $60 per 1M output tokens.',
          confidence: 0.82,
        } as any;
      }
      return {
        answer: 'A blog claims OpenAI pricing is expensive.',
        confidence: 0.78,
      } as any;
    });

    const res = await request(app)
      .post('/v1/ask')
      .send({ question: 'OpenAI GPT-4 pricing per token', sources: 2 });

    expect(res.status).toBe(200);
    expect(res.body.answer).toMatch(/\$30/);
    expect(res.body.evidencePolicy).toBe('factual');
    expect(res.body.evidenceSourcesUsed).toBeGreaterThanOrEqual(1);
    expect(res.body.sources[0].url).toContain('openai.com');
  });

  it('POST /v1/search/smart passes structured evidence into synthesis over the real HTTP route', async () => {
    setupSearch([
      {
        url: 'https://openai.com/pricing',
        title: 'OpenAI Pricing',
        snippet: 'Official API pricing',
      },
      {
        url: 'https://example.com/guide',
        title: 'Guide to OpenAI pricing',
        snippet: 'Third-party guide',
      },
    ]);

    mockPeel.mockImplementation(async (url: string) => {
      if (url.includes('openai.com')) {
        return {
          url,
          title: 'OpenAI Pricing',
          content: '## GPT-4 Pricing\n\n| Model | Input | Output |\n|-------|-------|--------|\n| GPT-4 | $30/1M | $60/1M |\n| GPT-4o | $2.50/1M | $10/1M |',
          metadata: { published: '2026-04-01' },
          structured: { pricing: true },
          fetchTimeMs: 120,
        } as any;
      }
      return {
        url,
        title: 'Third-party guide',
        content: 'Developers often compare OpenAI pricing across models and workloads.',
        metadata: {},
        fetchTimeMs: 100,
      } as any;
    });

    mockCallLLMQuick.mockResolvedValue('**GPT-4** costs **$30/1M input** and **$60/1M output** [1].');

    const res = await request(app)
      .post('/v1/search/smart')
      .send({ q: 'OpenAI GPT-4 pricing per token' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.type).toBe('general');
    expect(res.body.data.answer).toMatch(/\$30\/1M input/);

    const llmPrompt = mockCallLLMQuick.mock.calls[0]?.[0] ?? '';
    expect(llmPrompt).toContain('[structured]');
    expect(llmPrompt).toContain('URL: https://openai.com/pricing');
  });

  it('POST /v1/search/smart uses official snippet fallback and downgrades confidence when official fetch is blocked', async () => {
    setupSearch([
      {
        url: 'https://openai.com/api/pricing',
        title: 'API Pricing - OpenAI',
        snippet: 'Official pricing page: GPT-4 costs $30.00 per million input tokens and $60.00 per million output tokens.',
      },
      {
        url: 'https://pricepertoken.com/pricing-page/model/openai-gpt-4',
        title: 'GPT 4 API Pricing',
        snippet: 'Third-party pricing summary',
      },
    ]);

    mockPeel.mockImplementation(async (url: string) => {
      if (url.includes('openai.com')) {
        return {
          url,
          title: 'Text Document',
          content: '# ⚠️ openai.com — Access Blocked\n\nThis site uses advanced bot protection and blocked our request.',
          metadata: {},
          fetchTimeMs: 120,
        } as any;
      }
      return {
        url,
        title: 'GPT 4 API Pricing',
        content: 'GPT-4 was released in 2023. Pricing starts at $30.00 per million input tokens and $60.00 per million output tokens.',
        metadata: {},
        fetchTimeMs: 100,
      } as any;
    });

    mockCallLLMQuick.mockResolvedValue('Official snippet indicates GPT-4 costs **$30.00** input and **$60.00** output per 1M tokens [1].');

    const res = await request(app)
      .post('/v1/search/smart')
      .send({ q: 'OpenAI GPT-4 pricing per token' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.answer).toMatch(/\$30\.00/);
    expect(res.body.data.confidence).toBe('MEDIUM');

    const llmPrompt = mockCallLLMQuick.mock.calls[0]?.[0] ?? '';
    expect(llmPrompt).toContain('[snippet]');
    expect(llmPrompt).not.toContain('Access Blocked');
    expect(llmPrompt).toContain('URL: https://openai.com/api/pricing');
  });

  it('POST /v1/deep-research works over HTTP and returns a report payload', async () => {
    mockRunDeepResearch.mockResolvedValue({
      report: 'Executive Summary\n\nOpenAI pricing is led by official pricing docs [1].\n\n**Confidence: HIGH**',
      citations: [
        {
          index: 1,
          title: 'OpenAI Pricing',
          url: 'https://openai.com/pricing',
          snippet: 'Official pricing',
          relevanceScore: 0.91,
        },
      ],
      sourcesUsed: 1,
      roundsCompleted: 1,
      totalSearchQueries: 1,
      llmProvider: 'openai',
      tokensUsed: { input: 100, output: 50 },
      elapsed: 250,
    } as any);

    const res = await request(app)
      .post('/v1/deep-research')
      .send({
        question: 'What is OpenAI GPT-4 pricing?',
        llm: { provider: 'openai', apiKey: 'sk-test' },
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.report).toMatch(/Confidence: HIGH/);
    expect(res.body.citations[0].url).toBe('https://openai.com/pricing');
  });
});
