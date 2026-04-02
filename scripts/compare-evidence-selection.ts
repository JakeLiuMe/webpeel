#!/usr/bin/env npx tsx
/**
 * Evidence Selection Comparison Harness
 *
 * Compares naive evidence aggregation (take all, truncate) vs selective
 * aggregation (AttnRes-inspired) on representative queries.
 *
 * Usage:
 *   npx tsx scripts/compare-evidence-selection.ts
 *
 * Output: side-by-side comparison of selected evidence, source mix,
 * and policy for each query type.
 */

import {
  selectEvidence,
  classifyQuery,
  formatEvidenceForLLM,
  type EvidenceSource,
} from '../src/core/selective-evidence.js';
import { splitIntoBlocks } from '../src/core/bm25-filter.js';

// ---------------------------------------------------------------------------
// Test scenarios — representative queries with realistic source data
// ---------------------------------------------------------------------------

interface Scenario {
  name: string;
  query: string;
  sources: EvidenceSource[];
}

const scenarios: Scenario[] = [
  {
    name: 'Factual: API Pricing',
    query: 'OpenAI GPT-4 API pricing per token',
    sources: [
      {
        url: 'https://openai.com/pricing',
        title: 'OpenAI Pricing — Official',
        content: `## GPT-4 Pricing\n\n| Model | Input | Output |\n|-------|-------|--------|\n| GPT-4 | $30/1M tokens | $60/1M tokens |\n| GPT-4 Turbo | $10/1M tokens | $30/1M tokens |\n| GPT-4o | $2.50/1M tokens | $10/1M tokens |\n\nAll prices in USD. Volume discounts available for enterprise.`,
        snippet: 'GPT-4 pricing starts at $2.50 per million tokens',
        structured: { models: ['gpt-4', 'gpt-4-turbo', 'gpt-4o'] },
      },
      {
        url: 'https://techblog.xyz/openai-pricing-guide',
        title: 'OpenAI Pricing Guide 2024',
        content: `OpenAI has several pricing tiers. GPT-4 is their most expensive model. GPT-4o is cheaper. They also offer GPT-3.5 Turbo at even lower prices. Many developers find the pricing competitive compared to Anthropic and Google.\n\nThe pricing can add up quickly for high-volume applications. Some developers report spending $500-$1000/month on API calls.\n\nOpenAI also offers fine-tuning which has separate pricing. Enterprise customers get better rates.`,
        snippet: 'Complete guide to OpenAI API pricing tiers',
      },
      {
        url: 'https://reddit.com/r/openai/pricing-discussion',
        title: 'Reddit: OpenAI pricing thoughts',
        content: `Has anyone compared OpenAI vs Anthropic pricing? I think OpenAI is cheaper for most use cases. The new GPT-4o model is really affordable. I switched from Claude and saved 50% on my API bill.\n\nAnother user says: I prefer Claude for quality but OpenAI for price.\n\nSomeone else: Don't forget about the rate limits, they matter too.`,
        snippet: 'Discussion comparing OpenAI pricing',
      },
    ],
  },
  {
    name: 'Comparison: React vs Vue',
    query: 'React vs Vue pros and cons comparison',
    sources: [
      {
        url: 'https://reactjs.org/docs/thinking-in-react',
        title: 'Thinking in React — Official Docs',
        content: `React lets you build user interfaces from individual pieces called components. React components are JavaScript functions that return markup. React uses a virtual DOM for efficient updates.\n\nReact's component model is flexible and powerful. JSX combines HTML-like syntax with full JavaScript power. The ecosystem is vast with thousands of third-party packages.`,
        snippet: 'Official React documentation on component model',
      },
      {
        url: 'https://vuejs.org/guide/introduction',
        title: 'Vue.js Guide — Official Docs',
        content: `Vue is a progressive JavaScript framework for building user interfaces. It builds on standard HTML, CSS, and JavaScript. Vue provides a declarative, component-based programming model.\n\nVue's single-file components encapsulate template, logic, and styling. The Composition API offers flexible code organization. Vue 3 has excellent TypeScript support.`,
        snippet: 'Official Vue.js introduction guide',
      },
      {
        url: 'https://blog.logrocket.com/react-vs-vue',
        title: 'React vs Vue in 2024 — LogRocket',
        content: `## Performance Comparison\n\nBoth React and Vue offer excellent performance. Bundle sizes: React 42KB, Vue 33KB (gzipped). Initial render times are comparable.\n\n## Learning Curve\n\nVue has a gentler learning curve. React requires understanding JSX and hooks. Vue templates are closer to standard HTML.\n\n## Ecosystem\n\nReact has a larger ecosystem: 200K+ npm packages. Vue has a more curated ecosystem with official libraries for routing and state management.`,
        snippet: 'Detailed comparison of React and Vue frameworks',
      },
      {
        url: 'https://stackoverflow.com/questions/react-vue-comparison',
        title: 'Stack Overflow: React vs Vue',
        content: `React Pros: Large community, lots of jobs, backed by Meta. Cons: Steeper learning curve, JSX can be confusing.\n\nVue Pros: Easy to learn, great docs, progressive adoption. Cons: Smaller ecosystem, fewer enterprise adoptions.\n\nBoth are excellent choices for modern web development.`,
        snippet: 'Community comparison of React and Vue',
      },
    ],
  },
  {
    name: 'Exploratory: How DNS Works',
    query: 'how does DNS resolution work step by step',
    sources: [
      {
        url: 'https://www.cloudflare.com/learning/dns/what-is-dns/',
        title: 'What is DNS? — Cloudflare',
        content: `DNS (Domain Name System) translates domain names into IP addresses. When you type a URL, your browser needs to find the server's IP address.\n\nDNS resolution involves multiple steps: browser cache, OS cache, recursive resolver, root nameserver, TLD nameserver, and authoritative nameserver.\n\nThe recursive resolver acts as a middleman between the client and the DNS nameservers. It caches results to speed up future queries.`,
        snippet: 'Cloudflare explanation of DNS resolution',
      },
      {
        url: 'https://developer.mozilla.org/docs/DNS',
        title: 'DNS — MDN Web Docs',
        content: `The Domain Name System is a hierarchical naming system. DNS queries typically follow this path:\n\n1. Check local cache\n2. Query recursive resolver\n3. Resolver queries root server\n4. Root server directs to TLD server\n5. TLD server directs to authoritative server\n6. Authoritative server returns the IP\n\nCommon DNS record types: A (IPv4), AAAA (IPv6), CNAME, MX, TXT, NS.`,
        snippet: 'MDN documentation on DNS',
      },
      {
        url: 'https://howdns.works/episodes',
        title: 'How DNS Works — Visual Guide',
        content: `DNS is like a phone book for the internet. Your browser asks: "What's the IP for example.com?" and DNS answers with an IP address like 93.184.216.34.\n\nThere are 13 root server clusters worldwide. They don't know every domain — they just know who to ask next. It's a referral system.`,
        snippet: 'Visual explanation of DNS',
      },
      {
        url: 'https://blog.randomdev.com/dns-explained',
        title: 'DNS Explained Simply',
        content: `I've been a developer for 10 years and DNS still confuses me sometimes. But here's the basic idea: your computer needs to find an IP address for a domain name.\n\nIt's like asking for directions. You ask one person, they point you to another, and eventually you find your destination.`,
        snippet: 'Simple DNS explanation blog post',
      },
      {
        url: 'https://news.ycombinator.com/item?id=dns-thread',
        title: 'HN: DNS Resolution Deep Dive',
        content: `Interesting thread about DNS internals. Someone mentions that DNS over HTTPS is becoming standard. Another user points out that TTL values affect caching behavior significantly.\n\nFun fact: the 13 root servers are actually hundreds of servers using anycast routing.`,
        snippet: 'Hacker News discussion on DNS',
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Naive aggregation (baseline)
// ---------------------------------------------------------------------------

function naiveAggregate(sources: EvidenceSource[], maxChars: number): string {
  const parts: string[] = [];
  let budget = maxChars;

  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    const content = src.content || src.snippet || '';
    const truncated = content.substring(0, Math.min(budget, 800));
    parts.push(`[${i + 1}] ${src.title}\nURL: ${src.url}\n\n${truncated}`);
    budget -= truncated.length;
    if (budget <= 0) break;
  }

  return parts.join('\n\n---\n\n');
}

// ---------------------------------------------------------------------------
// Main comparison
// ---------------------------------------------------------------------------

console.log('='.repeat(80));
console.log('Evidence Selection Comparison: Naive vs Selective (AttnRes-inspired)');
console.log('='.repeat(80));

for (const scenario of scenarios) {
  console.log(`\n${'─'.repeat(80)}`);
  console.log(`\n## ${scenario.name}`);
  console.log(`   Query: "${scenario.query}"`);
  console.log(`   Sources: ${scenario.sources.length}`);

  // Policy
  const policy = classifyQuery(scenario.query);
  console.log(`   Policy: ${policy.type} (maxBlocksPerDomain=${policy.maxBlocksPerDomain}, minDomains=${policy.minDomains})`);
  console.log(`   Weights: relevance=${policy.relevanceWeight}, authority=${policy.authorityWeight}, structured=${policy.structuredWeight}`);

  // Naive
  const naiveResult = naiveAggregate(scenario.sources, 4000);
  const naiveBlocks = splitIntoBlocks(naiveResult);
  const naiveDomains = new Set(scenario.sources.map(s => {
    try { return new URL(s.url).hostname; } catch { return ''; }
  }));

  console.log(`\n### Naive Aggregation`);
  console.log(`   Total chars: ${naiveResult.length}`);
  console.log(`   Blocks: ${naiveBlocks.length}`);
  console.log(`   Domains: ${[...naiveDomains].join(', ')}`);
  console.log(`   Preview (first 200 chars):`);
  console.log(`   ${naiveResult.substring(0, 200).replace(/\n/g, '\n   ')}...`);

  // Selective
  const selectiveResult = selectEvidence({
    query: scenario.query,
    sources: scenario.sources,
    maxBlocks: 10,
    maxChars: 4000,
  });
  const formatted = formatEvidenceForLLM(selectiveResult);
  const selectedDomains = new Set(selectiveResult.blocks.map(b => {
    try { return new URL(b.sourceUrl).hostname; } catch { return ''; }
  }));

  console.log(`\n### Selective Aggregation (AttnRes)`);
  console.log(`   Total chars: ${formatted.length}`);
  console.log(`   Blocks selected: ${selectiveResult.blocks.length} / ${selectiveResult.totalCandidates} candidates`);
  console.log(`   Sources used: ${selectiveResult.sourcesUsed}`);
  console.log(`   Domains: ${[...selectedDomains].join(', ')}`);
  console.log(`   Structured signals: ${selectiveResult.blocks.filter(b => b.hasStructuredSignal).length} blocks`);

  // Block-level detail
  console.log(`\n   Selected blocks (score descending):`);
  for (const block of selectiveResult.blocks) {
    const domain = (() => { try { return new URL(block.sourceUrl).hostname; } catch { return '?'; } })();
    const preview = block.text.substring(0, 80).replace(/\n/g, ' ');
    console.log(`     [${block.score.toFixed(3)}] ${domain}${block.hasStructuredSignal ? ' ★' : '  '} "${preview}..."`);
  }

  // Comparison summary
  const naiveCharEfficiency = naiveResult.length;
  const selectiveCharEfficiency = formatted.length;
  const reduction = naiveCharEfficiency > 0
    ? Math.round((1 - selectiveCharEfficiency / naiveCharEfficiency) * 100)
    : 0;

  console.log(`\n### Comparison`);
  console.log(`   Char reduction: ${reduction > 0 ? reduction : 0}% (${naiveCharEfficiency} → ${selectiveCharEfficiency})`);
  console.log(`   Domain coverage: naive=${naiveDomains.size} → selective=${selectedDomains.size}`);
  console.log(`   Structured signal blocks in selective: ${selectiveResult.blocks.filter(b => b.hasStructuredSignal).length}`);
}

console.log(`\n${'='.repeat(80)}`);
console.log('Done. All comparisons above are deterministic and reproducible.');
