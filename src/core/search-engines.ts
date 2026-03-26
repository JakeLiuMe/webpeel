/**
 * Additional search engine providers: Baidu, Yandex
 * HTTP-only scraping with cheerio — no browser, no API key required.
 */

import { load } from 'cheerio';
import { simpleFetch } from './fetcher.js';
import type { WebSearchResult, WebSearchOptions, SearchProvider, SearchProviderId } from './search-provider.js';

// ── Baidu Search ──────────────────────────────────────────────────────────

export class BaiduSearchProvider implements SearchProvider {
  readonly id = 'baidu' as SearchProviderId;
  readonly requiresApiKey = false;

  async searchWeb(query: string, options: WebSearchOptions): Promise<WebSearchResult[]> {
    const { count = 10 } = options;

    // Baidu search URL
    const params = new URLSearchParams({
      wd: query,
      rn: String(Math.min(count, 50)),
      ie: 'utf-8',
    });

    const url = `https://www.baidu.com/s?${params}`;

    try {
      const response = await simpleFetch(
        url,
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        15000,
      );

      if (!response.html) return [];

      const $ = load(response.html);
      const results: WebSearchResult[] = [];
      const seen = new Set<string>();

      // Baidu result selectors: .result or .c-container
      $('.result, .c-container').each((_, elem) => {
        const el = $(elem);
        const linkEl = el.find('h3 a, .t a').first();
        const title = linkEl.text().trim();
        // Baidu uses redirect URLs — get the data-url or mu attribute for real URL
        const href = el.attr('mu') || linkEl.attr('href') || '';
        const snippet = el.find('.c-abstract, .c-span-last, .content-right_8Zs40').first().text().trim();

        if (title && href && !seen.has(href)) {
          seen.add(href);
          results.push({ title, url: href, snippet });
        }
      });

      return results.slice(0, count);
    } catch {
      return [];
    }
  }
}

// ── Naver Search (Korea) ──────────────────────────────────────────────────

export class NaverSearchProvider implements SearchProvider {
  readonly id = 'naver' as SearchProviderId;
  readonly requiresApiKey = false;

  async searchWeb(query: string, options: WebSearchOptions): Promise<WebSearchResult[]> {
    const { count = 10 } = options;
    const params = new URLSearchParams({
      query: query,
      where: 'web',
    });
    const url = `https://search.naver.com/search.naver?${params}`;

    try {
      // Naver is heavily JS-rendered — use peel with render for full content
      const { peel } = await import('../index.js');
      const result = await peel(url, { render: true, format: 'html', wait: 2000, timeout: 15000 });
      const html = result.content || '';
      if (!html) return [];

      const $ = load(html);
      const results: WebSearchResult[] = [];
      const seen = new Set<string>();

      // Naver uses .type-web class for web results, titles in *-title-text classes
      $('.type-web').each((_, elem) => {
        const el = $(elem);
        const parent = el.closest('li, section, [class*=item]').length ? el.closest('li, section, [class*=item]') : el.parent();
        const title = parent.find('[class*="title-text"], [class*="Title"]').first().text().trim();
        const href = parent.find('a[href^="http"]').first().attr('href') || '';
        const snippet = parent.find('[class*="text-type-body"], [class*="desc"]').first().text().trim();

        if (title && href && !href.includes('naver.com/search') && !seen.has(href)) {
          seen.add(href);
          results.push({ title, url: href, snippet });
        }
      });

      // Fallback: try generic link extraction if .type-web yielded nothing
      if (results.length === 0) {
        $('a[href^="http"]').each((_, elem) => {
          const el = $(elem);
          const href = el.attr('href') || '';
          const title = el.text().trim();
          if (title.length > 5 && title.length < 200 && href && !href.includes('naver.com') && !seen.has(href)) {
            seen.add(href);
            results.push({ title, url: href, snippet: '' });
          }
        });
      }

      return results.slice(0, count);
    } catch {
      return [];
    }
  }
}

// ── Yahoo Japan Search ────────────────────────────────────────────────────

export class YahooJapanSearchProvider implements SearchProvider {
  readonly id = 'yahoo_japan' as SearchProviderId;
  readonly requiresApiKey = false;

  async searchWeb(query: string, options: WebSearchOptions): Promise<WebSearchResult[]> {
    const { count = 10 } = options;
    const params = new URLSearchParams({
      p: query,
      n: String(Math.min(count, 50)),
      ei: 'UTF-8',
    });
    const url = `https://search.yahoo.co.jp/search?${params}`;

    try {
      const response = await simpleFetch(
        url,
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        15000,
      );
      if (!response.html) return [];

      const $ = load(response.html);
      const results: WebSearchResult[] = [];

      // Yahoo Japan result selectors (2026 layout uses sw-Card components)
      const seen = new Set<string>();
      $('.sw-Card__title, .algo, .dd').each((_, elem) => {
        const el = $(elem);
        // Walk up to the card container to find the link and snippet
        const card = el.closest('[class*="sw-Card"], .algo, .dd, li').length
          ? el.closest('[class*="sw-Card"], .algo, .dd, li')
          : el.parent();
        const title = el.find('.sw-Card__titleMain, h3, a').first().text().trim() || el.text().trim();
        const href = card.find('a[href^="http"]').first().attr('href') || '';
        const snippet = card.find('.sw-Card__description, .sw-Card__floatText, p').first().text().trim();

        // Filter Yahoo internal links
        if (title && title.length > 3 && href && !href.includes('yahoo.co.jp/search') && !href.includes('cache.yahoofs') && !seen.has(href)) {
          seen.add(href);
          results.push({ title, url: href, snippet });
        }
      });

      return results.slice(0, count);
    } catch {
      return [];
    }
  }
}

// ── Yandex Search ──────────────────────────────────────────────────────────

export class YandexSearchProvider implements SearchProvider {
  readonly id = 'yandex' as SearchProviderId;
  readonly requiresApiKey = false;

  async searchWeb(query: string, options: WebSearchOptions): Promise<WebSearchResult[]> {
    const { count = 10 } = options;

    const params = new URLSearchParams({
      text: query,
      numdoc: String(Math.min(count, 50)),
      lr: '84', // Default to US region; can be overridden
    });

    // Use Yandex HTML search
    const url = `https://yandex.com/search/?${params}`;

    try {
      const response = await simpleFetch(
        url,
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        15000,
      );

      if (!response.html) return [];

      const $ = load(response.html);
      const results: WebSearchResult[] = [];
      const seen = new Set<string>();

      // Yandex result selectors
      $('.serp-item, .organic').each((_, elem) => {
        const el = $(elem);
        const linkEl = el.find('.organic__url, .link, a[href]').first();
        const title = el.find('.organic__title, .OrganicTitle-LinkText, h2').first().text().trim();
        const href = linkEl.attr('href') || '';
        const snippet = el.find('.organic__text, .OrganicText, .text-container').first().text().trim();

        // Filter internal Yandex links
        if (title && href && !href.includes('yandex.') && !seen.has(href)) {
          seen.add(href);
          // Normalize URL (Yandex sometimes uses relative paths)
          const fullUrl = href.startsWith('http') ? href : `https://${href}`;
          results.push({ title, url: fullUrl, snippet });
        }
      });

      return results.slice(0, count);
    } catch {
      return [];
    }
  }
}
