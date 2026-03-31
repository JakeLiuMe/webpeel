/**
 * Tests for agent route — server-side synthesis path (Path B)
 *
 * Validates that POST /v1/agent returns cited answers using the server-side
 * LLM when no BYOK keys are provided, falling back to BM25 when LLM is
 * unavailable or fails.
 *
 * All network calls are mocked — no real HTTP requests.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Module mocks — use paths relative to THIS file that resolve to the same
// physical module the route file imports.
// ---------------------------------------------------------------------------

vi.mock('../index.js', () => ({
  peel: vi.fn(),
}));

vi.mock('../core/search-provider.js', () => ({
  getBestSearchProvider: vi.fn(),
}));

vi.mock('../core/quick-answer.js', () => ({
  quickAnswer: vi.fn(),
}));

vi.mock('../core/llm-provider.js', () => ({
  getDefaultLLMConfig: vi.fn(),
  callLLM: vi.fn(),
  isFreeTierLimitError: vi.fn().mockReturnValue(false),
}));

vi.mock('../core/prompt-guard.js', () => ({
  sanitizeForLLM: vi.fn((content: string) => ({
    content,
    injectionDetected: false,
    detectedPatterns: [],
  })),
  hardenSystemPrompt: vi.fn((prompt: string) => prompt),
  validateOutput: vi.fn(() => ({ clean: true, issues: [] })),
}));

vi.mock('../core/llm-extract.js', () => ({
  extractWithLLM: vi.fn(),
}));

// Mock webhooks — the route imports from a relative path
vi.mock('../server/routes/webhooks.js', () => ({
  sendWebhook: vi.fn().mockResolvedValue(undefined),
}));

// ---------------------------------------------------------------------------
// Imports — AFTER mocks
// ---------------------------------------------------------------------------

import { peel } from '../index.js';
import { getBestSearchProvider } from '../core/search-provider.js';
import { quickAnswer } from '../core/quick-answer.js';
import { getDefaultLLMConfig, callLLM } from '../core/llm-provider.js';
import { createAgentRouter } from '../server/routes/agent.js';
import express from 'express';
import request from 'supertest';

const mockPeel = vi.mocked(peel);
const mockGetBestSearchProvider = vi.mocked(getBestSearchProvider);
const mockQuickAnswer = vi.mocked(quickAnswer);
const mockGetDefaultLLMConfig = vi.mocked(getDefaultLLMConfig);
const mockCallLLM = vi.mocked(callLLM);

// ---------------------------------------------------------------------------
// Test app
// ---------------------------------------------------------------------------

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.auth = { keyInfo: { accountId: 'test-user' } };
    req.requestId = 'test-req-id';
    next();
  });
  app.use('/v1/agent', createAgentRouter());
  return app;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupSearch(results: Array<{ url: string; title: string; snippet: string }>) {
  mockGetBestSearchProvider.mockReturnValue({
    provider: {
      searchWeb: vi.fn().mockResolvedValue(results),
    },
    apiKey: undefined,
  } as any);
}

function setupPeel(pages: Array<{ url: string; title: string; content: string }>) {
  mockPeel.mockImplementation(async (url: string) => {
    const page = pages.find(p => p.url === url) || pages[0];
    return {
      url: page.url,
      title: page.title,
      content: page.content,
      tokens: 100,
      method: 'simple' as const,
      elapsed: 50,
      contentType: 'html' as const,
      quality: 0.9,
      fingerprint: 'abc',
      metadata: {},
      links: [],
    } as any;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /v1/agent — unified agent endpoint', () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp();
  });

  it('returns 400 when prompt is missing', async () => {
    const res = await request(app)
      .post('/v1/agent')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe('missing_prompt');
  });

  it('synthesises a cited answer via server-side LLM (Path B)', async () => {
    setupSearch([
      { url: 'https://example.com/pricing', title: 'Pricing Page', snippet: 'Plans start at $20/mo' },
      { url: 'https://example.com/faq', title: 'FAQ', snippet: 'Common questions' },
    ]);

    setupPeel([
      { url: 'https://example.com/pricing', title: 'Pricing Page', content: 'Basic plan costs $20/mo. Pro plan costs $50/mo.' },
      { url: 'https://example.com/faq', title: 'FAQ', content: 'Three plans: Basic, Pro, Enterprise.' },
    ]);

    mockGetDefaultLLMConfig.mockReturnValue({
      provider: 'ollama',
      endpoint: 'http://localhost:11434',
      apiKey: 'test-secret',
    });

    mockCallLLM.mockResolvedValue({
      text: 'Basic plan is $20/mo and Pro is $50/mo [1]. Three tiers available [2].',
      usage: { input: 200, output: 50 },
    });

    const res = await request(app)
      .post('/v1/agent')
      .send({ prompt: 'What are the pricing plans?' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.method).toBe('agent-synthesis');
    expect(res.body.answer).toContain('$20/mo');
    expect(res.body.citations).toEqual(expect.arrayContaining(['[1]', '[2]']));
    expect(res.body.sources).toHaveLength(2);
    expect(res.body.sources[0]).toEqual({
      url: 'https://example.com/pricing',
      title: 'Pricing Page',
      citedAs: '[1]',
    });
    expect(res.body.sources[1]).toEqual({
      url: 'https://example.com/faq',
      title: 'FAQ',
      citedAs: '[2]',
    });
    expect(res.body.tokensUsed).toBeGreaterThan(0);
    expect(res.body.elapsed).toBeGreaterThan(0);
  }, 10000);

  it('falls back to BM25 when server-side LLM fails', async () => {
    setupSearch([
      { url: 'https://example.com/page', title: 'Test', snippet: 'Test' },
    ]);

    setupPeel([
      { url: 'https://example.com/page', title: 'Test', content: 'The answer is 42.' },
    ]);

    mockGetDefaultLLMConfig.mockReturnValue({
      provider: 'ollama',
      endpoint: 'http://localhost:11434',
    });

    mockCallLLM.mockRejectedValue(new Error('Connection refused'));

    mockQuickAnswer.mockReturnValue({
      question: 'What is the answer?',
      answer: 'The answer is 42.',
      confidence: 0.8,
      passages: [],
      source: 'https://example.com/page',
      method: 'bm25' as const,
    });

    const res = await request(app)
      .post('/v1/agent')
      .send({ prompt: 'What is the answer?' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.method).toBe('agent-bm25');
    expect(res.body.answer).toBe('The answer is 42.');
    expect(res.body.citations).toEqual([]);
    expect(res.body.sources[0].citedAs).toBe('[1]');
  }, 10000);

  it('uses BM25 when nollm=true even if LLM is configured', async () => {
    setupSearch([
      { url: 'https://example.com/page', title: 'Test', snippet: 'Test' },
    ]);

    setupPeel([
      { url: 'https://example.com/page', title: 'Test', content: 'Content here.' },
    ]);

    mockQuickAnswer.mockReturnValue({
      question: 'Tell me about the topic',
      answer: 'Content here.',
      confidence: 0.7,
      passages: [],
      source: 'https://example.com/page',
      method: 'bm25' as const,
    });

    const res = await request(app)
      .post('/v1/agent')
      .send({ prompt: 'Tell me about the topic', nollm: true });

    expect(res.status).toBe(200);
    expect(res.body.method).toBe('agent-bm25');
    expect(mockGetDefaultLLMConfig).not.toHaveBeenCalled();
    expect(mockCallLLM).not.toHaveBeenCalled();
  }, 10000);

  it('falls back to BM25 when LLM returns empty text', async () => {
    setupSearch([
      { url: 'https://example.com/page', title: 'Test', snippet: 'Test' },
    ]);

    setupPeel([
      { url: 'https://example.com/page', title: 'Test', content: 'Page content.' },
    ]);

    mockGetDefaultLLMConfig.mockReturnValue({
      provider: 'ollama',
      endpoint: 'http://localhost:11434',
    });

    mockCallLLM.mockResolvedValue({
      text: '',
      usage: { input: 100, output: 0 },
    });

    mockQuickAnswer.mockReturnValue({
      question: 'What?',
      answer: 'Page content.',
      confidence: 0.6,
      passages: [],
      source: 'https://example.com/page',
      method: 'bm25' as const,
    });

    const res = await request(app)
      .post('/v1/agent')
      .send({ prompt: 'What?' });

    expect(res.status).toBe(200);
    expect(res.body.method).toBe('agent-bm25');
  }, 10000);

  it('strips <think> tags from Qwen/Ollama output', async () => {
    setupSearch([
      { url: 'https://example.com', title: 'Test', snippet: 'Test' },
    ]);

    setupPeel([
      { url: 'https://example.com', title: 'Test', content: 'Content' },
    ]);

    mockGetDefaultLLMConfig.mockReturnValue({
      provider: 'ollama',
      endpoint: 'http://localhost:11434',
    });

    mockCallLLM.mockResolvedValue({
      text: '<think>Let me analyze the sources...</think>The answer is clear from [1].',
      usage: { input: 100, output: 30 },
    });

    const res = await request(app)
      .post('/v1/agent')
      .send({ prompt: 'Test question' });

    expect(res.status).toBe(200);
    expect(res.body.method).toBe('agent-synthesis');
    expect(res.body.answer).toBe('The answer is clear from [1].');
    expect(res.body.answer).not.toContain('<think>');
    expect(res.body.citations).toEqual(['[1]']);
  }, 10000);

  it('returns consistent sources format with citedAs labels', async () => {
    setupSearch([
      { url: 'https://a.com', title: 'A', snippet: '' },
      { url: 'https://b.com', title: 'B', snippet: '' },
      { url: 'https://c.com', title: 'C', snippet: '' },
    ]);

    setupPeel([
      { url: 'https://a.com', title: 'A', content: 'Content A' },
      { url: 'https://b.com', title: 'B', content: 'Content B' },
      { url: 'https://c.com', title: 'C', content: 'Content C' },
    ]);

    mockGetDefaultLLMConfig.mockReturnValue({
      provider: 'ollama',
      endpoint: 'http://localhost:11434',
    });

    mockCallLLM.mockResolvedValue({
      text: 'Summary referencing [1] and [3].',
      usage: { input: 100, output: 20 },
    });

    const res = await request(app)
      .post('/v1/agent')
      .send({ prompt: 'Research query', sources: 3 });

    expect(res.status).toBe(200);
    expect(res.body.sources).toHaveLength(3);

    for (const source of res.body.sources) {
      expect(source).toHaveProperty('url');
      expect(source).toHaveProperty('title');
      expect(source).toHaveProperty('citedAs');
      expect(source.citedAs).toMatch(/^\[\d+\]$/);
    }
    expect(res.body.sources.map((s: any) => s.citedAs)).toEqual(['[1]', '[2]', '[3]']);
    expect(res.body.citations).toEqual(expect.arrayContaining(['[1]', '[3]']));
  }, 10000);

  it('returns no_sources error when search yields nothing', async () => {
    setupSearch([]);

    const res = await request(app)
      .post('/v1/agent')
      .send({ prompt: 'Something obscure' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe('no_sources');
  }, 10000);

  it('returns fetch_failed error when all fetches fail', async () => {
    setupSearch([
      { url: 'https://example.com', title: 'Test', snippet: 'Test' },
    ]);

    mockPeel.mockRejectedValue(new Error('Fetch failed'));

    const res = await request(app)
      .post('/v1/agent')
      .send({ prompt: 'Something' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe('fetch_failed');
  }, 10000);
});
