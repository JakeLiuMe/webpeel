/**
 * Tests for CSS schema-based extraction system.
 */

import { describe, it, expect } from 'vitest';
import {
  findSchemaForUrl,
  extractWithSchema,
  loadBundledSchemas,
  type ExtractionSchema,
} from '../core/schema-extraction.js';

/* ================================================================== */
/*  loadBundledSchemas                                                  */
/* ================================================================== */

describe('loadBundledSchemas', () => {
  it('returns an array of schemas', () => {
    const schemas = loadBundledSchemas();
    expect(Array.isArray(schemas)).toBe(true);
    expect(schemas.length).toBeGreaterThan(0);
  });

  it('each schema has required fields', () => {
    const schemas = loadBundledSchemas();
    for (const schema of schemas) {
      expect(typeof schema.name).toBe('string');
      expect(typeof schema.version).toBe('string');
      expect(Array.isArray(schema.domains)).toBe(true);
      expect(typeof schema.baseSelector).toBe('string');
      expect(Array.isArray(schema.fields)).toBe(true);
    }
  });

  it('includes expected schemas', () => {
    const schemas = loadBundledSchemas();
    const names = schemas.map(s => s.name);
    expect(names).toContain('Hacker News');
    expect(names).toContain('Amazon Product Search');
    expect(names).toContain('eBay Search Results');
    expect(names).toContain('Booking.com Hotel Search');
  });
});

/* ================================================================== */
/*  findSchemaForUrl                                                    */
/* ================================================================== */

describe('findSchemaForUrl', () => {
  it('matches Hacker News by domain', () => {
    const schema = findSchemaForUrl('https://news.ycombinator.com/');
    expect(schema).not.toBeNull();
    expect(schema?.name).toBe('Hacker News');
  });

  it('matches eBay by domain + URL pattern', () => {
    const schema = findSchemaForUrl('https://www.ebay.com/sch/i.html?_nkw=charizard');
    expect(schema).not.toBeNull();
    expect(schema?.name).toBe('eBay Search Results');
  });

  it('matches Amazon by domain + URL pattern', () => {
    const schema = findSchemaForUrl('https://www.amazon.com/s?k=laptop');
    expect(schema).not.toBeNull();
    expect(schema?.name).toBe('Amazon Product Search');
  });

  it('matches Amazon international domains', () => {
    const schemaUk = findSchemaForUrl('https://amazon.co.uk/s?k=laptop');
    expect(schemaUk?.name).toBe('Amazon Product Search');

    const schemaDe = findSchemaForUrl('https://amazon.de/s?k=laptop');
    expect(schemaDe?.name).toBe('Amazon Product Search');
  });

  it('matches Booking.com by domain + URL pattern', () => {
    const schema = findSchemaForUrl('https://www.booking.com/searchresults.html?ss=Paris');
    expect(schema).not.toBeNull();
    expect(schema?.name).toBe('Booking.com Hotel Search');
  });

  it('does NOT match Booking.com for non-search pages', () => {
    // Booking.com homepage has no urlPattern match (requires "searchresults")
    const schema = findSchemaForUrl('https://www.booking.com/');
    expect(schema).toBeNull();
  });

  it('matches Yelp by domain + URL pattern', () => {
    const schema = findSchemaForUrl('https://www.yelp.com/search?find_desc=pizza&find_loc=NYC');
    expect(schema).not.toBeNull();
    expect(schema?.name).toBe('Yelp Business Search');
  });

  it('matches Walmart by domain + URL pattern', () => {
    const schema = findSchemaForUrl('https://www.walmart.com/search?q=tv');
    expect(schema).not.toBeNull();
    expect(schema?.name).toBe('Walmart Product Search');
  });

  it('returns null for unknown domains', () => {
    expect(findSchemaForUrl('https://example.com/search')).toBeNull();
    expect(findSchemaForUrl('https://google.com/')).toBeNull();
    expect(findSchemaForUrl('https://twitter.com/')).toBeNull();
  });

  it('returns null for invalid URLs', () => {
    expect(findSchemaForUrl('not-a-url')).toBeNull();
    expect(findSchemaForUrl('')).toBeNull();
  });

  it('is case-insensitive for domains', () => {
    const schema = findSchemaForUrl('https://NEWS.ycombinator.com/');
    expect(schema).not.toBeNull();
    expect(schema?.name).toBe('Hacker News');
  });
});

/* ================================================================== */
/*  extractWithSchema                                                   */
/* ================================================================== */

describe('extractWithSchema', () => {
  /** Minimal schema for testing */
  const simpleSchema: ExtractionSchema = {
    name: 'Test Product Listings',
    version: '1.0',
    domains: ['test.com'],
    baseSelector: '.product',
    fields: [
      { name: 'title', selector: '.product-title', type: 'text' },
      { name: 'price', selector: '.product-price', type: 'text' },
      { name: 'link', selector: 'a.product-link', type: 'attribute', attribute: 'href' },
      { name: 'image', selector: 'img.product-img', type: 'attribute', attribute: 'src' },
      { name: 'inStock', selector: '.in-stock', type: 'exists' },
      { name: 'html', selector: '.product-desc', type: 'html' },
    ],
  };

  const PRODUCT_HTML = `
<!DOCTYPE html>
<html>
<body>
  <div class="product">
    <h3 class="product-title">Widget A</h3>
    <span class="product-price">$9.99</span>
    <a class="product-link" href="/products/widget-a">View</a>
    <img class="product-img" src="/img/widget-a.jpg" alt="Widget A">
    <span class="in-stock">In Stock</span>
    <div class="product-desc"><b>Great</b> widget</div>
  </div>
  <div class="product">
    <h3 class="product-title">Widget B</h3>
    <span class="product-price">$14.99</span>
    <a class="product-link" href="/products/widget-b">View</a>
    <img class="product-img" src="/img/widget-b.jpg" alt="Widget B">
    <div class="product-desc">Another widget</div>
  </div>
  <div class="product">
    <!-- empty, no title — should be filtered out -->
  </div>
</body>
</html>
`;

  it('extracts the correct number of items (skips empty-title items)', () => {
    const items = extractWithSchema(PRODUCT_HTML, simpleSchema);
    expect(items.length).toBe(2);
  });

  it('extracts text fields correctly', () => {
    const items = extractWithSchema(PRODUCT_HTML, simpleSchema);
    expect(items[0].title).toBe('Widget A');
    expect(items[0].price).toBe('$9.99');
    expect(items[1].title).toBe('Widget B');
    expect(items[1].price).toBe('$14.99');
  });

  it('extracts attribute fields correctly', () => {
    const items = extractWithSchema(PRODUCT_HTML, simpleSchema);
    expect(items[0].link).toBe('/products/widget-a');
    expect(items[0].image).toBe('/img/widget-a.jpg');
  });

  it('extracts exists fields correctly', () => {
    const items = extractWithSchema(PRODUCT_HTML, simpleSchema);
    expect(items[0].inStock).toBe(true);
    // Widget B has no .in-stock element — field should be absent or false
    expect(items[1].inStock).toBe(false);
  });

  it('extracts html fields correctly', () => {
    const items = extractWithSchema(PRODUCT_HTML, simpleSchema);
    expect(typeof items[0].html).toBe('string');
    expect((items[0].html as string)).toContain('<b>Great</b>');
  });

  it('resolves relative URLs when baseUrl is provided', () => {
    const items = extractWithSchema(PRODUCT_HTML, simpleSchema, 'https://shop.example.com');
    expect(items[0].link).toBe('https://shop.example.com/products/widget-a');
    expect(items[0].image).toBe('https://shop.example.com/img/widget-a.jpg');
  });

  it('keeps relative URLs when no baseUrl is provided', () => {
    const items = extractWithSchema(PRODUCT_HTML, simpleSchema);
    expect(items[0].link).toBe('/products/widget-a');
  });

  it('returns empty array for empty HTML', () => {
    expect(extractWithSchema('', simpleSchema)).toEqual([]);
    expect(extractWithSchema('   ', simpleSchema)).toEqual([]);
  });

  it('returns empty array when baseSelector matches nothing', () => {
    const items = extractWithSchema('<html><body><p>hello</p></body></html>', simpleSchema);
    expect(items).toEqual([]);
  });

  it('applies trim transform', () => {
    const schema: ExtractionSchema = {
      name: 'Trim Test',
      version: '1.0',
      domains: ['test.com'],
      baseSelector: '.item',
      fields: [
        { name: 'title', selector: '.title', type: 'text', transform: 'trim' },
      ],
    };
    const html = '<div class="item"><span class="title">  Padded Title  </span></div>';
    const items = extractWithSchema(html, schema);
    expect(items[0].title).toBe('Padded Title');
  });

  it('applies number transform', () => {
    const schema: ExtractionSchema = {
      name: 'Number Test',
      version: '1.0',
      domains: ['test.com'],
      baseSelector: '.item',
      fields: [
        { name: 'title', selector: '.title', type: 'text' },
        { name: 'count', selector: '.count', type: 'text', transform: 'number' },
      ],
    };
    const html = '<div class="item"><span class="title">Item</span><span class="count">42 reviews</span></div>';
    const items = extractWithSchema(html, schema);
    expect(items[0].count).toBe(42);
  });

  it('applies stripCurrency transform', () => {
    const schema: ExtractionSchema = {
      name: 'Currency Test',
      version: '1.0',
      domains: ['test.com'],
      baseSelector: '.item',
      fields: [
        { name: 'title', selector: '.title', type: 'text' },
        { name: 'price', selector: '.price', type: 'text', transform: 'stripCurrency' },
      ],
    };
    const html = '<div class="item"><span class="title">Item</span><span class="price">$24.99</span></div>';
    const items = extractWithSchema(html, schema);
    expect(items[0].price).toBe('24.99');
  });

  it('handles self-referencing attribute selector (empty selector = base element)', () => {
    const schema: ExtractionSchema = {
      name: 'Self Attr Test',
      version: '1.0',
      domains: ['test.com'],
      baseSelector: '[data-product]',
      fields: [
        { name: 'title', selector: 'h3', type: 'text' },
        { name: 'id', selector: '', type: 'attribute', attribute: 'data-product' },
      ],
    };
    const html = '<div data-product="prod-123"><h3>My Product</h3></div>';
    const items = extractWithSchema(html, schema);
    expect(items[0].id).toBe('prod-123');
  });

  it('extracts multiple values when multiple=true', () => {
    const schema: ExtractionSchema = {
      name: 'Multiple Test',
      version: '1.0',
      domains: ['test.com'],
      baseSelector: '.listing',
      fields: [
        { name: 'title', selector: '.title', type: 'text' },
        { name: 'tags', selector: '.tag', type: 'text', multiple: true },
      ],
    };
    const html = `
      <div class="listing">
        <span class="title">Article</span>
        <span class="tag">tech</span>
        <span class="tag">news</span>
        <span class="tag">AI</span>
      </div>
    `;
    const items = extractWithSchema(html, schema);
    expect(Array.isArray(items[0].tags)).toBe(true);
    expect(items[0].tags).toEqual(['tech', 'news', 'AI']);
  });
});

/* ================================================================== */
/*  Hacker News fixture test                                            */
/* ================================================================== */

describe('extractWithSchema — Hacker News fixture', () => {
  const HN_HTML = `
<!DOCTYPE html>
<html>
<body>
<table id="hnmain">
<tbody>
  <tr class="athing" id="1001">
    <td class="title"><span class="rank">1.</span></td>
    <td class="title">
      <span class="titleline">
        <a href="https://example.com/article-1">TypeScript is great</a>
        <span class="sitestr">example.com</span>
      </span>
    </td>
  </tr>
  <tr class="athing" id="1002">
    <td class="title"><span class="rank">2.</span></td>
    <td class="title">
      <span class="titleline">
        <a href="https://news.example.com/article-2">Ask HN: How do you stay focused?</a>
        <span class="sitestr">news.example.com</span>
      </span>
    </td>
  </tr>
  <tr class="athing" id="1003">
    <td class="title"><span class="rank">3.</span></td>
    <td class="title">
      <span class="titleline">
        <a href="https://another.com/post">New open source tool released</a>
        <span class="sitestr">another.com</span>
      </span>
    </td>
  </tr>
</tbody>
</table>
</body>
</html>
`;

  it('extracts HN stories using the bundled schema', () => {
    const schemas = loadBundledSchemas();
    const hnSchema = schemas.find(s => s.name === 'Hacker News');
    expect(hnSchema).toBeDefined();

    const items = extractWithSchema(HN_HTML, hnSchema!);
    expect(items.length).toBe(3);
  });

  it('extracts title and link from HN stories', () => {
    const schemas = loadBundledSchemas();
    const hnSchema = schemas.find(s => s.name === 'Hacker News')!;
    const items = extractWithSchema(HN_HTML, hnSchema);

    expect(items[0].title).toBe('TypeScript is great');
    expect(items[0].link).toBe('https://example.com/article-1');
    expect(items[0].site).toBe('example.com');

    expect(items[1].title).toBe('Ask HN: How do you stay focused?');
    expect(items[2].title).toBe('New open source tool released');
  });

  it('extracts rank from HN stories', () => {
    const schemas = loadBundledSchemas();
    const hnSchema = schemas.find(s => s.name === 'Hacker News')!;
    const items = extractWithSchema(HN_HTML, hnSchema);

    expect(items[0].rank).toBe('1.');
    expect(items[1].rank).toBe('2.');
    expect(items[2].rank).toBe('3.');
  });
});
