import { peel } from '../../../../index.js';
import type { PeelResult } from '../../../../types.js';
import { getBestSearchProvider, type WebSearchResult } from '../../../../core/search-provider.js';
import { buildSiteSearchUrl } from '../../../../core/site-search.js';
import { extractDomainData } from '../../../../ee/extractors/index.js';
import type { DomainExtractResult } from '../../../../ee/extractors/types.js';
import { getProfilePath, loadStorageState, touchProfile } from '../../../../core/profiles.js';
import { localSearch, type LocalSearchResult } from '../../../../core/local-search.js';
import type { SearchIntent, SmartSearchResult } from '../types.js';
import { addAffiliateTag, getStoreInfo, parsePrice, cleanProductTitle, extractPriceValue, detectRequestedStore, stripRequestedStoreFromQuery, isRequestedStoreUrl, type RequestedStore } from '../utils.js';
import { callLLMQuick, sanitizeSearchQuery, PROMPT_INJECTION_DEFENSE } from '../llm.js';

type DeepListing = {
  title: string;
  price: string;
  priceValue: number;
  url: string;
  source: string;
  condition?: string;
};

type RetailerDifficulty = 'easy' | 'medium' | 'hard';
type RetailerEvidenceSource = 'retailer-extractor' | 'page-domain-data' | 'page-content';

type RetailerStrategy = {
  id: string;
  store: string;
  domain: string;
  difficulty: RetailerDifficulty;
  adapterFirst: boolean;
  preferPersistentProfile: boolean;
  profileHints: string[];
};

type RetailerProfile = {
  profileName: string;
  profileDir: string;
  storageState?: any;
};

type RetailerRoutingTrace = {
  url: string;
  store: string;
  domain: string;
  difficulty: RetailerDifficulty;
  route: 'adapter-first' | 'peel';
  source?: RetailerEvidenceSource;
  fetchMethod?: string;
  profileUsed?: string;
  evidenceFound: boolean;
};

type VerifiedProductEvidence = {
  title: string;
  price: string;
  priceValue: number;
  url: string;
  rawUrl: string;
  store: string;
  availability?: string;
  condition?: string;
  brand?: string;
  model?: string;
  image?: string;
  matchScore: number;
  difficulty: RetailerDifficulty;
  source: RetailerEvidenceSource;
  fetchMethod?: string;
  profileUsed?: string;
  localInventoryVerified?: boolean;
  localInventoryStatus?: string;
};

type DrillDownOutcome = {
  evidence: VerifiedProductEvidence | null;
  checkedProductPages: number;
  routing: RetailerRoutingTrace[];
};

const QUERY_STOPWORDS = new Set([
  'buy', 'shop', 'shopping', 'purchase', 'order', 'deal', 'deals', 'discount', 'sale', 'price', 'prices',
  'cheap', 'cheapest', 'best', 'under', 'for', 'with', 'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in',
  'near', 'me', 'on', 'from', 'at', 'wireless', 'new', 'latest', 'review', 'reviews', 'worth', 'it',
]);

const BUNDLE_PENALTY_RE = /\b(bundle|charger|stand|case|guide|accessor(?:y|ies)|kit|pack|renewed|refurbished|open box|used)\b/i;
const CONDITION_RE = /\b(Near Mint|NM|Lightly Played|LP|Moderately Played|MP|Heavily Played|HP|Damaged|DMG|Brand New|New|Used|Like New|Good|Very Good|Excellent|Open Box|Refurbished|Pre-Owned)\b/i;

const DEFAULT_RETAILER_STRATEGY: RetailerStrategy = {
  id: 'generic',
  store: 'Retailer',
  domain: 'generic',
  difficulty: 'medium',
  adapterFirst: false,
  preferPersistentProfile: false,
  profileHints: [],
};

const RETAILER_STRATEGIES: Record<string, RetailerStrategy> = {
  'amazon.com': {
    id: 'amazon',
    store: 'Amazon',
    domain: 'amazon.com',
    difficulty: 'hard',
    adapterFirst: false,
    preferPersistentProfile: true,
    profileHints: ['amazon.com', 'amazon'],
  },
  'walmart.com': {
    id: 'walmart',
    store: 'Walmart',
    domain: 'walmart.com',
    difficulty: 'hard',
    adapterFirst: true,
    preferPersistentProfile: true,
    profileHints: ['walmart.com', 'walmart'],
  },
  'bestbuy.com': {
    id: 'bestbuy',
    store: 'Best Buy',
    domain: 'bestbuy.com',
    difficulty: 'hard',
    adapterFirst: true,
    preferPersistentProfile: true,
    profileHints: ['bestbuy.com', 'bestbuy', 'best-buy'],
  },
  'ebay.com': {
    id: 'ebay',
    store: 'eBay',
    domain: 'ebay.com',
    difficulty: 'medium',
    adapterFirst: false,
    preferPersistentProfile: false,
    profileHints: ['ebay.com', 'ebay'],
  },
  'target.com': {
    id: 'target',
    store: 'Target',
    domain: 'target.com',
    difficulty: 'hard',
    adapterFirst: false,
    preferPersistentProfile: true,
    profileHints: ['target.com', 'target'],
  },
  'etsy.com': {
    id: 'etsy',
    store: 'Etsy',
    domain: 'etsy.com',
    difficulty: 'medium',
    adapterFirst: false,
    preferPersistentProfile: false,
    profileHints: ['etsy.com', 'etsy'],
  },
};

function getRequestedStorePreference(intent: SearchIntent): RequestedStore | null {
  const { requestedStoreId, requestedStore, requestedStoreDomain } = intent.params || {};
  if (requestedStoreId && requestedStore && requestedStoreDomain) {
    return {
      id: requestedStoreId as RequestedStore['id'],
      store: requestedStore,
      domain: requestedStoreDomain,
    };
  }
  return detectRequestedStore(intent.query);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildProductKeyword(query: string, requestedStore: RequestedStore | null, params: Record<string, string> = {}): string {
  const baseQuery = requestedStore ? stripRequestedStoreFromQuery(query, requestedStore) : query;
  const locationText = params.location || params.localLocation || '';
  const locationPattern = locationText
    ? new RegExp(`\\b(?:near|around|in|at)?\\s*${escapeRegExp(locationText)}\\b`, 'gi')
    : null;

  let keyword = baseQuery
    .replace(/\bbest price\b/gi, '')
    .replace(/\b(?<!best\s)(buy|shop|shopping|purchase|order|deal|discount|sale|price|cheap|cheapest|under)\b/gi, '')
    .replace(/\$\d[\d,]*/g, '');

  if (params.localIntent === 'true') {
    keyword = keyword
      .replace(/\b(near me|nearby|closest|nearest|my local|local)\b/gi, '')
      .replace(/\b(?:inventory|availability|available|in stock|stock|pickup|store pickup)\b/gi, '');
    if (locationPattern) keyword = keyword.replace(locationPattern, '');
  }

  return keyword.replace(/\s+/g, ' ').trim() || baseQuery.trim() || query;
}

function hasLocalRetailIntent(intent: SearchIntent, requestedStore: RequestedStore | null): boolean {
  return !!requestedStore && intent.params.localIntent === 'true';
}

type NearbyRetailResolution = {
  status: 'resolved' | 'needs-location' | 'not-found' | 'error';
  location?: string;
  source?: string;
  message: string;
  stores: LocalSearchResult[];
};

function buildRequestedStoreSourceUrl(requestedStore: RequestedStore, keyword: string): string {
  try {
    return addAffiliateTag(buildSiteSearchUrl(requestedStore.id, keyword).url);
  } catch {
    switch (requestedStore.id) {
      case 'costco':
        return `https://www.costco.com/CatalogSearch?dept=All&keyword=${encodeURIComponent(keyword)}`;
      case 'bjs':
        return `https://www.bjs.com/search/${encodeURIComponent(keyword)}`;
      case 'traderjoes':
        return `https://www.traderjoes.com/home/search?q=${encodeURIComponent(keyword)}`;
      case 'dyson':
        return `https://www.dyson.com/search-results?query=${encodeURIComponent(keyword)}`;
      default:
        return `https://www.${requestedStore.domain}`;
    }
  }
}

function getRequestedStoreLocalSearchQuery(requestedStore: RequestedStore): string {
  switch (requestedStore.id) {
    case 'bjs':
      return "BJ's Wholesale Club";
    case 'dyson':
      return 'Dyson store';
    default:
      return requestedStore.store;
  }
}

function matchesRequestedStoreName(name: string, requestedStore: RequestedStore): boolean {
  const normalizedName = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const normalizedRequestedStore = requestedStore.store.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (normalizedName !== normalizedRequestedStore && /\b(gas|gasoline|pharmacy|optical|tire|hearing|food court)\b/.test(normalizedName)) {
    return false;
  }

  const detected = detectRequestedStore(name);
  if (detected?.id === requestedStore.id) return true;

  const requiredTokens = requestedStore.store
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(token => token.length >= 2 && !['wholesale', 'club', 'store'].includes(token));

  return requiredTokens.length > 0 && requiredTokens.every(token => normalizedName.includes(token));
}

async function resolveNearbyRetailStores(intent: SearchIntent, requestedStore: RequestedStore): Promise<NearbyRetailResolution> {
  const location = (intent.params.location || intent.params.localLocation || intent.params.zip || '').trim();
  if (!location) {
    return {
      status: 'needs-location',
      message: `I can see the local/nearby intent for ${requestedStore.store}, but this smart-search route still needs a city, ZIP, or coordinates to resolve "near me" honestly.`,
      stores: [],
    };
  }

  try {
    const response = await localSearch({
      query: getRequestedStoreLocalSearchQuery(requestedStore),
      location,
      limit: 5,
    });
    const stores = response.results
      .filter(store => matchesRequestedStoreName(store.name, requestedStore))
      .slice(0, 5);

    if (stores.length === 0) {
      return {
        status: 'not-found',
        location,
        source: response.source,
        message: `I did not find any nearby ${requestedStore.store} locations for ${location}.`,
        stores: [],
      };
    }

    return {
      status: 'resolved',
      location,
      source: response.source,
      message: `Found ${stores.length} nearby ${requestedStore.store} location${stores.length === 1 ? '' : 's'} for ${location}.`,
      stores,
    };
  } catch (err) {
    return {
      status: 'error',
      location,
      message: `Nearby ${requestedStore.store} lookup failed: ${(err as Error).message}`,
      stores: [],
    };
  }
}

function buildRequestedStoreSearchQuery(requestedStore: RequestedStore, keyword: string, isBulk: boolean, isGrocery: boolean, isCollectible: boolean): string {
  if (isGrocery && requestedStore.id === 'walmart') {
    return `${keyword} price site:walmart.com/grocery OR site:walmart.com`;
  }
  if (isCollectible && requestedStore.id === 'ebay') {
    return `${keyword} price site:ebay.com sold`;
  }
  if (isCollectible && requestedStore.id === 'etsy') {
    return `${keyword} price site:etsy.com`;
  }
  if (isBulk && ['amazon', 'walmart', 'bestbuy', 'target'].includes(requestedStore.id)) {
    return `${keyword} site:${requestedStore.domain}`;
  }
  return `${keyword} price site:${requestedStore.domain}`;
}

function filterToRequestedStore<T extends { url?: string; rawUrl?: string }>(items: T[], requestedStore: RequestedStore | null): T[] {
  if (!requestedStore) return items;
  return items.filter(item => isRequestedStoreUrl(item.rawUrl || item.url || '', requestedStore));
}

function normalizeMatchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function collapseMatchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function getQueryTokens(query: string): string[] {
  return Array.from(new Set(
    normalizeMatchText(query)
      .split(' ')
      .filter(token => token.length >= 2 && !QUERY_STOPWORDS.has(token))
  ));
}

function scoreKeywordMatch(text: string, query: string): number {
  const normalizedText = normalizeMatchText(text);
  const collapsedText = collapseMatchText(text);
  const normalizedQuery = normalizeMatchText(query);
  const collapsedQuery = collapseMatchText(query);
  const tokens = getQueryTokens(query);

  if (!normalizedText && !collapsedText) return 0;

  let score = 0;
  if (collapsedQuery && collapsedText.includes(collapsedQuery)) score += 1.1;
  if (normalizedQuery && normalizedText.includes(normalizedQuery)) score += 0.45;

  if (tokens.length > 0) {
    const tokenHits = tokens.filter(token => normalizedText.includes(token) || collapsedText.includes(token)).length;
    score += tokenHits / tokens.length;

    const modelTokens = tokens.filter(token => /\d/.test(token));
    const modelHits = modelTokens.filter(token => collapsedText.includes(token.replace(/[^a-z0-9]+/g, ''))).length;
    if (modelTokens.length > 0) {
      score += (modelHits / modelTokens.length) * 0.35;
    }
  }

  if (BUNDLE_PENALTY_RE.test(text)) score -= 0.2;
  return score;
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: value % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

function normalizePriceString(raw: unknown, content = ''): string | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return formatUsd(raw);
  if (typeof raw === 'string' && raw.trim()) {
    const directMatch = raw.match(/(?:US\s*)?\$\s*([\d,]+(?:\.\d{2})?)/i);
    if (directMatch) {
      const numeric = parseFloat(directMatch[1].replace(/,/g, ''));
      if (Number.isFinite(numeric) && numeric > 0) {
        return `$${numeric.toLocaleString('en-US', {
          minimumFractionDigits: directMatch[1].includes('.') ? 2 : 0,
          maximumFractionDigits: 2,
        })}`;
      }
    }
    const parsed = parsePrice(raw);
    if (parsed) return parsed;
  }

  const labeledLine = content.split('\n').find(line => /\bprice\b/i.test(line) && /\$/i.test(line));
  if (labeledLine) {
    const parsed = parsePrice(labeledLine);
    if (parsed) return parsed;
  }

  const firstDollar = content.match(/(?:US\s*)?\$\s*[\d,]+(?:\.\d{2})?/i)?.[0];
  if (firstDollar) {
    const parsed = parsePrice(firstDollar);
    if (parsed) return parsed;
  }

  return undefined;
}

function normalizeAvailability(rawAvailability: unknown, rawInStock: unknown, content = ''): string | undefined {
  if (typeof rawAvailability === 'string' && rawAvailability.trim()) {
    return rawAvailability.replace(/^https?:\/\/schema\.org\//i, '').replace(/\s+/g, ' ').trim();
  }
  if (typeof rawInStock === 'boolean') return rawInStock ? 'In Stock' : 'Out of Stock';

  const availabilityLine = content.split('\n').find(line => /\b(in stock|out of stock|available|unavailable|sold out)\b/i.test(line));
  if (!availabilityLine) return undefined;
  if (/out of stock|sold out|unavailable/i.test(availabilityLine)) return 'Out of Stock';
  if (/in stock|available/i.test(availabilityLine)) return 'In Stock';
  return undefined;
}

function normalizeCondition(rawCondition: unknown, content = ''): string | undefined {
  const coerceCondition = (value: string): string | undefined => {
    const cleaned = value.replace(/\s+/g, ' ').replace(/^\**\s*condition\s*:\s*/i, '').replace(/\*+/g, '').trim();
    if (!cleaned) return undefined;
    const explicit = cleaned.match(/(Brand New|New|Used|Like New|Good(?:\s*-\s*Refurbished)?|Very Good|Excellent|Open Box|Refurbished|Pre-Owned)/i)?.[1];
    if (explicit) return explicit;
    return cleaned.length > 120 ? `${cleaned.slice(0, 117)}…` : cleaned;
  };

  if (typeof rawCondition === 'string' && rawCondition.trim()) {
    return coerceCondition(rawCondition);
  }
  const conditionLine = content.split('\n').find(line => /\bcondition\b/i.test(line));
  if (conditionLine) {
    return coerceCondition(conditionLine);
  }
  return undefined;
}

function looksBlockedPage(result: PeelResult | null): boolean {
  if (!result) return true;
  if (result.blocked) return true;
  const title = (result.title || '').toLowerCase();
  const content = (result.content || '').toLowerCase();
  const method = String((result as any).method || '').toLowerCase();
  return (
    title === 'robot or human?' ||
    /access denied|captcha|robot or human|verify you are human|temporarily unavailable/i.test(`${title}\n${content}`) ||
    method === 'search-fallback' ||
    /limited content .* blocked direct access/i.test(content)
  );
}

function extractLocalInventorySignal(structured: Record<string, any>, content = ''): { verified: boolean; status: string } | null {
  const structuredCandidates = [
    structured.pickupAvailability,
    structured.pickupStatus,
    structured.storeAvailability,
    structured.localAvailability,
    structured.availabilityMessage,
    structured.fulfillmentMessage,
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  const contentCandidates = content
    .split('\n')
    .map(line => line.replace(/^[#>*\-\s]+/, '').replace(/\*+/g, '').trim())
    .filter(line => /\b(pickup|pick up|same day|curbside|local store|nearby store|store pickup)\b/i.test(line));

  for (const candidate of [...structuredCandidates, ...contentCandidates]) {
    const cleaned = candidate.replace(/\s+/g, ' ').trim();
    if (!cleaned) continue;
    if (!/\b(pickup|pick up|same day|curbside|local store|nearby store|store pickup)\b/i.test(cleaned)) continue;
    if (!/\b(available|in stock|ready|unavailable|not available|out of stock|sold out)\b/i.test(cleaned)) continue;
    return {
      verified: true,
      status: cleaned.length > 160 ? `${cleaned.slice(0, 157)}…` : cleaned,
    };
  }

  return null;
}

function isLikelyProductDetailUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, '');
    const path = parsed.pathname;

    if (/amazon\./.test(hostname)) return /\/dp\/[A-Z0-9]{10}/i.test(path) || /\/gp\/product\//i.test(path);
    if (/walmart\./.test(hostname)) return /\/ip\//i.test(path) && !/\/browse\//i.test(path);
    if (/bestbuy\./.test(hostname)) return /\/site\//i.test(path) && /\/\d+\.p$/i.test(path) || /\/product\//i.test(path);
    if (/target\./.test(hostname)) return /\/p\//i.test(path);
    if (/costco\./.test(hostname)) return /\/Product\./i.test(path) || /\.html$/i.test(path);
    if (/bjs\./.test(hostname)) return /\/product\//i.test(path) || /\/sku\//i.test(path);
    if (/traderjoes\./.test(hostname)) return /\/products\/pdp\//i.test(path);
    if (/dyson\./.test(hostname)) return /\/[^/]+\/[^/]+$/i.test(path) && !/\/search/i.test(path);
    if (/ebay\./.test(hostname)) return /\/itm\//i.test(path);
    if (/etsy\./.test(hostname)) return /\/listing\//i.test(path);
    if (/tcgplayer\./.test(hostname)) return /\/product\//i.test(path);
    if (/mercari\./.test(hostname)) return /\/item\//i.test(path);
    return /\/product\//i.test(path) || /\/p\//i.test(path) || /\/itm\//i.test(path) || /\.html$/i.test(path);
  } catch {
    return false;
  }
}

function isLikelyCategoryOrSearchUrl(url: string, title = '', snippet = ''): boolean {
  try {
    const parsed = new URL(url);
    const text = `${parsed.pathname} ${parsed.search} ${title} ${snippet}`.toLowerCase();
    return /\/s\b|search|searchpage|\/browse\/|category|department|results|shop for|all products|collections?/.test(text);
  } catch {
    return false;
  }
}

function getRetailerStrategy(url: string): RetailerStrategy {
  const storeInfo = getStoreInfo(url);
  if (!storeInfo) return DEFAULT_RETAILER_STRATEGY;
  return RETAILER_STRATEGIES[storeInfo.domain] || {
    id: storeInfo.domain.replace(/\..*$/, ''),
    store: storeInfo.store,
    domain: storeInfo.domain,
    difficulty: 'medium',
    adapterFirst: false,
    preferPersistentProfile: false,
    profileHints: [storeInfo.domain, storeInfo.store.toLowerCase().replace(/[^a-z0-9]+/g, '-')],
  };
}

function getRetailerProfile(url: string, strategy: RetailerStrategy): RetailerProfile | null {
  if (!strategy.preferPersistentProfile) return null;

  const candidates = new Set<string>(strategy.profileHints);
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    candidates.add(hostname);
    const root = hostname.split('.').slice(-2).join('.');
    if (root) candidates.add(root);
  } catch {
    // Ignore invalid URLs
  }

  const normalizedStore = strategy.store.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (normalizedStore) {
    candidates.add(normalizedStore);
    candidates.add(normalizedStore.replace(/-/g, ''));
  }

  for (const profileName of candidates) {
    if (!profileName) continue;
    const profileDir = getProfilePath(profileName);
    if (!profileDir) continue;
    return {
      profileName,
      profileDir,
      storageState: loadStorageState(profileName) ?? undefined,
    };
  }

  return null;
}

function getStructuredPriceCandidate(structured: Record<string, any>): unknown {
  return structured.price
    ?? structured.salePrice
    ?? structured.regularPrice
    ?? structured.currentPrice
    ?? structured.currentPrice?.price
    ?? structured.priceInfo?.currentPrice?.price
    ?? structured.offerPrice;
}

function buildRetailerPeelAttempts(strategy: RetailerStrategy, profile: RetailerProfile | null): Array<Record<string, any>> {
  const attempts: Array<Record<string, any>> = [];
  const profileAttempt = profile
    ? {
        render: true,
        stealth: true,
        timeout: strategy.difficulty === 'hard' ? 14000 : 11000,
        wait: strategy.difficulty === 'hard' ? 1000 : 750,
        profileDir: profile.profileDir,
        storageState: profile.storageState,
      }
    : null;

  if (profileAttempt) attempts.push(profileAttempt);

  switch (strategy.domain) {
    case 'amazon.com':
    case 'walmart.com':
    case 'bestbuy.com':
    case 'target.com':
      attempts.push(
        { render: true, stealth: true, timeout: 12000, wait: 1000 },
        { render: true, timeout: 9000, wait: 750 },
        { render: false, timeout: 7000 },
      );
      break;
    case 'ebay.com':
      attempts.push(
        { render: false, timeout: 6000 },
        { render: true, timeout: 8500, wait: 500 },
        { render: true, stealth: true, timeout: 10000, wait: 800 },
      );
      break;
    default:
      attempts.push(
        { render: false, timeout: 7000 },
        { render: true, timeout: 9000, wait: 750 },
        { render: true, stealth: true, timeout: 12000, wait: 1000 },
      );
      break;
  }

  const seen = new Set<string>();
  return attempts.filter((attempt) => {
    const key = JSON.stringify(attempt);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractEvidenceFromStructuredSource(input: {
  structured?: Record<string, any>;
  content?: string;
  title?: string;
  url: string;
  fallbackTitle: string;
  keyword: string;
  strategy: RetailerStrategy;
  source: RetailerEvidenceSource;
  fetchMethod?: string;
  profileUsed?: string;
}): VerifiedProductEvidence | null {
  const structured = input.structured || {};
  const content = input.content || '';
  const rawTitle = String(structured.title || structured.name || input.title || input.fallbackTitle || '').trim();
  const title = cleanProductTitle(rawTitle);
  if (!title || /^learn more$/i.test(title)) return null;

  const price = normalizePriceString(getStructuredPriceCandidate(structured), content);
  const priceValue = extractPriceValue(price);
  if (!price || priceValue === undefined) return null;

  const matchScore = scoreKeywordMatch(`${title} ${input.url}`, input.keyword);
  if (matchScore < 0.8) return null;

  const localInventory = extractLocalInventorySignal(structured, content);
  const storeInfo = getStoreInfo(input.url);
  return {
    title,
    price,
    priceValue,
    url: addAffiliateTag(input.url),
    rawUrl: input.url,
    store: storeInfo?.store || input.strategy.store || new URL(input.url).hostname.replace(/^www\./, ''),
    availability: normalizeAvailability(
      structured.availability ?? structured.availabilityStatus,
      structured.inStock ?? structured.onlineAvailability,
      content,
    ),
    condition: normalizeCondition(structured.condition, content),
    brand: typeof (structured.brand ?? structured.manufacturer) === 'string' ? String(structured.brand ?? structured.manufacturer) : undefined,
    model: typeof (structured.model ?? structured.modelNumber) === 'string' ? String(structured.model ?? structured.modelNumber) : undefined,
    image: typeof structured.image === 'string' ? structured.image : undefined,
    matchScore,
    difficulty: input.strategy.difficulty,
    source: input.source,
    fetchMethod: input.fetchMethod,
    profileUsed: input.profileUsed,
    localInventoryVerified: localInventory?.verified,
    localInventoryStatus: localInventory?.status,
  };
}

function extractEvidenceFromPage(
  result: PeelResult,
  url: string,
  fallbackTitle: string,
  keyword: string,
  strategy: RetailerStrategy,
  profileUsed?: string,
): VerifiedProductEvidence | null {
  if (looksBlockedPage(result)) return null;

  const structured = (result.domainData?.structured || {}) as Record<string, any>;
  return extractEvidenceFromStructuredSource({
    structured,
    content: result.content || '',
    title: result.title || '',
    url,
    fallbackTitle,
    keyword,
    strategy,
    source: Object.keys(structured).length > 0 ? 'page-domain-data' : 'page-content',
    fetchMethod: result.method,
    profileUsed,
  });
}

async function fetchPageWithRetailerRouting(url: string): Promise<{
  strategy: RetailerStrategy;
  page: PeelResult | null;
  domainResult: DomainExtractResult | null;
  source?: RetailerEvidenceSource;
  fetchMethod?: string;
  profileUsed?: string;
}> {
  const strategy = getRetailerStrategy(url);
  const profile = getRetailerProfile(url, strategy);

  if (strategy.adapterFirst && isLikelyProductDetailUrl(url)) {
    try {
      const domainResult = await extractDomainData('', url);
      if (domainResult?.structured) {
        return {
          strategy,
          page: null,
          domainResult,
          source: 'retailer-extractor',
          fetchMethod: 'retailer-extractor',
        };
      }
    } catch {
      // Fall through to peel attempts
    }
  }

  let lastResult: PeelResult | null = null;
  let lastProfileUsed: string | undefined;
  for (const attempt of buildRetailerPeelAttempts(strategy, profile)) {
    try {
      const result = await peel(url, attempt);
      lastResult = result;
      const usedProfile = typeof attempt.profileDir === 'string' ? profile?.profileName : undefined;
      if (usedProfile) {
        lastProfileUsed = usedProfile;
      }
      if (!looksBlockedPage(result) && ((result.content?.length || 0) > 120 || (result.links?.length || 0) > 0 || !!result.domainData)) {
        if (usedProfile) touchProfile(usedProfile);
        return {
          strategy,
          page: result,
          domainResult: null,
          source: result.domainData ? 'page-domain-data' : 'page-content',
          fetchMethod: result.method,
          profileUsed: usedProfile,
        };
      }
    } catch {
      // Ignore and escalate
    }
  }

  return {
    strategy,
    page: lastResult,
    domainResult: null,
    source: lastResult?.domainData ? 'page-domain-data' : (lastResult ? 'page-content' : undefined),
    fetchMethod: lastResult?.method,
    profileUsed: lastProfileUsed,
  };
}

function selectMatchingProductLinks(links: string[], keyword: string, parentUrl: string): string[] {
  let parentHost = '';
  try {
    parentHost = new URL(parentUrl).hostname.replace(/^www\./, '');
  } catch {
    parentHost = '';
  }

  const scored = links
    .filter(link => /^https?:\/\//i.test(link))
    .filter(link => getStoreInfo(link) !== null)
    .filter(link => isLikelyProductDetailUrl(link))
    .map(link => {
      let sameHostBonus = 0;
      try {
        const host = new URL(link).hostname.replace(/^www\./, '');
        if (host === parentHost) sameHostBonus = 0.15;
      } catch {
        sameHostBonus = 0;
      }
      return {
        link,
        score: scoreKeywordMatch(decodeURIComponent(link), keyword) + sameHostBonus,
      };
    })
    .filter(item => item.score >= 0.9)
    .sort((a, b) => b.score - a.score);

  const seen = new Set<string>();
  const picked: string[] = [];
  for (const item of scored) {
    if (seen.has(item.link)) continue;
    seen.add(item.link);
    picked.push(item.link);
    if (picked.length >= 2) break;
  }
  return picked;
}

async function drillDownSearchResult(result: WebSearchResult, keyword: string): Promise<DrillDownOutcome> {
  if (!result.url || !getStoreInfo(result.url)) return { evidence: null, checkedProductPages: 0, routing: [] };

  if (isLikelyProductDetailUrl(result.url)) {
    const routed = await fetchPageWithRetailerRouting(result.url);
    const directEvidence = routed.domainResult
      ? extractEvidenceFromStructuredSource({
          structured: routed.domainResult.structured,
          content: routed.domainResult.cleanContent,
          title: routed.domainResult.structured?.title || routed.domainResult.structured?.name,
          url: result.url,
          fallbackTitle: result.title || '',
          keyword,
          strategy: routed.strategy,
          source: 'retailer-extractor',
          fetchMethod: routed.fetchMethod,
          profileUsed: routed.profileUsed,
        })
      : (routed.page ? extractEvidenceFromPage(routed.page, result.url, result.title || '', keyword, routed.strategy, routed.profileUsed) : null);

    return {
      evidence: directEvidence,
      checkedProductPages: routed.page || routed.domainResult ? 1 : 0,
      routing: [{
        url: result.url,
        store: routed.strategy.store,
        domain: routed.strategy.domain,
        difficulty: routed.strategy.difficulty,
        route: routed.domainResult ? 'adapter-first' : 'peel',
        source: routed.source,
        fetchMethod: routed.fetchMethod,
        profileUsed: routed.profileUsed,
        evidenceFound: !!directEvidence,
      }],
    };
  }

  const routedParent = await fetchPageWithRetailerRouting(result.url);
  const page = routedParent.page;
  if (!page) {
    return {
      evidence: null,
      checkedProductPages: 0,
      routing: [{
        url: result.url,
        store: routedParent.strategy.store,
        domain: routedParent.strategy.domain,
        difficulty: routedParent.strategy.difficulty,
        route: 'peel',
        source: routedParent.source,
        fetchMethod: routedParent.fetchMethod,
        profileUsed: routedParent.profileUsed,
        evidenceFound: false,
      }],
    };
  }

  const pageEvidence = extractEvidenceFromPage(page, result.url, result.title || '', keyword, routedParent.strategy, routedParent.profileUsed);
  const isCategoryOrSearchPage = isLikelyCategoryOrSearchUrl(result.url, result.title, result.snippet);
  if (pageEvidence && !isCategoryOrSearchPage) {
    return {
      evidence: pageEvidence,
      checkedProductPages: 1,
      routing: [{
        url: result.url,
        store: routedParent.strategy.store,
        domain: routedParent.strategy.domain,
        difficulty: routedParent.strategy.difficulty,
        route: 'peel',
        source: routedParent.source,
        fetchMethod: routedParent.fetchMethod,
        profileUsed: routedParent.profileUsed,
        evidenceFound: true,
      }],
    };
  }

  if (!isCategoryOrSearchPage) {
    return {
      evidence: null,
      checkedProductPages: 0,
      routing: [{
        url: result.url,
        store: routedParent.strategy.store,
        domain: routedParent.strategy.domain,
        difficulty: routedParent.strategy.difficulty,
        route: 'peel',
        source: routedParent.source,
        fetchMethod: routedParent.fetchMethod,
        profileUsed: routedParent.profileUsed,
        evidenceFound: false,
      }],
    };
  }

  const candidateLinks = selectMatchingProductLinks(page.links || [], keyword, result.url);
  let bestEvidence: VerifiedProductEvidence | null = null;
  let checkedProductPages = 0;
  const routing: RetailerRoutingTrace[] = [{
    url: result.url,
    store: routedParent.strategy.store,
    domain: routedParent.strategy.domain,
    difficulty: routedParent.strategy.difficulty,
    route: 'peel',
    source: routedParent.source,
    fetchMethod: routedParent.fetchMethod,
    profileUsed: routedParent.profileUsed,
    evidenceFound: false,
  }];

  for (const link of candidateLinks) {
    const routedLink = await fetchPageWithRetailerRouting(link);
    const evidence = routedLink.domainResult
      ? extractEvidenceFromStructuredSource({
          structured: routedLink.domainResult.structured,
          content: routedLink.domainResult.cleanContent,
          title: routedLink.domainResult.structured?.title || routedLink.domainResult.structured?.name,
          url: link,
          fallbackTitle: result.title || '',
          keyword,
          strategy: routedLink.strategy,
          source: 'retailer-extractor',
          fetchMethod: routedLink.fetchMethod,
          profileUsed: routedLink.profileUsed,
        })
      : (routedLink.page ? extractEvidenceFromPage(routedLink.page, link, result.title || '', keyword, routedLink.strategy, routedLink.profileUsed) : null);

    if (routedLink.page || routedLink.domainResult) checkedProductPages += 1;
    routing.push({
      url: link,
      store: routedLink.strategy.store,
      domain: routedLink.strategy.domain,
      difficulty: routedLink.strategy.difficulty,
      route: routedLink.domainResult ? 'adapter-first' : 'peel',
      source: routedLink.source,
      fetchMethod: routedLink.fetchMethod,
      profileUsed: routedLink.profileUsed,
      evidenceFound: !!evidence,
    });
    if (!evidence) continue;
    if (!bestEvidence || evidence.matchScore > bestEvidence.matchScore || (evidence.matchScore === bestEvidence.matchScore && evidence.priceValue < bestEvidence.priceValue)) {
      bestEvidence = evidence;
    }
  }

  return { evidence: bestEvidence, checkedProductPages, routing };
}

function dedupeVerifiedEvidence(items: VerifiedProductEvidence[]): VerifiedProductEvidence[] {
  const seen = new Set<string>();
  return items
    .sort((a, b) => {
      if (b.matchScore !== a.matchScore) return b.matchScore - a.matchScore;
      if (a.source !== b.source) return a.source === 'retailer-extractor' ? -1 : 1;
      return a.priceValue - b.priceValue;
    })
    .filter(item => {
      const key = `${item.store}|${normalizeMatchText(item.title)}|${item.price}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 6);
}

function buildVerifiedAnswer(keyword: string, evidence: VerifiedProductEvidence[], requestedStore: RequestedStore | null): string {
  const top = evidence.slice(0, 3).map((item, index) => {
    const extras = [item.availability, item.condition].filter(Boolean).join('; ');
    return `${index + 1}. ${item.title} — ${item.price} at ${item.store}${extras ? ` (${extras})` : ''} [${index + 1}]`;
  }).join(' ');

  if (requestedStore) {
    return `I checked ${requestedStore.store} product pages for ${keyword}. Best verified option${evidence.length === 1 ? '' : 's'}: ${top}`;
  }
  return `I checked product pages for ${keyword}. Best verified options: ${top}`;
}

function buildFallbackAnswer(keyword: string, checkedProductPages: number, requestedStore: RequestedStore | null): string {
  if (requestedStore) {
    if (checkedProductPages > 0) {
      return `I checked ${checkedProductPages} ${requestedStore.store} product page${checkedProductPages === 1 ? '' : 's'} for ${keyword}, but I could not verify a trustworthy live price from ${requestedStore.store}. I’m not going to substitute another store.`;
    }
    return `I couldn’t verify any actual ${requestedStore.store} product pages for ${keyword}, so I’m not going to substitute another store based on snippets.`;
  }

  if (checkedProductPages > 0) {
    return `I checked ${checkedProductPages} product page${checkedProductPages === 1 ? '' : 's'} for ${keyword}, but I could not verify a trustworthy live price from those pages. I’m not going to guess from snippets.`;
  }
  return `I couldn’t verify any actual product pages for ${keyword}, so I’m not going to claim a live price from search snippets alone.`;
}

function buildLocalRetailSection(input: {
  keyword: string;
  requestedStore: RequestedStore;
  rawResults: WebSearchResult[];
  verifiedEvidence: VerifiedProductEvidence[];
  nearbyRetail: NearbyRetailResolution;
}): string {
  const { keyword, requestedStore, rawResults, verifiedEvidence, nearbyRetail } = input;
  const requestedStoreResults = filterToRequestedStore(rawResults, requestedStore);
  const requestedStoreEvidence = verifiedEvidence.filter(item => item.store === requestedStore.store);
  const localInventoryEvidence = requestedStoreEvidence.find(item => item.localInventoryVerified && item.localInventoryStatus);

  const catalogLine = requestedStoreEvidence.length > 0
    ? `- Retailer catalog existence: **Verified** on a ${requestedStore.store} product page.`
    : requestedStoreResults.length > 0
      ? `- Retailer catalog existence: **Search-result evidence only** (${requestedStoreResults.length} ${requestedStore.store} hit${requestedStoreResults.length === 1 ? '' : 's'} found, but no trustworthy PDP verification).`
      : `- Retailer catalog existence: **Not found** in the checked ${requestedStore.store} results.`;

  const nearbyLine = nearbyRetail.status === 'resolved'
    ? `- Nearby ${requestedStore.store} stores: **${nearbyRetail.stores.length} found** near ${nearbyRetail.location} (${nearbyRetail.source || 'local search'}).`
    : nearbyRetail.status === 'needs-location'
      ? `- Nearby ${requestedStore.store} stores: **Need location context** ("near me" alone is not enough on the server side).`
      : nearbyRetail.status === 'not-found'
        ? `- Nearby ${requestedStore.store} stores: **None found** near ${nearbyRetail.location}.`
        : `- Nearby ${requestedStore.store} stores: **Lookup failed** (${nearbyRetail.message}).`;

  const inventoryLine = localInventoryEvidence
    ? `- Local inventory: **Verified from public retailer page signal** — ${localInventoryEvidence.localInventoryStatus}.`
    : '- Local inventory: **Not publicly verifiable** from the retailer pages I checked.';

  const nearbyStoresSection = nearbyRetail.status === 'resolved' && nearbyRetail.stores.length > 0
    ? [
        '',
        '### Nearby stores',
        ...nearbyRetail.stores.slice(0, 3).map((store, index) => {
          const rating = store.rating ? ` · ⭐${store.rating}${store.reviewCount ? ` (${store.reviewCount.toLocaleString()} reviews)` : ''}` : '';
          const openStatus = store.isOpen === true ? ' · 🟢 Open now' : (store.isOpen === false ? ' · 🔴 Closed' : '');
          const mapsLink = store.googleMapsUrl ? ` · [Maps](${store.googleMapsUrl})` : '';
          return `${index + 1}. **${store.name}**${rating}${openStatus}${mapsLink}${store.address ? ` — ${store.address}` : ''}`;
        }),
      ]
    : [];

  return [
    '## Local retail check',
    `- Requested retailer: **${requestedStore.store}**`,
    `- Product: **${keyword}**`,
    catalogLine,
    nearbyLine,
    inventoryLine,
    ...nearbyStoresSection,
    '',
  ].join('\n');
}

function buildLocalRetailAnswer(input: {
  keyword: string;
  requestedStore: RequestedStore;
  rawResults: WebSearchResult[];
  verifiedEvidence: VerifiedProductEvidence[];
  nearbyRetail: NearbyRetailResolution;
  checkedProductPages: number;
}): string {
  const { keyword, requestedStore, rawResults, verifiedEvidence, nearbyRetail, checkedProductPages } = input;
  const requestedStoreResults = filterToRequestedStore(rawResults, requestedStore);
  const requestedStoreEvidence = verifiedEvidence.filter(item => item.store === requestedStore.store);
  const localInventoryEvidence = requestedStoreEvidence.find(item => item.localInventoryVerified && item.localInventoryStatus);

  const parts: string[] = [];
  if (requestedStoreEvidence.length > 0) {
    parts.push(`I verified that ${requestedStore.store} lists ${keyword} on a product page.`);
  } else if (requestedStoreResults.length > 0) {
    parts.push(`I found ${requestedStore.store} search-result evidence for ${keyword}, but I could not fully verify a trustworthy ${requestedStore.store} product page.`);
  } else {
    parts.push(`I could not find reliable ${requestedStore.store} catalog evidence for ${keyword}.`);
  }

  if (nearbyRetail.status === 'resolved') {
    parts.push(`I found ${nearbyRetail.stores.length} nearby ${requestedStore.store} location${nearbyRetail.stores.length === 1 ? '' : 's'} near ${nearbyRetail.location}.`);
  } else if (nearbyRetail.status === 'needs-location') {
    parts.push('I can see the nearby/local intent, but this route still needs a city or ZIP to resolve "near me" honestly.');
  } else if (nearbyRetail.status === 'not-found') {
    parts.push(`I did not find nearby ${requestedStore.store} locations near ${nearbyRetail.location}.`);
  } else {
    parts.push(`Nearby ${requestedStore.store} store lookup failed, so local store presence is unresolved.`);
  }

  if (localInventoryEvidence) {
    parts.push(`Public local pickup/store inventory is visible: ${localInventoryEvidence.localInventoryStatus}.`);
  } else if (checkedProductPages > 0 || requestedStoreResults.length > 0) {
    parts.push(`I could not verify store-specific local inventory from public retailer pages, so I cannot honestly say whether your local ${requestedStore.store} has it in stock.`);
  }

  return parts.join(' ');
}

function scoreSearchResultCandidate(result: WebSearchResult, keyword: string): number {
  const text = `${result.title || ''} ${result.snippet || ''} ${result.url || ''}`;
  let score = scoreKeywordMatch(text, keyword);
  if (isLikelyProductDetailUrl(result.url || '')) score += 0.35;
  if (isLikelyCategoryOrSearchUrl(result.url || '', result.title, result.snippet)) score -= 0.35;
  return score;
}

export async function handleProductSearch(intent: SearchIntent): Promise<SmartSearchResult> {
  const t0 = Date.now();
  const requestedStore = getRequestedStorePreference(intent);
  const keyword = buildProductKeyword(intent.query, requestedStore, intent.params || {});
  const localRetailIntent = hasLocalRetailIntent(intent, requestedStore);
  const nearbyRetailPromise = localRetailIntent && requestedStore
    ? resolveNearbyRetailStores(intent, requestedStore)
    : Promise.resolve(null);

  // Parallel site-specific searches
  const { provider: searchProvider } = getBestSearchProvider();
  const isBulk = /\b(bulk|wholesale|1000|500|case|pallet|box of|pack of|carton)\b/i.test(intent.query);
  const isGrocery = intent.params.isGrocery === 'true' || /\b(grocery|milk|eggs|bread|butter|cheese|chicken|produce)\b/i.test(intent.query);
  const isCollectible = /\b(pokemon|pokémon|magic\s*the\s*gathering|mtg|yu-?gi-?oh|trading\s*card|tcg|baseball\s*card|sports\s*card|collectible\s*card|figurine|funko|hot\s*wheels|lego\s*set|vintage\s*toy|action\s*figure|comic\s*book|vinyl\s*record|rare\s*coin|stamp\s*collection)\b/i.test(intent.query);

  let rawResults: WebSearchResult[];
  let redditResults: WebSearchResult[];

  if (requestedStore) {
    const [storeSettled] = await Promise.allSettled([
      searchProvider.searchWeb(
        buildRequestedStoreSearchQuery(requestedStore, keyword, isBulk, isGrocery, isCollectible),
        { count: 6 },
      ),
    ]);
    rawResults = filterToRequestedStore(storeSettled.status === 'fulfilled' ? storeSettled.value : [], requestedStore);
    redditResults = [];
  } else if (isCollectible) {
    const [tcgSettled, ebaySettled, etsySettled, fbAmazonSettled, redditSettled] = await Promise.allSettled([
      searchProvider.searchWeb(`${keyword} price site:tcgplayer.com`, { count: 2 }),
      searchProvider.searchWeb(`${keyword} price site:ebay.com sold`, { count: 2 }),
      searchProvider.searchWeb(`${keyword} price site:etsy.com OR site:mercari.com`, { count: 3 }),
      searchProvider.searchWeb(`${keyword} price site:facebook.com/marketplace OR site:amazon.com`, { count: 3 }),
      searchProvider.searchWeb(`${keyword} cheapest reddit where to buy`, { count: 3 }),
    ]);
    rawResults = [
      ...(tcgSettled.status === 'fulfilled' ? tcgSettled.value : []),
      ...(ebaySettled.status === 'fulfilled' ? ebaySettled.value : []),
      ...(etsySettled.status === 'fulfilled' ? etsySettled.value : []),
      ...(fbAmazonSettled.status === 'fulfilled' ? fbAmazonSettled.value : []),
    ];
    redditResults = redditSettled.status === 'fulfilled' ? redditSettled.value : [];
  } else if (isGrocery) {
    // Search grocery-specific sites
    const [instacartSettled, walmartGrocerySettled, freshSettled, redditGrocerySettled] = await Promise.allSettled([
      searchProvider.searchWeb(`${keyword} price site:instacart.com`, { count: 2 }),
      searchProvider.searchWeb(`${keyword} price site:walmart.com/grocery OR site:walmart.com`, { count: 2 }),
      searchProvider.searchWeb(`${keyword} price site:freshdirect.com OR site:wholefoodsmarket.com`, { count: 3 }),
      searchProvider.searchWeb(`${keyword} cheapest grocery store reddit`, { count: 3 }),
    ]);
    rawResults = [
      ...(instacartSettled.status === 'fulfilled' ? instacartSettled.value : []),
      ...(walmartGrocerySettled.status === 'fulfilled' ? walmartGrocerySettled.value : []),
      ...(freshSettled.status === 'fulfilled' ? freshSettled.value : []),
    ];
    redditResults = redditGrocerySettled.status === 'fulfilled' ? redditGrocerySettled.value : [];
  } else {
    const [amazonSettled, walmartSettled, bestbuySettled, targetSettled, redditSettled] = await Promise.allSettled([
      searchProvider.searchWeb(`${keyword} site:amazon.com ${isBulk ? '' : 'price'}`, { count: 3 }),
      searchProvider.searchWeb(`${keyword} site:walmart.com price`, { count: 2 }),
      searchProvider.searchWeb(`${keyword} site:bestbuy.com OR site:target.com price`, { count: 2 }),
      isBulk
        ? searchProvider.searchWeb(`${keyword} wholesale bulk site:uline.com OR site:alibaba.com OR site:staples.com OR site:webstaurantstore.com`, { count: 3 })
        : searchProvider.searchWeb(`${keyword} site:ebay.com OR site:etsy.com price`, { count: 3 }),
      searchProvider.searchWeb(`${keyword} reddit review best worth it`, { count: 2 }),
    ]);
    rawResults = [
      ...(amazonSettled.status === 'fulfilled' ? amazonSettled.value : []),
      ...(walmartSettled.status === 'fulfilled' ? walmartSettled.value : []),
      ...(bestbuySettled.status === 'fulfilled' ? bestbuySettled.value : []),
      ...(targetSettled.status === 'fulfilled' ? targetSettled.value : []),
    ];
    redditResults = redditSettled.status === 'fulfilled' ? redditSettled.value : [];
  }

  // Parse structured product listings from search results
  // DEEP SCRAPE: Visit top marketplace pages to extract real prices (collectibles only)
  let uniqueListings: DeepListing[] = [];
  if (isCollectible) {
    const scrapableUrls = rawResults
      .filter(r => r.url && (
        r.url.includes('tcgplayer.com') ||
        r.url.includes('ebay.com') ||
        r.url.includes('amazon.com') ||
        r.url.includes('etsy.com') ||
        r.url.includes('mercari.com')
      ))
      .slice(0, 4)
      .map(r => r.url);

    const deepResults = await Promise.allSettled(
      scrapableUrls.map(url =>
        peel(url, { render: false, timeout: 5000 })
          .then(result => ({ url, content: result.content, title: result.title, tokens: result.tokens }))
          .catch(() => null)
      )
    );

    const deepListings: DeepListing[] = [];

    for (const settled of deepResults) {
      if (settled.status !== 'fulfilled' || !settled.value) continue;
      const { url, content: pageContent } = settled.value;
      if (!pageContent) continue;

      const sourceName = url.includes('tcgplayer') ? 'TCGPlayer'
        : url.includes('ebay') ? 'eBay'
        : url.includes('amazon') ? 'Amazon'
        : url.includes('etsy') ? 'Etsy'
        : url.includes('mercari') ? 'Mercari'
        : new URL(url).hostname;

      const lines = pageContent.split('\n');
      for (const line of lines) {
        const pm = line.match(/\$(\d{1,6}(?:\.\d{2})?)/);
        if (!pm) continue;
        const price = parseFloat(pm[1]);
        if (price < 0.5 || price > 50000) continue;

        const titleText = line.replace(/\$[\d,.]+/g, '').replace(/[|·\-–—]/g, ' ').trim().slice(0, 100);
        if (titleText.length < 5) continue;

        const conditionMatch = line.match(CONDITION_RE);

        deepListings.push({
          title: titleText,
          price: '$' + price.toFixed(2),
          priceValue: price,
          url,
          source: sourceName,
          condition: conditionMatch ? conditionMatch[1] : undefined,
        });
      }
    }

    deepListings.sort((a, b) => a.priceValue - b.priceValue);
    const seen = new Set<string>();
    uniqueListings = deepListings.filter(l => {
      const key = l.price + l.source;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 6);
  }

  const fallbackListings = filterToRequestedStore(rawResults, requestedStore)
    .filter(r => r.url && getStoreInfo(r.url) !== null)
    .map(r => {
      const storeInfo = getStoreInfo(r.url)!;
      const textToSearch = `${r.title || ''} ${r.snippet || ''}`;

      // Extract price from snippet/title
      const price = parsePrice(textToSearch);

      // Extract rating from snippet
      const ratingMatch = (r.snippet || '').match(/(\d+(?:\.\d)?)\s*(?:out of 5|stars?|★)/i);
      const rating = ratingMatch ? parseFloat(ratingMatch[1]) : undefined;

      // Extract review count
      const reviewMatch = (r.snippet || '').match(/([\d,]+)\s*(?:ratings?|reviews?)/i);
      const reviewCount = reviewMatch ? reviewMatch[1].replace(/,/g, '') : undefined;

      // Clean up title
      const title = cleanProductTitle(r.title || '');

      // Extract brand from title — common patterns: "Brand Name Product..." or known brands
      const KNOWN_BRANDS = /\b(Sony|Bose|Apple|Samsung|LG|JBL|Sennheiser|Audio-Technica|Beats|Jabra|Anker|Soundcore|AKG|Shure|Skullcandy|Plantronics|HyperX|SteelSeries|Razer|Corsair|Logitech|Dell|HP|Lenovo|Asus|Acer|MSI|Microsoft|Google|Amazon|Kindle|Echo|Ring|Roku|Dyson|iRobot|Roomba|Ninja|KitchenAid|Instant Pot|Keurig|Breville|Philips|Panasonic|Canon|Nikon|GoPro|DJI|Fitbit|Garmin|Xiaomi|OnePlus|Nothing|Motorola|Nokia|TCL|Hisense|Vizio|Sonos|Marshall|Bang & Olufsen|B&O|Nike|Adidas|New Balance|Puma|Under Armour|North Face|Patagonia|Columbia|Levi's|Oakley|Ray-Ban|Gucci|Coach|Kate Spade|Michael Kors|Samsonite|Osprey|Yeti|Hydro Flask|Stanley|Weber|Traeger|DeWalt|Makita|Milwaukee|Bosch|Black\+Decker|Craftsman|Ryobi)\b/i;
      const brandMatch = (r.title || '').match(KNOWN_BRANDS);
      const brand = brandMatch ? brandMatch[1] : undefined;

      // Image from SearXNG (imageUrl field if available)
      const image = (r as any).imageUrl ?? undefined;

      return {
        title,
        brand,
        price,
        rating,
        reviewCount,
        url: addAffiliateTag(r.url),
        rawUrl: r.url,
        snippet: r.snippet,
        store: storeInfo.store,
        image,
        checked: false,
      };
    })
    .slice(0, 10);

  let checkedProductPages = 0;
  let verifiedEvidence: VerifiedProductEvidence[] = [];
  let retailerRouting: RetailerRoutingTrace[] = [];

  if (!isCollectible) {
    const scoredCandidates = rawResults
      .filter(r => r.url && getStoreInfo(r.url) !== null)
      .map(result => ({ result, score: scoreSearchResultCandidate(result, keyword) }))
      .filter(item => item.score >= 0.4)
      .sort((a, b) => b.score - a.score);

    const pickedCandidateUrls = new Set<string>();
    const coveredStores = new Set<string>();
    const drillDownCandidates: WebSearchResult[] = [];

    for (const item of scoredCandidates) {
      const store = getStoreInfo(item.result.url)?.store || item.result.url;
      if (coveredStores.has(store)) continue;
      coveredStores.add(store);
      pickedCandidateUrls.add(item.result.url);
      drillDownCandidates.push(item.result);
      if (drillDownCandidates.length >= 5) break;
    }

    for (const item of scoredCandidates) {
      if (pickedCandidateUrls.has(item.result.url)) continue;
      pickedCandidateUrls.add(item.result.url);
      drillDownCandidates.push(item.result);
      if (drillDownCandidates.length >= 6) break;
    }

    const drillDownResults = await Promise.allSettled(
      drillDownCandidates.map(result => drillDownSearchResult(result, keyword))
    );

    for (const settled of drillDownResults) {
      if (settled.status !== 'fulfilled') continue;
      checkedProductPages += settled.value.checkedProductPages;
      retailerRouting.push(...settled.value.routing);
      if (settled.value.evidence) verifiedEvidence.push(settled.value.evidence);
    }

    verifiedEvidence = filterToRequestedStore(dedupeVerifiedEvidence(verifiedEvidence), requestedStore);
    const seenRouting = new Set<string>();
    retailerRouting = filterToRequestedStore(retailerRouting, requestedStore).filter(item => {
      const key = `${item.url}|${item.route}|${item.fetchMethod || ''}|${item.profileUsed || ''}`;
      if (seenRouting.has(key)) return false;
      seenRouting.add(key);
      return true;
    });
  }

  let listings: Array<{
    title: string;
    brand?: string;
    model?: string;
    price?: string;
    rating?: number;
    reviewCount?: string;
    url: string;
    rawUrl?: string;
    snippet?: string;
    store: string;
    image?: string;
    availability?: string;
    condition?: string;
    checked?: boolean;
    difficulty?: RetailerDifficulty;
    source?: RetailerEvidenceSource;
    fetchMethod?: string;
    profileUsed?: string;
  }> = fallbackListings;

  // Replace listings with deep-scraped results for collectibles (if any found)
  if (isCollectible && uniqueListings.length > 0) {
    listings = uniqueListings.map(l => ({
      title: l.title,
      brand: undefined,
      price: l.price,
      rating: undefined,
      reviewCount: undefined,
      url: l.url,
      rawUrl: l.url,
      snippet: l.condition ? `Condition: ${l.condition}` : '',
      store: l.source,
      image: undefined,
      condition: l.condition,
      checked: true,
    }));
  } else if (verifiedEvidence.length > 0) {
    listings = verifiedEvidence.map(item => ({
      title: item.title,
      brand: item.brand,
      model: item.model,
      price: item.price,
      rating: undefined,
      reviewCount: undefined,
      url: item.url,
      rawUrl: item.rawUrl,
      snippet: [item.availability, item.condition, item.localInventoryStatus, item.source === 'retailer-extractor' ? 'adapter-first' : undefined].filter(Boolean).join(' • '),
      store: item.store,
      image: item.image,
      availability: item.availability,
      condition: item.condition,
      checked: true,
      difficulty: item.difficulty,
      source: item.source,
      fetchMethod: item.fetchMethod,
      profileUsed: item.profileUsed,
    }));
  } else {
    listings = fallbackListings.map(item => ({
      ...item,
      snippet: item.snippet ? `${item.snippet}${item.price ? '' : ' (search snippet only; price unverified)'}` : (item.price ? '' : 'Search snippet only; price unverified'),
    }));
  }

  const nearbyRetail = await nearbyRetailPromise;
  const localRetailSection = localRetailIntent && requestedStore && nearbyRetail
    ? `${buildLocalRetailSection({ keyword, requestedStore, rawResults, verifiedEvidence, nearbyRetail })}\n`
    : '';

  const sourceUrl = requestedStore
    ? buildRequestedStoreSourceUrl(requestedStore, keyword)
    : addAffiliateTag(`https://www.amazon.com/s?k=${encodeURIComponent(keyword)}`);
  const heading = requestedStore ? `${keyword} (${requestedStore.store})` : keyword;
  const content = listings.length > 0
    ? `# 🛍️ Products — ${heading}\n\n${localRetailSection}${listings.map((l, i) =>
        `${i + 1}. **${l.title}** — ${l.price || 'see price'} [${l.store}](${l.url})${l.checked ? '' : ' _(unverified snippet)_'}\n   ${l.snippet || ''}`
      ).join('\n\n')}`
    : `# 🛍️ Products — ${heading}\n\n${localRetailSection}No structured listings found. Try a more specific query.`;

  // AI synthesis: recommend best value option
  let answer: string | undefined;
  try {
    const productInfo = listings.length > 0
      ? listings.slice(0, 5).map(l => `${l.brand ? l.brand + ' ' : ''}${l.title}: ${l.price || 'N/A'} at ${l.store}${l.rating ? `, ${l.rating}★` : ''}${l.reviewCount ? ` (${l.reviewCount} reviews)` : ''}`).join(', ')
      : 'no specific listings found';
    const redditSnippets = redditResults.slice(0, 2).map(r => `${r.title}: ${r.snippet || ''}`).join('\n');
    const deepPriceInfo = uniqueListings.length > 0
      ? '\n\nReal prices found:\n' + uniqueListings.slice(0, 5).map((l, i) => `${i + 1}. ${l.title} — ${l.price} on ${l.source}${l.condition ? ` (${l.condition})` : ''}`).join('\n')
      : '';

    if (isCollectible) {
      const aiPrompt = `${PROMPT_INJECTION_DEFENSE}You are a collectibles price expert. The user wants: "${sanitizeSearchQuery(intent.query)}". Products found: ${productInfo}.${deepPriceInfo} Reddit says: ${redditSnippets || 'none'}. List the cheapest options with exact prices, condition (near mint/lightly played/etc), and which store. Be specific with dollar amounts. Max 200 words. Cite sources inline as [1], [2], [3].`;
      const aiText = await callLLMQuick(aiPrompt, { maxTokens: 250, timeoutMs: 8000, temperature: 0.3 });
      if (aiText && aiText.length > 20) answer = aiText;
    } else if (localRetailIntent && requestedStore && nearbyRetail) {
      answer = buildLocalRetailAnswer({ keyword, requestedStore, rawResults, verifiedEvidence, nearbyRetail, checkedProductPages });
    } else if (verifiedEvidence.length > 0) {
      answer = buildVerifiedAnswer(keyword, verifiedEvidence, requestedStore);
    } else {
      answer = buildFallbackAnswer(keyword, checkedProductPages, requestedStore);
    }
  } catch (err) {
    console.warn('[product-search] LLM synthesis failed (graceful fallback):', (err as Error).message);
    if (!isCollectible) {
      answer = localRetailIntent && requestedStore && nearbyRetail
        ? buildLocalRetailAnswer({ keyword, requestedStore, rawResults, verifiedEvidence, nearbyRetail, checkedProductPages })
        : (verifiedEvidence.length > 0
          ? buildVerifiedAnswer(keyword, verifiedEvidence, requestedStore)
          : buildFallbackAnswer(keyword, checkedProductPages, requestedStore));
    }
  }

  return {
    type: 'products',
    source: localRetailIntent && requestedStore
      ? 'Checked product pages + local store search'
      : (verifiedEvidence.length > 0 ? 'Checked product pages' : (listings.length > 0 ? 'Shopping + Reddit' : 'Web')),
    sourceUrl,
    content,
    title: requestedStore ? `${keyword} — ${requestedStore.store}` : `${keyword} — Shopping`,
    structured: {
      requestedStore: requestedStore || undefined,
      localRetail: localRetailIntent && requestedStore ? {
        requested: true,
        location: nearbyRetail?.location,
        nearbyStoresStatus: nearbyRetail?.status,
        nearbyStoresSource: nearbyRetail?.source,
        nearbyStoresMessage: nearbyRetail?.message,
        nearbyStores: nearbyRetail?.stores?.map(store => ({
          name: store.name,
          address: store.address,
          rating: store.rating,
          reviewCount: store.reviewCount,
          isOpen: store.isOpen,
          googleMapsUrl: store.googleMapsUrl,
          hours: store.hours,
        })) || [],
        catalogExistence: requestedStore ? (
          verifiedEvidence.some(item => item.store === requestedStore.store)
            ? 'verified'
            : (filterToRequestedStore(rawResults, requestedStore).length > 0 ? 'search-result' : 'not-found')
        ) : undefined,
        localInventoryStatus: verifiedEvidence.find(item => item.store === requestedStore?.store && item.localInventoryVerified && item.localInventoryStatus)?.localInventoryStatus,
        localInventoryVerified: verifiedEvidence.some(item => item.store === requestedStore?.store && item.localInventoryVerified),
      } : undefined,
      listings,
      checkedProductPages,
      retailerRouting,
      verifiedEvidence: verifiedEvidence.map(item => ({
        title: item.title,
        brand: item.brand,
        model: item.model,
        image: item.image,
        price: item.price,
        priceValue: item.priceValue,
        store: item.store,
        url: item.url,
        rawUrl: item.rawUrl,
        availability: item.availability,
        condition: item.condition,
        difficulty: item.difficulty,
        source: item.source,
        fetchMethod: item.fetchMethod,
        profileUsed: item.profileUsed,
        localInventoryVerified: item.localInventoryVerified,
        localInventoryStatus: item.localInventoryStatus,
      })),
    },
    tokens: content.split(' ').length,
    fetchTimeMs: Date.now() - t0,
    ...(answer !== undefined ? { answer } : {}),
    sources: [
      { type: 'shopping', count: listings.length, checkedProductPages } as any,
      ...(localRetailIntent && requestedStore ? [{
        type: 'local-retail',
        requestedStore: requestedStore.store,
        status: nearbyRetail?.status,
        location: nearbyRetail?.location,
        count: nearbyRetail?.stores?.length || 0,
      } as any] : []),
      { type: 'reddit', threads: redditResults.slice(0, 3).map(r => ({ title: r.title, url: r.url, snippet: r.snippet })) } as any,
    ],
  };
}
