/**
 * business-intel.ts — Extract structured business intelligence from a URL.
 *
 * Uses peel() to fetch the website, then extracts:
 * - Name, description, industry from schema.org + OG tags
 * - Products and pricing from /pricing and /plans pages
 * - Tech stack from headers and script patterns
 * - Social media links
 * - Review aggregates
 */

import { peel } from '../index.js';

// ─── Types ────────────────────────────────────────────────────────────────

export interface BusinessIntel {
  name?: string;
  description?: string;
  industry?: string;
  products?: string[];
  pricing?: { plan: string; price: string }[];
  reviews?: { source: string; rating: number; count: number }[];
  socialMedia?: { platform: string; url: string }[];
  techStack?: string[];      // detected from headers/scripts
  employees?: string;        // from LinkedIn if available
  founded?: string;
}

// ─── Tech stack detectors ─────────────────────────────────────────────────

const TECH_PATTERNS: Array<{ name: string; pattern: RegExp; type: 'script' | 'meta' | 'header' }> = [
  // Frontend frameworks
  { name: 'React',       pattern: /react(?:\.min)?\.js|__reactFiber|react-dom/i,       type: 'script' },
  { name: 'Vue.js',      pattern: /vue(?:\.min)?\.js|Vue\.component|__vue_/i,          type: 'script' },
  { name: 'Angular',     pattern: /angular(?:\.min)?\.js|ng-version|ng-app/i,          type: 'script' },
  { name: 'Next.js',     pattern: /__NEXT_DATA__|next\/dist\/|_next\/static/i,         type: 'script' },
  { name: 'Nuxt.js',     pattern: /__NUXT__|_nuxt\/|nuxtjs\.org/i,                     type: 'script' },
  { name: 'Svelte',      pattern: /svelte\/internal|SvelteComponent/i,                 type: 'script' },

  // E-commerce & CMS
  { name: 'Shopify',     pattern: /shopify\.com|Shopify\.theme|cdn\.shopify/i,          type: 'script' },
  { name: 'WordPress',   pattern: /wp-content\/|wp-includes\/|WordPress/i,             type: 'script' },
  { name: 'Webflow',     pattern: /webflow\.com|Webflow\.require/i,                     type: 'script' },
  { name: 'Squarespace', pattern: /squarespace\.com|SQUARESPACE_ROLLUPS/i,              type: 'script' },
  { name: 'Wix',         pattern: /wix\.com|wixstatic\.com/i,                           type: 'script' },

  // Analytics & marketing
  { name: 'Google Analytics', pattern: /google-analytics\.com|gtag\(|ga\('send/i,     type: 'script' },
  { name: 'Segment',     pattern: /segment\.com|analytics\.identify/i,                  type: 'script' },
  { name: 'Mixpanel',    pattern: /mixpanel\.com|mixpanel\.track/i,                     type: 'script' },
  { name: 'Intercom',    pattern: /intercom\.io|window\.Intercom/i,                     type: 'script' },
  { name: 'Hubspot',     pattern: /hubspot\.com|hs-scripts\.com/i,                      type: 'script' },
  { name: 'Stripe',      pattern: /js\.stripe\.com|Stripe\(/i,                          type: 'script' },

  // Server / infrastructure (detected via headers)
  { name: 'Vercel',      pattern: /vercel/i,                                             type: 'header' },
  { name: 'Netlify',     pattern: /netlify/i,                                            type: 'header' },
  { name: 'Cloudflare',  pattern: /cloudflare/i,                                         type: 'header' },
  { name: 'AWS',         pattern: /amazonaws\.com|x-amz-/i,                             type: 'header' },
  { name: 'Nginx',       pattern: /nginx/i,                                              type: 'header' },
  { name: 'Apache',      pattern: /apache/i,                                             type: 'header' },
];

const SOCIAL_PATTERNS: Array<{ platform: string; pattern: RegExp }> = [
  { platform: 'Twitter/X',   pattern: /(?:twitter\.com|x\.com)\/([^/"?\s]+)/i },
  { platform: 'LinkedIn',    pattern: /linkedin\.com\/(?:company|in)\/([^/"?\s]+)/i },
  { platform: 'Facebook',    pattern: /facebook\.com\/([^/"?\s]+)/i },
  { platform: 'Instagram',   pattern: /instagram\.com\/([^/"?\s]+)/i },
  { platform: 'YouTube',     pattern: /youtube\.com\/(?:channel|c|@)\/([^/"?\s]+)/i },
  { platform: 'GitHub',      pattern: /github\.com\/([^/"?\s]+)/i },
  { platform: 'Discord',     pattern: /discord\.(?:gg|com\/invite)\/([^/"?\s]+)/i },
  { platform: 'TikTok',      pattern: /tiktok\.com\/@([^/"?\s]+)/i },
];

const INDUSTRY_KEYWORDS: Record<string, string[]> = {
  'SaaS / Software':   ['software', 'saas', 'platform', 'api', 'developer', 'cloud', 'app'],
  'E-commerce':        ['shop', 'store', 'buy', 'cart', 'checkout', 'product', 'shipping'],
  'Finance / Fintech': ['payment', 'invoice', 'banking', 'crypto', 'invest', 'finance', 'loan'],
  'Healthcare':        ['health', 'medical', 'patient', 'clinic', 'doctor', 'hospital', 'pharma'],
  'Education':         ['course', 'learn', 'training', 'education', 'school', 'university', 'tutor'],
  'Marketing':         ['marketing', 'seo', 'email campaign', 'crm', 'lead', 'analytics'],
  'AI / Machine Learning': ['ai', 'machine learning', 'nlp', 'model', 'inference', 'llm'],
  'Food & Restaurant': ['restaurant', 'food', 'menu', 'delivery', 'catering', 'dining'],
  'Travel':            ['travel', 'hotel', 'flight', 'booking', 'tourism', 'vacation'],
  'Real Estate':       ['real estate', 'property', 'mortgage', 'rent', 'apartment', 'lease'],
  'Media / Content':   ['news', 'blog', 'podcast', 'video', 'streaming', 'media', 'content'],
};

// ─── Pricing page helpers ─────────────────────────────────────────────────

interface PlanCandidate {
  plan: string;
  price: string;
}

function extractPricing(content: string): PlanCandidate[] {
  const plans: PlanCandidate[] = [];
  const seen = new Set<string>();

  // Look for plan name + price in proximity
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const planMatch = line.match(/\b(free|starter|basic|pro|professional|business|enterprise|premium|growth|scale|team|individual|personal)\b/i);
    if (!planMatch) continue;

    // Search nearby lines for a price
    const context = lines.slice(Math.max(0, i - 1), Math.min(lines.length, i + 5)).join(' ');
    const priceMatch = context.match(/\$([\d,]+(?:\.\d{2})?)/);
    if (priceMatch) {
      const key = `${planMatch[1].toLowerCase()}:${priceMatch[0]}`;
      if (!seen.has(key)) {
        seen.add(key);
        plans.push({ plan: planMatch[1], price: priceMatch[0] });
      }
    } else if (/\bfree\b/i.test(planMatch[1])) {
      const key = `${planMatch[1].toLowerCase()}:$0`;
      if (!seen.has(key)) {
        seen.add(key);
        plans.push({ plan: planMatch[1], price: '$0' });
      }
    }
  }

  return plans.slice(0, 8);
}

function detectTechStack(content: string, headers: Record<string, string>): string[] {
  const detected = new Set<string>();

  // Check headers
  const headerString = Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
    .toLowerCase();

  // Check content (HTML/scripts)
  for (const tech of TECH_PATTERNS) {
    if (tech.type === 'header') {
      if (tech.pattern.test(headerString)) detected.add(tech.name);
    } else {
      if (tech.pattern.test(content)) detected.add(tech.name);
    }
  }

  return [...detected].sort();
}

function extractSocialMedia(content: string): { platform: string; url: string }[] {
  const found: { platform: string; url: string }[] = [];
  const seen = new Set<string>();

  for (const { platform, pattern } of SOCIAL_PATTERNS) {
    const matches = content.matchAll(new RegExp(pattern.source, 'gi'));
    for (const match of matches) {
      const fullMatch = match[0];
      if (!fullMatch.includes('share') && !fullMatch.includes('intent') && !seen.has(fullMatch)) {
        seen.add(fullMatch);
        // Build full URL
        let url = fullMatch;
        if (!url.startsWith('http')) url = 'https://' + url;
        found.push({ platform, url });
        break; // one per platform
      }
    }
  }

  return found;
}

function detectIndustry(text: string): string | undefined {
  const lower = text.toLowerCase();
  const scores: Record<string, number> = {};

  for (const [industry, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
    scores[industry] = keywords.filter(kw => lower.includes(kw)).length;
  }

  const best = Object.entries(scores)
    .filter(([, score]) => score > 0)
    .sort(([, a], [, b]) => b - a)[0];

  return best ? best[0] : undefined;
}

function extractSchemaOrgData(content: string): Partial<BusinessIntel> {
  const result: Partial<BusinessIntel> = {};

  // JSON-LD: look for Organization or LocalBusiness schema
  const jsonLdMatch = content.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi);
  if (jsonLdMatch) {
    for (const block of jsonLdMatch) {
      try {
        const json = JSON.parse(block.replace(/<script[^>]*>|<\/script>/gi, ''));
        const items = Array.isArray(json) ? json : [json];
        for (const item of items) {
          if (!result.name && item.name) result.name = item.name;
          if (!result.description && item.description) result.description = item.description;
          if (!result.founded && item.foundingDate) result.founded = String(item.foundingDate);
          if (!result.employees && item.numberOfEmployees) {
            const emp = item.numberOfEmployees;
            result.employees = typeof emp === 'object' ? `${emp.minValue ?? ''}–${emp.maxValue ?? ''}` : String(emp);
          }
          // Review aggregate
          if (item.aggregateRating) {
            result.reviews = result.reviews || [];
            result.reviews.push({
              source: 'Schema.org',
              rating: parseFloat(item.aggregateRating.ratingValue) || 0,
              count: parseInt(item.aggregateRating.reviewCount) || 0,
            });
          }
        }
      } catch {
        // Invalid JSON-LD — skip
      }
    }
  }

  // Open Graph fallback
  if (!result.name) {
    const ogTitle = content.match(/property="og:title"\s+content="([^"]+)"/);
    if (ogTitle) result.name = ogTitle[1];
  }
  if (!result.description) {
    const ogDesc = content.match(/(?:property="og:description"|name="description")\s+content="([^"]+)"/);
    if (ogDesc) result.description = ogDesc[1];
  }

  return result;
}

// ─── Main export ──────────────────────────────────────────────────────────

/**
 * Extract structured business intelligence from a website URL.
 *
 * Fetches the homepage and optionally the /pricing page, then extracts
 * structured data including tech stack, social media, pricing, and more.
 *
 * @example
 * ```typescript
 * const intel = await getBusinessIntel('https://stripe.com');
 * console.log(intel.name);       // "Stripe"
 * console.log(intel.techStack);  // ["React", "Cloudflare", ...]
 * console.log(intel.pricing);    // [{plan: "Starter", price: "$0"}, ...]
 * ```
 */
export async function getBusinessIntel(url: string): Promise<BusinessIntel> {
  // Normalize URL
  if (!url.startsWith('http')) url = 'https://' + url;
  const parsed = new URL(url);
  const origin = parsed.origin;

  // 1. Fetch homepage
  const homeResult = await peel(url, {
    format: 'html',
    timeout: 15000,
  });

  const homeContent = homeResult.content || '';
  const homeHtml = (homeResult as any).rawHtml || homeContent;

  // 2. Extract schema.org / OG data
  const schemaData = extractSchemaOrgData(homeHtml);

  // 3. Detect tech stack from content + headers
  const responseHeaders = (homeResult as any).headers || {};
  const techStack = detectTechStack(homeHtml + homeContent, responseHeaders);

  // 4. Extract social media links
  const socialMedia = extractSocialMedia(homeHtml + homeContent);

  // 5. Detect industry from description + content
  const textForIndustry = [schemaData.description, homeContent].filter(Boolean).join(' ');
  const industry = detectIndustry(textForIndustry);

  // 6. Try to fetch pricing page (best-effort)
  let pricing: { plan: string; price: string }[] = [];
  const pricingPaths = ['/pricing', '/plans', '/pricing-plans', '/subscribe'];

  for (const path of pricingPaths) {
    try {
      const pricingUrl = origin + path;
      const pricingResult = await peel(pricingUrl, { timeout: 8000 });
      if (pricingResult.content && pricingResult.content.length > 200) {
        pricing = extractPricing(pricingResult.content);
        if (pricing.length > 0) break;
      }
    } catch {
      // Pricing page not found — continue
    }
  }

  // If no pricing found from pricing page, try extracting from homepage
  if (pricing.length === 0) {
    pricing = extractPricing(homeContent);
  }

  // 7. Extract products list from homepage (look for feature/product lists)
  const products: string[] = [];
  const productSection = homeContent.match(/(?:products?|features?|solutions?)[^\n]*\n((?:[^\n]+\n){1,10})/i);
  if (productSection) {
    const lines = productSection[1]
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 3 && l.length < 80 && !l.startsWith('#') && !l.startsWith('http'));
    products.push(...lines.slice(0, 8));
  }

  // Build final result
  const intel: BusinessIntel = {
    ...schemaData,
  };

  if (industry) intel.industry = industry;
  if (products.length > 0) intel.products = products;
  if (pricing.length > 0) intel.pricing = pricing;
  if (socialMedia.length > 0) intel.socialMedia = socialMedia;
  if (techStack.length > 0) intel.techStack = techStack;

  return intel;
}
