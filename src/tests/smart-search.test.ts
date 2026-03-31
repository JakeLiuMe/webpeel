import { describe, it, expect } from 'vitest';
import { detectSearchIntent } from '../server/routes/smart-search/index.js';
import { parseTransitQuery } from '../server/routes/smart-search/handlers/general.js';

describe('detectSearchIntent', () => {
  it('detects car search queries', () => {
    expect(detectSearchIntent('cheapest car Long Island budget $10000 Tesla').type).toBe('cars');
    expect(detectSearchIntent('used Honda Civic for sale').type).toBe('cars');
    expect(detectSearchIntent('buy a cheap truck under $15000').type).toBe('cars');
    expect(detectSearchIntent('new BMW deal near 10001').type).toBe('cars');
    expect(detectSearchIntent('used Tesla under $30000').type).toBe('cars');
  });

  it('extracts car search params', () => {
    const result = detectSearchIntent('cheapest car budget $10000 near 11101');
    expect(result.type).toBe('cars');
    expect(result.params.maxPrice).toBe('10000');
    expect(result.params.zip).toBe('11101');
  });

  it('defaults zip to 10001 if not provided', () => {
    const result = detectSearchIntent('used Honda Civic for sale');
    expect(result.params.zip).toBe('10001');
  });

  it('detects flight search queries', () => {
    expect(detectSearchIntent('flights NYC to Fort Myers April 4').type).toBe('flights');
    expect(detectSearchIntent('fly to Miami').type).toBe('flights');
    expect(detectSearchIntent('airline tickets to LA').type).toBe('flights');
    expect(detectSearchIntent('cheap flights to London').type).toBe('flights');
  });

  it('detects hotel search queries', () => {
    expect(detectSearchIntent('hotels in Punta Gorda FL').type).toBe('hotels');
    expect(detectSearchIntent('cheap hotel near Manhattan').type).toBe('hotels');
    expect(detectSearchIntent('best resort in Cancun').type).toBe('hotels');
    expect(detectSearchIntent('airbnb in Brooklyn').type).toBe('hotels');
  });

  it('detects car rental queries', () => {
    expect(detectSearchIntent('rent a car in Miami').type).toBe('rental');
    expect(detectSearchIntent('car rental LAX').type).toBe('rental');
    expect(detectSearchIntent('rental car Fort Myers airport').type).toBe('rental');
  });

  it('detects restaurant queries', () => {
    expect(detectSearchIntent('best pizza in Manhattan').type).toBe('restaurants');
    expect(detectSearchIntent('good sushi near me').type).toBe('restaurants');
    expect(detectSearchIntent('cheap restaurants in Brooklyn').type).toBe('restaurants');
    expect(detectSearchIntent('best brunch in NYC').type).toBe('restaurants');
  });

  it('detects product search queries', () => {
    expect(detectSearchIntent('face wash for men').type).toBe('products');
    expect(detectSearchIntent('bouldering shoes size 10').type).toBe('products');
    expect(detectSearchIntent('running shoes Nike').type).toBe('products');
    expect(detectSearchIntent('buy headphones under $100').type).toBe('products');
    expect(detectSearchIntent('cheap laptop deals').type).toBe('products');
    expect(detectSearchIntent('best backpack for travel').type).toBe('products');
    expect(detectSearchIntent('Sony WH-1000XM6').type).toBe('products');
    expect(detectSearchIntent('Apple AirPods Pro 2').type).toBe('products');
  });

  it('preserves explicit retailer intent for product queries', () => {
    const bestBuy = detectSearchIntent('Sony WH-1000XM6 Best Buy price');
    expect(bestBuy.type).toBe('products');
    expect(bestBuy.params.requestedStoreId).toBe('bestbuy');
    expect(bestBuy.params.requestedStore).toBe('Best Buy');
    expect(bestBuy.params.requestedStoreDomain).toBe('bestbuy.com');

    const walmart = detectSearchIntent('Apple AirPods Pro 2 Walmart price');
    expect(walmart.type).toBe('products');
    expect(walmart.params.requestedStoreId).toBe('walmart');
    expect(walmart.params.requestedStore).toBe('Walmart');
    expect(walmart.params.requestedStoreDomain).toBe('walmart.com');
  });

  it('detects local retail availability intent and preserves store + location params', () => {
    const traderJoes = detectSearchIntent("Grilled Chimichurri Chicken Thigh Skewers Trader Joe's near me");
    expect(traderJoes.type).toBe('products');
    expect(traderJoes.params.requestedStoreId).toBe('traderjoes');
    expect(traderJoes.params.requestedStore).toBe("Trader Joe's");
    expect(traderJoes.params.localIntent).toBe('true');
    expect(traderJoes.params.localIntentMode).toBe('near-me');
    expect(traderJoes.params.localNeedsUserLocation).toBe('true');

    const costco = detectSearchIntent('Dyson Ball Animal 3+ Upright Vacuum Costco near 11101');
    expect(costco.type).toBe('products');
    expect(costco.params.requestedStoreId).toBe('costco');
    expect(costco.params.requestedStore).toBe('Costco');
    expect(costco.params.localIntent).toBe('true');
    expect(costco.params.location).toBe('11101');
    expect(costco.params.localLocationSource).toBe('zip');
  });

  it('treats store-specific local product availability as products, not generic local search', () => {
    const result = detectSearchIntent("is Grilled Chimichurri Chicken Thigh Skewers in my local Trader Joe's");
    expect(result.type).toBe('products');
    expect(result.params.requestedStoreId).toBe('traderjoes');
    expect(result.params.localIntent).toBe('true');
    expect(result.params.localIntentMode).toBe('local');
  });

  it('falls back to general for unrecognized queries', () => {
    expect(detectSearchIntent('latest AI news').type).toBe('general');
    expect(detectSearchIntent('what is TypeScript').type).toBe('general');
    expect(detectSearchIntent('how to cook pasta').type).toBe('general');
    expect(detectSearchIntent('machine learning tutorial').type).toBe('general');
  });

  // Existing rental test should still pass after the regex reorder
  it('detects rental even with price keywords', () => {
    expect(detectSearchIntent('rent a car $150 max price').type).toBe('rental');
    expect(detectSearchIntent('I want to rent a car in Miami for $100/day').type).toBe('rental');
    expect(detectSearchIntent('renting a vehicle for the weekend cheap').type).toBe('rental');
  });

  // These should return 'general' from regex (LLM would reclassify in prod)
  it('regex returns general for typos and creative phrasing', () => {
    // These are "general" at the regex level — LLM handles them in production
    // (typos, creative/colloquial phrasing that doesn't match the keyword lists)
    expect(detectSearchIntent('I need wheels for the weekend').type).toBe('general');
    expect(detectSearchIntent('craving some brgr near me').type).toBe('general'); // typo: brgr
  });

  // ── Transit / ground-travel ticket queries must NOT be products ──
  it('detects transit/bus ticket queries as general (not products)', () => {
    // Jake's exact failing query
    const jakeQuery = 'help me find the cheapest boston ticket from new york i want to take bus. april 2 and i want to take the bus back at april 5th';
    const result = detectSearchIntent(jakeQuery);
    expect(result.type).toBe('general');
    expect(result.type).not.toBe('products');
    expect(result.params.isTransit).toBe('true');
  });

  it('detects various transit booking queries as general with isTransit', () => {
    // Bus queries
    expect(detectSearchIntent('cheap bus ticket from NYC to Boston').type).toBe('general');
    expect(detectSearchIntent('greyhound bus from new york to philadelphia').type).toBe('general');
    expect(detectSearchIntent('flixbus ticket NYC to DC cheapest').type).toBe('general');
    expect(detectSearchIntent('book a bus from chicago to detroit').type).toBe('general');

    // Train queries
    expect(detectSearchIntent('amtrak tickets from DC to New York').type).toBe('general');
    expect(detectSearchIntent('cheapest train from boston to NYC').type).toBe('general');
    expect(detectSearchIntent('acela ticket price DC to NYC').type).toBe('general');

    // Ferry queries
    expect(detectSearchIntent('ferry tickets from manhattan to staten island').type).toBe('general');

    // Round trip
    expect(detectSearchIntent('bus round trip NYC to Boston April 2 return April 5').type).toBe('general');

    // All should have isTransit param
    expect(detectSearchIntent('cheap bus ticket from NYC to Boston').params.isTransit).toBe('true');
    expect(detectSearchIntent('amtrak tickets from DC to New York').params.isTransit).toBe('true');
  });

  it('transit queries have suggestedDomains for booking sites', () => {
    const result = detectSearchIntent('cheap bus ticket from NYC to Boston');
    expect(result.suggestedDomains).toBeDefined();
    expect(result.suggestedDomains).toContain('wanderu.com');
    expect(result.suggestedDomains).toContain('flixbus.com');
    expect(result.suggestedDomains).toContain('greyhound.com');
  });
});

describe('parseTransitQuery', () => {
  it('parses origin and destination from "from X to Y" pattern', () => {
    const result = parseTransitQuery('cheap bus ticket from new york to boston');
    expect(result.origin).toBe('new york');
    expect(result.destination).toBe('boston');
    expect(result.mode).toBe('bus');
  });

  it('parses Jake exact query with "boston ticket from new york" pattern', () => {
    const result = parseTransitQuery('help me find the cheapest boston ticket from new york i want to take bus. april 2 and i want to take the bus back at april 5th');
    expect(result.origin).toBeTruthy();
    expect(result.destination).toBeTruthy();
    expect(result.isRoundTrip).toBe(true);
    expect(result.mode).toBe('bus');
  });

  it('detects round trip intent', () => {
    expect(parseTransitQuery('bus round trip NYC to Boston').isRoundTrip).toBe(true);
    expect(parseTransitQuery('bus from NYC to Boston and back').isRoundTrip).toBe(true);
    expect(parseTransitQuery('bus from NYC to Boston return April 5').isRoundTrip).toBe(true);
    expect(parseTransitQuery('one way bus NYC to Boston').isRoundTrip).toBe(false);
  });

  it('detects transport mode', () => {
    expect(parseTransitQuery('amtrak tickets NYC to DC').mode).toBe('train');
    expect(parseTransitQuery('ferry from manhattan to staten island').mode).toBe('ferry');
    expect(parseTransitQuery('greyhound bus from NYC to Philly').mode).toBe('bus');
  });

  it('extracts dates', () => {
    const result = parseTransitQuery('bus from NYC to Boston april 2 return april 5');
    expect(result.departDate).toMatch(/april 2/i);
    expect(result.returnDate).toMatch(/april 5/i);
  });
});
