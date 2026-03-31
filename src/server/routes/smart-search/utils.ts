const AFFILIATE_TAGS: Record<string, { param: string; value: string }> = {
  'amazon.com':    { param: 'tag',         value: process.env.AMAZON_AFFILIATE_TAG || '' },
  'walmart.com':   { param: 'wmlspartner', value: process.env.WALMART_AFFILIATE_ID || '' },
  'bestbuy.com':   { param: 'ref',         value: process.env.BESTBUY_AFFILIATE_ID || '' },
  'target.com':    { param: 'afid',        value: process.env.TARGET_AFFILIATE_ID || '' },
  'ebay.com':      { param: 'campid',      value: process.env.EBAY_AFFILIATE_ID || '' },
  'etsy.com':      { param: 'ref',         value: process.env.ETSY_AFFILIATE_ID || '' },
  'booking.com':   { param: 'aid',         value: process.env.BOOKING_AFFILIATE_ID || '' },
  'kayak.com':     { param: 'affid',       value: process.env.KAYAK_AFFILIATE_ID || '' },
  'expedia.com':   { param: 'affcid',      value: process.env.EXPEDIA_AFFILIATE_ID || '' },
};

const DOMAIN_TO_STORE: Record<string, string> = {
  'amazon.com': 'amazon', 'walmart.com': 'walmart', 'bestbuy.com': 'bestbuy',
  'target.com': 'target', 'ebay.com': 'ebay', 'etsy.com': 'etsy',
  'booking.com': 'booking', 'kayak.com': 'kayak', 'expedia.com': 'expedia',
};

export type RequestedStore = {
  id: 'amazon' | 'walmart' | 'bestbuy' | 'target' | 'ebay' | 'etsy' | 'traderjoes' | 'costco' | 'bjs' | 'dyson';
  store: string;
  domain: string;
};

const REQUESTED_STORES: Array<RequestedStore & { patterns: RegExp[] }> = [
  { id: 'bestbuy', store: 'Best Buy', domain: 'bestbuy.com', patterns: [/\bbest[\s-]*buy(?:\.com)?\b/i] },
  { id: 'walmart', store: 'Walmart', domain: 'walmart.com', patterns: [/\bwal(?:\s|-)?mart(?:\.com)?\b/i] },
  { id: 'target', store: 'Target', domain: 'target.com', patterns: [/\btarget(?:\.com)?\b/i] },
  { id: 'amazon', store: 'Amazon', domain: 'amazon.com', patterns: [/\bamazon(?:\.com)?\b/i] },
  { id: 'costco', store: 'Costco', domain: 'costco.com', patterns: [/\bcostco(?:\.com)?\b/i] },
  { id: 'bjs', store: "BJ's Wholesale Club", domain: 'bjs.com', patterns: [/\bbj'?s(?:\s+wholesale(?:\s+club)?)?(?:\.com)?\b/i] },
  { id: 'traderjoes', store: "Trader Joe's", domain: 'traderjoes.com', patterns: [/\btrader\s+joe'?s(?:\.com)?\b/i] },
  { id: 'dyson', store: 'Dyson', domain: 'dyson.com', patterns: [/\bdyson(?:\s+store|\.com)\b/i] },
  { id: 'ebay', store: 'eBay', domain: 'ebay.com', patterns: [/\be(?:\s|-)?bay(?:\.com)?\b/i] },
  { id: 'etsy', store: 'Etsy', domain: 'etsy.com', patterns: [/\betsy(?:\.com)?\b/i] },
];

export function detectRequestedStore(query: string): RequestedStore | null {
  const normalized = query.toLowerCase();
  for (const store of REQUESTED_STORES) {
    if (store.patterns.some(pattern => pattern.test(normalized))) {
      return { id: store.id, store: store.store, domain: store.domain };
    }
  }
  return null;
}

export function stripRequestedStoreFromQuery(query: string, requestedStore?: RequestedStore | null): string {
  if (!query) return query;

  const stores = requestedStore
    ? REQUESTED_STORES.filter(store => store.id === requestedStore.id)
    : REQUESTED_STORES;

  let stripped = query;
  for (const store of stores) {
    for (const pattern of store.patterns) {
      const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
      stripped = stripped.replace(globalPattern, ' ');
    }
  }

  return stripped.replace(/\s+/g, ' ').trim();
}

export function isRequestedStoreUrl(url: string, requestedStore?: RequestedStore | null): boolean {
  if (!requestedStore) return true;
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return hostname === requestedStore.domain || hostname.endsWith(`.${requestedStore.domain}`);
  } catch {
    return false;
  }
}

export function addAffiliateTag(url: string): string {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace('www.', '');
    for (const [domain] of Object.entries(DOMAIN_TO_STORE)) {
      if ((hostname === domain || hostname.endsWith('.' + domain)) && AFFILIATE_TAGS[domain]?.value) {
        const apiUrl = process.env.API_URL || 'https://api.webpeel.dev';
        return `${apiUrl}/go?url=${encodeURIComponent(url)}`;
      }
    }
  } catch { /* invalid URL — return as-is */ }
  return url;
}

export const SHOPPING_DOMAINS: Array<{ pattern: string; name: string }> = [
  { pattern: 'amazon.com', name: 'Amazon' }, { pattern: 'bestbuy.com', name: 'Best Buy' },
  { pattern: 'walmart.com', name: 'Walmart' }, { pattern: 'target.com', name: 'Target' },
  { pattern: 'costco.com', name: 'Costco' }, { pattern: 'bjs.com', name: "BJ's Wholesale Club" },
  { pattern: 'traderjoes.com', name: "Trader Joe's" }, { pattern: 'dyson.com', name: 'Dyson' },
  { pattern: 'zappos.com', name: 'Zappos' }, { pattern: 'rei.com', name: 'REI' },
  { pattern: 'nordstrom.com', name: 'Nordstrom' }, { pattern: 'macys.com', name: "Macy's" },
  { pattern: 'sephora.com', name: 'Sephora' }, { pattern: 'ulta.com', name: 'Ulta' },
  { pattern: 'homedepot.com', name: 'Home Depot' }, { pattern: 'lowes.com', name: "Lowe's" },
  { pattern: 'ebay.com', name: 'eBay' }, { pattern: 'etsy.com', name: 'Etsy' },
  { pattern: 'tcgplayer.com', name: 'TCGPlayer' }, { pattern: 'cardmarket.com', name: 'Cardmarket' },
  { pattern: 'mercari.com', name: 'Mercari' }, { pattern: 'facebook.com', name: 'Facebook Marketplace' },
  { pattern: 'uline.com', name: 'Uline' }, { pattern: 'alibaba.com', name: 'Alibaba' },
  { pattern: 'webstaurantstore.com', name: 'WebstaurantStore' }, { pattern: 'globalindustrial.com', name: 'Global Industrial' },
  { pattern: 'staples.com', name: 'Staples' }, { pattern: 'instacart.com', name: 'Instacart' },
  { pattern: 'freshdirect.com', name: 'FreshDirect' }, { pattern: 'wholefoodsmarket.com', name: 'Whole Foods' },
];

export function getStoreInfo(url: string): { store: string; domain: string } | null {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    for (const s of SHOPPING_DOMAINS) {
      if (hostname === s.pattern || hostname.endsWith('.' + s.pattern)) return { store: s.name, domain: s.pattern };
    }
    return null;
  } catch { return null; }
}

export function parsePrice(text: string): string | undefined {
  if (!text) return undefined;
  const rangeMatch = text.match(/\$\s*([\d,]+(?:\.\d{2})?)\s*[-–—to]+\s*\$\s*([\d,]+(?:\.\d{2})?)/i);
  if (rangeMatch) { const lo = rangeMatch[1].replace(/,/g, ''); return `from $${parseFloat(lo).toLocaleString('en-US', { minimumFractionDigits: 0 })}`; }
  const fromMatch = text.match(/from\s+\$\s*([\d,]+(?:\.\d{2})?)/i);
  if (fromMatch) { const val = parseFloat(fromMatch[1].replace(/,/g, '')); return `from $${val.toLocaleString('en-US', { minimumFractionDigits: 0 })}`; }
  const plainMatch = text.match(/\$\s*([\d,]+(?:\.\d{2})?)/);
  if (plainMatch) {
    const val = parseFloat(plainMatch[1].replace(/,/g, ''));
    if (isNaN(val)) return undefined;
    if (val > 50000) return undefined;
    return `$${val.toLocaleString('en-US', { minimumFractionDigits: val % 1 !== 0 ? 2 : 0 })}`;
  }
  return undefined;
}

export function extractPriceValue(priceStr: string | undefined): number | undefined {
  if (!priceStr) return undefined;
  const match = priceStr.match(/\$\s*([\d,]+(?:\.\d+)?)/);
  return match ? parseFloat(match[1].replace(/,/g, '')) : undefined;
}

export function cleanProductTitle(title: string): string {
  return title
    .replace(/^amazon\.com\s*[:\-–—]\s*/i, '')
    .replace(/^walmart\s*[:\-–—]\s*/i, '')
    .replace(/^target\s*[:\-–—]\s*/i, '')
    .replace(/^best\s*buy\s*[:\-–—]\s*/i, '')
    .replace(/^ebay\s*[:\-–—]\s*/i, '')
    .trim();
}
