import { getBestSearchProvider } from '../../../../core/search-provider.js';
import type { SearchIntent, SmartSearchResult } from '../types.js';
import { addAffiliateTag, parsePrice, extractPriceValue } from '../utils.js';
import { callLLMQuick, sanitizeSearchQuery, PROMPT_INJECTION_DEFENSE } from '../llm.js';

export async function handleHotelSearch(intent: SearchIntent): Promise<SmartSearchResult> {
  const t0 = Date.now();
  const ghUrl = `https://www.google.com/travel/hotels?q=${encodeURIComponent(intent.query)}`;

  // Extract location from query: "hotels in boston" → "boston"
  const hotelLocMatch = intent.query.match(/\b(?:in|near|at|around)\s+(.+?)(?:\s+(?:under|below|for|cheap|\$|from|per).*)?$/i);
  const hotelLocation = hotelLocMatch ? hotelLocMatch[1].trim() : intent.query.replace(/\b(hotel|hotels|motel|stay|accommodation|lodging|inn|resort|airbnb|hostel|book|cheap|best)\b/gi, '').trim();

  // Search for actual hotel prices + Reddit tips in parallel
  const { provider: searchProvider } = getBestSearchProvider();
  const [bookingSettled, kayakSettled, expediaSettled, tripadvisorSettled, redditSettled] = await Promise.allSettled([
    searchProvider.searchWeb(`hotel ${hotelLocation} price per night site:booking.com`, { count: 3 }),
    searchProvider.searchWeb(`hotel ${hotelLocation} cheapest site:kayak.com`, { count: 3 }),
    searchProvider.searchWeb(`hotel ${hotelLocation} deals site:expedia.com OR site:hotels.com`, { count: 3 }),
    searchProvider.searchWeb(`hotel ${hotelLocation} best rated site:tripadvisor.com`, { count: 2 }),
    searchProvider.searchWeb(`best hotel ${hotelLocation} reddit tips deal`, { count: 3 }),
  ]);
  const hotelResults = [
    ...(bookingSettled.status === 'fulfilled' ? bookingSettled.value : []),
    ...(kayakSettled.status === 'fulfilled' ? kayakSettled.value : []),
    ...(expediaSettled.status === 'fulfilled' ? expediaSettled.value : []),
    ...(tripadvisorSettled.status === 'fulfilled' ? tripadvisorSettled.value : []),
  ];
  const redditResults = redditSettled.status === 'fulfilled' ? redditSettled.value : [];

  // Parse prices and sort by price
  const parsedHotels = hotelResults
    .map(r => {
      const textToSearch = `${r.title || ''} ${r.snippet || ''}`;
      const price = parsePrice(textToSearch);
      const priceValue = extractPriceValue(price);
      return { ...r, price, priceValue };
    })
    .sort((a, b) => {
      const aVal = a.priceValue ?? Infinity;
      const bVal = b.priceValue ?? Infinity;
      return aVal - bVal;
    });

  // Build content from search results + static booking links as fallback
  const searchSection = parsedHotels.length > 0
    ? `## 🔍 Hotel Results\n\n${parsedHotels.slice(0, 6).map((r, i) =>
        `${i + 1}. **[${r.title}](${r.url})**${r.price ? ` — ${r.price}/night` : ''}\n   ${r.snippet || ''}`
      ).join('\n\n')}\n\n`
    : '';

  const content = `# 🏨 Hotels — ${intent.query}

${searchSection}## 📌 Book Directly

1. **[Booking.com](https://www.booking.com)**  
   Largest selection, competitive prices

2. **[Hotels.com](https://www.hotels.com)**  
   Free night rewards program

3. **[Expedia](https://www.expedia.com/Hotels)**  
   Bundle with flights for discounts

4. **[Airbnb](https://www.airbnb.com)**  
   Apartments, houses, unique stays

5. **[Google Hotels](${ghUrl})**  
   Compare prices across all sites

---
`;

  // AI synthesis from search results + Reddit tips
  let answer: string | undefined;
  if (process.env.OLLAMA_URL) {
    const hotelInfo = parsedHotels.slice(0, 5).map(r => `${r.title}${r.price ? `: ${r.price}/night` : ''} — ${r.snippet || ''}`).join('\n');
    const redditSnippets = redditResults.slice(0, 2).map(r => `${r.title}: ${r.snippet || ''}`).join('\n');
    const aiPrompt = `${PROMPT_INJECTION_DEFENSE}You are a hotel booking advisor. ONLY use information from the sources below. Do NOT make up hotel names or prices not mentioned. User searched: "${sanitizeSearchQuery(intent.query)}". Hotels found: ${hotelInfo || 'no results found'}. Reddit tips: ${redditSnippets || 'none'}. Give a 2-3 sentence recommendation based ONLY on the sources. Mention the cheapest option and actual price if available. Max 200 words. Cite sources inline as [1], [2], [3].`;
    const aiText = await callLLMQuick(aiPrompt, { maxTokens: 250, timeoutMs: 5000, temperature: 0.4 });
    if (aiText && aiText.length > 20) answer = aiText;
  }

  return {
    type: 'hotels',
    source: 'Hotel Search',
    sourceUrl: ghUrl,
    content,
    title: `Hotels — ${intent.query}`,
    structured: { listings: parsedHotels.slice(0, 6).map(r => ({ title: r.title, url: addAffiliateTag(r.url), snippet: r.snippet, price: r.price })) },
    tokens: content.split(' ').length,
    fetchTimeMs: Date.now() - t0,
    ...(answer !== undefined ? { answer } : {}),
  };
}
