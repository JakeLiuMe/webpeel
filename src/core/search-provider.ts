/**
 * Search provider abstraction
 *
 * WebPeel supports multiple web search backends. DuckDuckGo is the default
 * (no API key required). Additional providers available via API keys:
 * - Serper.dev (SERPER_API_KEY) — 2,500 free queries, Google results
 * - Brave Search (BRAVE_API_KEY / BRAVE_SEARCH_KEY) — independent index
 *
 * On hosted/production servers where DDG is blocked, the system auto-falls
 * back through: DDG → DDG Lite → Serper → Brave → stealth browser.
 */

import { fetch as undiciFetch } from 'undici';
import { load } from 'cheerio';

export type SearchProviderId = 'duckduckgo' | 'brave' | 'serper';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchOptions {
  /** Number of results (1-10) */
  count: number;
  /** Provider API key (required for some providers, e.g. Brave) */
  apiKey?: string;
  /** Time filter (DuckDuckGo: df param) */
  tbs?: string;
  /** Country code for geo-targeting */
  country?: string;
  /** Location/region for geo-targeting */
  location?: string;
  /** Optional AbortSignal */
  signal?: AbortSignal;
}

export interface SearchProvider {
  readonly id: SearchProviderId;
  readonly requiresApiKey: boolean;

  searchWeb(query: string, options: WebSearchOptions): Promise<WebSearchResult[]>;
}

function decodeHtmlEntities(input: string): string {
  // Cheerio usually decodes entities when using `.text()`, but keep this as a
  // safety net since DuckDuckGo snippets sometimes leak encoded entities.
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const cp = Number.parseInt(String(hex), 16);
      if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return _m;
      try {
        return String.fromCodePoint(cp);
      } catch {
        return _m;
      }
    })
    .replace(/&#(\d+);/g, (_m, num) => {
      const cp = Number.parseInt(String(num), 10);
      if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return _m;
      try {
        return String.fromCodePoint(cp);
      } catch {
        return _m;
      }
    });
}

function cleanText(
  input: string,
  opts: {
    maxLen: number;
    stripEllipsisPadding?: boolean;
  },
): string {
  let s = decodeHtmlEntities(input);
  s = s.replace(/\s+/g, ' ').trim();

  if (opts.stripEllipsisPadding) {
    // Remove leading/trailing "..." or Unicode ellipsis padding.
    s = s
      .replace(/^(?:\.{3,}|…)+\s*/g, '')
      .replace(/\s*(?:\.{3,}|…)+$/g, '')
      .trim();
  }

  if (s.length > opts.maxLen) s = s.slice(0, opts.maxLen);
  return s;
}

function normalizeUrlForDedupe(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    let path = u.pathname || '/';
    path = path.replace(/\/+$/g, '');
    return `${host}${path}`;
  } catch {
    return rawUrl
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/g, '');
  }
}

export class DuckDuckGoProvider implements SearchProvider {
  readonly id: SearchProviderId = 'duckduckgo';
  readonly requiresApiKey = false;

  private buildQueryAttempts(originalQuery: string): string[] {
    const q = originalQuery.trim();
    if (!q) return [];

    const attempts: string[] = [];

    // Required retry strategy order:
    // 1) original query
    // 2) quoted query
    // 3) query site:*
    attempts.push(q);
    if (!/^".*"$/.test(q)) attempts.push(`"${q}"`);
    attempts.push(`${q} site:*`);

    // Single-word queries are disproportionately likely to return 0 results on
    // the DDG HTML endpoint (e.g. "openai" vs "open ai"). When the first three
    // attempts fail, try a few light-touch strategies that tend to coax the
    // parser into returning web results.
    const isSingleWord = !/\s/.test(q);
    const looksLikeUrlOrDomain = /[./]/.test(q) || /^https?:/i.test(q);

    if (isSingleWord && !looksLikeUrlOrDomain) {
      // Try splitting a common suffix (e.g. openai -> open ai)
      if (/^[a-z]{5,}ai$/i.test(q)) {
        attempts.push(`${q.slice(0, -2)} ai`);
      }

      // Common suffixes that often return at least the official domain
      attempts.push(`${q}.com`);
      attempts.push(`site:${q}.com`);
      attempts.push(`${q} website`);
    }

    // De-dupe attempts (case-insensitive)
    const seen = new Set<string>();
    return attempts
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .filter((s) => {
        const key = s.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  private buildSearchUrl(query: string, options: WebSearchOptions): string {
    const { tbs, country, location } = options;

    const params = new URLSearchParams();
    params.set('q', query);

    // DuckDuckGo HTML endpoint supports some filtering
    if (tbs) {
      // DDG uses `df` for time filtering on html endpoint
      params.set('df', tbs);
    }

    if (country || location) {
      const region = (country || location || '').toLowerCase();
      if (region) params.set('kl', region);
    }

    return `https://html.duckduckgo.com/html/?${params.toString()}`;
  }

  private async searchOnce(query: string, options: WebSearchOptions): Promise<WebSearchResult[]> {
    const { count, signal } = options;

    const searchUrl = this.buildSearchUrl(query, options);

    // Use realistic browser headers to avoid DDG bot detection on datacenter IPs
    const response = await undiciFetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        'Referer': 'https://duckduckgo.com/',
      },
      signal,
    });

    if (!response.ok) {
      throw new Error(`Search failed: HTTP ${response.status}`);
    }

    const html = await response.text();
    const $ = load(html);

    const results: WebSearchResult[] = [];
    const seen = new Set<string>();

    $('.result').each((_i, elem) => {
      if (results.length >= count) return;

      const $result = $(elem);

      // Be resilient to markup variations: title can be in .result__title or
      // directly on the anchor.
      const titleRaw = $result.find('.result__title').text() || $result.find('.result__a').text();
      const rawUrl = $result.find('.result__a').attr('href') || '';
      const snippetRaw = $result.find('.result__snippet').text();

      let title = cleanText(titleRaw, { maxLen: 200 });
      let snippet = cleanText(snippetRaw, { maxLen: 500, stripEllipsisPadding: true });

      if (!title || !rawUrl) return;

      // Extract actual URL from DuckDuckGo redirect
      let url = rawUrl;
      try {
        const ddgUrl = new URL(rawUrl, 'https://duckduckgo.com');
        const uddg = ddgUrl.searchParams.get('uddg');
        if (uddg) url = decodeURIComponent(uddg);
      } catch {
        // Use raw URL if parsing fails
      }

      // SECURITY: Validate and sanitize results — only allow HTTP/HTTPS URLs
      try {
        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch {
          // Handle protocol-relative or relative URLs (rare but possible)
          parsed = new URL(url, 'https://duckduckgo.com');
        }
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          return;
        }
        url = parsed.href;
      } catch {
        return;
      }

      // Deduplicate by normalized URL (strip query params, www, trailing slash)
      const dedupeKey = normalizeUrlForDedupe(url);
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      results.push({ title, url, snippet });
    });

    return results;
  }

  /**
   * Fallback: DuckDuckGo Lite endpoint. Different HTML structure, sometimes
   * works when the main HTML endpoint is temporarily blocked on datacenter IPs.
   */
  private async searchLite(query: string, options: WebSearchOptions): Promise<WebSearchResult[]> {
    const { count, signal } = options;

    const params = new URLSearchParams();
    params.set('q', query);

    const response = await undiciFetch(`https://lite.duckduckgo.com/lite/?${params.toString()}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://lite.duckduckgo.com/',
      },
      signal,
    });

    if (!response.ok) return [];

    const html = await response.text();
    const $ = load(html);

    const results: WebSearchResult[] = [];
    const seen = new Set<string>();

    // DDG Lite uses a table-based layout with class="result-link" for links
    // and class="result-snippet" for snippets
    $('a.result-link').each((_i, elem) => {
      if (results.length >= count) return;

      const $a = $(elem);
      const title = cleanText($a.text(), { maxLen: 200 });
      let url = $a.attr('href') || '';

      if (!title || !url) return;

      // Extract actual URL from DDG redirect
      try {
        const ddgUrl = new URL(url, 'https://lite.duckduckgo.com');
        const uddg = ddgUrl.searchParams.get('uddg');
        if (uddg) url = decodeURIComponent(uddg);
      } catch { /* use raw */ }

      // Validate URL
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) return;
        url = parsed.href;
      } catch { return; }

      const dedupeKey = normalizeUrlForDedupe(url);
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);

      // Lite snippets are in the next <td> with class result-snippet
      const snippet = cleanText(
        $a.closest('tr').next('tr').find('.result-snippet').text(),
        { maxLen: 500, stripEllipsisPadding: true },
      );

      results.push({ title, url, snippet });
    });

    return results;
  }

  /**
   * Last-resort fallback: use headless browser with stealth mode to render
   * DDG search results. Stealth mode bypasses bot detection on datacenter IPs.
   * Slower (~5-8s) but more reliable than HTTP-only scraping from server IPs.
   */
  private async searchRendered(query: string, options: WebSearchOptions): Promise<WebSearchResult[]> {
    const { count } = options;

    try {
      // Dynamic import to avoid loading peel in search-only contexts
      const { peel } = await import('../index.js');
      const searchUrl = this.buildSearchUrl(query, options);

      const result = await peel(searchUrl, {
        render: true,
        stealth: true,
        format: 'html',
        wait: 3000,  // Extra wait for stealth mode + DDG rendering
      });

      const html = result.content || '';
      if (!html) return [];

      const { load: cheerioLoad } = await import('cheerio');
      const $ = cheerioLoad(html);
      const results: WebSearchResult[] = [];
      const seen = new Set<string>();

      // Same parsing as searchOnce — DDG HTML structure
      $('.result').each((_i, elem) => {
        if (results.length >= count) return;

        const $result = $(elem);
        const titleRaw = $result.find('.result__title').text() || $result.find('.result__a').text();
        const rawUrl = $result.find('.result__a').attr('href') || '';
        const snippetRaw = $result.find('.result__snippet').text();

        let title = cleanText(titleRaw, { maxLen: 200 });
        let snippet = cleanText(snippetRaw, { maxLen: 500, stripEllipsisPadding: true });

        if (!title || !rawUrl) return;

        let url = rawUrl;
        try {
          const ddgUrl = new URL(rawUrl, 'https://duckduckgo.com');
          const uddg = ddgUrl.searchParams.get('uddg');
          if (uddg) url = decodeURIComponent(uddg);
        } catch { /* use raw */ }

        try {
          const parsed = new URL(url);
          if (!['http:', 'https:'].includes(parsed.protocol)) return;
          url = parsed.href;
        } catch { return; }

        const dedupeKey = normalizeUrlForDedupe(url);
        if (seen.has(dedupeKey)) return;
        seen.add(dedupeKey);

        results.push({ title, url, snippet });
      });

      return results;
    } catch {
      return [];
    }
  }

  async searchWeb(query: string, options: WebSearchOptions): Promise<WebSearchResult[]> {
    const attempts = this.buildQueryAttempts(query);

    // Retry only when DDG returns 0 results.
    for (const q of attempts) {
      const results = await this.searchOnce(q, options);
      if (results.length > 0) return results;
    }

    // Fallback: try DDG Lite endpoint (different HTML, sometimes bypasses blocks)
    try {
      const liteResults = await this.searchLite(query, options);
      if (liteResults.length > 0) return liteResults;
    } catch {
      // Lite also failed — try API-based fallbacks
    }

    // Fallback: try Serper API if key is configured (2,500 free queries)
    const serperKey = process.env.SERPER_API_KEY;
    if (serperKey) {
      try {
        const serperProvider = new SerperProvider();
        const serperResults = await serperProvider.searchWeb(query, { ...options, apiKey: serperKey });
        if (serperResults.length > 0) return serperResults;
      } catch {
        // Serper failed — continue to next fallback
      }
    }

    // Fallback: try Brave Search API if key is configured
    const braveKey = process.env.BRAVE_SEARCH_KEY || process.env.BRAVE_API_KEY;
    if (braveKey) {
      try {
        const braveProvider = new BraveSearchProvider();
        const braveResults = await braveProvider.searchWeb(query, { ...options, apiKey: braveKey });
        if (braveResults.length > 0) return braveResults;
      } catch {
        // Brave failed — continue to next fallback
      }
    }

    // Last resort: browser-rendered search with stealth mode
    // Only use this on the server (has Chromium), not in CLI (too slow for interactive)
    if (typeof process !== 'undefined' && (process.env.PLAYWRIGHT_BROWSERS_PATH !== undefined || process.env.NODE_ENV === 'production')) {
      try {
        const renderedResults = await this.searchRendered(query, options);
        if (renderedResults.length > 0) return renderedResults;
      } catch {
        // Rendered also failed
      }
    }

    return [];
  }
}

export class SerperProvider implements SearchProvider {
  readonly id: SearchProviderId = 'serper';
  readonly requiresApiKey = true;

  async searchWeb(query: string, options: WebSearchOptions): Promise<WebSearchResult[]> {
    const { count, apiKey, signal } = options;

    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('Serper requires an API key (SERPER_API_KEY). Get 2,500 free queries at https://serper.dev');
    }

    const response = await undiciFetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: query,
        num: Math.min(Math.max(count, 1), 10),
      }),
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Serper search failed: HTTP ${response.status}${text ? ` - ${text}` : ''}`);
    }

    const data = await response.json() as any;
    const organic: any[] = data?.organic;

    if (!Array.isArray(organic)) {
      return [];
    }

    const results: WebSearchResult[] = [];

    for (const r of organic) {
      if (results.length >= count) break;
      const title = typeof r?.title === 'string' ? r.title.trim() : '';
      const rawUrl = typeof r?.link === 'string' ? r.link.trim() : '';
      const snippet = typeof r?.snippet === 'string' ? r.snippet.trim() : '';

      if (!title || !rawUrl) continue;

      // SECURITY: Validate URL protocol
      try {
        const parsed = new URL(rawUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      } catch {
        continue;
      }

      results.push({
        title: title.slice(0, 200),
        url: rawUrl,
        snippet: snippet.slice(0, 500),
      });
    }

    return results;
  }
}

export class BraveSearchProvider implements SearchProvider {
  readonly id: SearchProviderId = 'brave';
  readonly requiresApiKey = true;

  async searchWeb(query: string, options: WebSearchOptions): Promise<WebSearchResult[]> {
    const { count, apiKey, signal } = options;

    if (!apiKey || apiKey.trim().length === 0) {
      throw new Error('Brave Search requires an API key');
    }

    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(Math.min(Math.max(count, 1), 10)));

    const response = await undiciFetch(url.toString(), {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': apiKey,
      },
      signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Brave Search failed: HTTP ${response.status}${text ? ` - ${text}` : ''}`);
    }

    const data = await response.json() as any;
    const resultsArray: any[] = data?.web?.results;

    if (!Array.isArray(resultsArray)) {
      return [];
    }

    const results: WebSearchResult[] = [];

    for (const r of resultsArray) {
      if (results.length >= count) break;
      const title = typeof r?.title === 'string' ? r.title.trim() : '';
      const rawUrl = typeof r?.url === 'string' ? r.url.trim() : '';
      const snippet = typeof r?.description === 'string'
        ? r.description.trim()
        : typeof r?.snippet === 'string'
          ? r.snippet.trim()
          : '';

      if (!title || !rawUrl) continue;

      // SECURITY: Validate URL protocol
      try {
        const parsed = new URL(rawUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      } catch {
        continue;
      }

      results.push({
        title: title.slice(0, 200),
        url: rawUrl,
        snippet: snippet.slice(0, 500),
      });
    }

    return results;
  }
}

export function getSearchProvider(id: SearchProviderId | undefined): SearchProvider {
  if (!id || id === 'duckduckgo') return new DuckDuckGoProvider();
  if (id === 'brave') return new BraveSearchProvider();
  if (id === 'serper') return new SerperProvider();

  // Exhaustive fallback (should be unreachable due to typing)
  return new DuckDuckGoProvider();
}

/**
 * Get the best available search provider based on configured API keys.
 * Returns the first provider with a configured key, falling back to DDG.
 */
export function getBestSearchProvider(): { provider: SearchProvider; apiKey?: string } {
  // Check for Serper (best free tier: 2,500 queries)
  const serperKey = process.env.SERPER_API_KEY;
  if (serperKey) {
    return { provider: new SerperProvider(), apiKey: serperKey };
  }

  // Check for Brave
  const braveKey = process.env.BRAVE_SEARCH_KEY || process.env.BRAVE_API_KEY;
  if (braveKey) {
    return { provider: new BraveSearchProvider(), apiKey: braveKey };
  }

  // Default: DuckDuckGo (free, no key, with built-in fallback chain)
  return { provider: new DuckDuckGoProvider() };
}
