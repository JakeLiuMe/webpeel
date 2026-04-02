/**
 * Tests for selective-evidence.ts
 *
 * Covers: query classification, structured signal detection, evidence
 * selection (credibility, diversity, policy), and LLM formatting.
 * All tests run offline — no network requests.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyQuery,
  detectStructuredSignal,
  sourceStructuredScore,
  selectEvidence,
  formatEvidenceForLLM,
  type EvidenceSource,
  type QueryPolicy,
} from '../core/selective-evidence.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeSource(
  url: string,
  content: string,
  opts: Partial<EvidenceSource> = {},
): EvidenceSource {
  return {
    url,
    title: opts.title ?? `Page from ${new URL(url).hostname}`,
    content,
    snippet: opts.snippet ?? content.substring(0, 80),
    structured: opts.structured,
    metadata: opts.metadata,
  };
}

const FACTUAL_CONTENT = `
## Pricing Plans

The free tier includes 1,000 API calls per month at no cost.
The Pro plan costs $49/month and includes 50,000 API calls.
The Enterprise plan costs $299/month with unlimited calls.

Rate limits: 100 requests/second on Pro, 500 req/s on Enterprise.
`;

const TUTORIAL_CONTENT = `
## Getting Started with React

React is a JavaScript library for building user interfaces.
It was created by Facebook and released in 2013.

To install React, run: npm install react react-dom

Components are the building blocks of React applications.
Each component manages its own state and renders UI.
`;

const COMPARISON_CONTENT = `
## React vs Vue Comparison

React uses JSX for templating while Vue uses HTML templates.
React has a larger ecosystem and more community packages.
Vue offers better documentation and a gentler learning curve.

Performance benchmarks show similar results for both frameworks.
Bundle sizes: React 42KB, Vue 33KB (minified + gzipped).
`;

const TABLE_CONTENT = `
| Feature | React | Vue | Angular |
|---------|-------|-----|---------|
| Size | 42KB | 33KB | 143KB |
| Stars | 210K | 205K | 89K |
| License | MIT | MIT | MIT |
`;

// ---------------------------------------------------------------------------
// Query Classification
// ---------------------------------------------------------------------------

describe('classifyQuery', () => {
  it('classifies pricing queries as factual', () => {
    const policy = classifyQuery('what is the price of OpenAI API');
    expect(policy.type).toBe('factual');
    expect(policy.maxBlocksPerDomain).toBe(4);
  });

  it('classifies version queries as factual', () => {
    expect(classifyQuery('latest version of Node.js').type).toBe('factual');
  });

  it('classifies limit/rate queries as factual', () => {
    expect(classifyQuery('cerebras free tier rate limits').type).toBe('factual');
  });

  it('classifies comparison queries correctly', () => {
    const policy = classifyQuery('React vs Vue comparison');
    expect(policy.type).toBe('comparison');
    expect(policy.minDomains).toBe(3);
  });

  it('classifies "pros and cons" as comparison', () => {
    expect(classifyQuery('pros and cons of kubernetes').type).toBe('comparison');
  });

  it('classifies "alternatives to X" as comparison', () => {
    expect(classifyQuery('alternatives to MongoDB').type).toBe('comparison');
  });

  it('classifies how-to queries as exploratory', () => {
    const policy = classifyQuery('how does DNS resolution work');
    expect(policy.type).toBe('exploratory');
    expect(policy.maxBlocksPerDomain).toBe(2);
    expect(policy.minDomains).toBe(4);
  });

  it('classifies "explain X" as exploratory', () => {
    expect(classifyQuery('explain transformer architecture').type).toBe('exploratory');
  });

  it('classifies "what is X" as exploratory', () => {
    expect(classifyQuery('what is WebAssembly').type).toBe('exploratory');
  });

  it('defaults ambiguous queries to exploratory with balanced settings', () => {
    const policy = classifyQuery('rust programming language');
    expect(policy.type).toBe('exploratory');
    expect(policy.maxBlocksPerDomain).toBe(3);
  });

  it('factual policy has higher authority weight than exploratory', () => {
    const factual = classifyQuery('OpenAI API pricing');
    const exploratory = classifyQuery('how does machine learning work');
    expect(factual.authorityWeight).toBeGreaterThan(exploratory.authorityWeight);
  });

  it('factual policy has higher structured weight than comparison', () => {
    const factual = classifyQuery('S3 storage costs per GB');
    const comparison = classifyQuery('S3 vs GCS comparison');
    expect(factual.structuredWeight).toBeGreaterThan(comparison.structuredWeight);
  });
});

// ---------------------------------------------------------------------------
// Structured Signal Detection
// ---------------------------------------------------------------------------

describe('detectStructuredSignal', () => {
  it('returns 0 for empty text', () => {
    expect(detectStructuredSignal('')).toBe(0);
  });

  it('detects price patterns', () => {
    const score = detectStructuredSignal('The plan costs $49.99 per month. Enterprise is $299/mo.');
    expect(score).toBeGreaterThan(0.1);
  });

  it('detects markdown tables', () => {
    const score = detectStructuredSignal(TABLE_CONTENT);
    expect(score).toBeGreaterThan(0.1);
  });

  it('detects key-value patterns', () => {
    const text = 'Name: John Doe\nAge: 30\nLocation: New York\nRole: Engineer';
    const score = detectStructuredSignal(text);
    expect(score).toBeGreaterThan(0.05);
  });

  it('detects version patterns', () => {
    const score = detectStructuredSignal('Node.js v20.11.0 was released with performance improvements');
    expect(score).toBeGreaterThan(0.05);
  });

  it('detects numeric data density', () => {
    const text = 'Latency: 45ms p50, 120ms p99. Throughput: 500 MB per second. Uptime: 99.99%';
    const score = detectStructuredSignal(text);
    expect(score).toBeGreaterThan(0.1);
  });

  it('detects JSON-LD markers', () => {
    const score = detectStructuredSignal('<script type="application/ld+json">{"@context":"schema.org"}</script>');
    expect(score).toBeGreaterThan(0.1);
  });

  it('returns low score for plain prose', () => {
    const score = detectStructuredSignal(
      'React is a JavaScript library for building user interfaces. It was created by Facebook and is widely used in web development today.',
    );
    expect(score).toBeLessThan(0.1);
  });
});

describe('sourceStructuredScore', () => {
  it('boosts score when structured data is present', () => {
    const withStructured = sourceStructuredScore(
      makeSource('https://example.com', FACTUAL_CONTENT, { structured: { price: 49 } }),
    );
    const without = sourceStructuredScore(
      makeSource('https://example.com', FACTUAL_CONTENT),
    );
    expect(withStructured).toBeGreaterThan(without);
  });

  it('derives signal from content even without explicit structured data', () => {
    const score = sourceStructuredScore(
      makeSource('https://example.com', FACTUAL_CONTENT),
    );
    expect(score).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Evidence Selection — Credibility
// ---------------------------------------------------------------------------

describe('selectEvidence — credibility affects selection', () => {
  it('ranks blocks from high-authority domains higher', () => {
    const govSource = makeSource(
      'https://data.gov/pricing',
      'The federal rate is $150 per unit. Updated quarterly.',
    );
    const blogSource = makeSource(
      'https://randomblog.xyz/post',
      'I think the rate is about $150 per unit maybe.',
    );

    const result = selectEvidence({
      query: 'federal rate per unit',
      sources: [blogSource, govSource],
      maxBlocks: 2,
    });

    expect(result.blocks.length).toBeGreaterThan(0);
    // The gov source should appear first (higher authority)
    expect(result.blocks[0].sourceUrl).toBe('https://data.gov/pricing');
  });

  it('prefers .edu sources for academic queries', () => {
    const eduSource = makeSource(
      'https://cs.stanford.edu/papers',
      'The transformer architecture uses multi-head self-attention mechanisms for parallel computation.',
    );
    const genericSource = makeSource(
      'https://techblog.io/transformers',
      'Transformers use attention for parallel computation in neural networks.',
    );

    const result = selectEvidence({
      query: 'transformer architecture attention mechanism',
      sources: [genericSource, eduSource],
      maxBlocks: 2,
    });

    expect(result.blocks[0].sourceUrl).toBe('https://cs.stanford.edu/papers');
  });
});

// ---------------------------------------------------------------------------
// Evidence Selection — Domain Diversity
// ---------------------------------------------------------------------------

describe('selectEvidence — domain diversity', () => {
  it('limits blocks per domain according to policy', () => {
    // Create a source with many blocks from one domain
    const longContent = Array.from({ length: 10 }, (_, i) =>
      `## Section ${i + 1}\n\nThis is detailed content about React hooks including useState, useEffect, and useCallback for section ${i + 1}.`,
    ).join('\n\n');

    const singleDomainSource = makeSource('https://reactjs.org/docs', longContent);
    const otherSource = makeSource(
      'https://developer.mozilla.org/react',
      'React hooks documentation and reference guide for modern web development.',
    );

    const result = selectEvidence({
      query: 'React hooks guide',
      sources: [singleDomainSource, otherSource],
      maxBlocks: 8,
      policyOverride: { maxBlocksPerDomain: 3 },
    });

    // Count blocks from reactjs.org
    const reactBlocks = result.blocks.filter(b => b.sourceUrl.includes('reactjs.org'));
    expect(reactBlocks.length).toBeLessThanOrEqual(3);
  });

  it('promotes under-represented domains for exploratory queries', () => {
    const source1 = makeSource(
      'https://example.com/a',
      'React is great for building component-based user interfaces with virtual DOM.\n\nReact hooks enable functional components to manage state effectively.',
    );
    const source2 = makeSource(
      'https://example.com/b',
      'React components can be composed together for complex user interface patterns.\n\nThe React ecosystem includes Redux, React Router, and many other libraries.',
    );
    const source3 = makeSource(
      'https://different-site.com/react',
      'An alternative perspective on React development and best practices for large applications.',
    );

    const result = selectEvidence({
      query: 'how does React work',
      sources: [source1, source2, source3],
      maxBlocks: 4,
      policyOverride: { minDomains: 2 },
    });

    // Should include at least one block from different-site.com
    const domains = new Set(result.blocks.map(b => new URL(b.sourceUrl).hostname));
    expect(domains.size).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Evidence Selection — Structured Signal
// ---------------------------------------------------------------------------

describe('selectEvidence — structured signal helps', () => {
  it('prefers blocks with structured data signals', () => {
    const structuredSource = makeSource(
      'https://example.com/pricing',
      FACTUAL_CONTENT,
      { structured: { plans: [{ name: 'Pro', price: 49 }] } },
    );
    const proseSource = makeSource(
      'https://blog.example.com/review',
      'The service has various pricing tiers available for different use cases and team sizes. They offer competitive rates compared to alternatives in the market.',
    );

    const result = selectEvidence({
      query: 'pricing plans and costs',
      sources: [proseSource, structuredSource],
      maxBlocks: 3,
    });

    // At least one block should have structured signal
    expect(result.blocks.some(b => b.hasStructuredSignal)).toBe(true);
  });

  it('detects structured signals in content even without domainData.structured', () => {
    const tableSource = makeSource(
      'https://docs.example.com/compare',
      TABLE_CONTENT,
    );

    const result = selectEvidence({
      query: 'framework comparison size',
      sources: [tableSource],
      maxBlocks: 3,
    });

    expect(result.blocks.some(b => b.hasStructuredSignal)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Evidence Selection — Policy Changes by Query Type
// ---------------------------------------------------------------------------

describe('selectEvidence — policy varies by query type', () => {
  it('uses factual policy for pricing queries', () => {
    const result = selectEvidence({
      query: 'AWS S3 storage pricing per GB',
      sources: [makeSource('https://aws.amazon.com/s3/pricing', FACTUAL_CONTENT)],
      maxBlocks: 3,
    });
    expect(result.policy.type).toBe('factual');
  });

  it('uses comparison policy for vs queries', () => {
    const result = selectEvidence({
      query: 'React vs Angular performance benchmark',
      sources: [makeSource('https://example.com', COMPARISON_CONTENT)],
      maxBlocks: 3,
    });
    expect(result.policy.type).toBe('comparison');
  });

  it('uses exploratory policy for how-to queries', () => {
    const result = selectEvidence({
      query: 'how to deploy a Node.js app',
      sources: [makeSource('https://example.com', TUTORIAL_CONTENT)],
      maxBlocks: 3,
    });
    expect(result.policy.type).toBe('exploratory');
  });

  it('factual policy allows more blocks per domain than exploratory', () => {
    const factualResult = selectEvidence({
      query: 'OpenAI API rate limits',
      sources: [],
      maxBlocks: 1,
    });
    const exploratoryResult = selectEvidence({
      query: 'how does machine learning work',
      sources: [],
      maxBlocks: 1,
    });
    expect(factualResult.policy.maxBlocksPerDomain).toBeGreaterThan(
      exploratoryResult.policy.maxBlocksPerDomain,
    );
  });

  it('exploratory policy requires more minimum domains than factual', () => {
    const factualResult = selectEvidence({
      query: 'S3 pricing per GB',
      sources: [],
    });
    const exploratoryResult = selectEvidence({
      query: 'what is quantum computing',
      sources: [],
    });
    expect(exploratoryResult.policy.minDomains).toBeGreaterThan(
      factualResult.policy.minDomains,
    );
  });

  it('allows policy override', () => {
    const result = selectEvidence({
      query: 'any query',
      sources: [],
      policyOverride: { maxBlocksPerDomain: 10, type: 'factual' },
    });
    expect(result.policy.maxBlocksPerDomain).toBe(10);
    expect(result.policy.type).toBe('factual');
  });
});

// ---------------------------------------------------------------------------
// Evidence Selection — Edge Cases
// ---------------------------------------------------------------------------

describe('selectEvidence — edge cases', () => {
  it('returns empty result for no sources', () => {
    const result = selectEvidence({ query: 'test', sources: [] });
    expect(result.blocks).toHaveLength(0);
    expect(result.totalCandidates).toBe(0);
    expect(result.sourcesUsed).toBe(0);
  });

  it('handles sources with empty content', () => {
    const result = selectEvidence({
      query: 'test',
      sources: [makeSource('https://example.com', '')],
    });
    expect(result.blocks).toHaveLength(0);
  });

  it('respects maxChars budget', () => {
    const result = selectEvidence({
      query: 'React hooks',
      sources: [makeSource('https://example.com', TUTORIAL_CONTENT)],
      maxChars: 100,
      maxBlocks: 20,
    });
    const totalChars = result.blocks.reduce((s, b) => s + b.text.length, 0);
    expect(totalChars).toBeLessThanOrEqual(100 + 50); // allow small overflow from first-block rule
  });

  it('respects maxBlocks limit', () => {
    const longContent = Array.from({ length: 20 }, (_, i) =>
      `## Section ${i}\n\nContent about topic ${i} with enough text to be a real block.`,
    ).join('\n\n');

    const result = selectEvidence({
      query: 'topic',
      sources: [makeSource('https://example.com', longContent)],
      maxBlocks: 3,
      maxChars: 10000,
    });
    expect(result.blocks.length).toBeLessThanOrEqual(3);
  });

  it('preserves exact numbers and prices in selected blocks', () => {
    const result = selectEvidence({
      query: 'API pricing',
      sources: [makeSource('https://example.com/pricing', FACTUAL_CONTENT)],
      maxBlocks: 5,
    });
    // The selected blocks should contain the exact prices from the source
    const allText = result.blocks.map(b => b.text).join(' ');
    if (allText.includes('$')) {
      expect(allText).toMatch(/\$49\/month/);
    }
  });
});

// ---------------------------------------------------------------------------
// Format for LLM
// ---------------------------------------------------------------------------

describe('formatEvidenceForLLM', () => {
  it('returns empty string for no blocks', () => {
    const formatted = formatEvidenceForLLM({
      blocks: [],
      totalCandidates: 0,
      sourcesUsed: 0,
      policy: classifyQuery('test'),
    });
    expect(formatted).toBe('');
  });

  it('groups blocks by source URL', () => {
    const result = selectEvidence({
      query: 'React hooks useState useEffect',
      sources: [
        makeSource('https://reactjs.org/docs', TUTORIAL_CONTENT),
        makeSource('https://blog.example.com/react', COMPARISON_CONTENT),
      ],
      maxBlocks: 6,
    });

    const formatted = formatEvidenceForLLM(result);
    expect(formatted).toContain('[1]');
    expect(formatted).toContain('URL:');
    expect(formatted).toContain('---');
  });

  it('marks sources with structured signals', () => {
    const result = selectEvidence({
      query: 'pricing comparison',
      sources: [
        makeSource('https://example.com/pricing', FACTUAL_CONTENT, {
          structured: { price: 49 },
        }),
      ],
      maxBlocks: 3,
    });

    const formatted = formatEvidenceForLLM(result);
    if (result.blocks.some(b => b.hasStructuredSignal)) {
      expect(formatted).toContain('[structured]');
    }
  });

  it('marks snippet-fallback sources and excludes blocked placeholder content', () => {
    const result = selectEvidence({
      query: 'OpenAI GPT-4 pricing per token',
      sources: [
        makeSource('https://openai.com/api/pricing', '# ⚠️ openai.com — Access Blocked\n\nThis site uses advanced bot protection and blocked our request.', {
          title: 'OpenAI Pricing',
          snippet: 'Official pricing: GPT-4 costs $30 per 1M input tokens and $60 per 1M output tokens.',
        }),
      ],
      maxBlocks: 3,
    });

    const formatted = formatEvidenceForLLM(result);
    expect(formatted).toContain('[snippet]');
    expect(formatted).toContain('$30 per 1M input tokens');
    expect(formatted).not.toContain('Access Blocked');
  });
});
