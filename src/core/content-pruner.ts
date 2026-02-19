/**
 * Content Density Pruner
 *
 * Scores HTML block elements by text quality and removes low-value blocks
 * (sidebars, footers, navigation, ads) that CSS selectors miss.
 *
 * Inspired by Crawl4AI's fit_markdown approach — typical 40-60% token savings.
 */

import * as cheerio from 'cheerio';
import type { AnyNode, Element } from 'domhandler';

export interface PruneOptions {
  /** Score threshold (0-1). Blocks below this are removed. Default: 0.4 */
  threshold?: number;
  /** Minimum word count for a block to be considered. Default: 3 */
  minWords?: number;
  /** Whether threshold adapts to content distribution. Default: true */
  dynamic?: boolean;
}

export interface PruneResult {
  /** Pruned HTML */
  html: string;
  /** Number of nodes removed */
  nodesRemoved: number;
  /** Percentage of content removed (by character count) */
  reductionPercent: number;
}

/** Block-level elements we score */
const BLOCK_ELEMENTS = new Set([
  'div', 'section', 'article', 'aside', 'nav', 'footer', 'header',
  'main', 'p', 'ul', 'ol', 'table', 'blockquote', 'figure', 'form', 'details',
]);

/**
 * Elements that should NEVER be removed — they are content containers.
 * Scoring them would be wrong: if we remove <main>, we lose everything.
 */
const PROTECTED_ELEMENTS = new Set(['main', 'article', 'body']);

/**
 * Tag importance scores (-2 to +3).
 * These reflect semantic value of the element type.
 */
const TAG_IMPORTANCE: Record<string, number> = {
  article: 3,
  main: 3,
  p: 2,
  h1: 2, h2: 2, h3: 2, h4: 2, h5: 2, h6: 2,
  blockquote: 2,
  pre: 2,
  code: 2,
  figure: 2,
  figcaption: 2,
  section: 1,
  td: 1,
  th: 1,
  li: 1,
  dd: 1,
  dt: 1,
  div: 0,
  span: 0,
  aside: -1,
  header: -1,
  form: -1,
  nav: -2,
  footer: -2,
};

/** Normalize tag importance (-2..+3) to 0..1 range */
function normalizeTagScore(rawScore: number): number {
  // Range is 5 units (-2 to +3), shift by +2 and divide
  return (rawScore + 2) / 5;
}

function getTagImportance(tagName: string): number {
  return TAG_IMPORTANCE[tagName.toLowerCase()] ?? 0;
}

/** Word count bonus using log scale (0-1) */
function wordCountBonus(text: string): number {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  if (words.length === 0) return 0;
  return Math.min(Math.log(words.length + 1) / Math.log(1000), 1.0);
}

/**
 * Position weight based on normalized position in document (0-1).
 * Middle 60% of the page (0.2–0.8) scores 1.0.
 * Top/bottom 20% scores linearly from 0 to 1.
 */
function positionWeight(normalizedPos: number): number {
  if (normalizedPos >= 0.2 && normalizedPos <= 0.8) return 1.0;
  if (normalizedPos < 0.2) return normalizedPos / 0.2;
  // normalizedPos > 0.8
  return (1.0 - normalizedPos) / 0.2;
}

/** Intermediate data for a scored block element */
interface BlockData {
  element: AnyNode;
  tagName: string;
  htmlLength: number;
  visibleText: string;
  textDensity: number;
  linkDensity: number;
  normalizedTagScore: number;
  wordBonus: number;
  score: number; // calculated after all blocks found (needs position)
}

/** Max HTML length for a "leaf" block — blocks larger than this are recursed into */
const MAX_LEAF_BLOCK_HTML = 5000;

/**
 * Score a single element and return its BlockData.
 */
function scoreElement(
  $: cheerio.CheerioAPI,
  el: Element,
): BlockData {
  const tagName = el.tagName?.toLowerCase() ?? '';
  const $el = $(el);
  const outerHtml = $.html($el) ?? '';

  // Clone to compute visible text (strip scripts/styles)
  const clone = $el.clone();
  clone.find('script, style, noscript').remove();
  const visibleText = clone.text() ?? '';
  const visibleTextLen = visibleText.trim().length;
  const totalHtmlLen = Math.max(outerHtml.length, 1);

  // Text density: ratio of visible text to total HTML length
  const textDensity = Math.min(visibleTextLen / totalHtmlLen, 1.0);

  // Link density: ratio of link text to visible text
  let linkTextLen = 0;
  $el.find('a').each((_i, aEl) => {
    linkTextLen += ($(aEl).text() ?? '').trim().length;
  });
  const linkDensity = visibleTextLen > 0
    ? Math.min(linkTextLen / visibleTextLen, 1.0)
    : 0;

  return {
    element: el,
    tagName,
    htmlLength: outerHtml.length,
    visibleText,
    textDensity,
    linkDensity,
    normalizedTagScore: normalizeTagScore(getTagImportance(tagName)),
    wordBonus: wordCountBonus(visibleText),
    score: 0,
  };
}

/**
 * Recursively collect block elements for scoring.
 * 
 * Key insight: if a block is very large (>MAX_LEAF_BLOCK_HTML chars), we recurse
 * into its children instead of treating it as one unit. This handles sites like HN
 * (table-based layout) and sites wrapped in a single <div>.
 * 
 * Protected elements (main, article, body) are always recursed into.
 */
function collectBlocks(
  $: cheerio.CheerioAPI,
  parent: AnyNode,
  blocks: BlockData[],
  totalHtmlLength: number,
  depth: number = 0,
): void {
  const children = 'children' in parent ? (parent.children as AnyNode[]) : [];
  for (const child of children) {
    if (child.type !== 'tag') continue;
    const el = child as Element;
    const tagName = el.tagName?.toLowerCase() ?? '';

    if (BLOCK_ELEMENTS.has(tagName)) {
      const data = scoreElement($, el);
      
      // Recurse into large blocks, protected elements, and layout containers
      // to find the actual content sub-blocks
      const isLarge = data.htmlLength > MAX_LEAF_BLOCK_HTML;
      const isProtected = PROTECTED_ELEMENTS.has(tagName);
      const isLayoutContainer = tagName === 'div' || tagName === 'section' || tagName === 'table';
      
      if ((isLarge && isLayoutContainer) || isProtected) {
        // Recurse into children to find sub-blocks
        collectBlocks($, el, blocks, totalHtmlLength, depth + 1);
      } else {
        // Score this block as a leaf
        blocks.push(data);
      }
    } else if (tagName === 'tr' || tagName === 'td' || tagName === 'th' || tagName === 'tbody' || tagName === 'thead') {
      // Table layout elements — recurse through them to find block content
      collectBlocks($, el, blocks, totalHtmlLength, depth + 1);
    } else {
      // Non-block element — recurse to find nested blocks
      collectBlocks($, el, blocks, totalHtmlLength, depth + 1);
    }
  }
}

/**
 * Compute the max of an array of numbers.
 */
function maxValue(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.max(...values);
}

/**
 * Prune low-value HTML blocks using content density scoring.
 *
 * @param html - Raw HTML to prune
 * @param options - Pruning configuration
 * @returns Pruned HTML with stats
 */
export function pruneContent(html: string, options: PruneOptions = {}): PruneResult {
  const {
    threshold = 0.4,
    minWords = 3,
    dynamic = true,
  } = options;

  const originalLength = html.length;

  if (!html.trim()) {
    return { html, nodesRemoved: 0, reductionPercent: 0 };
  }

  const $ = cheerio.load(html);

  // Collect top-level block elements from the body
  const blocks: BlockData[] = [];
  const bodyEl = $('body').get(0);
  if (bodyEl) {
    collectBlocks($, bodyEl, blocks, originalLength);
  }

  // If no blocks found (very sparse HTML), return as-is
  if (blocks.length === 0) {
    return { html, nodesRemoved: 0, reductionPercent: 0 };
  }

  // Assign position weights and compute composite scores
  const n = blocks.length;
  for (let i = 0; i < n; i++) {
    const block = blocks[i]!;
    const normalizedPos = n > 1 ? i / (n - 1) : 0.5;
    const posWeight = positionWeight(normalizedPos);

    block.score = (
      block.textDensity * 0.35 +
      (1 - block.linkDensity) * 0.25 +
      block.normalizedTagScore * 0.2 +
      block.wordBonus * 0.1 +
      posWeight * 0.1
    );
  }

  // Determine effective threshold
  let effectiveThreshold = threshold;
  if (dynamic) {
    // Use the best-block score as the reference: remove blocks that score below
    // 40% of the highest-quality block. This handles the common bimodal case
    // (one great article block + several low-quality nav/sidebar blocks) much
    // better than median/mean approaches.
    const scores = blocks.map((b) => b.score);
    const best = maxValue(scores);
    effectiveThreshold = best * 0.4;
  }

  // Safety floor: we must retain at least 30% of the original HTML
  const minRetainLength = Math.ceil(originalLength * 0.3);

  // Sort ascending by score so we remove worst blocks first
  const sortedAsc = [...blocks].sort((a, b) => a.score - b.score);

  const toRemove = new Set<AnyNode>();
  let removedLength = 0;

  for (const block of sortedAsc) {
    // Never remove protected containers
    if (PROTECTED_ELEMENTS.has(block.tagName)) continue;

    const words = block.visibleText.trim().split(/\s+/).filter((w) => w.length > 0);
    const isTinyBlock = words.length < minWords;
    const isLowScore = block.score < effectiveThreshold;

    // Keep blocks that pass both checks
    if (!isTinyBlock && !isLowScore) continue;

    // Always check safety floor before removing — even for empty blocks.
    // This prevents over-pruning when every block is low quality.
    const remainingLength = originalLength - (removedLength + block.htmlLength);
    if (remainingLength >= minRetainLength) {
      toRemove.add(block.element);
      removedLength += block.htmlLength;
    }
  }

  // Remove selected elements from the DOM
  for (const el of toRemove) {
    $(el).remove();
  }

  const resultHtml = $.html() ?? html;
  const resultLength = resultHtml.length;
  const reductionPercent = originalLength > 0
    ? Math.max(0, Math.round(((originalLength - resultLength) / originalLength) * 100))
    : 0;

  return {
    html: resultHtml,
    nodesRemoved: toRemove.size,
    reductionPercent,
  };
}
