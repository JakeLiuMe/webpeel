/**
 * WebPeel Deep Research
 *
 * Multi-step search agent that turns one question into a comprehensive,
 * cited research report. Orchestrates:
 *
 *   1. Query Decomposition  — LLM breaks question into 3-5 sub-queries
 *   2. Parallel Multi-Search — All sub-queries across DDG + Stealth
 *   3. Source Fetching       — peel() on top results per sub-query
 *   4. Relevance Scoring     — BM25 against the original question
 *   5. Gap Detection         — LLM: "Is there enough info? What's missing?"
 *   6. Re-Search Loop        — Generate new queries if gaps found (max N rounds)
 *   7. Synthesis             — LLM generates final cited report
 */

import { peel } from '../index.js';
import { getSearchProvider, type WebSearchResult } from './search-provider.js';
import { scoreBM25, splitIntoBlocks } from './bm25-filter.js';
import {
  callLLM,
  getDefaultLLMConfig,
  isFreeTierLimitError,
  type LLMConfig,
  type LLMMessage,
} from './llm-provider.js';
import { sanitizeForLLM } from './prompt-guard.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProgressEventType =
  | 'decomposing'
  | 'searching'
  | 'fetching'
  | 'scoring'
  | 'gap_check'
  | 'researching'
  | 'synthesizing'
  | 'done'
  | 'error';

export interface DeepResearchProgressEvent {
  type: ProgressEventType;
  message: string;
  round?: number;
  data?: Record<string, unknown>;
}

export interface Citation {
  index: number;
  title: string;
  url: string;
  snippet: string;
  relevanceScore: number;
}

export interface DeepResearchRequest {
  question: string;
  llm?: LLMConfig;
  /** Maximum research rounds (default: 3) */
  maxRounds?: number;
  /** Maximum sources to consider (default: 20) */
  maxSources?: number;
  stream?: boolean;
  /** Called with incremental report text when stream=true */
  onChunk?: (text: string) => void;
  /** Called with progress updates */
  onProgress?: (event: DeepResearchProgressEvent) => void;
  signal?: AbortSignal;
}

export interface DeepResearchResponse {
  report: string;
  citations: Citation[];
  sourcesUsed: number;
  roundsCompleted: number;
  totalSearchQueries: number;
  llmProvider: string;
  tokensUsed: { input: number; output: number };
  elapsed: number;
}

// Internal representation of a fetched source
interface FetchedSource {
  result: WebSearchResult;
  content: string;
  relevanceScore: number;
  subQuery: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '\n\n[Truncated]';
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = (u.pathname || '/').replace(/\/+$/, '');
    return `${host}${path}`;
  } catch {
    return url.toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
  }
}

// ---------------------------------------------------------------------------
// LLM call with merged token tracking
// ---------------------------------------------------------------------------

async function callWithTracking(
  config: LLMConfig,
  messages: LLMMessage[],
  tokenAccumulator: { input: number; output: number },
  opts: { stream?: boolean; onChunk?: (text: string) => void; signal?: AbortSignal; maxTokens?: number } = {},
): Promise<string> {
  const result = await callLLM(config, {
    messages,
    stream: opts.stream,
    onChunk: opts.onChunk,
    signal: opts.signal,
    maxTokens: opts.maxTokens ?? 4096,
    temperature: 0.3,
  });
  tokenAccumulator.input += result.usage.input;
  tokenAccumulator.output += result.usage.output;
  return result.text;
}

// ---------------------------------------------------------------------------
// Step 1: Query Decomposition
// ---------------------------------------------------------------------------

async function decomposeQuery(
  question: string,
  config: LLMConfig,
  tokens: { input: number; output: number },
  signal?: AbortSignal,
): Promise<string[]> {
  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: [
        'You are a research assistant that helps decompose complex questions.',
        'Given a research question, generate 3-5 specific search sub-queries that together would provide comprehensive coverage of the topic.',
        'Each sub-query should target a different aspect of the question.',
        'Output ONLY the sub-queries, one per line, no numbering, no explanation.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Research question: "${question}"\n\nGenerate 3-5 focused search sub-queries:`,
    },
  ];

  const text = await callWithTracking(config, messages, tokens, {
    signal,
    maxTokens: 500,
  });

  // Parse lines, filter empties and numbering
  const queries = text
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/^\d+[.)]\s*/, '')
        .replace(/^[-*•]\s*/, '')
        .trim(),
    )
    .filter((line) => line.length > 5 && line.length < 300);

  // Ensure the original question is always in the mix
  const all = [question, ...queries];

  // Deduplicate (case-insensitive)
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const q of all) {
    const key = q.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(q);
    }
  }

  // Return at most 6 queries (1 original + up to 5 generated)
  return deduped.slice(0, 6);
}

// ---------------------------------------------------------------------------
// Step 2: Parallel Multi-Search
// ---------------------------------------------------------------------------

async function searchAll(
  queries: string[],
  signal?: AbortSignal,
): Promise<Map<string, WebSearchResult[]>> {
  const resultsMap = new Map<string, WebSearchResult[]>();

  const searchWithDDG = async (query: string): Promise<WebSearchResult[]> => {
    try {
      const provider = getSearchProvider('duckduckgo');
      return await provider.searchWeb(query, {
        count: 5,
        signal,
      });
    } catch {
      return [];
    }
  };

  // Run all queries in parallel
  const settled = await Promise.allSettled(
    queries.map(async (query) => {
      const results = await searchWithDDG(query);
      return { query, results };
    }),
  );

  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') {
      resultsMap.set(outcome.value.query, outcome.value.results);
    }
  }

  return resultsMap;
}

// ---------------------------------------------------------------------------
// Step 3: Source Fetching
// ---------------------------------------------------------------------------

async function fetchSources(
  searchResults: Map<string, WebSearchResult[]>,
  maxSources: number,
  signal?: AbortSignal,
): Promise<FetchedSource[]> {
  // Collect top 3 per sub-query, deduplicated by URL
  const seen = new Set<string>();
  const toFetch: Array<{ result: WebSearchResult; subQuery: string }> = [];

  for (const [subQuery, results] of searchResults) {
    let count = 0;
    for (const result of results) {
      if (count >= 3) break;
      const key = normalizeUrl(result.url);
      if (seen.has(key)) continue;
      seen.add(key);
      toFetch.push({ result, subQuery });
      count++;
      if (toFetch.length >= maxSources) break;
    }
    if (toFetch.length >= maxSources) break;
  }

  // Fetch in parallel batches of 5
  const BATCH_SIZE = 5;
  const fetched: FetchedSource[] = [];

  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    if (signal?.aborted) break;
    const batch = toFetch.slice(i, i + BATCH_SIZE);

    const settled = await Promise.allSettled(
      batch.map(async ({ result, subQuery }) => {
        try {
          const pr = await peel(result.url, {
            format: 'markdown',
            maxTokens: 2000,
            timeout: 25_000,
            render: false,
          });
          return { result, content: pr.content || '', subQuery };
        } catch (err) {
          return {
            result,
            content: result.snippet || '',
            subQuery,
          };
        }
      }),
    );

    for (const outcome of settled) {
      if (outcome.status === 'fulfilled') {
        fetched.push({
          ...outcome.value,
          relevanceScore: 0, // filled in step 4
        });
      }
    }
  }

  return fetched;
}

// ---------------------------------------------------------------------------
// Step 4: Relevance Scoring
// ---------------------------------------------------------------------------

function scoreSources(
  sources: FetchedSource[],
  question: string,
): FetchedSource[] {
  const queryTerms = question
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);

  return sources.map((source) => {
    const content = source.content;
    if (!content || queryTerms.length === 0) {
      return { ...source, relevanceScore: 0 };
    }

    const blocks = splitIntoBlocks(content);
    if (blocks.length === 0) {
      return { ...source, relevanceScore: 0 };
    }

    const scores = scoreBM25(blocks, queryTerms);

    // Weighted average by block length
    const blockLens = blocks.map((b) => b.raw.length);
    const totalLen = blockLens.reduce((s, l) => s + l, 0) || 1;
    let weightedSum = 0;
    for (let i = 0; i < scores.length; i++) {
      weightedSum += scores[i] * (blockLens[i] / totalLen);
    }

    // Normalize to 0-1 using sigmoid
    const perTerm = weightedSum / (queryTerms.length || 1);
    const normalized = Math.max(0, Math.min(1, 2 / (1 + Math.exp(-perTerm * 8)) - 1));

    return { ...source, relevanceScore: normalized };
  });
}

// ---------------------------------------------------------------------------
// Step 5: Gap Detection
// ---------------------------------------------------------------------------

interface GapDetectionResult {
  hasEnoughInfo: boolean;
  gaps: string[];
  additionalQueries: string[];
}

async function detectGaps(
  question: string,
  sources: FetchedSource[],
  config: LLMConfig,
  tokens: { input: number; output: number },
  signal?: AbortSignal,
): Promise<GapDetectionResult> {
  // Build summary of what we have
  const topSources = sources
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 8);

  const contextSummary = topSources
    .map((s, i) => {
      const snippet = truncate(s.content || s.result.snippet || '', 800);
      return `[${i + 1}] ${s.result.title}\nURL: ${s.result.url}\n${snippet}`;
    })
    .join('\n\n---\n\n');

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: [
        'You are a research quality assessor. Given a question and the sources collected so far,',
        'determine if there is sufficient information to write a comprehensive answer.',
        '',
        'Respond in this EXACT JSON format (no markdown, no code blocks):',
        '{',
        '  "hasEnoughInfo": boolean,',
        '  "gaps": ["gap1", "gap2"],',
        '  "additionalQueries": ["query1", "query2"]',
        '}',
        '',
        '"gaps" should be 0-3 specific aspects not covered by the sources.',
        '"additionalQueries" should be 0-3 new search queries to fill those gaps.',
        'If hasEnoughInfo is true, set gaps and additionalQueries to empty arrays.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Question: "${question}"\n\nSources collected:\n\n${contextSummary}\n\nAnalyze coverage and gaps:`,
    },
  ];

  let text: string;
  try {
    text = await callWithTracking(config, messages, tokens, {
      signal,
      maxTokens: 600,
    });
  } catch (err) {
    if (isFreeTierLimitError(err)) throw err;
    // On LLM failure, assume we have enough info
    return { hasEnoughInfo: true, gaps: [], additionalQueries: [] };
  }

  // Parse JSON response
  try {
    // Strip markdown code fences if present
    const cleaned = text
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();
    const json = JSON.parse(cleaned) as GapDetectionResult;
    return {
      hasEnoughInfo: Boolean(json.hasEnoughInfo),
      gaps: Array.isArray(json.gaps) ? json.gaps.slice(0, 3) : [],
      additionalQueries: Array.isArray(json.additionalQueries)
        ? json.additionalQueries.slice(0, 3)
        : [],
    };
  } catch {
    // Couldn't parse JSON — assume enough info
    return { hasEnoughInfo: true, gaps: [], additionalQueries: [] };
  }
}

// ---------------------------------------------------------------------------
// Step 7: Synthesis
// ---------------------------------------------------------------------------

async function synthesizeReport(
  question: string,
  sources: FetchedSource[],
  config: LLMConfig,
  tokens: { input: number; output: number },
  opts: { stream?: boolean; onChunk?: (text: string) => void; signal?: AbortSignal },
): Promise<{ report: string; citations: Citation[] }> {
  // Sort by relevance, take best sources (max 15 for context)
  const topSources = sources
    .sort((a, b) => b.relevanceScore - a.relevanceScore)
    .slice(0, 15);

  // Build context
  const contextParts: string[] = [];
  const citations: Citation[] = [];

  topSources.forEach((source, i) => {
    const idx = i + 1;
    const sanitized = sanitizeForLLM(truncate(source.content || source.result.snippet || '', 3000));
    contextParts.push(
      `SOURCE [${idx}]\nTitle: ${source.result.title}\nURL: ${source.result.url}\n\n${sanitized.content}`,
    );
    citations.push({
      index: idx,
      title: source.result.title,
      url: source.result.url,
      snippet: source.result.snippet || '',
      relevanceScore: source.relevanceScore,
    });
  });

  const context = contextParts.join('\n\n---\n\n');

  const messages: LLMMessage[] = [
    {
      role: 'system',
      content: [
        'You are a research analyst that writes comprehensive, well-cited reports.',
        'Use ONLY the provided sources to answer the question.',
        'Cite sources using bracketed numbers like [1], [2], [3].',
        'Structure your report with:',
        '  - A brief executive summary',
        '  - Key findings (with citations)',
        '  - Detailed analysis',
        '  - Conclusion',
        'Do not fabricate URLs or citations. Do not include information not found in the sources.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: `Research question: "${question}"\n\nSources:\n\n${context}\n\nWrite a comprehensive research report with citations:`,
    },
  ];

  const report = await callWithTracking(config, messages, tokens, {
    stream: opts.stream,
    onChunk: opts.onChunk,
    signal: opts.signal,
    maxTokens: 4096,
  });

  return { report, citations };
}

// ---------------------------------------------------------------------------
// Main: runDeepResearch
// ---------------------------------------------------------------------------

/**
 * Run a deep research session.
 *
 * Orchestrates query decomposition → multi-search → source fetching →
 * relevance scoring → gap detection → re-search loop → synthesis.
 */
export async function runDeepResearch(req: DeepResearchRequest): Promise<DeepResearchResponse> {
  const startTime = Date.now();

  const question = (req.question || '').trim();
  if (!question) throw new Error('Missing or invalid "question"');
  if (question.length > 5000) throw new Error('Question too long (max 5000 characters)');

  const maxRounds = clamp(req.maxRounds ?? 3, 1, 5);
  const maxSources = clamp(req.maxSources ?? 20, 5, 30);
  const config = req.llm ?? getDefaultLLMConfig();

  const tokens = { input: 0, output: 0 };
  let totalSearchQueries = 0;
  let roundsCompleted = 0;

  const progress = (event: DeepResearchProgressEvent) => {
    req.onProgress?.(event);
  };

  // ── Round tracking ────────────────────────────────────────────────────────
  // All fetched sources across all rounds, deduplicated by URL
  const allSources: FetchedSource[] = [];
  const seenUrls = new Set<string>();
  let usedQueries = new Set<string>();

  // ── Round 0..maxRounds ────────────────────────────────────────────────────
  let currentQueries: string[] = [];

  for (let round = 0; round < maxRounds; round++) {
    if (req.signal?.aborted) break;

    if (round === 0) {
      // Step 1: Query Decomposition
      progress({ type: 'decomposing', message: 'Decomposing question into sub-queries…', round });

      try {
        currentQueries = await decomposeQuery(question, config, tokens, req.signal);
      } catch (err) {
        if (isFreeTierLimitError(err)) throw err;
        // Fallback: just use the original question
        currentQueries = [question];
      }
    }

    // Filter out already-used queries
    const newQueries = currentQueries.filter((q) => !usedQueries.has(q.toLowerCase()));
    if (newQueries.length === 0) break;

    for (const q of newQueries) {
      usedQueries.add(q.toLowerCase());
    }
    totalSearchQueries += newQueries.length;

    // Step 2: Multi-Search
    progress({
      type: 'searching',
      message: `Searching ${newQueries.length} queries (round ${round + 1})…`,
      round,
      data: { queries: newQueries },
    });

    const searchResults = await searchAll(newQueries, req.signal);

    // Step 3: Source Fetching
    const newResultCount = [...searchResults.values()].reduce((s, r) => s + r.length, 0);
    progress({
      type: 'fetching',
      message: `Fetching content from up to ${Math.min(newResultCount, maxSources)} sources…`,
      round,
    });

    const roundSources = await fetchSources(searchResults, maxSources, req.signal);

    // Deduplicate against already-fetched sources
    const newSources = roundSources.filter((s) => {
      const key = normalizeUrl(s.result.url);
      if (seenUrls.has(key)) return false;
      seenUrls.add(key);
      return true;
    });

    // Step 4: Relevance Scoring
    progress({ type: 'scoring', message: 'Scoring source relevance…', round });
    const scored = scoreSources(newSources, question);
    allSources.push(...scored);

    roundsCompleted = round + 1;

    // Don't do gap detection after the last round
    if (round >= maxRounds - 1) break;

    // Step 5: Gap Detection
    progress({
      type: 'gap_check',
      message: 'Checking research coverage for gaps…',
      round,
    });

    let gapResult: { hasEnoughInfo: boolean; additionalQueries: string[] };
    try {
      gapResult = await detectGaps(question, allSources, config, tokens, req.signal);
    } catch (err) {
      if (isFreeTierLimitError(err)) throw err;
      break;
    }

    if (gapResult.hasEnoughInfo || gapResult.additionalQueries.length === 0) {
      break;
    }

    // Step 6: Re-Search Loop
    progress({
      type: 'researching',
      message: `Found ${gapResult.additionalQueries.length} gaps — searching more…`,
      round,
      data: { additionalQueries: gapResult.additionalQueries },
    });

    currentQueries = gapResult.additionalQueries;
  }

  // Step 7: Synthesis
  progress({ type: 'synthesizing', message: 'Synthesizing research report…' });

  // Sort all sources by relevance for synthesis
  const sortedSources = allSources.sort((a, b) => b.relevanceScore - a.relevanceScore);

  const { report, citations } = await synthesizeReport(
    question,
    sortedSources,
    config,
    tokens,
    {
      stream: req.stream,
      onChunk: req.onChunk,
      signal: req.signal,
    },
  );

  const elapsed = Date.now() - startTime;

  progress({
    type: 'done',
    message: `Research complete in ${(elapsed / 1000).toFixed(1)}s`,
    data: { sourcesUsed: citations.length, roundsCompleted, totalSearchQueries },
  });

  return {
    report,
    citations,
    sourcesUsed: citations.length,
    roundsCompleted,
    totalSearchQueries,
    llmProvider: config.provider,
    tokensUsed: tokens,
    elapsed,
  };
}
