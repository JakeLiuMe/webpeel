/**
 * local-search.ts — Local business search using Google Places API (Text Search)
 *
 * Primary: Google Places Text Search (New) API
 * Secondary: Yelp Fusion API
 * Fallback: peel() scraping Google Maps
 */

import { peel } from '../index.js';

// ─── Types ────────────────────────────────────────────────────────────────

export interface LocalSearchOptions {
  query: string;       // "best sushi in Shibuya"
  location?: string;   // "Shibuya, Tokyo" or "35.6595,139.7004" (lat,lng)
  country?: string;    // "JP" — ISO 3166-1 alpha-2
  language?: string;   // "ja" — language for results
  radius?: number;     // meters, default 5000
  type?: string;       // Google Places type: restaurant, hotel, cafe, etc.
  limit?: number;      // max results, default 10
}

export interface LocalSearchResult {
  name: string;
  address: string;
  rating?: number;        // 1-5
  reviewCount?: number;
  priceLevel?: number;    // 0-4 (Google's scale)
  categories?: string[];  // e.g. ["sushi", "japanese"]
  phone?: string;
  website?: string;
  googleMapsUrl?: string;
  isOpen?: boolean;
  hours?: string[];
  location?: { lat: number; lng: number };
  photos?: string[];      // Google Places photo URLs
}

export interface LocalSearchResponse {
  results: LocalSearchResult[];
  query: string;
  location?: string;
  source: 'google-places' | 'yelp' | 'fallback';
}

// ─── Google Places Text Search (New) API ─────────────────────────────────

const GOOGLE_PLACES_FIELD_MASK = [
  'places.displayName',
  'places.formattedAddress',
  'places.rating',
  'places.userRatingCount',
  'places.priceLevel',
  'places.currentOpeningHours',
  'places.googleMapsUri',
  'places.websiteUri',
  'places.internationalPhoneNumber',
  'places.types',
  'places.location',
  'places.photos',
].join(',');

/**
 * Convert Google Places priceLevel string to numeric 0-4 scale.
 * Google New API returns strings like "PRICE_LEVEL_MODERATE".
 */
function parsePriceLevel(raw: any): number | undefined {
  if (typeof raw === 'number') return raw;
  if (!raw) return undefined;
  const MAP: Record<string, number> = {
    PRICE_LEVEL_FREE: 0,
    PRICE_LEVEL_INEXPENSIVE: 1,
    PRICE_LEVEL_MODERATE: 2,
    PRICE_LEVEL_EXPENSIVE: 3,
    PRICE_LEVEL_VERY_EXPENSIVE: 4,
  };
  return MAP[String(raw)] ?? undefined;
}

async function searchGooglePlaces(opts: LocalSearchOptions): Promise<LocalSearchResult[] | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;

  // Build the text query — append location if not already in query
  let textQuery = opts.query;
  if (opts.location && !opts.query.toLowerCase().includes(opts.location.toLowerCase())) {
    textQuery = `${opts.query} in ${opts.location}`;
  }

  const body: Record<string, any> = {
    textQuery,
    maxResultCount: Math.min(opts.limit ?? 10, 20),
  };

  if (opts.language) body.languageCode = opts.language;
  if (opts.country) body.regionCode = opts.country;
  if (opts.type) body.includedType = opts.type;

  // If location is lat,lng coordinates, add location bias
  if (opts.location) {
    const latLngMatch = opts.location.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
    if (latLngMatch) {
      body.locationBias = {
        circle: {
          center: { latitude: parseFloat(latLngMatch[1]), longitude: parseFloat(latLngMatch[2]) },
          radius: opts.radius ?? 5000,
        },
      };
    }
  }

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': GOOGLE_PLACES_FIELD_MASK,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn(`[local-search] Google Places API ${res.status}: ${await res.text().catch(() => '')}`);
      return null;
    }

    const data = await res.json();
    if (!data.places?.length) return [];

    return data.places.map((p: any): LocalSearchResult => {
      // Build photo URLs
      const photos: string[] = [];
      if (p.photos?.length) {
        for (const photo of p.photos.slice(0, 3)) {
          if (photo.name) {
            photos.push(`https://places.googleapis.com/v1/${photo.name}/media?maxHeightPx=400&key=${key}`);
          }
        }
      }

      // Parse hours
      const hours: string[] = p.currentOpeningHours?.weekdayDescriptions ?? [];

      return {
        name: p.displayName?.text ?? '',
        address: p.formattedAddress ?? '',
        rating: p.rating,
        reviewCount: p.userRatingCount,
        priceLevel: parsePriceLevel(p.priceLevel),
        categories: p.types?.filter((t: string) => !t.startsWith('point_of_interest') && !t.startsWith('establishment')),
        phone: p.internationalPhoneNumber,
        website: p.websiteUri,
        googleMapsUrl: p.googleMapsUri,
        isOpen: p.currentOpeningHours?.openNow,
        hours,
        location: p.location ? { lat: p.location.latitude, lng: p.location.longitude } : undefined,
        photos,
      };
    });
  } catch (err) {
    console.warn('[local-search] Google Places request failed:', (err as Error).message);
    return null;
  }
}

// ─── Yelp Fusion API ──────────────────────────────────────────────────────

async function searchYelp(opts: LocalSearchOptions): Promise<LocalSearchResult[] | null> {
  const key = process.env.YELP_API_KEY;
  if (!key) return null;

  try {
    const params = new URLSearchParams({
      term: opts.query,
      limit: String(Math.min(opts.limit ?? 10, 50)),
      sort_by: 'rating',
    });

    // Location can be an address string or lat,lng
    if (opts.location) {
      const latLngMatch = opts.location.match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
      if (latLngMatch) {
        params.set('latitude', latLngMatch[1]);
        params.set('longitude', latLngMatch[2]);
        params.set('radius', String(Math.min(opts.radius ?? 5000, 40000)));
      } else {
        params.set('location', opts.location);
      }
    } else {
      params.set('location', 'New York, NY');
    }

    if (opts.language) params.set('locale', opts.language + '_' + (opts.country ?? '').toUpperCase());

    const res = await fetch(`https://api.yelp.com/v3/businesses/search?${params}`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) return null;
    const data = await res.json();

    return (data.businesses || []).map((b: any): LocalSearchResult => ({
      name: b.name,
      address: b.location
        ? [b.location.address1, b.location.city, b.location.state, b.location.country]
            .filter(Boolean)
            .join(', ')
        : '',
      rating: b.rating,
      reviewCount: b.review_count,
      priceLevel: b.price ? b.price.length : undefined, // "$" → 1, "$$" → 2, etc.
      categories: (b.categories || []).map((c: any) => c.alias),
      phone: b.display_phone,
      website: b.url,
      googleMapsUrl: undefined,
      isOpen: b.is_closed === false,
      hours: undefined,
      location: b.coordinates
        ? { lat: b.coordinates.latitude, lng: b.coordinates.longitude }
        : undefined,
      photos: b.image_url ? [b.image_url] : [],
    }));
  } catch (err) {
    console.warn('[local-search] Yelp request failed:', (err as Error).message);
    return null;
  }
}

// ─── Google Maps scraping fallback ────────────────────────────────────────

async function searchGoogleMapsFallback(opts: LocalSearchOptions): Promise<LocalSearchResult[]> {
  try {
    const query = opts.location
      ? `${opts.query} in ${opts.location}`
      : opts.query;

    const url = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
    const result = await peel(url, { render: true, timeout: 15000 });

    // Extract what we can from the markdown content
    const lines = result.content.split('\n').filter(Boolean);
    const businesses: LocalSearchResult[] = [];

    // Simple heuristic: look for business name patterns followed by rating/address
    let current: Partial<LocalSearchResult> | null = null;
    for (const line of lines) {
      // Rating line: "4.5 (1,234)"
      const ratingMatch = line.match(/^(\d\.\d)\s*\((\d[\d,]*)\)/);
      if (ratingMatch && current) {
        current.rating = parseFloat(ratingMatch[1]);
        current.reviewCount = parseInt(ratingMatch[2].replace(/,/g, ''));
        continue;
      }

      // Push completed entry and start new one for non-empty lines that look like names
      if (line.length > 3 && line.length < 100 && !line.startsWith('http') && !ratingMatch) {
        if (current?.name) {
          businesses.push(current as LocalSearchResult);
        }
        current = { name: line, address: '' };
      }
    }
    if (current?.name) businesses.push(current as LocalSearchResult);

    return businesses.slice(0, opts.limit ?? 10);
  } catch {
    return [];
  }
}

// ─── Dedup by name+address similarity ────────────────────────────────────

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function isSimilar(a: LocalSearchResult, b: LocalSearchResult): boolean {
  const nameA = normalize(a.name);
  const nameB = normalize(b.name);
  if (nameA === nameB) return true;

  // Jaccard similarity on word tokens
  const tokA = new Set(nameA.split(' '));
  const tokB = new Set(nameB.split(' '));
  const intersection = [...tokA].filter(t => tokB.has(t));
  const union = new Set([...tokA, ...tokB]);
  const jaccard = intersection.length / union.size;
  return jaccard >= 0.7;
}

function dedupResults(primary: LocalSearchResult[], secondary: LocalSearchResult[]): LocalSearchResult[] {
  const merged = [...primary];
  for (const item of secondary) {
    if (!merged.some(existing => isSimilar(existing, item))) {
      merged.push(item);
    }
  }
  return merged;
}

// ─── Main export ──────────────────────────────────────────────────────────

/**
 * Search for local businesses/places using the best available source.
 *
 * Priority order:
 * 1. Google Places Text Search (New) API — requires GOOGLE_PLACES_API_KEY
 * 2. Yelp Fusion API — requires YELP_API_KEY (merged with Google if both available)
 * 3. Google Maps scraping via peel() — no API key required, slowest
 *
 * @example
 * ```typescript
 * const results = await localSearch({
 *   query: 'best sushi',
 *   location: 'Shibuya, Tokyo',
 *   language: 'ja',
 *   country: 'JP',
 * });
 * console.log(results.results[0].name); // "寿司 さわ"
 * ```
 */
export async function localSearch(opts: LocalSearchOptions): Promise<LocalSearchResponse> {
  const limit = opts.limit ?? 10;
  let source: LocalSearchResponse['source'] = 'fallback';

  // Try Google Places first (best data quality)
  const googleResults = await searchGooglePlaces(opts);

  if (googleResults !== null) {
    source = 'google-places';
    let results = googleResults;

    // Also fetch Yelp in parallel if key is available, merge for more coverage
    const yelpResults = await searchYelp({ ...opts, limit: Math.ceil(limit / 2) });
    if (yelpResults && yelpResults.length > 0) {
      results = dedupResults(googleResults, yelpResults);
    }

    return {
      results: results.slice(0, limit),
      query: opts.query,
      location: opts.location,
      source,
    };
  }

  // Try Yelp as primary if no Google key
  const yelpResults = await searchYelp(opts);
  if (yelpResults !== null && yelpResults.length > 0) {
    return {
      results: yelpResults.slice(0, limit),
      query: opts.query,
      location: opts.location,
      source: 'yelp',
    };
  }

  // Last resort: scrape Google Maps
  const fallbackResults = await searchGoogleMapsFallback(opts);
  return {
    results: fallbackResults.slice(0, limit),
    query: opts.query,
    location: opts.location,
    source: 'fallback',
  };
}
