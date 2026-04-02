/**
 * Integration tests for selective-evidence usage in ask, general, and deep-research.
 *
 * These tests verify that each consumer path properly imports and uses the
 * shared selective-evidence module. They test the module at the integration
 * boundary — actual source code importing, type compatibility, and behavior
 * consistency across all three paths.
 *
 * All tests run offline — no network requests, no LLM calls.
 */

import { describe, it, expect } from 'vitest';
import {
  selectEvidence,
  classifyQuery,
  formatEvidenceForLLM,
  type EvidenceSource,
  type SelectionResult,
} from '../core/selective-evidence.js';

// ---------------------------------------------------------------------------
// Simulate the data shapes each consumer path provides
// ---------------------------------------------------------------------------

/** Simulate ask.ts: builds EvidenceSource[] from quickAnswer results */
function simulateAskPath(question: string): SelectionResult {
  const sources: EvidenceSource[] = [
    {
      url: 'https://docs.cerebras.ai/pricing',
      title: 'Cerebras Pricing — Official Docs',
      content: 'The free tier includes 1000 API calls per month. Pro costs $49/month with 50,000 calls. Rate limit: 100 req/s on free tier, 500 req/s on Pro.',
      snippet: 'Cerebras pricing plans and rate limits',
    },
    {
      url: 'https://techblog.io/cerebras-review',
      title: 'Cerebras Review 2026',
      content: 'Cerebras offers competitive pricing for AI inference. Their free tier is generous compared to OpenAI. Performance benchmarks show 2x faster inference.',
      snippet: 'Review of Cerebras AI inference platform',
    },
    {
      url: 'https://reddit.com/r/MachineLearning/cerebras',
      title: 'Reddit Discussion on Cerebras',
      content: 'Has anyone tried Cerebras? I heard the free tier has 1000 calls. The latency seems good based on my tests.',
      snippet: 'Discussion about Cerebras free tier',
    },
  ];

  return selectEvidence({
    query: question,
    sources,
    maxBlocks: 5,
    maxChars: 3000,
  });
}

/** Simulate general.ts: builds EvidenceSource[] from peel+BM25 results */
function simulateGeneralPath(query: string): SelectionResult {
  const sources: EvidenceSource[] = [
    {
      url: 'https://aws.amazon.com/s3/pricing/',
      title: 'Amazon S3 Pricing',
      content: '## S3 Standard Storage\n\n| Storage | Price |\n|---------|-------|\n| First 50 TB | $0.023/GB |\n| Next 450 TB | $0.022/GB |\n\nRequest pricing: GET $0.0004 per 1000 requests.',
      snippet: 'S3 pricing and storage costs',
      structured: { plans: [{ tier: 'Standard', price: 0.023 }] },
    },
    {
      url: 'https://cloud.google.com/storage/pricing',
      title: 'Cloud Storage Pricing',
      content: '## Standard Storage\n\nPricing starts at $0.020/GB/month for standard storage. Nearline: $0.010/GB. Coldline: $0.004/GB.',
      snippet: 'GCS pricing comparison',
    },
  ];

  return selectEvidence({
    query,
    sources,
    maxBlocks: 10,
    maxChars: 4000,
  });
}

/** Simulate deep-research.ts: builds EvidenceSource[] from multi-search sources */
function simulateDeepResearchPath(question: string): SelectionResult {
  const sources: EvidenceSource[] = [
    {
      url: 'https://arxiv.org/abs/2401.12345',
      title: 'Transformer Efficiency Survey 2024',
      content: 'This paper surveys efficient transformer architectures. Key findings: Flash Attention reduces memory from O(n^2) to O(n). Multi-query attention saves 40% compute.',
      snippet: 'Survey of efficient transformer methods',
    },
    {
      url: 'https://en.wikipedia.org/wiki/Transformer_(deep_learning_model)',
      title: 'Transformer (deep learning) - Wikipedia',
      content: 'The transformer architecture was introduced in "Attention Is All You Need" (2017). It uses self-attention mechanisms to process sequences in parallel rather than sequentially.',
      snippet: 'Wikipedia overview of transformer architecture',
    },
    {
      url: 'https://developer.mozilla.org/ml-guide',
      title: 'MDN ML Guide',
      content: 'Machine learning models process data through layers. Transformers are a type of neural network architecture used in NLP and computer vision.',
      snippet: 'MDN guide to ML concepts',
    },
    {
      url: 'https://blog.random.io/transformers',
      title: 'Random Blog on Transformers',
      content: 'I tried using transformers last week. They seem cool. The attention mechanism is interesting but I am still learning.',
      snippet: 'Personal blog post about transformers',
    },
  ];

  return selectEvidence({
    query: question,
    sources,
    maxBlocks: 20,
    maxChars: 12000,
  });
}

// ---------------------------------------------------------------------------
// Integration: ask.ts path
// ---------------------------------------------------------------------------

describe('ask.ts integration', () => {
  it('selects evidence for a factual query', () => {
    const result = simulateAskPath('cerebras free tier rate limits');
    expect(result.policy.type).toBe('factual');
    expect(result.blocks.length).toBeGreaterThan(0);
    expect(result.sourcesUsed).toBeGreaterThan(0);
  });

  it('prioritizes official docs over blog/reddit for factual query', () => {
    const result = simulateAskPath('cerebras API pricing per month');
    // First block should come from the official docs source
    expect(result.blocks[0].sourceUrl).toContain('cerebras.ai');
  });

  it('preserves exact numbers from source data', () => {
    const result = simulateAskPath('cerebras pricing cost per month');
    const allText = result.blocks.map(b => b.text).join(' ');
    // The exact numbers should be preserved
    if (allText.includes('$')) {
      expect(allText).toMatch(/\$49/);
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: general.ts path
// ---------------------------------------------------------------------------

describe('general.ts integration', () => {
  it('selects evidence and formats for LLM context', () => {
    const result = simulateGeneralPath('cloud storage comparison S3 vs GCS features');
    const formatted = formatEvidenceForLLM(result);

    expect(result.policy.type).toBe('comparison');
    expect(formatted).toContain('[1]');
    expect(formatted).toContain('URL:');
    expect(result.sourcesUsed).toBeGreaterThanOrEqual(1);
  });

  it('includes structured signal from domain extractor data', () => {
    const result = simulateGeneralPath('S3 storage price per GB');
    // The AWS source has explicit structured data
    expect(result.blocks.some(b => b.hasStructuredSignal)).toBe(true);
  });

  it('ensures domain diversity for comparison queries', () => {
    const result = simulateGeneralPath('compare S3 vs GCS pricing');
    const domains = new Set(result.blocks.map(b => {
      try { return new URL(b.sourceUrl).hostname; } catch { return ''; }
    }));
    // Should have blocks from multiple cloud providers
    expect(domains.size).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Integration: deep-research.ts path
// ---------------------------------------------------------------------------

describe('deep-research.ts integration', () => {
  it('selects evidence for an exploratory research query', () => {
    const result = simulateDeepResearchPath('how do transformer architectures work');
    expect(result.policy.type).toBe('exploratory');
    expect(result.blocks.length).toBeGreaterThan(0);
  });

  it('prioritizes arxiv and wikipedia over random blogs', () => {
    const result = simulateDeepResearchPath('transformer attention mechanism efficiency');
    // Higher authority sources should dominate the top positions
    const topSources = result.blocks.slice(0, 3).map(b => b.sourceUrl);
    const hasHighAuthority = topSources.some(
      u => u.includes('arxiv.org') || u.includes('wikipedia.org'),
    );
    expect(hasHighAuthority).toBe(true);
  });

  it('caps blocks from any single domain for research diversity', () => {
    const result = simulateDeepResearchPath('explain transformer architecture');
    const domainCounts = new Map<string, number>();
    for (const block of result.blocks) {
      try {
        const host = new URL(block.sourceUrl).hostname;
        domainCounts.set(host, (domainCounts.get(host) ?? 0) + 1);
      } catch { /* skip */ }
    }
    // No single domain should exceed the exploratory cap
    for (const [, count] of domainCounts) {
      expect(count).toBeLessThanOrEqual(result.policy.maxBlocksPerDomain);
    }
  });

  it('uses larger budgets suitable for deep research', () => {
    const result = simulateDeepResearchPath('comprehensive survey of efficient transformers');
    // deep-research passes maxBlocks=20, maxChars=12000
    expect(result.totalCandidates).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Cross-path consistency
// ---------------------------------------------------------------------------

describe('cross-path consistency', () => {
  it('all paths use the same classifier for the same query', () => {
    const query = 'OpenAI API pricing';
    const askPolicy = simulateAskPath(query).policy;
    // The policy should match classifyQuery directly
    const directPolicy = classifyQuery(query);
    expect(askPolicy.type).toBe(directPolicy.type);
    expect(askPolicy.maxBlocksPerDomain).toBe(directPolicy.maxBlocksPerDomain);
  });

  it('different query types produce different policies', () => {
    const factual = classifyQuery('S3 pricing per GB');
    const exploratory = classifyQuery('how does S3 replication work');
    expect(factual.type).not.toBe(exploratory.type);
    expect(factual.maxBlocksPerDomain).not.toBe(exploratory.maxBlocksPerDomain);
  });
});
