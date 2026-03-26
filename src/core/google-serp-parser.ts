/**
 * Google SERP Parser — extracts rich structured data from Google search HTML.
 * Supports organic results, knowledge panel, PAA, featured snippets,
 * related searches, shopping, news, images, videos, and local pack.
 */

import { load } from 'cheerio';

export interface GoogleSerpResult {
  // Basic organic results
  organicResults: Array<{
    position: number;
    title: string;
    url: string;
    snippet: string;
    sitelinks?: Array<{ title: string; url: string }>;
    date?: string;       // Published date if shown
    cachedUrl?: string;
  }>;

  // Knowledge Panel (right sidebar — company info, person info, etc.)
  knowledgePanel?: {
    title: string;
    type?: string;       // "Organization", "Person", "Place", etc.
    description?: string;
    source?: string;     // "Wikipedia", etc.
    sourceUrl?: string;
    attributes?: Record<string, string>; // Key-value pairs (CEO, Founded, etc.)
    imageUrl?: string;
  };

  // People Also Ask (expandable questions)
  peopleAlsoAsk?: Array<{
    question: string;
    snippet?: string;    // Answer text if visible
    source?: string;
    sourceUrl?: string;
  }>;

  // Featured Snippet (answer box at top)
  featuredSnippet?: {
    text: string;
    source: string;
    sourceUrl: string;
    type: 'paragraph' | 'list' | 'table';
  };

  // Related Searches (bottom of page)
  relatedSearches?: string[];

  // Shopping Results (product carousel)
  shoppingResults?: Array<{
    title: string;
    price?: string;
    source?: string;     // Store name
    url?: string;
    imageUrl?: string;
    rating?: number;
    reviewCount?: number;
  }>;

  // News Results (top stories)
  newsResults?: Array<{
    title: string;
    url: string;
    source: string;
    date?: string;
    snippet?: string;
    imageUrl?: string;
  }>;

  // Image Pack (inline images)
  imagePack?: Array<{
    url: string;
    imageUrl: string;
    title?: string;
  }>;

  // Video Results
  videoResults?: Array<{
    title: string;
    url: string;
    platform?: string;   // "YouTube", etc.
    duration?: string;
    date?: string;
    thumbnailUrl?: string;
  }>;

  // Local Pack (map results)
  localPack?: Array<{
    name: string;
    address?: string;
    rating?: number;
    reviewCount?: number;
    type?: string;       // "Restaurant", "Hotel", etc.
    phone?: string;
  }>;

  // Metadata
  totalResults?: string;   // "About 1,230,000 results"
  searchTime?: string;     // "0.45" (seconds)
}

export function parseGoogleSerp(html: string): GoogleSerpResult {
  const $ = load(html);
  const result: GoogleSerpResult = { organicResults: [] };

  // ── 1. Organic Results ──────────────────────────────────────────────────────
  // Multiple selector patterns for resilience across Google HTML variants
  let position = 1;
  const seenUrls = new Set<string>();

  $('#search .g, #rso .g').each((_, elem) => {
    const el = $(elem);

    // Skip ad blocks, PAA, related searches containers
    if (el.closest('[data-text-ad]').length) return;
    if (el.closest('.related-question-pair').length) return;
    if (el.closest('[data-initq]').length) return; // related searches
    if (el.find('[data-text-ad]').length) return;

    const linkEl = el.find('a[href^="http"]').first();
    const title = el.find('h3').first().text().trim();
    const url = linkEl.attr('href') || '';

    if (!title || !url) return;
    if (url.includes('google.com/search')) return;
    if (url.includes('/aclk')) return; // Google ad click tracking
    if (seenUrls.has(url)) return;
    seenUrls.add(url);

    const snippet =
      el.find('.VwiC3b').first().text().trim() ||
      el.find('span.aCOpRe').first().text().trim() ||
      el.find('[data-sncf]').first().text().trim() ||
      el.find('[style*="-webkit-line-clamp"]').first().text().trim() ||
      '';

    // Sitelinks (sub-links shown under some results)
    const sitelinks: Array<{ title: string; url: string }> = [];
    el.find('.fl a, .sld a, [data-sitelink] a').each((_, sEl) => {
      const sTitle = $(sEl).text().trim();
      const sUrl = $(sEl).attr('href') || '';
      if (sTitle && sUrl && sUrl.startsWith('http')) {
        sitelinks.push({ title: sTitle, url: sUrl });
      }
    });

    const dateText = el.find('.LEwnzc span, .f').first().text().trim();

    result.organicResults.push({
      position: position++,
      title,
      url,
      snippet,
      ...(sitelinks.length > 0 ? { sitelinks } : {}),
      ...(dateText ? { date: dateText } : {}),
    });
  });

  // ── 2. Knowledge Panel ──────────────────────────────────────────────────────
  const kp = $('.kp-wholepage, .knowledge-panel, .osrp-blk').first();
  if (kp.length) {
    const kpTitle = kp.find('[data-attrid="title"], h2').first().text().trim();
    const kpType = kp.find('[data-attrid="subtitle"], .wwUB2c').first().text().trim();
    const kpDesc = kp.find('[data-attrid="description"] span, .kno-rdesc span').first().text().trim();
    const kpSource = kp.find('.kno-rdesc a, [data-attrid="description"] a').first();
    const kpImage = kp.find('g-img img, .kno-ftr img').first().attr('src');

    if (kpTitle) {
      const attrs: Record<string, string> = {};
      kp.find('[data-attrid]').each((_, attrEl) => {
        const key = $(attrEl).find('.w8qArf, .Z1hOCe').text().trim().replace(/:$/, '');
        const val = $(attrEl).find('.LrzXr, .kno-fv').text().trim();
        if (key && val && key !== kpTitle) attrs[key] = val;
      });

      result.knowledgePanel = {
        title: kpTitle,
        ...(kpType ? { type: kpType } : {}),
        ...(kpDesc ? { description: kpDesc } : {}),
        ...(kpSource.text().trim() ? { source: kpSource.text().trim() } : {}),
        ...(kpSource.attr('href') ? { sourceUrl: kpSource.attr('href') } : {}),
        ...(Object.keys(attrs).length > 0 ? { attributes: attrs } : {}),
        ...(kpImage ? { imageUrl: kpImage } : {}),
      };
    }
  }

  // ── 3. People Also Ask ──────────────────────────────────────────────────────
  const paaItems: NonNullable<GoogleSerpResult['peopleAlsoAsk']> = [];
  const seenQuestions = new Set<string>();

  $('.related-question-pair, [data-sgrd="true"]').each((_, elem) => {
    const el = $(elem);
    const question =
      (el.find('[data-q]').attr('data-q') !== 'true' ? el.find('[data-q]').attr('data-q')?.trim() : '') ||
      el.find('[data-q]').text().trim() ||
      el.find('.CSkcDe').first().text().trim() ||
      el.find('[jsname="Cpkphb"] span').first().text().trim() ||
      '';

    if (!question || question.length < 5) return;
    if (seenQuestions.has(question)) return;
    seenQuestions.add(question);

    const snippet = el.find('.wDYxhc, .LGOjhe').first().text().trim() || undefined;
    const sourceEl = el.find('a[href^="http"]').first();

    paaItems.push({
      question,
      ...(snippet ? { snippet: snippet.slice(0, 500) } : {}),
      ...(sourceEl.text().trim() ? { source: sourceEl.text().trim() } : {}),
      ...(sourceEl.attr('href') ? { sourceUrl: sourceEl.attr('href') } : {}),
    });
  });

  if (paaItems.length > 0) result.peopleAlsoAsk = paaItems;

  // ── 4. Featured Snippet ─────────────────────────────────────────────────────
  // Try multiple selectors — Google changes these frequently
  const fSnippet = $('.xpdopen .hgKElc, .c2xzTb, .IZ6rdc, [data-attrid="wa:/description"] .LGOjhe').first();
  if (fSnippet.length) {
    const fText = fSnippet.text().trim();
    const fContainer = fSnippet.closest('.g, .xpdopen, [data-hveid]');
    const fSourceEl = fContainer.find('a[href^="http"]').first();

    if (fText && fText.length > 20) {
      const hasList = fSnippet.find('ol, ul').length > 0;
      const hasTable = fSnippet.find('table').length > 0;

      result.featuredSnippet = {
        text: fText.slice(0, 1000),
        source: fSourceEl.find('h3, cite').first().text().trim() || fContainer.find('cite').first().text().trim() || '',
        sourceUrl: fSourceEl.attr('href') || '',
        type: hasList ? 'list' : hasTable ? 'table' : 'paragraph',
      };
    }
  }

  // ── 5. Related Searches ─────────────────────────────────────────────────────
  const related: string[] = [];
  const seenRelated = new Set<string>();

  $('.k8XOCe, .s75CSd, .EIaa9b, .brs_col a, [data-initq]').each((_, elem) => {
    const text = $(elem).text().trim();
    if (text && text.length > 2 && text.length < 100 && !seenRelated.has(text)) {
      seenRelated.add(text);
      related.push(text);
    }
  });

  if (related.length > 0) result.relatedSearches = related;

  // ── 6. Shopping Results ─────────────────────────────────────────────────────
  const shopping: NonNullable<GoogleSerpResult['shoppingResults']> = [];
  const seenShopTitles = new Set<string>();

  $('.sh-dgr__content, .mnr-c .pla-unit, [data-docid]').each((_, elem) => {
    const el = $(elem);
    const title = el.find('.tAxDx, .pymv4e, h3').first().text().trim();
    if (!title || seenShopTitles.has(title)) return;
    seenShopTitles.add(title);

    const price = el.find('.a8Pemb, .e10twf, .HRLxBb').first().text().trim();
    const store = el.find('.aULzUe, .LbUacb, .dD8iuc').first().text().trim();
    const url = el.find('a[href]').first().attr('href') || undefined;
    const imageUrl = el.find('img').first().attr('src') || undefined;
    const ratingText = el.find('.Rsc7Yb, .NHJBb').first().text().trim();
    const reviewText = el.find('.GpVvtc, .MRqCbe').first().text().trim();

    shopping.push({
      title,
      ...(price ? { price } : {}),
      ...(store ? { source: store } : {}),
      ...(url ? { url } : {}),
      ...(imageUrl ? { imageUrl } : {}),
      ...(ratingText ? { rating: parseFloat(ratingText) || undefined } : {}),
      ...(reviewText ? { reviewCount: parseInt(reviewText.replace(/[^0-9]/g, ''), 10) || undefined } : {}),
    });
  });

  if (shopping.length > 0) result.shoppingResults = shopping;

  // ── 7. News Results ─────────────────────────────────────────────────────────
  const news: NonNullable<GoogleSerpResult['newsResults']> = [];
  const seenNewsUrls = new Set<string>();

  $('.WlydOe, .JJZKK, .SoaBEf, [jscontroller="d0DtYd"]').each((_, elem) => {
    const el = $(elem);
    const title = el.find('[role="heading"], .mCBkyc, .nDgy9d').first().text().trim();
    const url = el.find('a[href^="http"]').first().attr('href') || '';
    if (!title || !url || seenNewsUrls.has(url)) return;
    seenNewsUrls.add(url);

    const source = el.find('.NUnG9d, .CEMjEf, .XTjFC').first().text().trim();
    const date = el.find('.OSrXXb, .f').first().text().trim() || undefined;
    const snippet = el.find('.GI74Re, .lEBKkf').first().text().trim() || undefined;
    const imageUrl = el.find('img').first().attr('src') || undefined;

    news.push({
      title,
      url,
      source: source || '',
      ...(date ? { date } : {}),
      ...(snippet ? { snippet } : {}),
      ...(imageUrl ? { imageUrl } : {}),
    });
  });

  if (news.length > 0) result.newsResults = news;

  // ── 8. Image Pack ───────────────────────────────────────────────────────────
  const images: NonNullable<GoogleSerpResult['imagePack']> = [];
  const seenImageUrls = new Set<string>();

  $('.isv-r a[href], .iKjWAf a[href]').each((_, elem) => {
    const el = $(elem);
    const url = el.attr('href') || '';
    const imageUrl = el.find('img').first().attr('src') || el.find('img').first().attr('data-src') || '';
    if (!url || !imageUrl || seenImageUrls.has(url)) return;
    seenImageUrls.add(url);

    const title = el.find('img').first().attr('alt') || el.attr('aria-label') || undefined;
    images.push({
      url,
      imageUrl,
      ...(title ? { title } : {}),
    });
  });

  if (images.length > 0) result.imagePack = images;

  // ── 9. Video Results ────────────────────────────────────────────────────────
  const videos: NonNullable<GoogleSerpResult['videoResults']> = [];
  const seenVideoUrls = new Set<string>();

  $('[data-surl], .dXiKIc, .RzdJxc, .ct3b9e').each((_, elem) => {
    const el = $(elem);
    const title =
      el.find('h3').first().text().trim() ||
      el.find('.fc9yUc').first().text().trim() ||
      el.find('[aria-label]').first().attr('aria-label') || '';
    const url = el.find('a[href^="http"]').first().attr('href') || el.attr('data-surl') || '';
    if (!title || !url || seenVideoUrls.has(url)) return;
    seenVideoUrls.add(url);

    const duration = el.find('.J1mWY, .FGpTBd, .vjB1Cc').first().text().trim() || undefined;
    const date = el.find('.LEwnzc, .f').first().text().trim() || undefined;
    const thumbnailUrl = el.find('img').first().attr('src') || undefined;

    let platform: string | undefined;
    if (url.includes('youtube.com') || url.includes('youtu.be')) platform = 'YouTube';
    else if (url.includes('vimeo.com')) platform = 'Vimeo';
    else if (url.includes('dailymotion.com')) platform = 'Dailymotion';
    else if (url.includes('tiktok.com')) platform = 'TikTok';

    videos.push({
      title,
      url,
      ...(platform ? { platform } : {}),
      ...(duration ? { duration } : {}),
      ...(date ? { date } : {}),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
    });
  });

  if (videos.length > 0) result.videoResults = videos;

  // ── 10. Local Pack ──────────────────────────────────────────────────────────
  const localPack: NonNullable<GoogleSerpResult['localPack']> = [];
  const seenLocalNames = new Set<string>();

  $('.VkpGBb, [data-local-attribute], .rllt__details').each((_, elem) => {
    const el = $(elem);
    const name =
      el.find('.OSrXXb, .dbg0pd').first().text().trim() ||
      el.find('[role="heading"]').first().text().trim() ||
      '';
    if (!name || seenLocalNames.has(name)) return;
    seenLocalNames.add(name);

    const ratingText = el.find('.MW4etd, .yi40Hd').first().text().trim();
    const reviewText = el.find('.UY7F9, .RDApEe').first().text().trim();
    const rating = parseFloat(ratingText) || undefined;
    const reviewCount = parseInt(reviewText.replace(/[^0-9]/g, ''), 10) || undefined;

    localPack.push({
      name,
      address: el.find('.lMbq3e, .sXtWJb').first().text().trim() || undefined,
      ...(rating !== undefined ? { rating } : {}),
      ...(reviewCount !== undefined ? { reviewCount } : {}),
      type: el.find('.YhemCb, .Q2vNVc').first().text().trim() || undefined,
      phone: el.find('.fhNHSe, [data-dtype="d3ph"]').first().text().trim() || undefined,
    });
  });

  if (localPack.length > 0) result.localPack = localPack;

  // ── 11. Total results / search time ─────────────────────────────────────────
  const stats = $('#result-stats').text().trim();
  if (stats) {
    const totalMatch = stats.match(/About ([\d,]+) results/i);
    const timeMatch = stats.match(/\(([\d.]+) seconds?\)/i);
    if (totalMatch) result.totalResults = totalMatch[1];
    if (timeMatch) result.searchTime = timeMatch[1];
  }

  return result;
}
