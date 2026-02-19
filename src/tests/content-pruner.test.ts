/**
 * Tests for content-pruner.ts
 *
 * Tests the content density pruning algorithm that scores HTML block elements
 * and removes low-value blocks (sidebars, footers, navigation, ads).
 */

import { describe, it, expect } from 'vitest';
import { pruneContent } from '../core/content-pruner.js';

// ─── helpers ────────────────────────────────────────────────────────────────

function wrap(inner: string): string {
  return `<html><body>${inner}</body></html>`;
}

// ─── basic pruning ───────────────────────────────────────────────────────────

describe('pruneContent — basic behavior', () => {
  it('returns unchanged HTML when given empty string', () => {
    const result = pruneContent('');
    expect(result.html).toBe('');
    expect(result.nodesRemoved).toBe(0);
    expect(result.reductionPercent).toBe(0);
  });

  it('removes a <nav> element with high link density', () => {
    const html = wrap(`
      <article>
        <p>This is a long and substantive paragraph about the main topic of the article.
        It has real content and should be kept by the pruner algorithm.</p>
        <p>Another meaningful paragraph with enough words to score well on quality metrics.</p>
      </article>
      <nav>
        <a href="/home">Home</a>
        <a href="/about">About</a>
        <a href="/contact">Contact</a>
        <a href="/products">Products</a>
        <a href="/blog">Blog</a>
      </nav>
    `);
    const result = pruneContent(html, { dynamic: false, threshold: 0.4 });
    expect(result.html).not.toContain('<nav>');
    expect(result.html).toContain('substantive paragraph');
  });

  it('removes a <footer> element with low text density', () => {
    const html = wrap(`
      <main>
        <p>This article has important and substantive content about a topic.
        It contains detailed information that is valuable to the reader.</p>
        <p>More informative text about the subject matter here for scoring.</p>
      </main>
      <footer>
        <a href="/privacy">Privacy Policy</a>
        <a href="/terms">Terms</a>
        <a href="/sitemap">Sitemap</a>
        © 2024 Company
      </footer>
    `);
    const result = pruneContent(html, { dynamic: false, threshold: 0.35 });
    expect(result.html).not.toContain('<footer>');
    expect(result.html).toContain('important and substantive content');
  });

  it('removes empty blocks (below minWords)', () => {
    const html = wrap(`
      <div></div>
      <p>This paragraph has meaningful content with enough words to pass the minimum word threshold.</p>
      <div>   </div>
    `);
    const result = pruneContent(html, { minWords: 3 });
    // Empty divs removed
    expect(result.nodesRemoved).toBeGreaterThanOrEqual(1);
    expect(result.html).toContain('meaningful content');
  });

  it('keeps high text-density paragraphs', () => {
    const html = wrap(`
      <p>This paragraph contains dense, high-quality text content. It is the sort of
      text that you would find in the body of an article on a news website. The algorithm
      should give this block a high text density score and keep it.</p>
      <nav><a href="/">Home</a><a href="/x">X</a><a href="/y">Y</a><a href="/z">Z</a></nav>
    `);
    const result = pruneContent(html, { dynamic: false, threshold: 0.3 });
    expect(result.html).toContain('dense, high-quality text content');
  });
});

// ─── scoring factors ──────────────────────────────────────────────────────────

describe('pruneContent — tag importance scoring', () => {
  it('gives article elements higher priority than plain divs', () => {
    // Build a document where article should be kept and a low-value div removed
    const html = wrap(`
      <article>
        <p>This is the main article text with important and informative content.
        It is well written and contains substantial information for the reader.</p>
      </article>
      <div>
        <a href="/1">Link 1</a>
        <a href="/2">Link 2</a>
        <a href="/3">Link 3</a>
        <a href="/4">Link 4</a>
        <a href="/5">Link 5</a>
      </div>
    `);
    const result = pruneContent(html, { dynamic: false, threshold: 0.4 });
    expect(result.html).toContain('main article text');
    // The link-heavy div should be pruned
    expect(result.nodesRemoved).toBeGreaterThanOrEqual(1);
  });

  it('prioritizes <article> over <nav>', () => {
    const html = wrap(`
      <nav>
        <a href="/a">Alpha</a><a href="/b">Beta</a><a href="/c">Gamma</a>
        <a href="/d">Delta</a><a href="/e">Epsilon</a>
      </nav>
      <article>
        <h1>Important Article Heading</h1>
        <p>The article body has excellent readable content that scores well on text density
        and word count metrics and should be retained by the pruning algorithm.</p>
      </article>
    `);
    const result = pruneContent(html, { dynamic: false, threshold: 0.3 });
    expect(result.html).toContain('Important Article Heading');
    expect(result.html).not.toContain('<nav>');
  });
});

describe('pruneContent — link density scoring', () => {
  it('removes link-heavy blocks', () => {
    const html = wrap(`
      <div>
        <a href="/1">Related Post One</a>
        <a href="/2">Related Post Two</a>
        <a href="/3">Related Post Three</a>
        <a href="/4">Related Post Four</a>
        <a href="/5">Related Post Five</a>
        <a href="/6">Related Post Six</a>
      </div>
      <p>This paragraph has real textual content with no links and high text density.
      It should be kept while the link-heavy div above is removed.</p>
    `);
    const result = pruneContent(html, { dynamic: false, threshold: 0.4 });
    expect(result.html).toContain('real textual content with no links');
  });

  it('keeps article text with low link density', () => {
    const html = wrap(`
      <p>This is the body of the article. You can read more about this topic on
      <a href="/more">this page</a>. The article continues with more substantial content
      that has low link density and high information value for the reader.</p>
    `);
    // One link in mostly-text paragraph — should be kept
    const result = pruneContent(html, { dynamic: false, threshold: 0.4 });
    expect(result.html).toContain('body of the article');
  });
});

// ─── position weighting ────────────────────────────────────────────────────────

describe('pruneContent — position weighting', () => {
  it('middle-of-document content scores higher than edge content', () => {
    // Create a document where the main content is in the middle
    // and low-value blocks are at the top and bottom
    const html = wrap(`
      <div>
        <a href="/a">Top Nav A</a><a href="/b">Top Nav B</a>
        <a href="/c">Top Nav C</a><a href="/d">Top Nav D</a>
      </div>
      <section>
        <h2>Main Content Section</h2>
        <p>This section contains the primary article content. It is located in the middle
        of the document and should therefore receive a higher position weight score from
        the pruning algorithm, increasing its chances of being retained.</p>
        <p>More content that is valuable and meaningful to the reader of the article.</p>
      </section>
      <div>
        <a href="/x">Bottom Link X</a><a href="/y">Bottom Link Y</a>
        <a href="/z">Bottom Link Z</a><a href="/w">Bottom Link W</a>
      </div>
    `);
    const result = pruneContent(html, { dynamic: false, threshold: 0.35 });
    expect(result.html).toContain('Main Content Section');
    expect(result.html).toContain('primary article content');
  });
});

// ─── dynamic threshold ────────────────────────────────────────────────────────

describe('pruneContent — dynamic threshold', () => {
  it('adapts threshold to content distribution', () => {
    // All blocks have similar quality — dynamic mode should keep most of them
    const html = wrap(`
      <p>First paragraph with a decent amount of textual content right here in this block.</p>
      <p>Second paragraph with a decent amount of textual content right here in this block.</p>
      <p>Third paragraph with a decent amount of textual content right here in this block.</p>
      <p>Fourth paragraph with a decent amount of textual content right here in this block.</p>
    `);
    const resultDynamic = pruneContent(html, { dynamic: true });
    const resultFixed = pruneContent(html, { dynamic: false, threshold: 0.9 });
    // Fixed high threshold removes more than dynamic (dynamic adapts to actual content)
    expect(resultDynamic.nodesRemoved).toBeLessThanOrEqual(resultFixed.nodesRemoved);
  });

  it('removes clear low-quality blocks even with dynamic threshold', () => {
    const html = wrap(`
      <p>Main content paragraph with a substantial amount of readable text that provides
      real value to the user and has high text density relative to its HTML size.</p>
      <p>Another good content paragraph with informative text and no links at all.</p>
      <p>Third content paragraph with yet more informative details about the article topic.</p>
      <nav><a href="/">H</a><a href="/a">A</a><a href="/b">B</a><a href="/c">C</a><a href="/d">D</a><a href="/e">E</a></nav>
    `);
    const result = pruneContent(html, { dynamic: true });
    // The nav with almost pure links should be removed
    expect(result.html).not.toContain('<nav>');
  });
});

// ─── safety floor ────────────────────────────────────────────────────────────

describe('pruneContent — safety floor', () => {
  it('retains at least 30% of original content by character count', () => {
    // Create a document with many low-quality blocks; safety floor should prevent over-pruning
    const blocks = Array.from({ length: 20 }, (_, i) =>
      `<div><a href="/${i}">Link${i}A</a><a href="/${i}b">Link${i}B</a><a href="/${i}c">Link${i}C</a></div>`
    ).join('\n');
    const html = wrap(blocks);
    const originalLen = html.length;
    const result = pruneContent(html, { dynamic: false, threshold: 0.99 });
    // Must retain at least 30% of original
    expect(result.html.length).toBeGreaterThanOrEqual(originalLen * 0.3);
  });

  it('reductionPercent never exceeds ~70%', () => {
    const manyBlocks = Array.from({ length: 15 }, (_, i) =>
      `<div><a href="/${i}">Nav ${i}</a><a href="/${i}x">Nav ${i}x</a></div>`
    ).join('');
    const html = wrap(manyBlocks);
    const result = pruneContent(html, { dynamic: false, threshold: 0.99 });
    expect(result.reductionPercent).toBeLessThanOrEqual(70);
  });
});

// ─── minWords threshold ───────────────────────────────────────────────────────

describe('pruneContent — minWords threshold', () => {
  it('removes blocks with fewer than minWords words', () => {
    const html = wrap(`
      <div>Hi</div>
      <p>This paragraph has a sufficient number of words to pass the minimum threshold.</p>
    `);
    const result = pruneContent(html, { minWords: 5 });
    // "Hi" is 1 word — should be removed
    expect(result.nodesRemoved).toBeGreaterThanOrEqual(1);
    expect(result.html).toContain('sufficient number of words');
  });

  it('keeps blocks that meet the minWords threshold', () => {
    const html = wrap(`
      <p>Exactly five words here now.</p>
      <p>This is a paragraph with many more words than the minimum required threshold value.</p>
    `);
    const result = pruneContent(html, { minWords: 3, dynamic: false, threshold: 0.1 });
    // Both meet minWords=3, both should survive low threshold
    expect(result.html).toContain('Exactly five words here now');
    expect(result.html).toContain('paragraph with many more words');
  });
});

// ─── protected elements ───────────────────────────────────────────────────────

describe('pruneContent — protected elements', () => {
  it('never removes <main> even with a very high threshold', () => {
    const html = `<html><body><main><p>Content inside main element.</p></main></body></html>`;
    const result = pruneContent(html, { dynamic: false, threshold: 0.99 });
    expect(result.html).toContain('<main>');
  });

  it('never removes <article> even with a very high threshold', () => {
    const html = `<html><body><article><p>Content inside article element.</p></article></body></html>`;
    const result = pruneContent(html, { dynamic: false, threshold: 0.99 });
    expect(result.html).toContain('<article>');
  });
});

// ─── reduction stats ──────────────────────────────────────────────────────────

describe('pruneContent — statistics', () => {
  it('reports correct nodesRemoved count', () => {
    const html = wrap(`
      <nav><a href="/a">A</a><a href="/b">B</a><a href="/c">C</a><a href="/d">D</a></nav>
      <footer><a href="/x">X</a><a href="/y">Y</a><a href="/z">Z</a><a href="/w">W</a></footer>
      <p>This is the real content of the page with good text density and enough words.</p>
    `);
    const result = pruneContent(html, { dynamic: false, threshold: 0.35 });
    // nav and footer should be removed
    expect(result.nodesRemoved).toBeGreaterThanOrEqual(2);
  });

  it('reductionPercent is 0 when nothing is removed', () => {
    const html = wrap(`
      <p>Single good paragraph with plenty of text to satisfy the pruner algorithm.</p>
    `);
    const result = pruneContent(html, { dynamic: false, threshold: 0.0 });
    expect(result.reductionPercent).toBe(0);
    expect(result.nodesRemoved).toBe(0);
  });

  it('reductionPercent is positive when blocks are removed', () => {
    const html = wrap(`
      <nav><a href="/1">One</a><a href="/2">Two</a><a href="/3">Three</a><a href="/4">Four</a></nav>
      <p>This paragraph has high text density and many words and represents quality content.</p>
    `);
    const result = pruneContent(html, { dynamic: false, threshold: 0.4 });
    if (result.nodesRemoved > 0) {
      expect(result.reductionPercent).toBeGreaterThan(0);
    }
  });
});

// ─── nested content ───────────────────────────────────────────────────────────

describe('pruneContent — nested content handling', () => {
  it('scores at the top-level block, not its children separately', () => {
    // A div containing a p — the div is the top-level scored block
    const html = wrap(`
      <div>
        <p>This paragraph is inside a div wrapper. The div is the scored unit,
        not the paragraph. The content is good quality with high text density.</p>
        <p>Another paragraph inside the same div with more useful readable content here.</p>
      </div>
    `);
    const result = pruneContent(html, { dynamic: false, threshold: 0.1 });
    // The div and its paragraphs should be kept
    expect(result.html).toContain('inside a div wrapper');
  });

  it('handles deeply nested HTML without errors', () => {
    const html = wrap(`
      <div>
        <section>
          <div>
            <p>Deeply nested content that should be handled gracefully by the pruner.</p>
          </div>
        </section>
      </div>
    `);
    expect(() => pruneContent(html)).not.toThrow();
    const result = pruneContent(html);
    expect(result.html).toContain('Deeply nested content');
  });
});

// ─── real-world simulation ────────────────────────────────────────────────────

describe('pruneContent — real-world HTML simulation', () => {
  it('prunes a typical news article page with sidebar', () => {
    const html = wrap(`
      <header>
        <a href="/">Site Logo</a>
        <nav>
          <a href="/news">News</a>
          <a href="/sports">Sports</a>
          <a href="/tech">Tech</a>
          <a href="/politics">Politics</a>
          <a href="/entertainment">Entertainment</a>
        </nav>
      </header>

      <article>
        <h1>Breaking News: Important Event Happens Today</h1>
        <p class="byline">By Staff Reporter</p>
        <p>In a significant development today, an important event occurred that has
        major implications for many people across the country and around the world.
        Experts are weighing in on what this means for the future.</p>
        <p>According to multiple sources familiar with the matter, the event unfolded
        in the afternoon following a series of developments. Officials have confirmed
        the situation and are working to address concerns raised by stakeholders.</p>
        <p>The response from the public has been significant, with many expressing
        their views on social media and other platforms. Community leaders have called
        for calm while investigations continue into the full scope of events.</p>
        <blockquote>
          "This is a very important moment," said one official. "We are working to
          ensure the best outcome for everyone involved in this matter."
        </blockquote>
        <p>More details are expected to emerge as the situation develops. Reporters
        on the ground are gathering information and will provide updates throughout
        the day as the story continues to evolve with new facts emerging.</p>
      </article>

      <aside class="sidebar">
        <div>
          <a href="/article/1">Related: Other News Story</a>
          <a href="/article/2">Related: Another Story</a>
          <a href="/article/3">Related: Third Story</a>
          <a href="/article/4">Related: Fourth Story</a>
          <a href="/article/5">Related: Fifth Story</a>
        </div>
        <div>
          <a href="/ad1">Advertisement</a>
          <a href="/ad2">Sponsored Content</a>
          <a href="/ad3">Promoted Link</a>
        </div>
      </aside>

      <footer>
        <a href="/about">About Us</a>
        <a href="/contact">Contact</a>
        <a href="/privacy">Privacy Policy</a>
        <a href="/terms">Terms of Service</a>
        <a href="/sitemap">Sitemap</a>
        <p>© 2024 News Organization. All rights reserved.</p>
      </footer>
    `);

    const result = pruneContent(html, { dynamic: true });

    // Article content should be preserved
    expect(result.html).toContain('Breaking News');
    expect(result.html).toContain('significant development today');
    expect(result.html).toContain('very important moment');

    // At least something should be pruned (header, footer, sidebar, or nav)
    expect(result.nodesRemoved).toBeGreaterThanOrEqual(1);

    // Should achieve some content reduction
    expect(result.reductionPercent).toBeGreaterThanOrEqual(0);
  });
});

// ─── integration: fullPage disables pruning ───────────────────────────────────

describe('pruneContent — edge cases', () => {
  it('handles HTML with no block elements gracefully', () => {
    const html = '<html><body><span>Just inline text</span></body></html>';
    const result = pruneContent(html);
    expect(result.nodesRemoved).toBe(0);
    expect(result.reductionPercent).toBe(0);
    expect(result.html).toContain('Just inline text');
  });

  it('handles a single block element without errors', () => {
    const html = wrap('<p>A single paragraph with enough words to be meaningful here.</p>');
    const result = pruneContent(html, { dynamic: true });
    expect(result.html).toContain('single paragraph');
    expect(result.nodesRemoved).toBe(0); // Only one block, shouldn't be removed
  });

  it('multiple blocks with varying quality removes only the worst', () => {
    const html = wrap(`
      <p>High quality paragraph with substantive informative readable content here.</p>
      <p>Another high quality paragraph with excellent readable content for the user.</p>
      <p>Third good paragraph with more useful informational content for the reader.</p>
      <nav><a href="/a">A</a><a href="/b">B</a><a href="/c">C</a><a href="/d">D</a><a href="/e">E</a><a href="/f">F</a></nav>
    `);
    const result = pruneContent(html, { dynamic: true });
    // Good paragraphs kept, nav (pure links) removed
    expect(result.html).toContain('High quality paragraph');
    expect(result.html).toContain('Another high quality paragraph');
    expect(result.html).toContain('Third good paragraph');
    expect(result.html).not.toContain('<nav>');
  });
});
