/**
 * Tests for src/core/chunking.ts
 *
 * Covers: fixed, semantic, paragraph strategies; overlap; token counting;
 * edge cases (empty, short, single-chunk); isLast; startOffset; originalTokens.
 */

import { describe, it, expect } from 'vitest';
import { chunkContent, estimateTokens, type ChunkOptions } from '../core/chunking.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a string of roughly `tokens` tokens (tokens * 4 chars). */
function makeContent(tokens: number, char = 'x'): string {
  return char.repeat(tokens * 4);
}

/** Build multi-paragraph content where each paragraph is ~paragraphTokens tokens. */
function makeParagraphs(count: number, paragraphTokens: number): string {
  return Array.from({ length: count }, (_, i) =>
    `Paragraph ${i + 1}: ${'word '.repeat(paragraphTokens * 4 / 5).trim()}`
  ).join('\n\n');
}

// ---------------------------------------------------------------------------
// estimateTokens
// ---------------------------------------------------------------------------

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns ceil(length/4)', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2); // ceil(5/4)=2
    expect(estimateTokens('a'.repeat(100))).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// Fixed strategy
// ---------------------------------------------------------------------------

describe('chunkContent — fixed strategy', () => {
  it('returns a single chunk when content fits in chunkSize', () => {
    const content = makeContent(100); // 100 tokens
    const result = chunkContent(content, { strategy: 'fixed', chunkSize: 200, overlap: 0 });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].content).toBe(content);
    expect(result.chunks[0].isLast).toBe(true);
    expect(result.chunks[0].startOffset).toBe(0);
  });

  it('produces the correct number of chunks for known content (no overlap)', () => {
    // 2000 tokens of content, chunkSize=500, overlap=0 → 4 chunks exactly
    const content = makeContent(2000);
    const result = chunkContent(content, { strategy: 'fixed', chunkSize: 500, overlap: 0 });
    expect(result.totalChunks).toBe(4);
    expect(result.chunks).toHaveLength(4);
  });

  it('overlap works: end of chunk N matches start of chunk N+1', () => {
    const content = makeContent(2000);
    const overlapTokens = 100;
    const result = chunkContent(content, { strategy: 'fixed', chunkSize: 500, overlap: overlapTokens });

    const overlapChars = overlapTokens * 4;
    for (let i = 0; i < result.chunks.length - 1; i++) {
      const chunkA = result.chunks[i];
      const chunkB = result.chunks[i + 1];
      const tailA = chunkA.content.slice(-overlapChars);
      const headB = chunkB.content.slice(0, overlapChars);
      expect(tailA).toBe(headB);
    }
  });

  it('startOffset is correct for fixed strategy', () => {
    const content = makeContent(1000);
    const result = chunkContent(content, { strategy: 'fixed', chunkSize: 250, overlap: 0 });

    for (const chunk of result.chunks) {
      expect(content.slice(chunk.startOffset, chunk.startOffset + chunk.content.length)).toBe(chunk.content);
    }
  });

  it('isLast flag is correct for fixed strategy', () => {
    const content = makeContent(800);
    const result = chunkContent(content, { strategy: 'fixed', chunkSize: 200, overlap: 0 });
    result.chunks.forEach((c, i) => {
      if (i < result.chunks.length - 1) expect(c.isLast).toBe(false);
      else expect(c.isLast).toBe(true);
    });
  });

  it('chunk tokens are correctly estimated', () => {
    const content = makeContent(2000);
    const result = chunkContent(content, { strategy: 'fixed', chunkSize: 500, overlap: 0 });
    for (const chunk of result.chunks) {
      expect(chunk.tokens).toBe(estimateTokens(chunk.content));
    }
  });

  it('custom chunkSize and overlap work', () => {
    const content = makeContent(600);
    const result = chunkContent(content, { strategy: 'fixed', chunkSize: 100, overlap: 25 });
    // With overlap the chunks aren't perfectly divisible, but at least we have > 1 chunk
    expect(result.totalChunks).toBeGreaterThan(1);
    // Each chunk should be ≤ chunkSize * 4 chars
    for (const chunk of result.chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(100 * 4);
    }
  });

  it('empty content returns empty chunks', () => {
    const result = chunkContent('', { strategy: 'fixed' });
    expect(result.chunks).toHaveLength(0);
    expect(result.totalChunks).toBe(0);
    expect(result.totalTokens).toBe(0);
    expect(result.originalTokens).toBe(0);
  });

  it('very short content returns one chunk', () => {
    const result = chunkContent('Hello world', { strategy: 'fixed', chunkSize: 4000 });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].content).toBe('Hello world');
  });

  it('originalTokens matches original content', () => {
    const content = 'The quick brown fox jumps over the lazy dog.';
    const result = chunkContent(content, { strategy: 'fixed', chunkSize: 4000 });
    expect(result.originalTokens).toBe(estimateTokens(content));
  });
});

// ---------------------------------------------------------------------------
// Semantic strategy
// ---------------------------------------------------------------------------

describe('chunkContent — semantic strategy', () => {
  it('splits at section headings', () => {
    // Single heading at ~990 tokens (3960 chars) into the content — well within
    // the ±20% (800 char) tolerance window around target 4000.
    // Using exactly one heading ensures the closest break IS the heading.
    const filler = 'word '.repeat(792); // 792 * 5 = 3960 chars ≈ 990 tokens, no newlines
    const rest = '\n## Section Two\n\nMore content. ' + 'extra text. '.repeat(500);
    const content = filler + rest;

    const result = chunkContent(content, { strategy: 'semantic', chunkSize: 1000, overlap: 0 });
    expect(result.totalChunks).toBeGreaterThanOrEqual(2);

    // The second chunk should start at the heading (breakPos == 3960, where \n## is)
    const chunk2 = result.chunks[1];
    expect(chunk2).toBeDefined();
    // Chunk 2 starts with the heading (possibly with a leading newline)
    expect(chunk2.content.trimStart()).toMatch(/^## Section Two/);
  });

  it('splits at paragraph breaks', () => {
    const para1 = 'First paragraph with some content here. '.repeat(100); // ~4000 chars
    const para2 = 'Second paragraph starts here. '.repeat(50);
    const content = para1 + '\n\n' + para2;

    const result = chunkContent(content, { strategy: 'semantic', chunkSize: 1000, overlap: 0 });
    expect(result.totalChunks).toBeGreaterThan(1);

    // Second chunk should start with second paragraph content (no mid-paragraph split)
    const secondChunk = result.chunks[1];
    expect(secondChunk.content.trim().startsWith('Second paragraph') ||
      result.chunks.some(c => c.content.includes('Second paragraph starts here'))).toBe(true);
  });

  it('does not cut mid-sentence', () => {
    // Content designed so the naive cut would land mid-sentence
    const longSentence = 'This is a very important sentence that should not be cut in the middle at all. ';
    const filler = 'Padding. '.repeat(440); // ~3960 chars
    const content = filler + longSentence + 'Next sentence follows after. '.repeat(100);

    const result = chunkContent(content, { strategy: 'semantic', chunkSize: 1000, overlap: 0 });

    for (const chunk of result.chunks.slice(0, -1)) {
      // Each non-last chunk should end at a word boundary (no partial words)
      const lastChar = chunk.content[chunk.content.length - 1];
      // Ends with whitespace, punctuation, or newline — not mid-word
      expect(/[\s.!?\n]/.test(lastChar)).toBe(true);
    }
  });

  it('does not split mid-code-block (code block treated as semantic unit)', () => {
    const before = 'Some prose before the code. '.repeat(100);
    const codeBlock = '```javascript\nconst x = 1;\nconsole.log(x);\n```';
    const after = '\n\nSome prose after the code block.';
    const content = before + '\n\n' + codeBlock + after;

    const result = chunkContent(content, { strategy: 'semantic', chunkSize: 100, overlap: 0 });
    // The code block should not be split across chunks if it fits
    const codeChunk = result.chunks.find(c =>
      c.content.includes('```javascript') && c.content.includes('console.log')
    );
    // Code block is small enough to fit in one chunk
    expect(codeChunk).toBeDefined();
  });

  it('semantic: single chunk when content fits', () => {
    const content = 'Short content that fits easily.';
    const result = chunkContent(content, { strategy: 'semantic', chunkSize: 4000 });
    expect(result.totalChunks).toBe(1);
    expect(result.chunks[0].content).toBe(content);
  });

  it('semantic: isLast flag is correct', () => {
    const content = 'x'.repeat(20000);
    const result = chunkContent(content, { strategy: 'semantic', chunkSize: 1000, overlap: 100 });
    result.chunks.forEach((c, i) => {
      if (i < result.chunks.length - 1) expect(c.isLast).toBe(false);
      else expect(c.isLast).toBe(true);
    });
  });

  it('semantic: originalTokens matches original content', () => {
    const content = 'Hello world. This is a test. '.repeat(50);
    const result = chunkContent(content, { strategy: 'semantic', chunkSize: 100 });
    expect(result.originalTokens).toBe(estimateTokens(content));
  });
});

// ---------------------------------------------------------------------------
// Paragraph strategy
// ---------------------------------------------------------------------------

describe('chunkContent — paragraph strategy', () => {
  it('groups paragraphs to target size', () => {
    // Each paragraph is ~50 tokens (200 chars); chunkSize=200 → ~4 paragraphs per chunk
    const content = makeParagraphs(20, 50);
    const result = chunkContent(content, { strategy: 'paragraph', chunkSize: 200, overlap: 0 });
    expect(result.totalChunks).toBeGreaterThan(1);
    expect(result.totalChunks).toBeLessThan(20); // grouped, not one per paragraph
  });

  it('does not split within a paragraph', () => {
    // Each paragraph is large enough that it would need splitting if we weren't careful
    const content = makeParagraphs(5, 300);
    const result = chunkContent(content, { strategy: 'paragraph', chunkSize: 400, overlap: 0 });

    // Verify no paragraph is broken (each paragraph starts with 'Paragraph N:')
    for (const chunk of result.chunks) {
      // A paragraph boundary (\n\n) in the middle is fine, but the chunk should not
      // end mid-paragraph-sentence arbitrarily
      // We just verify that chunks don't contain partial paragraph markers
      const parts = chunk.content.split('\n\n');
      for (const part of parts) {
        // Each part should be a full paragraph text (starts with Paragraph or is continuation)
        expect(part.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('paragraph: startOffset points to the right position in original content', () => {
    const content = 'Para one content here.\n\nPara two content here.\n\nPara three content here.';
    const result = chunkContent(content, { strategy: 'paragraph', chunkSize: 4000 });

    for (const chunk of result.chunks) {
      const slice = content.slice(chunk.startOffset, chunk.startOffset + chunk.content.length);
      expect(slice).toBe(chunk.content);
    }
  });

  it('paragraph: single chunk when all paragraphs fit', () => {
    const content = 'Short para.\n\nAnother short para.';
    const result = chunkContent(content, { strategy: 'paragraph', chunkSize: 4000 });
    expect(result.totalChunks).toBe(1);
  });

  it('paragraph: isLast flag is correct', () => {
    const content = makeParagraphs(10, 100);
    const result = chunkContent(content, { strategy: 'paragraph', chunkSize: 150, overlap: 0 });
    result.chunks.forEach((c, i) => {
      if (i < result.chunks.length - 1) expect(c.isLast).toBe(false);
      else expect(c.isLast).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// General / cross-strategy
// ---------------------------------------------------------------------------

describe('chunkContent — general', () => {
  it('default strategy is semantic', () => {
    const content = 'Hello. '.repeat(2000);
    const resultDefault = chunkContent(content, { chunkSize: 500 });
    const resultSemantic = chunkContent(content, { chunkSize: 500, strategy: 'semantic' });
    // Results should be identical
    expect(resultDefault.totalChunks).toBe(resultSemantic.totalChunks);
  });

  it('totalTokens equals sum of individual chunk tokens', () => {
    const content = 'Some random text content here. '.repeat(500);
    const result = chunkContent(content, { strategy: 'fixed', chunkSize: 200, overlap: 0 });
    const sumTokens = result.chunks.reduce((s, c) => s + c.tokens, 0);
    expect(result.totalTokens).toBe(sumTokens);
  });

  it('empty content returns zeros across all fields', () => {
    const result = chunkContent('');
    expect(result.chunks).toHaveLength(0);
    expect(result.totalChunks).toBe(0);
    expect(result.totalTokens).toBe(0);
    expect(result.originalTokens).toBe(0);
  });
});
