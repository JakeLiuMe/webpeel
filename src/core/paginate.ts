/**
 * Pagination link discovery.
 *
 * Given a page's HTML, finds the "Next" page URL by matching common
 * pagination patterns (link text, ARIA labels, rel attributes, CSS classes).
 *
 * @module paginate
 */

import { load } from 'cheerio';

/* ------------------------------------------------------------------ */
/*  Next-page heuristics                                              */
/* ------------------------------------------------------------------ */

/** Exact and partial text patterns for "Next" links (case-insensitive). */
const NEXT_TEXT_EXACT = new Set(['next', 'next page', '›', '»', '>', '>>', 'next ›', 'next »', 'next >', 'suivant', 'weiter', 'siguiente', '次へ']);

/** Substrings to look for in aria-label / class attributes. */
const NEXT_ATTR_SUBSTRINGS = ['next'];

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

/**
 * Attempt to find the URL of the "next" page in a paginated result set.
 *
 * Checks, in priority order:
 *  1. `<a rel="next">`  or  `<link rel="next">`
 *  2. `<a aria-label="...next...">`
 *  3. `<a class="...next...">` (if the link text also looks "nexty")
 *  4. `<a>` whose visible text matches a known next-page pattern
 *
 * @param html       - Raw HTML of the current page.
 * @param currentUrl - Absolute URL of the current page (used to resolve
 *                     relative `href` values).
 * @returns          Absolute URL of the next page, or `null` if none found.
 *
 * @example
 * ```typescript
 * const next = findNextPageUrl(html, 'https://example.com/results?page=1');
 * if (next) {
 *   // fetch next page
 * }
 * ```
 */
export function findNextPageUrl(html: string, currentUrl: string): string | null {
  if (!html) return null;

  const $ = load(html);

  // 1. rel="next" (strongest signal)
  const relNext = $('a[rel="next"], link[rel="next"]').first();
  if (relNext.length) {
    const href = relNext.attr('href');
    const resolved = resolve(href, currentUrl);
    if (resolved && resolved !== currentUrl) return resolved;
  }

  // 2. aria-label containing "next"
  const ariaNext = $('a[aria-label]').filter((_, el) => {
    const label = $(el).attr('aria-label')?.toLowerCase() ?? '';
    return NEXT_ATTR_SUBSTRINGS.some(sub => label.includes(sub));
  }).first();
  if (ariaNext.length) {
    const href = ariaNext.attr('href');
    const resolved = resolve(href, currentUrl);
    if (resolved && resolved !== currentUrl) return resolved;
  }

  // 3. class containing "next" + plausible link text
  const classNext = $('a[class*="next"], a[class*="Next"]').filter((_, el) => {
    const text = $(el).text().trim().toLowerCase();
    // Avoid "previous" or "prev" links that happen to also have "next" in class
    return !text.includes('prev');
  }).first();
  if (classNext.length) {
    const href = classNext.attr('href');
    const resolved = resolve(href, currentUrl);
    if (resolved && resolved !== currentUrl) return resolved;
  }

  // 4. Text-based match on all <a> tags
  const allLinks = $('a');
  for (let i = 0; i < allLinks.length; i++) {
    const el = allLinks.eq(i);
    const text = el.text().trim().toLowerCase();
    if (NEXT_TEXT_EXACT.has(text)) {
      const href = el.attr('href');
      const resolved = resolve(href, currentUrl);
      if (resolved && resolved !== currentUrl) return resolved;
    }
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/**
 * Resolve `href` against `base`. Returns `null` for unresolvable / empty hrefs.
 */
function resolve(href: string | undefined, base: string): string | null {
  if (!href || href === '#' || href.startsWith('javascript:')) return null;
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}
