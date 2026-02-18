/**
 * Tests for auto-extract listings, table formatting, CSV output, and pagination.
 */

import { describe, it, expect } from 'vitest';
import { extractListings, type ListingItem } from '../core/extract-listings.js';
import { formatTable } from '../core/table-format.js';
import { findNextPageUrl } from '../core/paginate.js';

/* ================================================================== */
/*  Fixtures                                                          */
/* ================================================================== */

/** Mock eBay-style search results page with 5 listings. */
const EBAY_HTML = `
<!DOCTYPE html>
<html>
<head><title>charizard card | eBay</title></head>
<body>
  <div class="srp-results">
    <ul class="srp-list">
      <li class="s-item">
        <div class="s-item__image"><img src="/img/charizard-vmax.jpg" alt="Charizard VMAX"></div>
        <h3 class="s-item__title">Charizard VMAX 020/189 Darkness Ablaze Ultra Rare</h3>
        <span class="s-item__price">$24.99</span>
        <a href="https://www.ebay.com/itm/123456">View</a>
        <span class="s-item__subtitle">Free shipping</span>
      </li>
      <li class="s-item">
        <div class="s-item__image"><img src="/img/charizard-ex.jpg" alt="Charizard EX"></div>
        <h3 class="s-item__title">Charizard EX 006/165 Scarlet Violet 151</h3>
        <span class="s-item__price">$15.00</span>
        <a href="https://www.ebay.com/itm/234567">View</a>
        <span class="s-item__subtitle">Hot item</span>
      </li>
      <li class="s-item">
        <div class="s-item__image"><img src="/img/charizard-gx.jpg" alt="Charizard GX"></div>
        <h3 class="s-item__title">Charizard GX SM211 Hidden Fates Promo</h3>
        <span class="s-item__price">$32.50</span>
        <a href="https://www.ebay.com/itm/345678">View</a>
      </li>
      <li class="s-item">
        <div class="s-item__image"><img src="/img/charizard-v.jpg" alt="Charizard V"></div>
        <h3 class="s-item__title">Charizard V 017/189 Full Art</h3>
        <span class="s-item__price">$8.99</span>
        <a href="https://www.ebay.com/itm/456789">View</a>
        <span class="s-item__rating" aria-label="4.5 out of 5 stars">4.5 stars</span>
      </li>
      <li class="s-item">
        <div class="s-item__image"><img src="/img/charizard-vstar.jpg" alt="Charizard VSTAR"></div>
        <h3 class="s-item__title">Charizard VSTAR GG70/GG70 Crown Zenith</h3>
        <span class="s-item__price">$19.75</span>
        <a href="https://www.ebay.com/itm/567890">View</a>
      </li>
    </ul>
  </div>
</body>
</html>
`;

/** Mock Amazon-style product listing page. */
const AMAZON_HTML = `
<!DOCTYPE html>
<html>
<head><title>Results for "wireless mouse"</title></head>
<body>
  <div class="s-main-slot">
    <div class="s-result-item" data-asin="B08ABC1">
      <img src="https://m.media-amazon.com/mouse1.jpg" alt="Mouse 1">
      <h2 class="a-text-normal"><a href="/dp/B08ABC1">Logitech M720 Triathlon Mouse</a></h2>
      <span class="a-price"><span class="a-offscreen">$49.99</span></span>
      <span class="a-icon-alt">4.6 out of 5 stars</span>
      <p class="a-text-normal">Multi-device wireless mouse</p>
    </div>
    <div class="s-result-item" data-asin="B08ABC2">
      <img src="https://m.media-amazon.com/mouse2.jpg" alt="Mouse 2">
      <h2 class="a-text-normal"><a href="/dp/B08ABC2">Razer DeathAdder V3</a></h2>
      <span class="a-price"><span class="a-offscreen">$89.99</span></span>
      <span class="a-icon-alt">4.8 out of 5 stars</span>
      <p class="a-text-normal">Ergonomic gaming mouse</p>
    </div>
    <div class="s-result-item" data-asin="B08ABC3">
      <img src="https://m.media-amazon.com/mouse3.jpg" alt="Mouse 3">
      <h2 class="a-text-normal"><a href="/dp/B08ABC3">Microsoft Arc Mouse</a></h2>
      <span class="a-price"><span class="a-offscreen">$59.99</span></span>
      <span class="a-icon-alt">4.3 out of 5 stars</span>
      <p class="a-text-normal">Slim, portable design</p>
    </div>
    <div class="s-result-item" data-asin="B08ABC4">
      <img src="https://m.media-amazon.com/mouse4.jpg" alt="Mouse 4">
      <h2 class="a-text-normal"><a href="/dp/B08ABC4">Apple Magic Mouse</a></h2>
      <span class="a-price"><span class="a-offscreen">$79.00</span></span>
      <span class="a-icon-alt">4.5 out of 5 stars</span>
      <p class="a-text-normal">Multi-Touch surface</p>
    </div>
  </div>
</body>
</html>
`;

/** Hacker News-style listing. */
const HN_HTML = `
<!DOCTYPE html>
<html>
<body>
  <table class="itemlist">
    <tr class="athing">
      <td class="title"><a href="https://example.com/post1" class="titlelink">Show HN: My new project</a></td>
    </tr>
    <tr class="athing">
      <td class="title"><a href="https://example.com/post2" class="titlelink">Ask HN: What are you working on?</a></td>
    </tr>
    <tr class="athing">
      <td class="title"><a href="https://example.com/post3" class="titlelink">A deep dive into Rust ownership</a></td>
    </tr>
  </table>
</body>
</html>
`;

/* ================================================================== */
/*  extractListings                                                   */
/* ================================================================== */

describe('extractListings', () => {
  it('extracts listings from eBay-style HTML', () => {
    const items = extractListings(EBAY_HTML, 'https://www.ebay.com/sch/i.html?_nkw=charizard');
    expect(items.length).toBe(5);

    expect(items[0].title).toBe('Charizard VMAX 020/189 Darkness Ablaze Ultra Rare');
    expect(items[0].price).toBe('$24.99');
    expect(items[0].link).toBe('https://www.ebay.com/itm/123456');
    expect(items[0].image).toContain('charizard-vmax.jpg');

    expect(items[1].title).toBe('Charizard EX 006/165 Scarlet Violet 151');
    expect(items[1].price).toBe('$15.00');

    expect(items[4].title).toContain('Charizard VSTAR');
    expect(items[4].price).toBe('$19.75');
  });

  it('extracts ratings when present', () => {
    const items = extractListings(EBAY_HTML);
    const rated = items.find(i => i.rating);
    expect(rated).toBeDefined();
    expect(rated!.rating).toContain('4.5');
  });

  it('extracts listings from Amazon-style HTML', () => {
    const items = extractListings(AMAZON_HTML, 'https://www.amazon.com/s?k=wireless+mouse');
    expect(items.length).toBe(4);

    expect(items[0].title).toContain('Logitech');
    expect(items[0].price).toBe('$49.99');
    expect(items[0].image).toBe('https://m.media-amazon.com/mouse1.jpg');
    expect(items[0].link).toBe('https://www.amazon.com/dp/B08ABC1');

    expect(items[2].title).toContain('Microsoft Arc Mouse');
    expect(items[2].price).toBe('$59.99');
  });

  it('resolves relative image and link URLs', () => {
    const items = extractListings(EBAY_HTML, 'https://www.ebay.com/sch/i.html?_nkw=charizard');
    // Images are relative in the fixture
    expect(items[0].image).toBe('https://www.ebay.com/img/charizard-vmax.jpg');
  });

  it('extracts from Hacker News-style HTML', () => {
    const items = extractListings(HN_HTML, 'https://news.ycombinator.com');
    expect(items.length).toBe(3);
    expect(items[0].title).toBe('Show HN: My new project');
    expect(items[0].link).toBe('https://example.com/post1');
  });

  it('returns empty array for empty HTML', () => {
    expect(extractListings('')).toEqual([]);
    expect(extractListings('  ')).toEqual([]);
  });

  it('returns empty array for page with no listings', () => {
    const html = `
      <html><body>
        <h1>About Us</h1>
        <p>We are a great company.</p>
        <p>Contact us at hello@example.com.</p>
      </body></html>
    `;
    expect(extractListings(html)).toEqual([]);
  });

  it('filters out items with very short titles', () => {
    const html = `
      <html><body>
        <ul>
          <li><h3>OK</h3><a href="/a">link</a></li>
          <li><h3>AB</h3><a href="/b">link</a></li>
          <li><h3>A valid title here</h3><a href="/c">link</a></li>
          <li><h3>Another valid title</h3><a href="/d">link</a></li>
          <li><h3>Third valid title</h3><a href="/e">link</a></li>
        </ul>
      </body></html>
    `;
    const items = extractListings(html);
    // "AB" is < 3 chars, should be filtered
    for (const item of items) {
      expect((item.title?.length ?? 0)).toBeGreaterThanOrEqual(3);
    }
  });
});

/* ================================================================== */
/*  findNextPageUrl                                                   */
/* ================================================================== */

describe('findNextPageUrl', () => {
  const BASE = 'https://example.com/results?page=1';

  it('finds rel="next" link', () => {
    const html = '<html><body><a rel="next" href="/results?page=2">Next</a></body></html>';
    expect(findNextPageUrl(html, BASE)).toBe('https://example.com/results?page=2');
  });

  it('finds link rel="next"', () => {
    const html = '<html><head><link rel="next" href="/results?page=2"></head><body></body></html>';
    expect(findNextPageUrl(html, BASE)).toBe('https://example.com/results?page=2');
  });

  it('finds aria-label="next" link', () => {
    const html = '<html><body><a aria-label="Go to next page" href="/results?page=2">›</a></body></html>';
    expect(findNextPageUrl(html, BASE)).toBe('https://example.com/results?page=2');
  });

  it('finds class*="next" link', () => {
    const html = '<html><body><a class="pagination-next" href="/results?page=2">Next Page</a></body></html>';
    expect(findNextPageUrl(html, BASE)).toBe('https://example.com/results?page=2');
  });

  it('finds "Next" text link', () => {
    const html = '<html><body><a href="/page/2">Next</a></body></html>';
    expect(findNextPageUrl(html, BASE)).toBe('https://example.com/page/2');
  });

  it('finds "»" text link', () => {
    const html = '<html><body><a href="/results?p=2">»</a></body></html>';
    expect(findNextPageUrl(html, BASE)).toBe('https://example.com/results?p=2');
  });

  it('finds "›" text link', () => {
    const html = '<html><body><a href="/results?p=2">›</a></body></html>';
    expect(findNextPageUrl(html, BASE)).toBe('https://example.com/results?p=2');
  });

  it('resolves relative URLs correctly', () => {
    const html = '<html><body><a rel="next" href="?page=2">Next</a></body></html>';
    expect(findNextPageUrl(html, BASE)).toBe('https://example.com/results?page=2');
  });

  it('returns null when no next link found', () => {
    const html = '<html><body><p>No pagination here</p></body></html>';
    expect(findNextPageUrl(html, BASE)).toBeNull();
  });

  it('returns null for empty HTML', () => {
    expect(findNextPageUrl('', BASE)).toBeNull();
  });

  it('skips "prev" links that have next in class', () => {
    // A link with class "next-prev-button" but text "Previous" should be skipped
    const html = `
      <html><body>
        <a class="next-prev-button" href="/page/0">Previous</a>
        <a class="next-page" href="/page/2">Next</a>
      </body></html>
    `;
    // Should find the "Next" link, not the "Previous" one
    expect(findNextPageUrl(html, BASE)).toBe('https://example.com/page/2');
  });

  it('ignores javascript: hrefs', () => {
    const html = '<html><body><a rel="next" href="javascript:void(0)">Next</a></body></html>';
    expect(findNextPageUrl(html, BASE)).toBeNull();
  });
});

/* ================================================================== */
/*  formatTable                                                       */
/* ================================================================== */

describe('formatTable', () => {
  it('renders a basic table with box-drawing characters', () => {
    const rows = [
      { title: 'Widget A', price: '$10' },
      { title: 'Widget B', price: '$20' },
    ];
    const table = formatTable(rows);

    expect(table).toContain('┌');
    expect(table).toContain('┐');
    expect(table).toContain('└');
    expect(table).toContain('┘');
    expect(table).toContain('│');
    expect(table).toContain('─');
    expect(table).toContain('Widget A');
    expect(table).toContain('Widget B');
    expect(table).toContain('$10');
    expect(table).toContain('$20');
    expect(table).toContain('Title');
    expect(table).toContain('Price');
  });

  it('auto-sizes columns', () => {
    const rows = [
      { a: 'short', b: 'a much longer column value' },
      { a: 'x', b: 'y' },
    ];
    const table = formatTable(rows);
    const lines = table.split('\n');
    // All lines should be the same width (box-drawing alignment)
    const widths = new Set(lines.map(l => l.length));
    expect(widths.size).toBe(1);
  });

  it('truncates long values with ellipsis', () => {
    const rows = [
      { title: 'A'.repeat(50) },
    ];
    const table = formatTable(rows);
    expect(table).toContain('…');
  });

  it('returns empty string for empty rows', () => {
    expect(formatTable([])).toBe('');
  });

  it('omits columns that are entirely empty', () => {
    const rows = [
      { title: 'A', price: undefined, link: 'http://a' },
      { title: 'B', price: undefined, link: 'http://b' },
    ];
    const table = formatTable(rows);
    expect(table).not.toContain('Price');
    expect(table).toContain('Title');
    expect(table).toContain('Link');
  });

  it('supports explicit column selection', () => {
    const rows = [
      { title: 'A', price: '$5', link: 'http://a', image: 'http://img' },
    ];
    const table = formatTable(rows, ['title', 'price']);
    expect(table).toContain('Title');
    expect(table).toContain('Price');
    expect(table).not.toContain('Link');
    expect(table).not.toContain('Image');
  });
});

/* ================================================================== */
/*  CSV formatting (using the same logic as CLI)                      */
/* ================================================================== */

describe('CSV formatting', () => {
  function formatCsv(items: Array<Record<string, string | undefined>>): string {
    if (items.length === 0) return '';
    const keySet = new Set<string>();
    for (const item of items) {
      for (const key of Object.keys(item)) {
        if (item[key] !== undefined) keySet.add(key);
      }
    }
    const keys = Array.from(keySet);
    const escapeCsv = (s: string | undefined): string => {
      if (s === undefined || s === null) return '""';
      const str = String(s);
      if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return '"' + str + '"';
    };
    const lines: string[] = [keys.join(',')];
    for (const item of items) {
      lines.push(keys.map(k => escapeCsv(item[k])).join(','));
    }
    return lines.join('\n') + '\n';
  }

  it('generates valid CSV header and rows', () => {
    const items: ListingItem[] = [
      { title: 'Charizard VMAX', price: '$24.99', link: 'https://ebay.com/itm/123' },
      { title: 'Charizard EX', price: '$15.00', link: 'https://ebay.com/itm/234' },
    ];
    const csv = formatCsv(items);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('title,price,link');
    expect(lines[1]).toContain('Charizard VMAX');
    expect(lines[1]).toContain('$24.99');
    expect(lines.length).toBe(3); // header + 2 data rows
  });

  it('escapes values with commas and quotes', () => {
    const items = [
      { title: 'Item with, comma', price: '$10' },
      { title: 'Item with "quotes"', price: '$20' },
    ];
    const csv = formatCsv(items);
    expect(csv).toContain('"Item with, comma"');
    expect(csv).toContain('"Item with ""quotes"""');
  });

  it('handles empty array', () => {
    expect(formatCsv([])).toBe('');
  });

  it('handles undefined values', () => {
    const items: ListingItem[] = [
      { title: 'Item A', price: undefined },
    ];
    const csv = formatCsv(items);
    expect(csv).toContain('title');
    // price column should be excluded (all undefined)
    expect(csv).not.toContain('price');
  });
});
