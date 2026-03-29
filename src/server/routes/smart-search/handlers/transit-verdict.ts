/**
 * Transit Verdict Builder
 *
 * Extracts structured pricing data from search results and peeled transit
 * booking pages, then produces a TransactionalVerdict that the UI can render
 * directly — no markdown parsing needed.
 *
 * Design principles:
 *  1. Only use prices found in real source data (never fabricate).
 *  2. Prefer booking/comparison sites (wanderu, flixbus, busbud, rome2rio,
 *     greyhound, amtrak) over generic snippets.
 *  3. Deduplicate by provider+price so the UI gets clean data.
 *  4. Return round-trip totals only when both legs have real data.
 */

import type { TransactionalVerdict, VerdictOption } from '../types.js';

/** Known booking domains — results from these are higher-trust for pricing */
const BOOKING_DOMAINS = new Set([
  'wanderu.com', 'flixbus.com', 'greyhound.com', 'busbud.com',
  'amtrak.com', 'rome2rio.com', 'megabus.com', 'ourbus.com',
  'gotobus.com', 'trailways.com', 'peterpanbus.com', 'coachrun.com',
]);

/** Provider name normalization map */
const PROVIDER_NAMES: Record<string, string> = {
  flixbus: 'FlixBus',
  greyhound: 'Greyhound',
  megabus: 'Megabus',
  amtrak: 'Amtrak',
  ourbus: 'OurBus',
  wanderu: 'Wanderu',
  busbud: 'Busbud',
  rome2rio: 'Rome2Rio',
  peterpanbus: 'Peter Pan Bus',
  peterpan: 'Peter Pan Bus',
  gotobus: 'GotoBus',
  coachrun: 'CoachRun',
  trailways: 'Trailways',
  boltbus: 'BoltBus',
  vamoose: 'Vamoose',
};

export interface TransitSourceResult {
  url: string;
  domain: string;
  title: string;
  content: string;
  snippet: string;
  isTransitSource?: boolean;
  legHint?: 'outbound' | 'return' | 'unknown';
}

interface ExtractedPrice {
  provider: string;
  price: number;
  currency: string;
  url: string;
  isBookingSite: boolean;
  /** Which leg: 'outbound' | 'return' | 'unknown' */
  leg: 'outbound' | 'return' | 'unknown';
}

/**
 * Extract price-provider pairs from a transit source page.
 *
 * Tries multiple heuristics:
 *  1. "$XX on Provider" / "Provider from $XX" / "Provider: $XX"
 *  2. Lines with a known provider name + a dollar amount
 *  3. Plain dollar amounts with domain-based provider attribution
 */
function extractPricesFromSource(source: TransitSourceResult, leg: 'outbound' | 'return' | 'unknown'): ExtractedPrice[] {
  const prices: ExtractedPrice[] = [];
  const text = `${source.title} ${source.snippet} ${source.content}`;
  const isBooking = BOOKING_DOMAINS.has(source.domain);

  // Guess provider from domain
  const domainProvider = source.domain.replace(/\.com$|\.net$|\.org$/, '');
  const fallbackProvider = PROVIDER_NAMES[domainProvider] || titleCase(domainProvider);

  // ── Strategy 1: "$XX … provider" or "provider … $XX" patterns ──
  // Match lines like: "FlixBus from $19.99" or "$19 on Greyhound"
  const providerKeys = Object.keys(PROVIDER_NAMES).join('|');
  const providerPriceRe = new RegExp(
    `(?:(${providerKeys})[^$]{0,30}\\$(\\d+(?:\\.\\d{1,2})?))|(?:\\$(\\d+(?:\\.\\d{1,2})?)[^\\n]{0,30}(${providerKeys}))`,
    'gi'
  );
  let m: RegExpExecArray | null;
  while ((m = providerPriceRe.exec(text)) !== null) {
    const providerKey = (m[1] || m[4] || '').toLowerCase();
    const priceStr = m[2] || m[3];
    const price = parseFloat(priceStr);
    if (price > 0 && price < 1000 && PROVIDER_NAMES[providerKey]) {
      prices.push({
        provider: PROVIDER_NAMES[providerKey],
        price,
        currency: 'USD',
        url: source.url,
        isBookingSite: isBooking,
        leg,
      });
    }
  }

  // ── Strategy 2: Plain dollar amounts — attribute to domain provider ──
  if (prices.length === 0) {
    const plainPrices = text.match(/\$(\d+(?:\.\d{1,2})?)/g);
    if (plainPrices) {
      for (const raw of plainPrices) {
        const price = parseFloat(raw.replace('$', ''));
        if (price > 0 && price < 1000) {
          prices.push({
            provider: fallbackProvider,
            price,
            currency: 'USD',
            url: source.url,
            isBookingSite: isBooking,
            leg,
          });
        }
      }
    }
  }

  return prices;
}

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Deduplicate prices: keep lowest price per provider.
 */
function dedup(prices: ExtractedPrice[]): ExtractedPrice[] {
  const map = new Map<string, ExtractedPrice>();
  for (const p of prices) {
    const key = `${p.provider.toLowerCase()}|${p.leg}`;
    const existing = map.get(key);
    if (!existing || p.price < existing.price) {
      map.set(key, p);
    }
  }
  return [...map.values()].sort((a, b) => a.price - b.price);
}

export interface BuildTransitVerdictInput {
  query: string;
  transitSources: TransitSourceResult[];
  parsedQuery: {
    origin: string;
    destination: string;
    departDate: string;
    returnDate: string;
    isRoundTrip: boolean;
    mode: string;
  };
}

/**
 * Build a TransactionalVerdict from transit search results.
 * Returns null if no usable prices were found.
 */
export function buildTransitVerdict(input: BuildTransitVerdictInput): TransactionalVerdict | null {
  const { transitSources, parsedQuery } = input;
  const { origin, destination, isRoundTrip, mode, departDate, returnDate } = parsedQuery;

  if (transitSources.length === 0) return null;

  // ── Extract prices from all sources ──
  const allPrices: ExtractedPrice[] = [];
  for (const src of transitSources) {
    // Determine leg: if the source URL/content suggests a return route, tag it
    const isReturnLeg = src.legHint === 'return' || (
      origin && destination &&
      (src.content.toLowerCase().includes(`${destination.toLowerCase()} to ${origin.toLowerCase()}`) ||
       src.title.toLowerCase().includes(`${destination.toLowerCase()} to ${origin.toLowerCase()}`))
    );

    const leg: 'outbound' | 'return' | 'unknown' = src.legHint || (isReturnLeg ? 'return' : (origin && destination ? 'outbound' : 'unknown'));
    allPrices.push(...extractPricesFromSource(src, leg));
  }

  if (allPrices.length === 0) return null;

  // ── Deduplicate ──
  const uniquePrices = dedup(allPrices);

  // ── Separate by leg ──
  const outbound = uniquePrices.filter(p => p.leg === 'outbound' || p.leg === 'unknown');
  const returnLeg = uniquePrices.filter(p => p.leg === 'return');

  // ── Build options ──
  const toOption = (p: ExtractedPrice): VerdictOption => ({
    provider: p.provider,
    price: p.price,
    currency: p.currency,
    route: origin && destination
      ? `${titleCase(origin)} → ${titleCase(destination)}`
      : undefined,
    url: p.url,
    notes: p.isBookingSite ? 'Booking site' : 'Price from search results',
  });

  // Best = cheapest from booking sites, else cheapest overall
  const bookingPrices = outbound.filter(p => p.isBookingSite);
  const best = bookingPrices.length > 0 ? bookingPrices[0] : outbound[0];

  if (!best) return null;

  const bestOption = toOption(best);
  const maxReasonableAltPrice = Math.max(best.price * 3, best.price + 75);
  const alternatives = outbound
    .filter(p => !(p.provider === best.provider && p.price === best.price))
    .filter(p => p.price <= maxReasonableAltPrice)
    .slice(0, 5)
    .map(toOption);

  // ── Route label ──
  const routeLabel = origin && destination
    ? `${titleCase(origin)} → ${titleCase(destination)}`
    : 'this route';

  // ── Headline ──
  const headline = `Cheapest I found is $${best.price.toFixed(2)} on ${best.provider} for ${routeLabel}`;

  // ── Totals ──
  let totals: TransactionalVerdict['totals'];
  if (isRoundTrip) {
    const returnBest = returnLeg.length > 0
      ? returnLeg[0]
      : null;
    totals = {
      oneWayLowest: best.price,
      currency: 'USD',
    };
    if (returnBest) {
      totals.returnLowest = returnBest.price;
      totals.roundTripLowest = best.price + returnBest.price;
    }
  }

  // ── Confidence ──
  const bookingSourceCount = new Set(
    uniquePrices.filter(p => p.isBookingSite).map(p => p.provider.toLowerCase())
  ).size;
  let confidence: TransactionalVerdict['confidence'] = 'LOW';
  if (bookingSourceCount >= 2 && uniquePrices.length >= 3) {
    confidence = 'HIGH';
  } else if (bookingSourceCount >= 1 || uniquePrices.length >= 2) {
    confidence = 'MEDIUM';
  }

  // ── Caveats ──
  const caveats: string[] = [];
  caveats.push('Prices may vary by date and availability. Book directly for confirmed pricing.');
  if (!departDate) {
    caveats.push('No specific date detected — prices shown are general/representative.');
  }
  if (isRoundTrip && returnLeg.length === 0) {
    caveats.push('Could not find separate return leg pricing. Round-trip total unavailable.');
  }
  if (bookingSourceCount === 0) {
    caveats.push('No booking site prices found — prices extracted from search snippets only.');
  }

  return {
    vertical: 'transit',
    headline,
    confidence,
    bestOption,
    alternatives,
    ...(totals ? { totals } : {}),
    caveats,
    query: {
      origin: origin || undefined,
      destination: destination || undefined,
      departDate: departDate || undefined,
      returnDate: returnDate || undefined,
      isRoundTrip,
      mode,
    },
  };
}
