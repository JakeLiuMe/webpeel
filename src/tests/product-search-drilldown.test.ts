import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  peelMock,
  searchWebMock,
  callLLMQuickMock,
  extractDomainDataMock,
  getProfilePathMock,
  loadStorageStateMock,
  touchProfileMock,
  localSearchMock,
} = vi.hoisted(() => ({
  peelMock: vi.fn(),
  searchWebMock: vi.fn(),
  callLLMQuickMock: vi.fn(),
  extractDomainDataMock: vi.fn(),
  getProfilePathMock: vi.fn(),
  loadStorageStateMock: vi.fn(),
  touchProfileMock: vi.fn(),
  localSearchMock: vi.fn(),
}));

vi.mock('../index.js', () => ({
  peel: peelMock,
}));

vi.mock('../ee/extractors/index.js', () => ({
  extractDomainData: extractDomainDataMock,
}));

vi.mock('../core/profiles.js', () => ({
  getProfilePath: getProfilePathMock,
  loadStorageState: loadStorageStateMock,
  touchProfile: touchProfileMock,
}));

vi.mock('../core/local-search.js', () => ({
  localSearch: localSearchMock,
}));

vi.mock('../core/search-provider.js', () => ({
  getBestSearchProvider: () => ({
    provider: {
      searchWeb: searchWebMock,
    },
  }),
}));

vi.mock('../server/routes/smart-search/llm.js', () => ({
  callLLMQuick: callLLMQuickMock,
  sanitizeSearchQuery: (value: string) => value,
  PROMPT_INJECTION_DEFENSE: '',
}));

import { handleProductSearch } from '../server/routes/smart-search/handlers/products.js';

describe('handleProductSearch — shopping drill-down', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callLLMQuickMock.mockResolvedValue(undefined);
    searchWebMock.mockResolvedValue([]);
    extractDomainDataMock.mockResolvedValue(null);
    getProfilePathMock.mockReturnValue(null);
    loadStorageStateMock.mockReturnValue(null);
    touchProfileMock.mockImplementation(() => {});
    localSearchMock.mockResolvedValue({ results: [], query: '', location: '', source: 'google-places' });
  });

  it('uses verified PDP evidence instead of snippet-only see price listings', async () => {
    searchWebMock.mockImplementation(async (query: string) => {
      if (query.includes('site:amazon.com')) {
        return [{
          title: 'Sony WH-1000XM6 Wireless Noise Canceling Headphones - Amazon',
          url: 'https://www.amazon.com/Sony-WH-1000XM6/dp/B0TEST1234',
          snippet: 'Sony WH-1000XM6 headphones. Free delivery.',
        }];
      }
      if (query.includes('site:walmart.com')) {
        return [{
          title: 'Sony WH-1000XM6 Best Wireless Noise Canceling Headphones | Black',
          url: 'https://www.walmart.com/ip/Sony-WH1000XM6/16504921979',
          snippet: 'Sony WH-1000XM6 product page.',
        }];
      }
      if (query.includes('site:ebay.com')) {
        return [{
          title: 'Sony WH-1000XM6 Wireless Noise Canceling Headphones (Black) SEALED - eBay',
          url: 'https://www.ebay.com/itm/188219681364',
          snippet: 'Sony WH-1000XM6 SEALED',
        }];
      }
      return [];
    });

    peelMock.mockImplementation(async (url: string) => {
      if (url.includes('amazon.com')) {
        return {
          title: 'Sony WH-1000XM6 The Best Noise Canceling Wireless Headphones, Midnight Blue',
          content: '# Sony WH-1000XM6\n**Price:** $458.00\n**Availability:** In Stock',
          links: [],
          domainData: {
            structured: {
              title: 'Sony WH-1000XM6 The Best Noise Canceling Wireless Headphones, Midnight Blue',
              price: '$458.00',
              availability: 'In Stock',
            },
          },
        };
      }
      if (url.includes('walmart.com')) {
        return {
          title: 'Robot or human?',
          content: '# Robot or human?\nActivate and hold the button to confirm that you’re human.',
          links: [],
          blocked: true,
        };
      }
      if (url.includes('ebay.com')) {
        return {
          title: 'Sony WH-1000XM6 Wireless Noise Canceling Headphones (Black) SEALED',
          content: '# Sony WH-1000XM6\n**Price:** US $300.00\n**Condition:** New',
          links: [],
          domainData: {
            structured: {
              title: 'Sony WH-1000XM6 Wireless Noise Canceling Headphones (Black) SEALED',
              price: 'US $300.00',
              condition: 'New',
            },
          },
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await handleProductSearch({ type: 'products', query: 'Sony WH-1000XM6', params: {} });

    expect(result.structured.checkedProductPages).toBe(3);
    expect(result.structured.verifiedEvidence).toHaveLength(2);
    expect(result.content).toContain('$458.00 [Amazon]');
    expect(result.content).toContain('$300.00 [eBay]');
    expect(result.content).not.toContain('see price');
    expect(result.answer).toContain('I checked product pages for Sony WH-1000XM6');
    expect(result.answer).toContain('$458.00');
    expect(result.answer).toContain('$300.00');
  });

  it('follows top matching product links from a category/search page', async () => {
    searchWebMock.mockImplementation(async (query: string) => {
      if (query.includes('site:walmart.com')) {
        return [{
          title: 'AirPods Pro in Apple AirPods - Walmart.com',
          url: 'https://www.walmart.com/browse/electronics/airpods-pro/3944_133251_1095191',
          snippet: 'Shop for AirPods Pro in Apple AirPods.',
        }];
      }
      return [];
    });

    peelMock.mockImplementation(async (url: string) => {
      if (url.includes('/browse/')) {
        return {
          title: 'AirPods Pro in Apple AirPods - Walmart.com',
          content: '# AirPods Pro in Apple AirPods',
          links: [
            'https://www.walmart.com/ip/Apple-AirPods-Pro-2nd-Generation-Lightning/1752657021',
            'https://www.walmart.com/ip/Random-Speaker/123',
          ],
        };
      }
      if (url.includes('/ip/Apple-AirPods-Pro-2nd-Generation-Lightning/1752657021')) {
        return {
          title: 'Apple AirPods Pro 2nd Generation Lightning',
          content: '# Apple AirPods Pro 2nd Generation Lightning\n**Price:** $189.99\n**Availability:** In Stock',
          links: [],
          domainData: {
            structured: {
              name: 'Apple AirPods Pro 2nd Generation Lightning',
              price: 189.99,
              inStock: true,
            },
          },
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await handleProductSearch({ type: 'products', query: 'Apple AirPods Pro 2', params: {} });

    expect(result.structured.checkedProductPages).toBe(1);
    expect(result.structured.verifiedEvidence).toHaveLength(1);
    expect(result.structured.verifiedEvidence[0].rawUrl).toBe('https://www.walmart.com/ip/Apple-AirPods-Pro-2nd-Generation-Lightning/1752657021');
    expect(result.content).toContain('$189.99 [Walmart]');
    expect(result.answer).toContain('I checked product pages for Apple AirPods Pro 2');
  });

  it('promotes retailer adapter data for direct Best Buy PDPs', async () => {
    searchWebMock.mockImplementation(async (query: string) => {
      if (query.includes('site:bestbuy.com')) {
        return [{
          title: 'Sony WH-1000XM6 Wireless Headphones - Best Buy',
          url: 'https://www.bestbuy.com/site/sony-wh-1000xm6-wireless-noise-canceling-headphones/6590123.p',
          snippet: 'Sony WH-1000XM6 product page at Best Buy.',
        }];
      }
      return [];
    });

    extractDomainDataMock.mockResolvedValue({
      domain: 'bestbuy.com',
      type: 'product',
      structured: {
        name: 'Sony WH-1000XM6 Wireless Noise Canceling Headphones',
        price: 449.99,
        regularPrice: 449.99,
        brand: 'Sony',
        model: 'WH-1000XM6',
        image: 'https://pisces.bbystatic.com/image.jpg',
        inStock: true,
      },
      cleanContent: '# Sony WH-1000XM6\n**Price:** $449.99\n**Availability:** In Stock',
    });

    const result = await handleProductSearch({ type: 'products', query: 'Sony WH-1000XM6', params: {} });

    expect(peelMock).not.toHaveBeenCalledWith(
      'https://www.bestbuy.com/site/sony-wh-1000xm6-wireless-noise-canceling-headphones/6590123.p',
      expect.anything(),
    );
    expect(result.structured.verifiedEvidence[0]).toMatchObject({
      store: 'Best Buy',
      price: '$449.99',
      source: 'retailer-extractor',
      fetchMethod: 'retailer-extractor',
      brand: 'Sony',
      model: 'WH-1000XM6',
    });
    expect(result.structured.retailerRouting[0]).toMatchObject({
      route: 'adapter-first',
      source: 'retailer-extractor',
      store: 'Best Buy',
    });
    expect(result.content).toContain('$449.99 [Best Buy]');
  });

  it('uses a saved profile first for hard retailer domains', async () => {
    searchWebMock.mockImplementation(async (query: string) => {
      if (query.includes('site:amazon.com')) {
        return [{
          title: 'Sony WH-1000XM6 Wireless Noise Canceling Headphones - Amazon',
          url: 'https://www.amazon.com/Sony-WH-1000XM6/dp/B0TEST1234',
          snippet: 'Sony WH-1000XM6 headphones. Free delivery.',
        }];
      }
      return [];
    });

    getProfilePathMock.mockImplementation((name: string) => name === 'amazon.com' ? '/tmp/wp-amazon-profile' : null);
    loadStorageStateMock.mockReturnValue({ cookies: [{ name: 'session-id', value: 'abc', domain: '.amazon.com', path: '/' }] });
    peelMock.mockResolvedValue({
      title: 'Sony WH-1000XM6 The Best Noise Canceling Wireless Headphones, Midnight Blue',
      content: '# Sony WH-1000XM6\n**Price:** $458.00\n**Availability:** In Stock',
      links: [],
      method: 'stealth',
      domainData: {
        structured: {
          title: 'Sony WH-1000XM6 The Best Noise Canceling Wireless Headphones, Midnight Blue',
          price: '$458.00',
          availability: 'In Stock',
          brand: 'Sony',
          model: 'WH-1000XM6',
        },
      },
    });

    const result = await handleProductSearch({ type: 'products', query: 'Sony WH-1000XM6', params: {} });

    expect(peelMock).toHaveBeenCalledWith(
      'https://www.amazon.com/Sony-WH-1000XM6/dp/B0TEST1234',
      expect.objectContaining({
        profileDir: '/tmp/wp-amazon-profile',
        storageState: { cookies: [{ name: 'session-id', value: 'abc', domain: '.amazon.com', path: '/' }] },
        stealth: true,
        render: true,
      }),
    );
    expect(touchProfileMock).toHaveBeenCalledWith('amazon.com');
    expect(result.structured.verifiedEvidence[0]).toMatchObject({
      store: 'Amazon',
      profileUsed: 'amazon.com',
      difficulty: 'hard',
      source: 'page-domain-data',
    });
    expect(result.structured.retailerRouting[0]).toMatchObject({
      profileUsed: 'amazon.com',
      difficulty: 'hard',
      route: 'peel',
    });
  });

  it('hard-routes explicit Best Buy queries to Best Buy only', async () => {
    const seenQueries: string[] = [];
    searchWebMock.mockImplementation(async (query: string) => {
      seenQueries.push(query);
      if (query.includes('site:bestbuy.com')) {
        return [{
          title: 'Sony WH-1000XM6 Wireless Headphones - Best Buy',
          url: 'https://www.bestbuy.com/site/sony-wh-1000xm6-wireless-noise-canceling-headphones/6590123.p',
          snippet: 'Sony WH-1000XM6 product page at Best Buy.',
        }];
      }
      return [];
    });

    extractDomainDataMock.mockResolvedValue({
      domain: 'bestbuy.com',
      type: 'product',
      structured: {
        name: 'Sony WH-1000XM6 Wireless Noise Canceling Headphones',
        price: 449.99,
        brand: 'Sony',
        model: 'WH-1000XM6',
        inStock: true,
      },
      cleanContent: '# Sony WH-1000XM6\n**Price:** $449.99\n**Availability:** In Stock',
    });

    const result = await handleProductSearch({
      type: 'products',
      query: 'Sony WH-1000XM6 Best Buy price',
      params: { requestedStoreId: 'bestbuy', requestedStore: 'Best Buy', requestedStoreDomain: 'bestbuy.com' },
    });

    expect(seenQueries).toEqual(['Sony WH-1000XM6 price site:bestbuy.com']);
    expect(result.structured.requestedStore).toMatchObject({ id: 'bestbuy', store: 'Best Buy', domain: 'bestbuy.com' });
    expect(result.structured.verifiedEvidence).toHaveLength(1);
    expect(result.structured.verifiedEvidence[0].store).toBe('Best Buy');
    expect(result.structured.retailerRouting.every((item: any) => item.store === 'Best Buy')).toBe(true);
    expect(result.content).toContain('$449.99 [Best Buy]');
    expect(result.content).not.toContain('[Amazon]');
    expect(result.answer).toContain('I checked Best Buy product pages for Sony WH-1000XM6');
  });

  it('stays honest when the requested Walmart result cannot be verified', async () => {
    searchWebMock.mockImplementation(async (query: string) => {
      if (query.includes('site:walmart.com')) {
        return [{
          title: 'Apple AirPods Pro 2 - Walmart.com',
          url: 'https://www.walmart.com/ip/Apple-AirPods-Pro-2nd-Generation-Lightning/1752657021',
          snippet: 'Apple AirPods Pro 2 available at Walmart.',
        }];
      }
      if (query.includes('site:amazon.com')) {
        return [{
          title: 'Apple AirPods Pro 2 - Amazon',
          url: 'https://www.amazon.com/dp/B0TEST1234',
          snippet: 'Apple AirPods Pro 2 at Amazon.',
        }];
      }
      return [];
    });

    peelMock.mockResolvedValue({
      title: 'Robot or human?',
      content: '# Robot or human?\nActivate and hold the button to confirm that you’re human.',
      links: [],
      blocked: true,
    });

    const result = await handleProductSearch({
      type: 'products',
      query: 'Apple AirPods Pro 2 Walmart price',
      params: { requestedStoreId: 'walmart', requestedStore: 'Walmart', requestedStoreDomain: 'walmart.com' },
    });

    expect(result.structured.checkedProductPages).toBe(1);
    expect(result.structured.verifiedEvidence).toHaveLength(0);
    expect(result.structured.requestedStore).toMatchObject({ id: 'walmart', store: 'Walmart', domain: 'walmart.com' });
    expect(result.content).toContain('[Walmart]');
    expect(result.content).not.toContain('[Amazon]');
    expect(result.answer).toContain('I checked 1 Walmart product page for Apple AirPods Pro 2');
    expect(result.answer).toContain('I’m not going to substitute another store');
  });

  it('combines nearby store resolution with catalog evidence and stays honest on unverifiable local inventory', async () => {
    searchWebMock.mockImplementation(async (query: string) => {
      if (query.includes('site:costco.com')) {
        return [{
          title: 'Dyson Ball Animal 3+ Upright Vacuum 400123 - Costco',
          url: 'https://www.costco.com/dyson-ball-animal-3-plus-upright-vacuum.product.400123.html',
          snippet: 'Dyson Ball Animal 3+ Upright Vacuum at Costco.',
        }];
      }
      return [];
    });

    peelMock.mockResolvedValue({
      title: 'Dyson Ball Animal 3+ Upright Vacuum - Costco',
      content: '# Dyson Ball Animal 3+ Upright Vacuum\n**Price:** $399.99\n**Availability:** In Stock\nCheck warehouse inventory in store.',
      links: [],
      domainData: {
        structured: {
          title: 'Dyson Ball Animal 3+ Upright Vacuum',
          price: '$399.99',
          availability: 'In Stock',
        },
      },
    });

    localSearchMock.mockResolvedValue({
      query: 'Costco',
      location: '11101',
      source: 'google-places',
      results: [
        {
          name: 'Costco Wholesale',
          address: '3250 Vernon Blvd, Queens, NY 11106',
          rating: 4.5,
          reviewCount: 1200,
          isOpen: true,
          googleMapsUrl: 'https://maps.google.com/?q=costco+vernon',
        },
      ],
    });

    const result = await handleProductSearch({
      type: 'products',
      query: 'Dyson Ball Animal 3+ Upright Vacuum Costco near me',
      params: {
        requestedStoreId: 'costco',
        requestedStore: 'Costco',
        requestedStoreDomain: 'costco.com',
        localIntent: 'true',
        localIntentMode: 'near-me',
        location: '11101',
      },
    });

    expect(localSearchMock).toHaveBeenCalledWith(expect.objectContaining({ query: 'Costco', location: '11101', limit: 5 }));
    expect(result.source).toBe('Checked product pages + local store search');
    expect(result.structured.localRetail).toMatchObject({
      nearbyStoresStatus: 'resolved',
      catalogExistence: 'verified',
      localInventoryVerified: false,
    });
    expect(result.content).toContain('## Local retail check');
    expect(result.content).toContain('Nearby Costco stores: **1 found** near 11101');
    expect(result.content).toContain('Local inventory: **Not publicly verifiable**');
    expect(result.answer).toContain('I verified that Costco lists Dyson Ball Animal 3+ Upright Vacuum on a product page.');
    expect(result.answer).toContain('I found 1 nearby Costco location near 11101.');
    expect(result.answer).toContain('I could not verify store-specific local inventory');
  });

  it('asks for location context instead of bluffing nearby stores on bare near-me queries', async () => {
    searchWebMock.mockImplementation(async (query: string) => {
      if (query.includes('site:traderjoes.com')) {
        return [{
          title: "Grilled Chimichurri Chicken Thigh Skewers - Trader Joe's",
          url: 'https://www.traderjoes.com/home/products/pdp/grilled-chimichurri-chicken-thigh-skewers-074744',
          snippet: 'Grilled Chimichurri Chicken Thigh Skewers at Trader Joe\'s.',
        }];
      }
      return [];
    });

    peelMock.mockResolvedValue({
      title: "Grilled Chimichurri Chicken Thigh Skewers - Trader Joe's",
      content: '# Grilled Chimichurri Chicken Thigh Skewers\nAvailable now.',
      links: [],
    });

    const result = await handleProductSearch({
      type: 'products',
      query: "Grilled Chimichurri Chicken Thigh Skewers Trader Joe's near me",
      params: {
        requestedStoreId: 'traderjoes',
        requestedStore: "Trader Joe's",
        requestedStoreDomain: 'traderjoes.com',
        localIntent: 'true',
        localIntentMode: 'near-me',
        localNeedsUserLocation: 'true',
      },
    });

    expect(localSearchMock).not.toHaveBeenCalled();
    expect(result.structured.localRetail).toMatchObject({ nearbyStoresStatus: 'needs-location' });
    expect(result.content).toContain('Need location context');
    expect(result.answer).toContain('needs a city or ZIP to resolve "near me" honestly');
  });

  it('is honest when no checked PDP yields a trustworthy live price', async () => {
    searchWebMock.mockImplementation(async (query: string) => {
      if (query.includes('site:amazon.com')) {
        return [{
          title: 'Sony WH-1000XM6 - Amazon',
          url: 'https://www.amazon.com/Sony-WH-1000XM6/dp/B0TEST1234',
          snippet: 'Sony WH-1000XM6 headphones',
        }];
      }
      return [];
    });

    peelMock.mockResolvedValue({
      title: 'Robot or human?',
      content: '# Robot or human?\nActivate and hold the button to confirm that you’re human.',
      links: [],
      blocked: true,
    });

    const result = await handleProductSearch({ type: 'products', query: 'Sony WH-1000XM6', params: {} });

    expect(result.structured.checkedProductPages).toBe(1);
    expect(result.structured.verifiedEvidence).toHaveLength(0);
    expect(result.answer).toContain('I checked 1 product page');
    expect(result.answer).toContain('I’m not going to guess from snippets');
    expect(result.content).toContain('unverified snippet');
  });
});
