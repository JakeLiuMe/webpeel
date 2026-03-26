import { getBestSearchProvider } from '../../../../core/search-provider.js';

export async function fetchYouTubeResults(keyword: string, location: string) {
  const { provider } = getBestSearchProvider();
  const results = await provider.searchWeb(`${keyword} ${location} food review site:youtube.com`, { count: 3 });
  return {
    source: 'youtube' as const,
    videos: results.map(r => ({ title: r.title, url: r.url, snippet: r.snippet })),
  };
}
