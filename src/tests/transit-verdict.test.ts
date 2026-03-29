import { describe, it, expect } from 'vitest';
import { buildTransitVerdict, type TransitSourceResult, type BuildTransitVerdictInput } from '../server/routes/smart-search/handlers/transit-verdict.js';
import type { TransactionalVerdict } from '../server/routes/smart-search/types.js';

/**
 * Helper: build a minimal transit source result for testing.
 */
function makeSource(overrides: Partial<TransitSourceResult> & { content: string; domain: string }): TransitSourceResult {
  return {
    url: `https://${overrides.domain}/route`,
    title: overrides.title || 'Route page',
    snippet: overrides.snippet || '',
    content: overrides.content,
    domain: overrides.domain,
    isTransitSource: true,
    ...overrides,
  };
}

const baseParsedQuery = {
  origin: 'new york',
  destination: 'boston',
  departDate: 'april 2',
  returnDate: 'april 5',
  isRoundTrip: true,
  mode: 'bus',
};

describe('buildTransitVerdict', () => {
  it('returns null when no sources provided', () => {
    const result = buildTransitVerdict({
      query: 'bus ticket nyc to boston',
      transitSources: [],
      parsedQuery: baseParsedQuery,
    });
    expect(result).toBeNull();
  });

  it('returns null when sources have no prices', () => {
    const result = buildTransitVerdict({
      query: 'bus ticket nyc to boston',
      transitSources: [
        makeSource({
          content: 'Take the bus from New York to Boston. Book your trip today!',
          domain: 'wanderu.com',
        }),
      ],
      parsedQuery: baseParsedQuery,
    });
    expect(result).toBeNull();
  });

  it('extracts cheapest price from booking site with provider name', () => {
    const result = buildTransitVerdict({
      query: 'cheapest bus ticket new york to boston',
      transitSources: [
        makeSource({
          content: 'FlixBus from $19.00 | Greyhound from $25.00 | OurBus from $23.00',
          domain: 'wanderu.com',
        }),
      ],
      parsedQuery: { ...baseParsedQuery, isRoundTrip: false },
    });

    expect(result).not.toBeNull();
    expect(result!.vertical).toBe('transit');
    expect(result!.bestOption.provider).toBe('FlixBus');
    expect(result!.bestOption.price).toBe(19.0);
    expect(result!.bestOption.currency).toBe('USD');
    expect(result!.headline).toContain('$19.00');
    expect(result!.headline).toContain('FlixBus');
    expect(result!.headline).toContain('New York → Boston');
    expect(result!.alternatives.length).toBeGreaterThanOrEqual(1);
    // Alternatives should be sorted cheapest first
    if (result!.alternatives.length >= 2) {
      expect(result!.alternatives[0].price).toBeLessThanOrEqual(result!.alternatives[1].price);
    }
  });

  it('prefers booking site prices over generic domains', () => {
    const result = buildTransitVerdict({
      query: 'bus from NYC to Boston',
      transitSources: [
        makeSource({
          content: 'Prices start at $15.00 for bus tickets',
          domain: 'randomsite.com',
        }),
        makeSource({
          content: 'FlixBus from $19.00 | Greyhound from $25.00',
          domain: 'wanderu.com',
        }),
      ],
      parsedQuery: { ...baseParsedQuery, isRoundTrip: false },
    });

    expect(result).not.toBeNull();
    // Should pick FlixBus ($19) from wanderu.com booking site, not $15 from randomsite
    expect(result!.bestOption.provider).toBe('FlixBus');
    expect(result!.bestOption.price).toBe(19.0);
    expect(result!.bestOption.notes).toBe('Booking site');
  });

  it('falls back to cheapest overall when no booking sites have prices', () => {
    const result = buildTransitVerdict({
      query: 'bus from NYC to Boston',
      transitSources: [
        makeSource({
          content: 'Bus tickets start at $22.50 for this route',
          domain: 'travelguide.com',
        }),
      ],
      parsedQuery: { ...baseParsedQuery, isRoundTrip: false },
    });

    expect(result).not.toBeNull();
    expect(result!.bestOption.price).toBe(22.50);
    expect(result!.caveats).toContain('No booking site prices found — prices extracted from search snippets only.');
  });

  it('builds round-trip totals when both legs have data', () => {
    const result = buildTransitVerdict({
      query: 'round trip bus new york to boston',
      transitSources: [
        makeSource({
          content: 'FlixBus from $19.00 | Greyhound from $25.00',
          domain: 'wanderu.com',
          title: 'New York to Boston bus tickets',
        }),
        makeSource({
          content: 'FlixBus from $21.00 | Greyhound from $27.00',
          domain: 'wanderu.com',
          title: 'Boston to New York bus tickets',
          url: 'https://wanderu.com/boston-to-new-york',
        }),
      ],
      parsedQuery: baseParsedQuery,
    });

    expect(result).not.toBeNull();
    expect(result!.totals).toBeDefined();
    expect(result!.totals!.oneWayLowest).toBe(19.0);
    expect(result!.totals!.returnLowest).toBe(21.0);
    expect(result!.totals!.roundTripLowest).toBe(40.0);
    expect(result!.totals!.currency).toBe('USD');
  });

  it('adds caveat when round trip requested but no return prices found', () => {
    const result = buildTransitVerdict({
      query: 'round trip bus new york to boston',
      transitSources: [
        makeSource({
          content: 'FlixBus from $19.00',
          domain: 'wanderu.com',
        }),
      ],
      parsedQuery: baseParsedQuery,
    });

    expect(result).not.toBeNull();
    expect(result!.totals).toBeDefined();
    expect(result!.totals!.oneWayLowest).toBe(19.0);
    expect(result!.totals!.returnLowest).toBeUndefined();
    expect(result!.totals!.roundTripLowest).toBeUndefined();
    expect(result!.caveats).toContain('Could not find separate return leg pricing. Round-trip total unavailable.');
  });

  it('includes parsed query parameters', () => {
    const result = buildTransitVerdict({
      query: 'bus from new york to boston april 2 return april 5',
      transitSources: [
        makeSource({
          content: 'FlixBus from $19.00',
          domain: 'wanderu.com',
        }),
      ],
      parsedQuery: baseParsedQuery,
    });

    expect(result).not.toBeNull();
    expect(result!.query).toEqual({
      origin: 'new york',
      destination: 'boston',
      departDate: 'april 2',
      returnDate: 'april 5',
      isRoundTrip: true,
      mode: 'bus',
    });
  });

  it('sets HIGH confidence with 2+ booking providers and 3+ prices', () => {
    const result = buildTransitVerdict({
      query: 'bus from new york to boston',
      transitSources: [
        makeSource({
          content: 'FlixBus from $19.00',
          domain: 'flixbus.com',
        }),
        makeSource({
          content: 'Greyhound from $25.00 | OurBus from $23.00',
          domain: 'greyhound.com',
        }),
      ],
      parsedQuery: { ...baseParsedQuery, isRoundTrip: false },
    });

    expect(result).not.toBeNull();
    expect(result!.confidence).toBe('HIGH');
  });

  it('sets MEDIUM confidence with 1 booking provider or 2+ prices', () => {
    const result = buildTransitVerdict({
      query: 'bus from new york to boston',
      transitSources: [
        makeSource({
          content: 'FlixBus from $19.00',
          domain: 'wanderu.com',
        }),
      ],
      parsedQuery: { ...baseParsedQuery, isRoundTrip: false },
    });

    expect(result).not.toBeNull();
    expect(result!.confidence).toBe('MEDIUM');
  });

  it('sets LOW confidence with no booking site data', () => {
    const result = buildTransitVerdict({
      query: 'bus from new york to boston',
      transitSources: [
        makeSource({
          content: 'Tickets around $30',
          domain: 'blogpost.com',
        }),
      ],
      parsedQuery: { ...baseParsedQuery, isRoundTrip: false },
    });

    expect(result).not.toBeNull();
    expect(result!.confidence).toBe('LOW');
  });

  it('filters out noise prices > $1000', () => {
    const result = buildTransitVerdict({
      query: 'bus from new york to boston',
      transitSources: [
        makeSource({
          content: 'FlixBus from $19.00 | Total revenue $5000000',
          domain: 'wanderu.com',
        }),
      ],
      parsedQuery: { ...baseParsedQuery, isRoundTrip: false },
    });

    expect(result).not.toBeNull();
    expect(result!.bestOption.price).toBe(19.0);
    // Should not have $5000000 in alternatives
    const allPrices = [result!.bestOption.price, ...result!.alternatives.map(a => a.price)];
    expect(allPrices.every(p => p < 1000)).toBe(true);
  });

  it('deduplicates same provider/price combinations', () => {
    const result = buildTransitVerdict({
      query: 'bus from new york to boston',
      transitSources: [
        makeSource({
          content: 'FlixBus from $19.00',
          domain: 'wanderu.com',
        }),
        makeSource({
          content: 'FlixBus from $19.00',
          domain: 'busbud.com',
        }),
      ],
      parsedQuery: { ...baseParsedQuery, isRoundTrip: false },
    });

    expect(result).not.toBeNull();
    // One bestOption, no duplicate alternatives for same provider
    const allProviders = [result!.bestOption.provider, ...result!.alternatives.map(a => a.provider)];
    const flixbusCount = allProviders.filter(p => p === 'FlixBus').length;
    expect(flixbusCount).toBe(1);
  });

  it('handles "$XX on Provider" pattern', () => {
    const result = buildTransitVerdict({
      query: 'bus from new york to boston',
      transitSources: [
        makeSource({
          content: 'Starting at $19.99 on FlixBus for the New York to Boston route',
          domain: 'rome2rio.com',
        }),
      ],
      parsedQuery: { ...baseParsedQuery, isRoundTrip: false },
    });

    expect(result).not.toBeNull();
    expect(result!.bestOption.provider).toBe('FlixBus');
    expect(result!.bestOption.price).toBe(19.99);
  });

  it('always includes general pricing caveat', () => {
    const result = buildTransitVerdict({
      query: 'bus from new york to boston',
      transitSources: [
        makeSource({
          content: 'FlixBus from $19.00',
          domain: 'wanderu.com',
        }),
      ],
      parsedQuery: { ...baseParsedQuery, isRoundTrip: false },
    });

    expect(result).not.toBeNull();
    expect(result!.caveats).toContain('Prices may vary by date and availability. Book directly for confirmed pricing.');
  });

  it('adds no-date caveat when departDate is missing', () => {
    const result = buildTransitVerdict({
      query: 'bus from new york to boston',
      transitSources: [
        makeSource({
          content: 'FlixBus from $19.00',
          domain: 'wanderu.com',
        }),
      ],
      parsedQuery: { ...baseParsedQuery, departDate: '', isRoundTrip: false },
    });

    expect(result).not.toBeNull();
    expect(result!.caveats).toContain('No specific date detected — prices shown are general/representative.');
  });

  it('alternatives capped at 5', () => {
    const result = buildTransitVerdict({
      query: 'bus from new york to boston',
      transitSources: [
        makeSource({
          content: 'FlixBus from $19.00 | Greyhound from $25.00 | OurBus from $23.00 | Megabus from $15.00 | BoltBus from $21.00 | Trailways from $30.00 | Vamoose from $35.00 | CoachRun from $17.00',
          domain: 'wanderu.com',
        }),
      ],
      parsedQuery: { ...baseParsedQuery, isRoundTrip: false },
    });

    expect(result).not.toBeNull();
    expect(result!.alternatives.length).toBeLessThanOrEqual(5);
  });

  it('route field uses capitalized city names', () => {
    const result = buildTransitVerdict({
      query: 'bus from new york to boston',
      transitSources: [
        makeSource({
          content: 'FlixBus from $19.00',
          domain: 'wanderu.com',
        }),
      ],
      parsedQuery: { ...baseParsedQuery, isRoundTrip: false },
    });

    expect(result).not.toBeNull();
    expect(result!.bestOption.route).toBe('New York → Boston');
  });
});

describe('TransactionalVerdict contract shape', () => {
  it('verdict has all required fields', () => {
    const result = buildTransitVerdict({
      query: 'bus from new york to boston',
      transitSources: [
        makeSource({
          content: 'FlixBus from $19.00 | Greyhound from $25.00',
          domain: 'wanderu.com',
        }),
      ],
      parsedQuery: { ...baseParsedQuery, isRoundTrip: false },
    });

    expect(result).not.toBeNull();
    const v = result!;

    // Required fields
    expect(v).toHaveProperty('vertical');
    expect(v).toHaveProperty('headline');
    expect(v).toHaveProperty('confidence');
    expect(v).toHaveProperty('bestOption');
    expect(v).toHaveProperty('alternatives');
    expect(v).toHaveProperty('caveats');

    // bestOption shape
    expect(v.bestOption).toHaveProperty('provider');
    expect(v.bestOption).toHaveProperty('price');
    expect(v.bestOption).toHaveProperty('currency');
    expect(v.bestOption).toHaveProperty('url');
    expect(typeof v.bestOption.provider).toBe('string');
    expect(typeof v.bestOption.price).toBe('number');
    expect(typeof v.bestOption.currency).toBe('string');
    expect(typeof v.bestOption.url).toBe('string');

    // alternatives shape
    expect(Array.isArray(v.alternatives)).toBe(true);
    for (const alt of v.alternatives) {
      expect(alt).toHaveProperty('provider');
      expect(alt).toHaveProperty('price');
      expect(alt).toHaveProperty('currency');
      expect(alt).toHaveProperty('url');
    }

    // caveats
    expect(Array.isArray(v.caveats)).toBe(true);

    // confidence is valid enum value
    expect(['HIGH', 'MEDIUM', 'LOW']).toContain(v.confidence);
  });
});
