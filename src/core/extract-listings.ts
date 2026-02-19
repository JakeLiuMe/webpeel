/**
 * Auto-extract repeated listing patterns from HTML pages.
 *
 * Given raw HTML (e.g. an eBay search results page), this module detects the
 * largest group of sibling elements with a consistent internal structure and
 * extracts structured fields (title, price, image, link, description, rating)
 * from each item.
 *
 * @module extract-listings
 */

import { load, type CheerioAPI } from 'cheerio';
import type { AnyNode } from 'domhandler';

/* ------------------------------------------------------------------ */
/*  Public types                                                      */
/* ------------------------------------------------------------------ */

/** A single extracted listing item. */
export interface ListingItem {
  title?: string;
  price?: string;
  image?: string;
  link?: string;
  description?: string;
  rating?: string;
  [key: string]: string | undefined;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                  */
/* ------------------------------------------------------------------ */

/** Tags we consider as potential listing containers. */
const CONTAINER_CHILD_TAGS = new Set(['li', 'div', 'article', 'section', 'tr', 'a']);

/** Return a normalised "child-tag signature" for a DOM element.
 *  Includes tag names **and their counts** so that elements with the same
 *  child-tag *names* but different *counts* (e.g. 3 `<td>` vs 2 `<td>`)
 *  produce distinct signatures. This is essential for table-based layouts
 *  like Hacker News where story rows (3 td) must be distinguished from
 *  subtext rows (2 td).
 */
function childSignature($: CheerioAPI, el: AnyNode): string {
  const children = $(el).children();
  if (children.length === 0) return '';
  const tagCounts = new Map<string, number>();
  children.each((_, child) => {
    const tagName = (child as any).tagName?.toLowerCase();
    if (tagName) tagCounts.set(tagName, (tagCounts.get(tagName) || 0) + 1);
  });
  return [...tagCounts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, count]) => `${tag}:${count}`)
    .join(',');
}

/**
 * Check whether two child-tag signatures are "similar enough" to be considered
 * the same listing type.
 *
 * Compares full `tag:count` pairs so that elements with the same child tags
 * but different counts are kept separate (critical for table-based layouts
 * like Hacker News where story rows have 3 `<td>` and subtext rows have 2).
 *
 * Similarity is measured by Jaccard index on `tag:count` pairs, with a
 * threshold of 0.5 or one being a subset of the other.
 */
function signaturesAreSimilar(a: string, b: string): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  // Compare full "tag:count" pairs (e.g. "td:3" ≠ "td:2")
  const pairsA = new Set(a.split(','));
  const pairsB = new Set(b.split(','));
  const intersection = [...pairsA].filter(p => pairsB.has(p)).length;
  const union = new Set([...pairsA, ...pairsB]).size;

  return intersection === pairsA.size || intersection === pairsB.size || (intersection / union) >= 0.5;
}

interface Candidate {
  /** The parent element containing repeated children. */
  parent: AnyNode;
  /** The repeated tag name (e.g. "li"). */
  tag: string;
  /** The children that share the dominant signature. */
  children: AnyNode[];
  /** Heuristic score: count × consistency. */
  score: number;
}

/**
 * Walk the DOM and find the best "listing container" — the element whose
 * direct children form the largest group of structurally-similar items.
 */
function findListingContainer($: CheerioAPI): Candidate | null {
  const candidates: Candidate[] = [];

  $('*').each((_, el) => {
    const $el = $(el);
    const children = $el.children();
    if (children.length < 3) return; // need at least 3 repeating items

    // Group children by tag name
    const byTag = new Map<string, AnyNode[]>();
    children.each((_, child) => {
      const tag = (child as any).tagName?.toLowerCase();
      if (tag && CONTAINER_CHILD_TAGS.has(tag)) {
        let arr = byTag.get(tag);
        if (!arr) { arr = []; byTag.set(tag, arr); }
        arr.push(child);
      }
    });

    for (const [tag, tagChildren] of byTag) {
      if (tagChildren.length < 3) continue;

      // Compute child-structure signatures
      const childSigs: Array<{ child: AnyNode; sig: string }> = [];
      for (const child of tagChildren) {
        const sig = childSignature($, child);
        childSigs.push({ child, sig });
      }

      // Separate children with content vs empty
      const withSig = childSigs.filter(c => c.sig.length > 0);
      const withoutSig = childSigs.filter(c => c.sig.length === 0);

      if (withSig.length === 0) {
        // All children are text-only or empty — still consider if there are enough
        const withContent = tagChildren.filter(c => $(c).text().trim().length > 3);
        if (withContent.length >= 3) {
          const score = withContent.length;
          candidates.push({ parent: el, tag, children: withContent, score });
        }
        continue;
      }

      // Build signature clusters: each distinct (incompatible) signature group
      // becomes its own candidate. This is critical for table-based layouts like
      // Hacker News where story rows (td:3) and subtext rows (td:2) are siblings
      // in the same tbody — we need BOTH as candidates so content scoring can
      // choose the right one (article titles beat usernames).
      const sigGroups: Array<{ repr: string; children: AnyNode[] }> = [];
      for (const { child, sig } of withSig) {
        let placed = false;
        for (const group of sigGroups) {
          if (signaturesAreSimilar(sig, group.repr)) {
            group.children.push(child);
            placed = true;
            break;
          }
        }
        if (!placed) {
          sigGroups.push({ repr: sig, children: [child] });
        }
      }

      // Text-only (no-sig) children with meaningful content go into the largest group
      const largestGroup = sigGroups.reduce<typeof sigGroups[0] | null>(
        (best, g) => (!best || g.children.length > best.children.length) ? g : best,
        null
      );
      for (const { child } of withoutSig) {
        if (largestGroup && $(child).text().trim().length > 3) {
          largestGroup.children.push(child);
        }
      }

      // Generate a candidate for each significant cluster (count >= 3)
      for (const group of sigGroups) {
        if (group.children.length < 3) continue;
        const consistency = group.children.length / tagChildren.length;
        const score = group.children.length * consistency;
        candidates.push({ parent: el, tag, children: group.children, score });
      }
    }
  });

  if (candidates.length === 0) return null;

  // Sort by initial structural score descending.
  candidates.sort((a, b) => b.score - a.score || b.children.length - a.children.length);

  // Take top candidates and re-rank by content quality.
  // This ensures containers with actual titles/prices beat those with
  // usernames or boilerplate (e.g. HN subtext rows vs title rows).
  const topN = candidates.slice(0, Math.min(candidates.length, 8));
  let best: Candidate | null = null;
  let bestContentScore = -1;

  for (const cand of topN) {
    let titleLenSum = 0;
    let titlesFound = 0;
    let linksFound = 0;
    const sample = cand.children.slice(0, 5);
    for (const child of sample) {
      const item = extractItem($, child);
      if (item.title && item.title.length >= 3) {
        titleLenSum += item.title.length;
        titlesFound++;
      }
      if (item.link) linksFound++;
    }
    // Content score: average title length × title hit rate × structural score
    const avgTitleLen = titlesFound > 0 ? titleLenSum / titlesFound : 0;
    const titleRate = titlesFound / sample.length;
    const contentScore = avgTitleLen * titleRate * cand.score;

    if (contentScore > bestContentScore) {
      bestContentScore = contentScore;
      best = cand;
    }
  }

  return best;
}

/** Price-matching regex — $12.34, £99, €5,00, etc. */
const PRICE_RE = /(?:[\$£€¥₹])\s*[\d,]+(?:\.\d{1,2})?|[\d,]+(?:\.\d{1,2})?\s*(?:USD|EUR|GBP|JPY|INR)/i;

/**
 * Common title prefixes injected by marketplaces (e.g. eBay's "New Listing")
 * that should be stripped from extracted titles.
 */
const TITLE_STRIP_PREFIXES = [
  /^New\s+Listing\s*/i,
  /^Sponsored\s*/i,
  /^Opens\s+in\s+(?:a\s+)?new\s+(?:window|tab)(?:\s+or\s+(?:window|tab))?\s*/i,
  /^Advertisement\s*/i,
  /^Ad\s*[-–—:·]\s*/i,
  /^Promoted\s*[-–—:·]?\s*/i,
];

/**
 * Common section-header / junk words that appear as single-word titles in
 * listing pages (e.g. Amazon's "Results" header, eBay's "Sponsored" label).
 */
const HEADER_WORDS = new Set([
  'results', 'sponsored', 'related', 'advertisement', 'shop', 'browse',
  'featured', 'popular', 'trending', 'new', 'sale', 'deals', 'more',
  'filters', 'sort', 'categories', 'departments', 'navigation',
]);

/**
 * Return true if a title string looks like a section header or junk rather
 * than a real listing title.
 */
function isHeaderOrJunk(title: string): boolean {
  if (!title) return true;
  if (title.length <= 3) return true;
  // Pure numbers or rank numbers like "10." "21." "100"
  if (/^\d+\.?$/.test(title)) return true;
  // Single word that matches a known header term
  if (!/\s/.test(title) && HEADER_WORDS.has(title.toLowerCase())) return true;
  return false;
}

/**
 * Common title suffixes that appear at the end of listing titles due to
 * accessibility text embedded in links (e.g. eBay's "Opens in a new window or tab").
 */
const TITLE_STRIP_SUFFIXES: RegExp[] = [
  // "Opens in new window" / "Opens in a new tab" / "Opens in new window or tab" etc.
  /\s*Opens\s+in\s+(?:a\s+)?new\s+(?:window|tab)(?:\s+or\s+(?:window|tab))?$/i,
  // Parenthesized variant: "(opens in a new window)"
  /\s*\(opens\s+(?:in\s+)?(?:a\s+)?new\s+(?:window|tab)\)$/i,
  // Dash variant: "- New window"
  /\s*[-–—]\s*New\s+window$/i,
  /\s*Sponsored$/i,
];

/**
 * Clean concatenated title artifacts that appear on travel/hotel aggregators
 * (e.g. Google Travel where price, source and rating get concatenated into the title).
 */
function cleanConcatenatedTitle(title: string): string {
  let cleaned = title;
  // Strip price suffixes: "$149 Booking.com...", "$179Hyatt Place...", "£99 Hotels.com...", "$149" at end
  // Handles both spaced ("$179 Hyatt") and concatenated ("$179Hyatt") from Google Travel etc.
  cleaned = cleaned.replace(/[\$£€]\d[\d,.]*(?:\s+[A-Z].*|\S+.*)?$/i, '').trim();
  // Strip rating suffixes: "4.2/5 (1.4K)" or "4.5 out of 5"
  cleaned = cleaned.replace(/\d+\.?\d*\/5\s*\(.*$/i, '').trim();
  // Strip star ratings: "· 3-star hotel" or "- 4 star"
  cleaned = cleaned.replace(/\s*[·\-–]\s*\d+-?star\s.*$/i, '').trim();
  // Strip source labels that got concatenated: "Expedia.com" at end
  cleaned = cleaned.replace(/(?:Booking|Expedia|Hotels|Kayak|Trivago|Priceline|Agoda)\.com.*$/i, '').trim();
  return cleaned || title; // fallback to original if over-stripped
}

/**
 * Strip known marketplace prefixes and suffixes from a title string,
 * then clean up any concatenated artifacts.
 */
function stripTitlePrefixes(title: string): string {
  let t = title;
  for (const prefix of TITLE_STRIP_PREFIXES) {
    t = t.replace(prefix, '');
  }
  for (const suffix of TITLE_STRIP_SUFFIXES) {
    t = t.replace(suffix, '');
  }
  return cleanConcatenatedTitle(t.trim());
}

/**
 * Resolve a potentially relative URL against a base URL.
 * Returns the original string if resolution fails.
 */
function resolveUrl(href: string | undefined, baseUrl?: string): string | undefined {
  if (!href) return undefined;
  if (href.startsWith('data:') || href.startsWith('javascript:')) return undefined;
  if (!baseUrl) return href;
  try {
    return new URL(href, baseUrl).href;
  } catch {
    return href;
  }
}

/**
 * Extract a single ListingItem from a DOM element.
 */
function extractItem($: CheerioAPI, el: AnyNode, baseUrl?: string): ListingItem {
  const $el = $(el);
  const item: ListingItem = {};

  // --- Title + Title-source element (used later for preferred link) ---
  // Priority: heading > [class*="title"]/[class*="name"] text or inner link text > first <a> text
  let titleSourceEl: ReturnType<typeof $el.find> | null = null;
  const heading = $el.find('h1, h2, h3, h4, h5, h6').first();
  if (heading.length && heading.text().trim().length >= 3) {
    item.title = stripTitlePrefixes(heading.text().trim());
    titleSourceEl = heading;
  } else {
    // Iterate ALL title/name class matches (not just .first()) — some sites
    // have multiple elements with "title" in their class (e.g. HN has a rank
    // cell and a title cell both with class="title").
    // Two-pass approach: first prefer candidates that have an inner link
    // (avoids picking rank numbers like "10." which appear before the real
    // title cell in Hacker News rows), then fall back to linkless candidates.
    const titleCandidates = $el.find('[class*="title"], [class*="name"], [class*="Title"], [class*="Name"]');
    // Pass 1: title-class elements with inner <a> links
    titleCandidates.each((_, tc) => {
      if (item.title) return;
      const $tc = $(tc);
      const innerLink = $tc.find('a').first();
      if (!innerLink.length) return; // no link — skip in pass 1
      const candidateText = innerLink.text().trim();
      if (candidateText.length >= 3) {
        item.title = stripTitlePrefixes(candidateText);
        titleSourceEl = $tc;
      }
    });
    // Pass 2: title-class elements without inner links (requires longer text
    // to avoid picking up rank numbers like "10.")
    if (!item.title) {
      titleCandidates.each((_, tc) => {
        if (item.title) return;
        const $tc = $(tc);
        const innerLink = $tc.find('a').first();
        if (innerLink.length) return; // has link — already handled in pass 1
        const candidateText = $tc.text().trim();
        if (candidateText.length >= 8) { // higher threshold for linkless elements
          item.title = stripTitlePrefixes(candidateText);
          titleSourceEl = $tc;
        }
      });
    }
    if (!item.title) {
      // Fall back to first <a> with meaningful text
      $el.find('a').each((_, a) => {
        if (item.title) return;
        const text = $(a).text().trim();
        if (text.length >= 3) {
          item.title = stripTitlePrefixes(text);
          titleSourceEl = $(a);
        }
      });
    }
  }

  // --- Price ---
  const priceEl = $el.find('[class*="price"], [class*="Price"], [data-price]').first();
  if (priceEl.length) {
    const priceText = priceEl.text().trim();
    const match = priceText.match(PRICE_RE);
    item.price = match ? match[0] : priceText;
  } else {
    // Scan entire element text for a price pattern
    const fullText = $el.text();
    const match = fullText.match(PRICE_RE);
    if (match) {
      item.price = match[0];
    }
  }

  // --- Image ---
  const img = $el.find('img').first();
  if (img.length) {
    const src = img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src');
    item.image = resolveUrl(src, baseUrl);
  }

  // --- Link ---
  // Prefer the link associated with the title element we found, falling back
  // to any <a[href]> in the listing. Using titleSourceEl avoids accidentally
  // picking up vote / action links that appear before the article link in the DOM
  // (e.g. Hacker News vote arrows before the story title link).
  let primaryLink: ReturnType<typeof $el.find> | null = null;
  if (titleSourceEl) {
    const titleElTag = (titleSourceEl.prop('tagName') as string)?.toLowerCase();
    if (titleElTag === 'a') {
      // The title source IS the link itself
      primaryLink = titleSourceEl;
    } else {
      const innerLink = titleSourceEl.find('a[href]').first();
      if (innerLink.length) primaryLink = innerLink;
    }
  }
  if (!primaryLink || !primaryLink.length) {
    primaryLink = $el.find('a[href]').first();
  }
  if (primaryLink && primaryLink.length) {
    item.link = resolveUrl(primaryLink.attr('href'), baseUrl);
  }
  // If the element itself is an <a>, use its href
  if (!item.link && ($el.prop('tagName') as string)?.toLowerCase() === 'a') {
    item.link = resolveUrl($el.attr('href'), baseUrl);
  }

  // --- Rating ---
  const ratingEl = $el.find('[class*="rating"], [class*="Rating"], [class*="star"], [class*="Star"], [aria-label*="star"], [aria-label*="rating"]').first();
  if (ratingEl.length) {
    const ariaLabel = ratingEl.attr('aria-label');
    item.rating = ariaLabel || ratingEl.text().trim() || undefined;
  }

  // --- Description ---
  // Gather remaining text that isn't the title or price
  const usedTexts = new Set<string>();
  if (item.title) usedTexts.add(item.title);
  if (item.price) usedTexts.add(item.price);
  if (item.rating) usedTexts.add(item.rating);

  const descParts: string[] = [];
  $el.find('p, span, [class*="desc"], [class*="Desc"], [class*="subtitle"], [class*="snippet"]').each((_, descEl) => {
    const text = $(descEl).text().trim();
    if (text.length > 5 && !usedTexts.has(text) && text !== item.title) {
      descParts.push(text);
      usedTexts.add(text);
    }
  });
  if (descParts.length > 0) {
    item.description = descParts.slice(0, 2).join(' ');
  }

  return item;
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

/**
 * Automatically detect repeated listing patterns in raw HTML and extract
 * structured items.
 *
 * @param html - Raw HTML string to parse.
 * @param url  - Optional base URL for resolving relative links and images.
 * @returns    Array of extracted listing items (may be empty).
 *
 * @example
 * ```typescript
 * import { extractListings } from 'webpeel';
 *
 * const items = extractListings(ebayHtml, 'https://ebay.com/sch?q=card');
 * console.log(items[0].title);  // "Charizard VMAX 020/189"
 * console.log(items[0].price);  // "$24.99"
 * ```
 */
export function extractListings(html: string, url?: string): ListingItem[] {
  if (!html || html.trim().length === 0) return [];

  const $ = load(html);
  const container = findListingContainer($);
  if (!container) return [];

  const items: ListingItem[] = [];
  for (const child of container.children) {
    const item = extractItem($, child, url);
    // Filter out empty / too-short titles and known header/junk words
    if (!item.title || item.title.length < 3) continue;
    if (isHeaderOrJunk(item.title)) continue;
    items.push(item);
  }

  return items;
}
