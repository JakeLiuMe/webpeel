/**
 * Smart content distillation for WebPeel
 *
 * Intelligently compresses content to fit within a token budget using
 * heuristic-based techniques — no LLM required.
 *
 * This is NOT simple truncation: it prioritises information-dense content
 * and progressively removes lower-value sections while preserving structure.
 *
 * @module budget
 */

import { estimateTokens } from './markdown.js';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/**
 * Heading patterns that indicate low-value boilerplate sections.
 * When a heading matches, its entire section is removed.
 */
const BOILERPLATE_HEADING_PATTERNS: RegExp[] = [
  /^#{1,3}\s*(cookie(s| notice| policy| banner| consent)?|privacy( policy)?|terms( of (use|service))?|disclaimer|copyright)/i,
  /^#{1,3}\s*(about us|contact( us)?|subscribe|newsletter|follow us|social media)/i,
  /^#{1,3}\s*(related posts?|you may also|more from|popular posts?|trending|recent posts?)/i,
  /^#{1,3}\s*(comments?|leave a (comment|reply)|tags?|categories?|share this)/i,
  /^#{1,3}\s*(table of contents?|toc|index)/i,
  /^#{1,3}\s*(advertisement|sponsored|promoted|ad(s| section)?)/i,
  /^#{1,3}\s*(navigation|menu|sidebar|footer|header)/i,
  /^#{1,3}\s*(sign[\s-]*up|log[\s-]*in|register|create( an)? account|get started)/i,
];

/** Maximum data rows to keep when compressing a markdown table */
const MAX_TABLE_ROWS = 3;

/** Tokens per listing item used for budget estimation in extract-all mode */
export const TOKENS_PER_LISTING_ITEM = 50;

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Distill content to fit within a token budget using smart compression.
 *
 * Strategy (applied progressively until within budget):
 * 1. Remove image markdown — ![alt](url) → keep meaningful alt text
 * 2. Remove boilerplate sections (cookie banners, nav headings, etc.)
 * 3. Compress tables to MAX_TABLE_ROWS data rows
 * 4. Collapse redundant whitespace
 * 5. Remove low information-density paragraphs
 * 6. Hard-truncate with notice as last resort
 *
 * @param content  The content string to distill
 * @param budget   Maximum token budget (rough: 1 token ≈ 4 chars)
 * @param format   Content format: 'markdown' | 'text' | 'json'
 * @returns        Distilled content within the budget
 */
export function distillToBudget(
  content: string,
  budget: number,
  format: 'markdown' | 'text' | 'json',
): string {
  if (!content || budget <= 0) return content;
  if (estimateTokens(content) <= budget) return content;

  if (format === 'json') {
    return distillJson(content, budget);
  }

  return distillMarkdown(content, budget);
}

/**
 * Calculate how many listing items fit within a token budget.
 *
 * @param totalItems  Total available items
 * @param budget      Token budget
 * @returns           { maxItems, truncated, totalAvailable }
 */
export function budgetListings(
  totalItems: number,
  budget: number,
): { maxItems: number; truncated: boolean; totalAvailable: number } {
  const maxItems = Math.max(1, Math.floor(budget / TOKENS_PER_LISTING_ITEM));
  const truncated = maxItems < totalItems;
  return {
    maxItems: truncated ? maxItems : totalItems,
    truncated,
    totalAvailable: totalItems,
  };
}

/* ------------------------------------------------------------------ */
/*  Markdown / text distillation                                       */
/* ------------------------------------------------------------------ */

function distillMarkdown(content: string, budget: number): string {
  let result = content;

  // Step 1: Remove decorative images (minimal info loss)
  if (estimateTokens(result) > budget) {
    result = removeImages(result);
  }

  // Step 2: Remove boilerplate sections
  if (estimateTokens(result) > budget) {
    result = removeBoilerplateSections(result);
  }

  // Step 3: Compress wide tables
  if (estimateTokens(result) > budget) {
    result = compressTables(result);
  }

  // Step 4: Collapse redundant whitespace
  if (estimateTokens(result) > budget) {
    result = compressWhitespace(result);
  }

  // Step 5: Remove low-density paragraphs
  if (estimateTokens(result) > budget) {
    result = removeWeakParagraphs(result, budget);
  }

  // Step 6: Hard-truncate with notice as last resort
  if (estimateTokens(result) > budget) {
    result = hardTruncate(result, budget);
  }

  return result.trim();
}

/**
 * Remove image markdown — replace informative alt text, drop decorative images.
 */
function removeImages(content: string): string {
  return content
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, (_, alt: string) => {
      const a = alt.trim();
      // Keep short, descriptive alt text as a text label
      return a.length > 0 && a.length < 60 ? `[Image: ${a}]` : '';
    })
    // Clean up empty image labels that remain
    .replace(/\[Image: \]\s*/g, '');
}

/**
 * Remove boilerplate sections by matching heading patterns.
 *
 * When a boilerplate heading is found, everything up to (but not including)
 * the next heading of equal or higher importance is removed.
 */
function removeBoilerplateSections(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let skipping = false;
  let skipDepth = 0;

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s/);

    if (headingMatch) {
      const depth = headingMatch[1].length;

      // Stop skipping when we encounter a heading of equal or higher priority
      if (skipping && depth <= skipDepth) {
        skipping = false;
      }

      // Check if this heading starts a boilerplate section
      if (!skipping && BOILERPLATE_HEADING_PATTERNS.some(p => p.test(line))) {
        skipping = true;
        skipDepth = depth;
        continue;
      }
    }

    if (!skipping) {
      result.push(line);
    }
  }

  return result.join('\n');
}

/**
 * Compress markdown tables to MAX_TABLE_ROWS data rows + header + separator.
 */
function compressTables(content: string): string {
  const lines = content.split('\n');
  const result: string[] = [];
  let inTable = false;
  let headerDone = false;
  let separatorDone = false;
  let dataRows = 0;
  let truncatedNote = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const isTableRow = trimmed.startsWith('|') && trimmed.endsWith('|');
    const isSeparator = isTableRow && /^\|[\s|:-]+\|$/.test(trimmed);

    if (isTableRow) {
      if (!inTable) {
        // New table begins
        inTable = true;
        headerDone = false;
        separatorDone = false;
        dataRows = 0;
        truncatedNote = false;
      }

      if (!headerDone) {
        result.push(line);
        headerDone = true;
      } else if (isSeparator && !separatorDone) {
        result.push(line);
        separatorDone = true;
      } else if (!isSeparator) {
        if (dataRows < MAX_TABLE_ROWS) {
          result.push(line);
          dataRows++;
        } else if (!truncatedNote) {
          result.push(`| ... | *(${MAX_TABLE_ROWS}+ rows — additional rows omitted)* | ... |`);
          truncatedNote = true;
        }
        // Further rows silently dropped
      }
    } else {
      inTable = false;
      result.push(line);
    }
  }

  return result.join('\n');
}

/**
 * Collapse runs of 3+ blank lines to a single blank line.
 */
function compressWhitespace(content: string): string {
  return content.replace(/\n{3,}/g, '\n\n');
}

/**
 * Remove paragraphs scored as low information-density until within budget.
 *
 * Scoring heuristics:
 * - Word count is the base score
 * - Very short paragraphs (< 50 chars) are heavily penalised
 * - Unusual avg word length penalised (nav menus, link lists)
 * - Long bullet lists scored slightly lower
 * - Headings and code blocks are never removed
 */
function removeWeakParagraphs(content: string, budget: number): string {
  const paragraphs = content.split('\n\n');

  const scored = paragraphs.map((para, i) => {
    const trimmed = para.trim();
    const isHeading = /^#{1,6}\s/.test(trimmed);
    const isCodeBlock = trimmed.startsWith('```');
    const isHtmlComment = trimmed.startsWith('<!--');

    // Never remove structural elements
    if (isHeading || isCodeBlock || isHtmlComment) {
      return { para, score: Number.MAX_SAFE_INTEGER, i };
    }

    // Strip markdown formatting for text analysis
    const textOnly = trimmed.replace(/[#*_\[\]\(\)\-`|>~]/g, '');
    const words = textOnly.split(/\s+/).filter(w => w.length > 0);
    let score = words.length;

    // Heavily penalise very short paragraphs (likely nav labels / single words)
    if (textOnly.length < 50) score *= 0.15;

    // Penalise unusual avg word lengths (short = icon labels, long = data URIs)
    const avgWordLen = words.length > 0 ? textOnly.length / words.length : 0;
    if (avgWordLen < 3 || avgWordLen > 15) score *= 0.4;

    // Slightly penalise long bullet lists (repetitive structure)
    const lines = trimmed.split('\n');
    const bulletLines = lines.filter(l => /^[-*]\s/.test(l.trim()));
    if (bulletLines.length > 3 && bulletLines.length === lines.length) {
      score *= 0.7;
    }

    return { para, score, i };
  });

  // Sort ascending — weakest paragraphs first
  const byScore = [...scored].sort((a, b) => a.score - b.score);

  const removed = new Set<number>();
  let current = content;

  for (const item of byScore) {
    if (estimateTokens(current) <= budget) break;
    // Don't remove paragraphs with reasonable content
    if (item.score >= 8) break;

    removed.add(item.i);
    current = scored
      .filter(s => !removed.has(s.i))
      .map(s => s.para)
      .join('\n\n');
  }

  return current;
}

/**
 * Hard-truncate at a clean line boundary, appending a notice.
 * Used only as the last resort after all other compression steps fail.
 */
function hardTruncate(content: string, budget: number): string {
  // Leave ~15 tokens for the truncation notice
  const maxChars = Math.max((budget - 15) * 4, 0);
  if (content.length <= maxChars) return content;

  // Find the last newline before the character limit
  let cut = maxChars;
  while (cut > 0 && content[cut] !== '\n') cut--;
  if (cut === 0) cut = maxChars; // No newline found — hard cut

  return content.slice(0, cut).trimEnd() + '\n\n[Content distilled to fit budget]';
}

/* ------------------------------------------------------------------ */
/*  JSON distillation                                                  */
/* ------------------------------------------------------------------ */

/**
 * Distill JSON content:
 * - Arrays: binary-search for the maximum number of items that fit
 * - Objects: fall back to text truncation
 */
function distillJson(content: string, budget: number): string {
  try {
    const parsed: unknown = JSON.parse(content);

    if (Array.isArray(parsed)) {
      // Binary search for max items that fit within budget
      let lo = 0;
      let hi = parsed.length;

      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const slice = parsed.slice(0, mid);
        if (estimateTokens(JSON.stringify(slice, null, 2)) <= budget) {
          lo = mid;
        } else {
          hi = mid - 1;
        }
      }

      return JSON.stringify(parsed.slice(0, lo), null, 2);
    }

    // Non-array JSON — fall back to text truncation
    const str = JSON.stringify(parsed, null, 2);
    if (estimateTokens(str) <= budget) return str;
    return hardTruncate(str, budget);
  } catch {
    // Invalid JSON — treat as plain text
    return hardTruncate(content, budget);
  }
}
