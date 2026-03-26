import { getBestSearchProvider } from '../../../../core/search-provider.js';
import type { SearchIntent, SmartSearchResult } from '../types.js';
import { addAffiliateTag, parsePrice, extractPriceValue } from '../utils.js';
import { callLLMQuick, PROMPT_INJECTION_DEFENSE } from '../llm.js';

export async function handleRentalSearch(intent: SearchIntent): Promise<SmartSearchResult> {
  const t0 = Date.now();

  // Extract location from query
  const locMatch = intent.query.match(/\b(?:in|at|near|from|around)\s+(.+?)(?:\s+(?:for|under|from|to|between|\$|cheap|best).*)?$/i);
  const location = locMatch ? locMatch[1].trim() : '';

  // Extract dates if present
  const dateMatch = intent.query.match(/(?:from|between)\s+(\w+\s+\d+)\s+(?:to|and|through|-)\s+(\w+\s+\d+)/i);
  const dates = dateMatch ? { from: dateMatch[1], to: dateMatch[2] } : null;

  // Extract budget if present
  const budgetMatch = intent.query.match(/(?:under|\$|budget|max|cheaper than)\s*\$?(\d+)/i);
  const budget = budgetMatch ? budgetMatch[1] : null;

  const { provider: searchProvider } = getBestSearchProvider();

  // Search for aggregator results that include prices + Reddit tips
  const [aggregatorSettled, turoSettled, redditSettled] = await Promise.allSettled([
    searchProvider.searchWeb(
      `car rental ${location || 'near me'} ${dates ? `${dates.from} to ${dates.to}` : ''} price cheapest site:kayak.com OR site:priceline.com OR site:expedia.com`,
      { count: 8 }
    ),
    searchProvider.searchWeb(
      `car rental ${location || ''} site:turo.com OR site:enterprise.com OR site:hertz.com`,
      { count: 3 }
    ),
    searchProvider.searchWeb(`car rental ${location || ''} reddit tips best deal cheapest`, { count: 2 }),
  ]);

  const rentalResults = [
    ...(aggregatorSettled.status === 'fulfilled' ? aggregatorSettled.value : []),
    ...(turoSettled.status === 'fulfilled' ? turoSettled.value : []),
  ];
  const redditResults = redditSettled.status === 'fulfilled' ? redditSettled.value : [];

  // Known aggregators and direct providers
  const RENTAL_SITES: Record<string, { name: string; type: 'aggregator' | 'direct' }> = {
    'kayak.com': { name: 'Kayak', type: 'aggregator' },
    'priceline.com': { name: 'Priceline', type: 'aggregator' },
    'cheapflights.com': { name: 'Cheapflights', type: 'aggregator' },
    'momondo.com': { name: 'Momondo', type: 'aggregator' },
    'skyscanner.com': { name: 'Skyscanner', type: 'aggregator' },
    'trip.com': { name: 'Trip.com', type: 'aggregator' },
    'carrentals.com': { name: 'CarRentals.com', type: 'aggregator' },
    'rentalcars.com': { name: 'RentalCars.com', type: 'aggregator' },
    'stressfreecarrental.com': { name: 'StressFree', type: 'aggregator' },
    'happycar.com': { name: 'HappyCar', type: 'aggregator' },
    'enterprise.com': { name: 'Enterprise', type: 'direct' },
    'hertz.com': { name: 'Hertz', type: 'direct' },
    'avis.com': { name: 'Avis', type: 'direct' },
    'budget.com': { name: 'Budget', type: 'direct' },
    'turo.com': { name: 'Turo', type: 'direct' },
    'sixt.com': { name: 'Sixt', type: 'direct' },
    'nationalcar.com': { name: 'National', type: 'direct' },
    'alamo.com': { name: 'Alamo', type: 'direct' },
    'costcotravel.com': { name: 'Costco Travel', type: 'direct' },
    'expedia.com': { name: 'Expedia', type: 'aggregator' },
  };

  const getSiteInfo = (url: string): { company: string; siteType: 'aggregator' | 'direct' } | null => {
    try {
      const hostname = new URL(url).hostname.replace('www.', '');
      for (const [domain, info] of Object.entries(RENTAL_SITES)) {
        if (hostname === domain || hostname.endsWith('.' + domain)) {
          return { company: info.name, siteType: info.type };
        }
      }
      return null;
    } catch { return null; }
  };

  // Deduplicate by company — keep the most location-specific URL per company
  const seen = new Map<string, typeof rentalResults[0]>();
  for (const r of rentalResults) {
    const siteInfo = getSiteInfo(r.url);
    if (!siteInfo) continue;
    const existing = seen.get(siteInfo.company);
    // Prefer URLs that mention the location (more specific = better)
    const locLower = (location || '').toLowerCase().replace(/\s+/g, '');
    const urlLower = r.url.toLowerCase().replace(/[\s-]/g, '');
    const isLocationSpecific = locLower && urlLower.includes(locLower.substring(0, 5));
    if (!existing || isLocationSpecific) {
      seen.set(siteInfo.company, r);
    }
  }

  const listings = [...seen.entries()]
    .map(([company, r]) => {
      const siteInfo = getSiteInfo(r.url)!;
      // Extract price from BOTH title and snippet; prefer title (more prominent = more accurate)
      const titlePrice = parsePrice(r.title || '');
      const snippetPrice = parsePrice(r.snippet || '');
      const price = titlePrice || snippetPrice;
      const priceValue = extractPriceValue(price);
      return {
        name: r.title?.replace(/\s*[-|–—].*$/, '').trim() || `${company} Car Rental`,
        company,
        siteType: siteInfo.siteType,
        url: addAffiliateTag(r.url),
        snippet: r.snippet || '',
        price,
        priceValue,
      };
    });

  // Sort: aggregators with prices first (lowest price first), then aggregators without prices, then direct providers
  listings.sort((a, b) => {
    const aVal = a.priceValue ?? Infinity;
    const bVal = b.priceValue ?? Infinity;
    if (aVal !== bVal) return aVal - bVal;
    if (a.siteType !== b.siteType) return a.siteType === 'aggregator' ? -1 : 1;
    return 0;
  });

  const topListings = listings.slice(0, 6);

  // Also add direct booking links for major providers if they didn't appear in search
  const searchLocation = encodeURIComponent(location || 'New York');
  const directLinks = [
    { company: 'Kayak', siteType: 'aggregator' as const, url: `https://www.kayak.com/cars/${searchLocation}`, name: 'Compare all rental companies' },
    { company: 'Enterprise', siteType: 'direct' as const, url: `https://www.enterprise.com/en/car-rental/locations/us.html`, name: 'Enterprise Rent-A-Car' },
    { company: 'Hertz', siteType: 'direct' as const, url: `https://www.hertz.com/rentacar/reservation/`, name: 'Hertz Car Rental' },
    { company: 'Avis', siteType: 'direct' as const, url: `https://www.avis.com/en/home`, name: 'Avis Car Rental' },
    { company: 'Budget', siteType: 'direct' as const, url: `https://www.budget.com/en/home`, name: 'Budget Car Rental' },
  ].filter(d => !topListings.some(l => l.company === d.company));

  const allListings = [
    ...topListings,
    ...directLinks.map(d => ({ ...d, snippet: '', price: undefined, priceValue: undefined })),
  ];

  // Build markdown content
  const content = `# 🔑 Car Rentals${location ? ` — ${location}` : ''}${dates ? ` (${dates.from} to ${dates.to})` : ''}\n\n` +
    allListings.map((l, i) => `${i + 1}. **${l.name}** — ${l.company}${l.price ? ` · ${l.price}/day` : ''}${l.siteType === 'aggregator' ? ' *(compares prices)*' : ''}\n   ${l.snippet}`).join('\n\n');

  // AI synthesis: use extracted prices + Reddit tips
  let answer: string | undefined;
  if (process.env.OLLAMA_URL) {
    const priceInfo = allListings.filter(l => l.price).map(l => `${l.company}: ${l.price}/day`).join(', ');
    const redditContent = redditResults.slice(0, 3).map(r => `${r.title}: ${r.snippet || ''}`).join('\n');
    const aiPrompt = `${PROMPT_INJECTION_DEFENSE}You are a car rental advisor. ONLY use information from the sources below. User wants to rent a car${location ? ' in ' + location : ''}.${dates ? ` Dates: ${dates.from} to ${dates.to}.` : ''}${budget ? ` Budget: $${budget}/day.` : ''} Prices found: ${priceInfo || 'no prices extracted yet — refer to sites below'}. Reddit tips: ${redditContent || 'none'}. Give a 2-3 sentence recommendation based ONLY on sources. Mention the cheapest option and actual price. Max 200 words. Cite sources inline as [1], [2], [3].`;
    const aiText = await callLLMQuick(aiPrompt, { maxTokens: 250, timeoutMs: 5000, temperature: 0.4 });
    if (aiText && aiText.length > 20) answer = aiText;
  }

  return {
    type: 'rental',
    source: 'Car Rentals + Reddit',
    sourceUrl: `https://www.kayak.com/cars/${searchLocation}`,
    content,
    title: `Car Rentals${location ? ` in ${location}` : ''}`,
    structured: { listings: allListings },
    tokens: content.split(/\s+/).length,
    fetchTimeMs: Date.now() - t0,
    loadingMessage: 'Searching for rental cars...',
    ...(answer !== undefined ? { answer } : {}),
    sources: [
      { type: 'rental', count: topListings.length } as any,
      { type: 'reddit', threads: redditResults.slice(0, 3).map(r => ({ title: r.title, url: r.url, snippet: r.snippet })) } as any,
    ],
  };
}

// ─── Restaurant source fetchers ───────────────────────────────────────────
