/**
 * Selective Evidence Aggregation
 *
 * AttnRes-inspired evidence selection: instead of naively concatenating all
 * sources, score and select evidence blocks that maximise relevance,
 * credibility, and source diversity for a given query.
 *
 * Design goals:
 *   1. Query-aware block scoring  — BM25 relevance per content block
 *   2. Credibility/authority weighting — higher-authority sources get a boost
 *   3. Structured-signal detection — detect structured data even when
 *      domainData.structured is absent (prices, dates, tables, lists, JSON-LD)
 *   4. Per-domain diversity limits — configurable cap per registered domain
 *   5. Query-type-aware policy    — factual vs exploratory queries use
 *      different diversity/concentration knobs
 *   6. Exact facts preserved      — numbers, prices, dates are never mutated
 *
 * No external dependencies — pure TypeScript, reuses existing helpers.
 */

import { splitIntoBlocks, scoreBM25 } from './bm25-filter.js';
import {
  scoreDomainAuthority,
  extractRegisteredDomain,
  isFactualQuery,
} from './source-scoring.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single evidence source with content and metadata */
export interface EvidenceSource {
  url: string;
  title: string;
  content: string;
  /** Snippet from search results (fallback when content is empty) */
  snippet?: string;
  /** Pre-computed structured data from domain extractors */
  structured?: unknown;
  /** Page metadata (publish dates, etc.) */
  metadata?: Record<string, unknown>;
}

/** A scored and selected evidence block */
export interface SelectedBlock {
  /** The text content of this block */
  text: string;
  /** Source URL this block came from */
  sourceUrl: string;
  /** Source title */
  sourceTitle: string;
  /** Composite score used for ranking (0-1) */
  score: number;
  /** Whether a structured signal was detected in this block */
  hasStructuredSignal: boolean;
  /** Whether the selector used full page content or a snippet fallback */
  contentMode: 'content' | 'snippet';
}

/** Result of selectEvidence() */
export interface SelectionResult {
  /** Selected evidence blocks, in score-descending order */
  blocks: SelectedBlock[];
  /** Number of total candidate blocks evaluated */
  totalCandidates: number;
  /** Number of sources that contributed at least one block */
  sourcesUsed: number;
  /** The query type policy that was applied */
  policy: QueryPolicy;
}

// ---------------------------------------------------------------------------
// Query-type policy
// ---------------------------------------------------------------------------

export type QueryType = 'factual' | 'comparison' | 'exploratory';

export interface QueryPolicy {
  /** The detected query type */
  type: QueryType;
  /** Max blocks from any single registered domain */
  maxBlocksPerDomain: number;
  /** Weight multiplier for authority score (0-1) */
  authorityWeight: number;
  /** Weight multiplier for BM25 relevance (0-1) */
  relevanceWeight: number;
  /** Weight multiplier for structured signal boost (0-1) */
  structuredWeight: number;
  /** Minimum number of unique domains to try to include */
  minDomains: number;
}

// Comparison / research query patterns
const COMPARISON_PATTERN =
  /\b(compare|comparison|vs\.?|versus|difference|differences|between|pros?\s+and\s+cons?|alternatives?|better|which\s+is|review|benchmark|ranking)\b/i;

// Exploratory / open-ended query patterns
const EXPLORATORY_PATTERN =
  /\b(how\s+(?:does|do|to|can)|what\s+(?:is|are|does)|explain|overview|introduction|guide|tutorial|learn|understand|history|background|research|explore|survey)\b/i;

/**
 * Classify a query and return the appropriate diversity/weighting policy.
 *
 * - **factual**: pricing, version, limit, spec queries → tight authority
 *   concentration, fewer domains needed, structured signals weighted high
 * - **comparison**: "X vs Y", "alternatives", "pros and cons" → moderate
 *   diversity, balanced weights
 * - **exploratory**: "how does X work", "explain Y", research queries →
 *   maximum diversity, many domains encouraged
 */
export function classifyQuery(query: string): QueryPolicy {
  // Order matters: check factual first (most specific), then comparison
  if (isFactualQuery(query)) {
    return {
      type: 'factual',
      maxBlocksPerDomain: 4,
      authorityWeight: 0.35,
      relevanceWeight: 0.40,
      structuredWeight: 0.25,
      minDomains: 2,
    };
  }

  if (COMPARISON_PATTERN.test(query)) {
    return {
      type: 'comparison',
      maxBlocksPerDomain: 3,
      authorityWeight: 0.25,
      relevanceWeight: 0.45,
      structuredWeight: 0.15,
      minDomains: 3,
    };
  }

  if (EXPLORATORY_PATTERN.test(query)) {
    return {
      type: 'exploratory',
      maxBlocksPerDomain: 2,
      authorityWeight: 0.20,
      relevanceWeight: 0.50,
      structuredWeight: 0.10,
      minDomains: 4,
    };
  }

  // Default: balanced
  return {
    type: 'exploratory',
    maxBlocksPerDomain: 3,
    authorityWeight: 0.25,
    relevanceWeight: 0.45,
    structuredWeight: 0.15,
    minDomains: 3,
  };
}

// ---------------------------------------------------------------------------
// Structured-signal detection (lightweight, no giant dependency)
// ---------------------------------------------------------------------------

/**
 * Detect whether a text block contains structured information signals.
 *
 * This does NOT rely on domainData.structured being present — it looks at
 * the actual content for patterns that indicate structured data:
 *   - Price/currency patterns ($X.XX, €, £)
 *   - Markdown tables (lines starting with |)
 *   - Key-value patterns ("Key: Value")
 *   - Numeric data density (percentages, measurements, dates)
 *   - JSON-LD or schema.org markers
 *   - Ordered/numbered lists with data
 *
 * Returns a score 0-1 representing structured signal strength.
 */
export function detectStructuredSignal(text: string): number {
  if (!text || text.length < 10) return 0;

  let signal = 0;
  const lines = text.split('\n');

  // Price/currency patterns — strong signal
  const priceMatches = text.match(/[$€£¥]\s?\d[\d,.]+/g);
  if (priceMatches && priceMatches.length > 0) {
    signal += Math.min(0.3, priceMatches.length * 0.1);
  }

  // Markdown table rows (|col1|col2|)
  const tableRows = lines.filter(l => /^\s*\|.*\|/.test(l));
  if (tableRows.length >= 2) {
    signal += Math.min(0.3, tableRows.length * 0.05);
  }

  // Key-value patterns ("Label: Value" at start of line)
  const kvMatches = lines.filter(l => /^\s*[A-Z][A-Za-z\s]{1,25}:\s+\S/.test(l));
  if (kvMatches.length >= 2) {
    signal += Math.min(0.2, kvMatches.length * 0.04);
  }

  // Numeric data density — dates, percentages, measurements
  const numericPatterns = text.match(/\b\d{1,3}(?:[.,]\d{1,3})*\s*(?:%|GB|MB|TB|kg|lb|mph|km|mi|ms|sec|min|hr|days?|months?|years?)\b/gi);
  if (numericPatterns && numericPatterns.length >= 2) {
    signal += Math.min(0.2, numericPatterns.length * 0.04);
  }

  // Explicit version/spec patterns (v2.0, API v3, version 4.1)
  if (/\bv(?:ersion)?\s?\d+(?:\.\d+)+/i.test(text)) {
    signal += 0.1;
  }

  // JSON-LD / schema.org markers
  if (/@context|schema\.org|itemtype|itemprop/i.test(text)) {
    signal += 0.15;
  }

  return Math.min(1.0, signal);
}

/**
 * Compute a structured signal score for a source, combining:
 * 1. Pre-existing structured data (domainData.structured) if present
 * 2. Content-derived structured signals from detectStructuredSignal()
 *
 * Returns 0-1.
 */
export function sourceStructuredScore(source: EvidenceSource): number {
  let score = 0;

  // If domain extractor provided structured data, strong signal
  if (source.structured != null) {
    const str = typeof source.structured === 'string'
      ? source.structured
      : JSON.stringify(source.structured);
    // Non-trivial structured data (more than just {})
    if (str.length > 5) {
      score += 0.5;
    }
  }

  // Content-derived structured signal
  const contentSignal = detectStructuredSignal(source.content || '');
  score += contentSignal * 0.5;

  return Math.min(1.0, score);
}

// ---------------------------------------------------------------------------
// Evidence quality / fallback helpers
// ---------------------------------------------------------------------------

const UNUSABLE_EVIDENCE_PATTERNS: RegExp[] = [
  /^#\s*⚠️\s+.+?\s+—\s+Access Blocked/im,
  /This site uses advanced bot protection and blocked our request\./i,
  /^##\s*❌\s+Reddit Post Not Found/im,
  /The post at r\/.+ could not be found\./i,
  /Server returned an error page \(522\)/i,
  /fetch_failed/i,
];

/**
 * Returns true when fetched content is a WebPeel placeholder / error shell rather
 * than usable evidence for synthesis.
 */
export function isUnusableEvidenceContent(text: string | undefined | null): boolean {
  if (!text) return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  return UNUSABLE_EVIDENCE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * Choose the best evidence text for a source.
 * - Prefer full fetched content when it is usable
 * - Fall back to the search snippet when the fetch content is blocked/error placeholder
 */
export function getBestEvidenceText(source: EvidenceSource): {
  text: string;
  mode: 'content' | 'snippet' | 'none';
} {
  if (!isUnusableEvidenceContent(source.content)) {
    return { text: source.content, mode: 'content' };
  }
  const snippet = source.snippet?.trim() ?? '';
  if (snippet.length >= 20) {
    return { text: snippet, mode: 'snippet' };
  }
  return { text: '', mode: 'none' };
}

// ---------------------------------------------------------------------------
// Selection options
// ---------------------------------------------------------------------------

export interface SelectEvidenceOptions {
  /** The user query */
  query: string;
  /** All candidate sources */
  sources: EvidenceSource[];
  /** Maximum total blocks to return. Default: 12 */
  maxBlocks?: number;
  /** Maximum character budget for all selected blocks combined. Default: 6000 */
  maxChars?: number;
  /** Override the auto-detected policy */
  policyOverride?: Partial<QueryPolicy>;
}

// ---------------------------------------------------------------------------
// Main selector
// ---------------------------------------------------------------------------

/**
 * Select the best evidence blocks from multiple sources for a given query.
 *
 * Pipeline:
 *   1. Classify query → policy (diversity caps, weight distribution)
 *   2. For each source: split into blocks, score BM25 against query
 *   3. Compute composite score per block: relevance × authority × structured
 *   4. Apply per-domain diversity cap
 *   5. Ensure minimum domain diversity (promote under-represented domains)
 *   6. Return top blocks within budget
 */
export function selectEvidence(options: SelectEvidenceOptions): SelectionResult {
  const {
    query,
    sources,
    maxBlocks = 12,
    maxChars = 6000,
    policyOverride,
  } = options;

  // Step 1: Classify query and build policy
  const basePolicy = classifyQuery(query);
  const policy: QueryPolicy = { ...basePolicy, ...policyOverride };

  if (sources.length === 0) {
    return { blocks: [], totalCandidates: 0, sourcesUsed: 0, policy };
  }

  // Tokenize query for BM25
  const queryTerms = query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1);

  // Step 2-3: Score all blocks from all sources
  interface CandidateBlock {
    text: string;
    sourceUrl: string;
    sourceTitle: string;
    domain: string;
    bm25Score: number;
    authorityScore: number;
    structuredScore: number;
    compositeScore: number;
    hasStructuredSignal: boolean;
    contentMode: 'content' | 'snippet';
  }

  const candidates: CandidateBlock[] = [];

  for (const source of sources) {
    const bestText = getBestEvidenceText(source);
    const text = bestText.text;
    if (!text || text.length < 20) continue;

    const blocks = splitIntoBlocks(text);
    if (blocks.length === 0) continue;

    const bm25Scores = queryTerms.length > 0
      ? scoreBM25(blocks, queryTerms)
      : blocks.map(() => 0.1); // small baseline when no query terms

    const authority = scoreDomainAuthority(source.url);
    const structuredSrc = sourceStructuredScore({ ...source, content: text });
    const domain = extractRegisteredDomain(source.url);

    for (let i = 0; i < blocks.length; i++) {
      const raw = blocks[i].raw;
      // Skip very short blocks (nav fragments, single words)
      if (raw.length < 30) continue;

      // Normalize BM25 to 0-1 range using sigmoid
      const rawBm25 = bm25Scores[i];
      const normBm25 = rawBm25 > 0
        ? 2 / (1 + Math.exp(-rawBm25 * 4)) - 1
        : 0;

      // Per-block structured signal
      const blockStructured = detectStructuredSignal(raw);
      const combinedStructured = Math.min(1.0, structuredSrc * 0.6 + blockStructured * 0.4);

      // Composite: weighted sum per policy
      const composite =
        normBm25 * policy.relevanceWeight +
        authority * policy.authorityWeight +
        combinedStructured * policy.structuredWeight;

      candidates.push({
        text: raw,
        sourceUrl: source.url,
        sourceTitle: source.title,
        domain,
        bm25Score: normBm25,
        authorityScore: authority,
        structuredScore: combinedStructured,
        compositeScore: composite,
        hasStructuredSignal: combinedStructured > 0.15,
        contentMode: bestText.mode === 'snippet' ? 'snippet' : 'content',
      });
    }
  }

  const totalCandidates = candidates.length;
  if (totalCandidates === 0) {
    return { blocks: [], totalCandidates: 0, sourcesUsed: 0, policy };
  }

  // Step 4: Sort by composite score, apply per-domain cap
  candidates.sort((a, b) => b.compositeScore - a.compositeScore);

  const domainBlockCounts = new Map<string, number>();
  const selected: CandidateBlock[] = [];
  let charBudget = maxChars;

  for (const c of candidates) {
    if (selected.length >= maxBlocks) break;
    if (charBudget <= 0) break;

    const domainCount = domainBlockCounts.get(c.domain) ?? 0;
    if (domainCount >= policy.maxBlocksPerDomain) continue;

    // Don't exceed char budget
    if (c.text.length > charBudget) {
      // If block is small enough to partially fit and we have no blocks yet, take it
      if (selected.length === 0) {
        selected.push({ ...c, text: c.text.substring(0, charBudget) });
        charBudget = 0;
        domainBlockCounts.set(c.domain, domainCount + 1);
      }
      continue;
    }

    selected.push(c);
    charBudget -= c.text.length;
    domainBlockCounts.set(c.domain, domainCount + 1);
  }

  // Step 5: Ensure minimum domain diversity
  // If we haven't hit minDomains, try to swap in blocks from under-represented domains
  const selectedDomains = new Set(selected.map(s => s.domain));
  if (selectedDomains.size < policy.minDomains && selected.length > 1) {
    // Find domains not yet represented
    const allDomains = new Set(candidates.map(c => c.domain));
    const missingDomains = [...allDomains].filter(d => !selectedDomains.has(d));

    for (const missingDomain of missingDomains) {
      if (selectedDomains.size >= policy.minDomains) break;

      // Find best block from this domain
      const domainBest = candidates.find(
        c => c.domain === missingDomain && !selected.includes(c),
      );
      if (!domainBest || domainBest.compositeScore <= 0) continue;

      // Replace the lowest-scored block from the most-represented domain
      // (only if the replacement isn't drastically worse)
      const domainCounts = new Map<string, number>();
      for (const s of selected) {
        domainCounts.set(s.domain, (domainCounts.get(s.domain) ?? 0) + 1);
      }

      // Find the domain with the most blocks
      let maxDomain = '';
      let maxCount = 0;
      for (const [d, c] of domainCounts) {
        if (c > maxCount) { maxCount = c; maxDomain = d; }
      }

      // Only swap if the over-represented domain has 2+ blocks
      if (maxCount < 2) continue;

      // Find the worst block from that domain
      const worstIdx = selected.reduce((worst, s, i) => {
        if (s.domain !== maxDomain) return worst;
        if (worst === -1) return i;
        return s.compositeScore < selected[worst].compositeScore ? i : worst;
      }, -1);

      if (worstIdx === -1) continue;

      // Only swap if the replacement isn't more than 40% worse
      const worstScore = selected[worstIdx].compositeScore;
      if (domainBest.compositeScore >= worstScore * 0.6) {
        selected[worstIdx] = domainBest;
        selectedDomains.add(missingDomain);
      }
    }
  }

  // Build result
  const sourcesUsed = new Set(selected.map(s => s.sourceUrl)).size;

  const blocks: SelectedBlock[] = selected.map(c => ({
    text: c.text,
    sourceUrl: c.sourceUrl,
    sourceTitle: c.sourceTitle,
    score: c.compositeScore,
    hasStructuredSignal: c.hasStructuredSignal,
    contentMode: c.contentMode,
  }));

  return { blocks, totalCandidates, sourcesUsed, policy };
}

// ---------------------------------------------------------------------------
// Convenience: format selected evidence for LLM context
// ---------------------------------------------------------------------------

/**
 * Format selected evidence blocks into a numbered, source-attributed string
 * suitable for LLM context injection.
 *
 * Preserves exact facts/numbers — no summarization or transformation.
 */
export function formatEvidenceForLLM(result: SelectionResult): string {
  if (result.blocks.length === 0) return '';

  // Group blocks by source for readability
  const sourceGroups = new Map<string, SelectedBlock[]>();
  for (const block of result.blocks) {
    const key = block.sourceUrl;
    if (!sourceGroups.has(key)) sourceGroups.set(key, []);
    sourceGroups.get(key)!.push(block);
  }

  const parts: string[] = [];
  let sourceIdx = 1;
  for (const [url, blocks] of sourceGroups) {
    const title = blocks[0].sourceTitle;
    const structuredTag = blocks.some(b => b.hasStructuredSignal) ? ' [structured]' : '';
    const snippetTag = blocks.every(b => b.contentMode === 'snippet') ? ' [snippet]' : '';
    parts.push(`[${sourceIdx}] ${title}${structuredTag}${snippetTag}\nURL: ${url}\n\n${blocks.map(b => b.text).join('\n\n')}`);
    sourceIdx++;
  }

  return parts.join('\n\n---\n\n');
}
