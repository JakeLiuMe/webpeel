/**
 * Cross-source verification — search multiple engines, compare results,
 * compute consensus/confidence scores.
 */

import type { WebSearchResult } from './search-provider.js';

export interface CrossVerifyResult {
  query: string;
  sources: Array<{
    engine: string;
    resultCount: number;
    topResults: WebSearchResult[];
  }>;
  consensus: Array<{
    url: string;
    title: string;
    appearsIn: string[];    // Which engines found this
    agreementScore: number; // 0-1, how many engines agree
    averagePosition: number;
  }>;
  confidence: number;       // 0-1 overall query confidence
  totalSources: number;
  elapsed: number;
}

export async function crossVerifySearch(
  query: string,
  options?: { engines?: string[]; count?: number }
): Promise<CrossVerifyResult> {
  const engines = options?.engines || ['duckduckgo', 'google', 'baidu'];
  const count = options?.count || 10;
  const t0 = Date.now();

  // Import providers dynamically to avoid circular deps
  const { getSearchProvider } = await import('./search-provider.js');
  const { BaiduSearchProvider, YandexSearchProvider, NaverSearchProvider, YahooJapanSearchProvider } = await import('./search-engines.js');

  // Search all engines in parallel
  const searchPromises = engines.map(async (engineId) => {
    try {
      let provider;
      if (engineId === 'baidu') provider = new BaiduSearchProvider();
      else if (engineId === 'yandex') provider = new YandexSearchProvider();
      else if (engineId === 'naver') provider = new NaverSearchProvider();
      else if (engineId === 'yahoo_japan') provider = new YahooJapanSearchProvider();
      else provider = getSearchProvider(engineId as any);

      const results = await Promise.race([
        provider.searchWeb(query, { count }),
        new Promise<WebSearchResult[]>((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000)),
      ]);
      return { engine: engineId, resultCount: results.length, topResults: results.slice(0, count) };
    } catch {
      return { engine: engineId, resultCount: 0, topResults: [] };
    }
  });

  const sources = await Promise.all(searchPromises);

  // Build consensus — find URLs that appear across multiple engines
  const urlMap = new Map<string, { title: string; engines: string[]; positions: number[] }>();

  for (const source of sources) {
    for (let i = 0; i < source.topResults.length; i++) {
      const r = source.topResults[i];
      // Normalize URL for comparison (strip www, trailing slash, query params)
      const normalizedUrl = normalizeUrl(r.url);
      const existing = urlMap.get(normalizedUrl);
      if (existing) {
        existing.engines.push(source.engine);
        existing.positions.push(i + 1);
      } else {
        urlMap.set(normalizedUrl, {
          title: r.title,
          engines: [source.engine],
          positions: [i + 1],
        });
      }
    }
  }

  const activeSources = sources.filter(s => s.resultCount > 0);

  // Sort by agreement (most engines first), then by average position
  const consensus = [...urlMap.entries()]
    .map(([url, data]) => ({
      url,
      title: data.title,
      appearsIn: data.engines,
      agreementScore: activeSources.length > 0
        ? data.engines.length / activeSources.length
        : 0,
      averagePosition: data.positions.reduce((a, b) => a + b, 0) / data.positions.length,
    }))
    .sort((a, b) => b.agreementScore - a.agreementScore || a.averagePosition - b.averagePosition);

  // Overall confidence = average agreement of top 5 results
  const top5Agreement = consensus.slice(0, 5);
  const confidence = top5Agreement.length > 0
    ? top5Agreement.reduce((sum, r) => sum + r.agreementScore, 0) / top5Agreement.length
    : 0;

  return {
    query,
    sources,
    consensus,
    confidence: Math.round(confidence * 100) / 100,
    totalSources: activeSources.length,
    elapsed: Date.now() - t0,
  };
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/$/, '');
  } catch {
    return url;
  }
}
