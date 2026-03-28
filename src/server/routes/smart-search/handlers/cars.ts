import { peel } from '../../../../index.js';
import { getBestSearchProvider } from '../../../../core/search-provider.js';
import type { SearchIntent, SmartSearchResult } from '../types.js';
import { addAffiliateTag, parsePrice } from '../utils.js';
import { callLLMQuick, sanitizeSearchQuery, PROMPT_INJECTION_DEFENSE } from '../llm.js';

export async function handleCarSearch(intent: SearchIntent): Promise<SmartSearchResult> {
  const t0 = Date.now();
  // Build a clean keyword: strip buying signals, price amounts, and common noise words
  // NOTE: keep "car"/"cars" — they're needed for Cars.com search!
  const keyword = intent.query
    .replace(/\b(buy|cheap|cheapest|under|budget|price|used|new|for sale|listing|deal|best|good|find|search|looking for|want|need|in|near|around)\b/gi, '')
    .replace(/[$]\d[\d,]*/g, '')             // strip $30000, $30,000 etc.
    .replace(/\b\d{4,}\b/g, '')              // strip standalone 4+ digit numbers (prices, not model years)
    // Remove location words that were already extracted to zip
    .replace(/\b(long island|nassau|suffolk|manhattan|brooklyn|queens|bronx|nyc|new york|los angeles|chicago|houston|miami|boston|seattle|san francisco|washington dc)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const params = new URLSearchParams({
    keyword,
    sort: 'list_price',
    stock_type: 'all',
    zip: intent.params.zip || '10001',
    maximum_distance: '50',
  });
  if (intent.params.maxPrice) params.set('list_price_max', intent.params.maxPrice);

  const carSearchUrl = `https://www.cars.com/shopping/results/?${params.toString()}`;

  // Search MULTIPLE car sites in parallel — first one with real listings wins
  const { provider } = getBestSearchProvider();
  const [carsComSettled, carGurusSettled, autotraderSettled, redditSettled] = await Promise.allSettled([
    peel(carSearchUrl, { timeout: 15000 }),
    provider.searchWeb(`${keyword} ${intent.params.maxPrice ? 'under $' + intent.params.maxPrice : ''} site:cargurus.com price listing`, { count: 3 }),
    provider.searchWeb(`${keyword} ${intent.params.maxPrice ? 'under $' + intent.params.maxPrice : ''} site:autotrader.com price listing`, { count: 3 }),
    provider.searchWeb(`${keyword} reddit review reliable problems`, { count: 3 }),
  ]);

  // Cars.com peel gives structured listings (best quality)
  const carsComResult = carsComSettled.status === 'fulfilled' ? carsComSettled.value : null;
  let carListings: any[] = carsComResult?.domainData?.structured?.listings || [];

  // If Cars.com peel failed, combine results from CarGurus + Autotrader
  if (carListings.length === 0) {
    const carGurusResults = carGurusSettled.status === 'fulfilled' ? carGurusSettled.value : [];
    const autotraderResults = autotraderSettled.status === 'fulfilled' ? autotraderSettled.value : [];
    const allSearchResults = [...carGurusResults, ...autotraderResults];

    carListings = allSearchResults
      .filter(r => r.url && r.title)
      .map(r => {
        const textToSearch = `${r.title || ''} ${r.snippet || ''}`;
        const price = parsePrice(textToSearch);
        const isGenericPage = /\b(for sale near|cars for sale|search|browse|find)\b/i.test(r.title || '') && !price;
        if (isGenericPage) return null;
        const yearMatch = (r.title || '').match(/\b(20\d{2}|19\d{2})\b/);
        return {
          title: r.title?.replace(/\s*[-|–—].*$/, '').trim() || 'Car Listing',
          price,
          year: yearMatch ? yearMatch[1] : '',
          url: addAffiliateTag(r.url),
          snippet: r.snippet || '',
          source: (() => { try { return new URL(r.url).hostname.replace('www.', ''); } catch { return ''; } })(),
        };
      })
      .filter(Boolean)
      .slice(0, 10) as any[];
  }

  const redditResults = redditSettled.status === 'fulfilled' ? redditSettled.value : [];

  // AI synthesis: summarize top listings + Reddit input
  let answer: string | undefined;
  try {
    const listingSummary = carListings.slice(0, 5).map((l: any) =>
      `${l.title || l.name || 'Car'}: ${l.price || 'price N/A'}, ${l.mileage || ''} miles`
    ).join(', ');
    const redditSnippets = redditResults.slice(0, 2).map(r => r.snippet || '').join(' ');
    const aiPrompt = `${PROMPT_INJECTION_DEFENSE}You are a car buying advisor. The user searched: "${sanitizeSearchQuery(intent.query)}". Here are the top listings: ${listingSummary || 'no listings found'}. Reddit says: ${redditSnippets || 'no community input'}. Give a 2-3 sentence recommendation about the best value. Mention specific prices and models. Cite sources inline as [1], [2], etc. if available. Max 200 words.`;
    const aiText = await callLLMQuick(aiPrompt, { maxTokens: 250, timeoutMs: 8000, temperature: 0.3 });
    if (aiText && aiText.length > 20) answer = aiText;
  } catch (err) {
    console.warn('[car-search] LLM synthesis failed (graceful fallback):', (err as Error).message);
  }

  const content = carListings.length > 0
    ? `# 🚗 Cars — ${intent.query}\n\n${carListings.map((l: any, i: number) =>
        `${i + 1}. **${l.title || l.name}** — ${l.price || 'see price'}${l.mileage ? ` · ${String(l.mileage).replace(/\s*mi$/i, '')} mi` : ''}\n   ${l.snippet || ''}`
      ).join('\n\n')}`
    : (carsComResult?.content || `# 🚗 Cars — ${intent.query}\n\nNo listings found. Try a different search.`);

  return {
    type: 'cars',
    source: 'Cars.com + CarGurus + Autotrader + Reddit',
    sourceUrl: carSearchUrl,
    content,
    title: carsComResult?.title || `Cars — ${intent.query}`,
    domainData: carsComResult?.domainData,
    structured: carsComResult?.domainData?.structured || (carListings.length > 0 ? { listings: carListings } : undefined),
    tokens: carsComResult?.tokens || content.split(/\s+/).length,
    fetchTimeMs: Date.now() - t0,
    ...(answer !== undefined ? { answer } : {}),
    sources: [
      { type: 'cars', url: carSearchUrl, count: carListings.length } as any,
      { type: 'reddit', threads: redditResults.map(r => ({ title: r.title, url: r.url, snippet: r.snippet })) } as any,
    ],
  };
}
