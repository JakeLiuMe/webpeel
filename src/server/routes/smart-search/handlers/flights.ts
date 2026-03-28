import { getBestSearchProvider } from '../../../../core/search-provider.js';
import type { SearchIntent, SmartSearchResult } from '../types.js';
import { addAffiliateTag } from '../utils.js';
import { callLLMQuick, sanitizeSearchQuery, PROMPT_INJECTION_DEFENSE } from '../llm.js';

export async function handleFlightSearch(intent: SearchIntent): Promise<SmartSearchResult> {
  const t0 = Date.now();
  const gfUrl = `https://www.google.com/travel/flights?q=Flights+${encodeURIComponent(intent.query)}+one+way`;

  // Search for actual flight prices + Reddit tips in parallel
  const { provider: searchProvider } = getBestSearchProvider();
  const [kayakSettled, skyscannerSettled, momondoSettled, googleSettled, redditSettled] = await Promise.allSettled([
    searchProvider.searchWeb(`${intent.query} cheapest price site:kayak.com`, { count: 2 }),
    searchProvider.searchWeb(`${intent.query} cheapest flights site:skyscanner.com`, { count: 3 }),
    searchProvider.searchWeb(`${intent.query} cheap flights site:momondo.com OR site:cheapflights.com`, { count: 3 }),
    searchProvider.searchWeb(`${intent.query} flights site:google.com/travel`, { count: 2 }),
    searchProvider.searchWeb(`${intent.query} flights reddit tips cheap`, { count: 3 }),
  ]);
  const flightResults = [
    ...(kayakSettled.status === 'fulfilled' ? kayakSettled.value : []),
    ...(skyscannerSettled.status === 'fulfilled' ? skyscannerSettled.value : []),
    ...(momondoSettled.status === 'fulfilled' ? momondoSettled.value : []),
    ...(googleSettled.status === 'fulfilled' ? googleSettled.value : []),
  ];
  const redditResults = redditSettled.status === 'fulfilled' ? redditSettled.value : [];

  // Build content from search results + static booking links as fallback
  const searchSection = flightResults.length > 0
    ? `## 🔍 Flight Results\n\n${flightResults.slice(0, 6).map((r, i) =>
        `${i + 1}. **[${r.title}](${r.url})**\n   ${r.snippet || ''}`
      ).join('\n\n')}\n\n`
    : '';

  const content = `# ✈️ Flights — ${intent.query}

${searchSection}## 📌 Book Directly

1. **[Google Flights](${gfUrl})**  
   Direct link to Google Flights search

2. **[Kayak](https://www.kayak.com/flights?a=help)**  
   Compare prices across all airlines

3. **[Expedia](https://www.expedia.com/Flights)**  
   Flights, hotels, bundles

4. **[Skyscanner](https://www.skyscanner.com/)**  
   Popular international flight search

5. **[Momondo](https://www.momondo.com/)**  
   Meta-search with lowest prices

---
`;

  // AI synthesis from search results + Reddit tips
  let answer: string | undefined;
  try {
    const flightInfo = flightResults.slice(0, 5).map(r => `${r.title}: ${r.snippet || ''}`).join('\n');
    const redditSnippets = redditResults.slice(0, 2).map(r => `${r.title}: ${r.snippet || ''}`).join('\n');
    const aiPrompt = `${PROMPT_INJECTION_DEFENSE}You are a flight booking advisor. ONLY use information from the sources below. Do NOT make up prices, airlines, or routes not mentioned. User searched: "${sanitizeSearchQuery(intent.query)}". Web results: ${flightInfo || 'no results found'}. Reddit tips: ${redditSnippets || 'none'}. Give a 2-3 sentence tip about cheapest flights for this route based ONLY on the sources. Mention actual prices found and booking sites. Max 200 words. Cite sources inline as [1], [2], [3].`;
    const aiText = await callLLMQuick(aiPrompt, { maxTokens: 250, timeoutMs: 8000, temperature: 0.3 });
    if (aiText && aiText.length > 20) answer = aiText;
  } catch (err) {
    console.warn('[flight-search] LLM synthesis failed (graceful fallback):', (err as Error).message);
  }

  return {
    type: 'flights',
    source: 'Flight Search',
    sourceUrl: gfUrl,
    content,
    title: `Flights — ${intent.query}`,
    structured: { listings: flightResults.slice(0, 6).map(r => ({ title: r.title, url: addAffiliateTag(r.url), snippet: r.snippet })) },
    tokens: content.split(' ').length,
    fetchTimeMs: Date.now() - t0,
    ...(answer !== undefined ? { answer } : {}),
  };
}
