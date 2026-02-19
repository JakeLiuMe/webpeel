/**
 * Smart content chunking for LLM processing.
 *
 * Splits content into manageable pieces with configurable overlap and strategy.
 * Zero external dependencies; target <1ms for typical page content.
 */

export interface ChunkOptions {
  /** Target tokens per chunk. Default: 4000 */
  chunkSize?: number;
  /** Overlap tokens between chunks. Default: 200 */
  overlap?: number;
  /** Chunking strategy. Default: 'semantic' */
  strategy?: 'fixed' | 'semantic' | 'paragraph';
}

export interface Chunk {
  /** Chunk index (0-based) */
  index: number;
  /** Chunk content */
  content: string;
  /** Estimated tokens in this chunk */
  tokens: number;
  /** Character offset in original content */
  startOffset: number;
  /** Whether this is the last chunk */
  isLast: boolean;
}

export interface ChunkResult {
  /** Array of content chunks */
  chunks: Chunk[];
  /** Total chunks */
  totalChunks: number;
  /** Total tokens across all chunks */
  totalTokens: number;
  /** Original content tokens */
  originalTokens: number;
}

/** Estimate token count using chars/4 heuristic. Accurate within ±10%. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split content into chunks suitable for LLM processing.
 */
export function chunkContent(content: string, options?: ChunkOptions): ChunkResult {
  const chunkSize = options?.chunkSize ?? 4000;
  const overlap = options?.overlap ?? 200;
  const strategy = options?.strategy ?? 'semantic';

  const originalTokens = estimateTokens(content);

  if (content.length === 0) {
    return { chunks: [], totalChunks: 0, totalTokens: 0, originalTokens: 0 };
  }

  let rawChunks: Array<{ content: string; startOffset: number }>;

  switch (strategy) {
    case 'fixed':
      rawChunks = chunkFixed(content, chunkSize, overlap);
      break;
    case 'paragraph':
      rawChunks = chunkParagraph(content, chunkSize);
      break;
    case 'semantic':
    default:
      rawChunks = chunkSemantic(content, chunkSize, overlap);
      break;
  }

  const chunks: Chunk[] = rawChunks.map((raw, i) => ({
    index: i,
    content: raw.content,
    tokens: estimateTokens(raw.content),
    startOffset: raw.startOffset,
    isLast: i === rawChunks.length - 1,
  }));

  const totalTokens = chunks.reduce((sum, c) => sum + c.tokens, 0);

  return {
    chunks,
    totalChunks: chunks.length,
    totalTokens,
    originalTokens,
  };
}

// ---------------------------------------------------------------------------
// Fixed strategy
// ---------------------------------------------------------------------------

function chunkFixed(
  content: string,
  chunkSize: number,
  overlap: number
): Array<{ content: string; startOffset: number }> {
  const chunkChars = chunkSize * 4;
  const overlapChars = overlap * 4;
  const result: Array<{ content: string; startOffset: number }> = [];

  let start = 0;
  while (start < content.length) {
    const end = Math.min(start + chunkChars, content.length);
    result.push({ content: content.slice(start, end), startOffset: start });
    if (end >= content.length) break;
    start = end - overlapChars;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Semantic strategy
// ---------------------------------------------------------------------------

function findNaturalBreak(content: string, target: number, tolerance: number): number {
  const min = target - tolerance;
  const max = Math.min(target + tolerance, content.length);

  // 1. Heading break: newline immediately before ##
  const headingRe = /\n(?=#{1,6} )/g;
  let best: { pos: number; priority: number } | null = null;

  headingRe.lastIndex = min;
  let m = headingRe.exec(content);
  while (m && m.index <= max) {
    const dist = Math.abs(m.index - target);
    if (!best || best.priority < 4 || dist < Math.abs(best.pos - target)) {
      best = { pos: m.index, priority: 4 };
    }
    m = headingRe.exec(content);
  }

  // 2. Paragraph break: \n\n
  const paraRe = /\n\n/g;
  paraRe.lastIndex = min;
  m = paraRe.exec(content);
  while (m && m.index <= max) {
    const dist = Math.abs(m.index - target);
    if (!best || best.priority < 3 || (best.priority === 3 && dist < Math.abs(best.pos - target))) {
      best = { pos: m.index + 2, priority: 3 };
    }
    m = paraRe.exec(content);
  }

  // 3. Sentence end: '. ', '! ', '? ' followed by capital or newline
  const sentRe = /[.!?](?:\s+(?=[A-Z\n])|(?=\n))/g;
  sentRe.lastIndex = min;
  m = sentRe.exec(content);
  while (m && m.index <= max) {
    const pos = m.index + m[0].length;
    const dist = Math.abs(pos - target);
    if (!best || best.priority < 2 || (best.priority === 2 && dist < Math.abs(best.pos - target))) {
      best = { pos, priority: 2 };
    }
    m = sentRe.exec(content);
  }

  // 4. Word boundary (space)
  if (!best || best.priority < 1) {
    const spaceRe = / /g;
    spaceRe.lastIndex = min;
    m = spaceRe.exec(content);
    while (m && m.index <= max) {
      const pos = m.index + 1;
      const dist = Math.abs(pos - target);
      if (!best || (best.priority < 2 && dist < Math.abs(best.pos - target))) {
        best = { pos, priority: 1 };
      }
      m = spaceRe.exec(content);
    }
  }

  return best ? best.pos : Math.min(target, content.length);
}

function chunkSemantic(
  content: string,
  chunkSize: number,
  overlap: number
): Array<{ content: string; startOffset: number }> {
  const chunkChars = chunkSize * 4;
  const overlapChars = overlap * 4;
  const tolerance = Math.floor(chunkChars * 0.2);
  const result: Array<{ content: string; startOffset: number }> = [];

  let start = 0;
  while (start < content.length) {
    const remaining = content.length - start;

    // If the rest fits, take it all
    if (remaining <= chunkChars + tolerance) {
      result.push({ content: content.slice(start), startOffset: start });
      break;
    }

    const breakPos = findNaturalBreak(content, start + chunkChars, tolerance);
    const end = Math.max(breakPos, start + 1); // always advance

    result.push({ content: content.slice(start, end), startOffset: start });

    // Next chunk starts with overlap from end of this chunk
    const nextStart = Math.max(start + 1, end - overlapChars);
    start = nextStart;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Paragraph strategy
// ---------------------------------------------------------------------------

function chunkParagraph(
  content: string,
  chunkSize: number
): Array<{ content: string; startOffset: number }> {
  const chunkChars = chunkSize * 4;
  const paragraphs = content.split(/\n\n/);
  const result: Array<{ content: string; startOffset: number }> = [];

  let currentParts: string[] = [];
  let currentLen = 0;
  let currentOffset = 0;
  let offsetTracker = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    // +2 for the \n\n separator (except for first paragraph)
    const paraLen = para.length + (currentParts.length > 0 ? 2 : 0);

    if (currentParts.length > 0 && currentLen + paraLen > chunkChars) {
      // Flush current group
      result.push({ content: currentParts.join('\n\n'), startOffset: currentOffset });
      currentOffset = offsetTracker;
      currentParts = [para];
      currentLen = para.length;
    } else {
      if (currentParts.length === 0) {
        currentOffset = offsetTracker;
      }
      currentParts.push(para);
      currentLen += paraLen;
    }

    offsetTracker += para.length + 2; // account for \n\n
  }

  if (currentParts.length > 0) {
    result.push({ content: currentParts.join('\n\n'), startOffset: currentOffset });
  }

  return result;
}
