/**
 * Engine Quality-Ranked Fallback System
 *
 * Ranks extraction strategies by quality for a given URL, producing a
 * dynamic fallback chain. Inspired by Firecrawl's engine cascade approach
 * but tailored to WebPeel's architecture.
 *
 * Usage:
 * ```ts
 * import { buildFallbackChain } from './engine-ranker.js';
 * const chain = buildFallbackChain('https://twitter.com/user', { render: true });
 * // Returns engines sorted by quality, with domain-specific adjustments
 * ```
 *
 * @module engine-ranker
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Supported extraction engine types, ordered roughly by sophistication. */
export type EngineType =
  | 'domain-api'
  | 'simple'
  | 'browser'
  | 'stealth'
  | 'cloaked'
  | 'search-fallback';

/**
 * Configuration for a single extraction engine describing its quality,
 * performance characteristics, resource cost, and feature capabilities.
 */
export interface EngineConfig {
  /** Engine identifier. */
  type: EngineType;
  /** Quality score 0-100 — higher means better extraction fidelity. */
  quality: number;
  /** Speed score 0-100 — higher means faster. */
  speed: number;
  /** Cost score 0-100 — higher means more resource-intensive. */
  cost: number;
  /** Maximum reasonable timeout for this engine in milliseconds. */
  maxTimeoutMs: number;
  /** Feature flags indicating engine capabilities. */
  features: {
    /** Can execute JavaScript / render SPAs. */
    javascript: boolean;
    /** Has anti-bot bypass capabilities. */
    antibot: boolean;
    /** Can capture screenshots. */
    screenshots: boolean;
    /** Uses stealth techniques (fingerprint spoofing, etc.). */
    stealth: boolean;
  };
}

/** Options controlling which engines are eligible for the fallback chain. */
export interface FallbackChainOptions {
  /** If false, exclude engines that require browser rendering (browser, stealth, cloaked). */
  render?: boolean;
  /** If true, include stealth-capable engines even when render is false. */
  stealth?: boolean;
  /** If true, exclude the domain-api engine from the chain. */
  noDomainApi?: boolean;
}

// ---------------------------------------------------------------------------
// Default engine configurations
// ---------------------------------------------------------------------------

/**
 * Baseline configuration for each engine type.
 *
 * Quality reflects extraction fidelity (not speed or cost):
 * - domain-api:      Best quality — structured data direct from source APIs
 * - browser:         High quality — full JS rendering captures dynamic content
 * - stealth:         Good quality — same as browser but with anti-bot bypass
 * - cloaked:         Decent quality — heavy stealth, sometimes degrades content
 * - simple:          Moderate — plain HTTP fetch, misses JS-rendered content
 * - search-fallback: Low — cached/snippet data from search engine caches
 */
const ENGINE_DEFAULTS: Record<EngineType, EngineConfig> = {
  'domain-api': {
    type: 'domain-api',
    quality: 95,
    speed: 95,
    cost: 5,
    maxTimeoutMs: 5000,
    features: { javascript: false, antibot: false, screenshots: false, stealth: false },
  },
  'simple': {
    type: 'simple',
    quality: 70,
    speed: 90,
    cost: 10,
    maxTimeoutMs: 8000,
    features: { javascript: false, antibot: false, screenshots: false, stealth: false },
  },
  'browser': {
    type: 'browser',
    quality: 85,
    speed: 40,
    cost: 60,
    maxTimeoutMs: 15000,
    features: { javascript: true, antibot: false, screenshots: true, stealth: false },
  },
  'stealth': {
    type: 'stealth',
    quality: 80,
    speed: 30,
    cost: 80,
    maxTimeoutMs: 20000,
    features: { javascript: true, antibot: true, screenshots: true, stealth: true },
  },
  'cloaked': {
    type: 'cloaked',
    quality: 75,
    speed: 20,
    cost: 90,
    maxTimeoutMs: 25000,
    features: { javascript: true, antibot: true, screenshots: true, stealth: true },
  },
  'search-fallback': {
    type: 'search-fallback',
    quality: 40,
    speed: 50,
    cost: 30,
    maxTimeoutMs: 10000,
    features: { javascript: false, antibot: false, screenshots: false, stealth: false },
  },
};

// ---------------------------------------------------------------------------
// Domain-specific overrides
// ---------------------------------------------------------------------------

/**
 * Domain pattern entry mapping a suffix pattern to engine config overrides.
 * Overrides are partial — only the specified fields are merged onto the base.
 */
interface DomainRule {
  /** Domain suffix to match (e.g. "twitter.com" matches "www.twitter.com"). */
  pattern: string;
  /** Partial engine config overrides keyed by engine type. */
  overrides: Partial<Record<EngineType, Partial<EngineConfig>>>;
}

/**
 * Domain rules that adjust engine scores for known site categories.
 *
 * Patterns use suffix matching: "twitter.com" matches both "twitter.com"
 * and "www.twitter.com" but not "nottwitter.com".
 */
const DOMAIN_RULES: DomainRule[] = [
  // ── Social media: heavy JS, aggressive anti-bot ──────────────────────
  {
    pattern: 'twitter.com',
    overrides: {
      'simple': { quality: 20, speed: 95 },
      'stealth': { quality: 90 },
      'cloaked': { quality: 85 },
      'browser': { quality: 80 },
    },
  },
  {
    pattern: 'x.com',
    overrides: {
      'simple': { quality: 20, speed: 95 },
      'stealth': { quality: 90 },
      'cloaked': { quality: 85 },
      'browser': { quality: 80 },
    },
  },
  {
    pattern: 'instagram.com',
    overrides: {
      'simple': { quality: 15 },
      'stealth': { quality: 90 },
      'cloaked': { quality: 88 },
      'browser': { quality: 75 },
    },
  },
  {
    pattern: 'tiktok.com',
    overrides: {
      'simple': { quality: 15 },
      'stealth': { quality: 90 },
      'cloaked': { quality: 88 },
      'browser': { quality: 70 },
    },
  },
  {
    pattern: 'facebook.com',
    overrides: {
      'simple': { quality: 20 },
      'stealth': { quality: 88 },
      'cloaked': { quality: 85 },
    },
  },
  {
    pattern: 'linkedin.com',
    overrides: {
      'simple': { quality: 25 },
      'stealth': { quality: 88 },
      'browser': { quality: 78 },
    },
  },
  {
    pattern: 'reddit.com',
    overrides: {
      'simple': { quality: 30 },
      'browser': { quality: 88 },
      'stealth': { quality: 85 },
    },
  },
  {
    pattern: 'threads.net',
    overrides: {
      'simple': { quality: 15 },
      'stealth': { quality: 90 },
      'cloaked': { quality: 85 },
    },
  },

  // ── SPA-heavy / JS-rendered sites ────────────────────────────────────
  {
    pattern: 'vercel.app',
    overrides: {
      'browser': { quality: 90 },
      'simple': { quality: 50 },
    },
  },
  {
    pattern: 'netlify.app',
    overrides: {
      'browser': { quality: 90 },
      'simple': { quality: 50 },
    },
  },
  {
    pattern: 'notion.so',
    overrides: {
      'browser': { quality: 92 },
      'simple': { quality: 20 },
    },
  },
  {
    pattern: 'figma.com',
    overrides: {
      'browser': { quality: 90 },
      'simple': { quality: 15 },
    },
  },

  // ── Static / well-structured sites ───────────────────────────────────
  {
    pattern: 'wikipedia.org',
    overrides: {
      'simple': { quality: 92 },
      'browser': { quality: 80, cost: 70 },
    },
  },
  {
    pattern: 'github.com',
    overrides: {
      'simple': { quality: 85 },
      'browser': { quality: 78, cost: 65 },
    },
  },
  {
    pattern: 'stackoverflow.com',
    overrides: {
      'simple': { quality: 88 },
      'browser': { quality: 78 },
    },
  },
  {
    pattern: 'docs.python.org',
    overrides: {
      'simple': { quality: 90 },
    },
  },
  {
    pattern: 'developer.mozilla.org',
    overrides: {
      'simple': { quality: 90 },
    },
  },
  {
    pattern: 'news.ycombinator.com',
    overrides: {
      'simple': { quality: 92 },
      'browser': { quality: 75 },
    },
  },

  // ── Known-blocked / aggressive anti-bot ──────────────────────────────
  {
    pattern: 'zillow.com',
    overrides: {
      'simple': { quality: 10 },
      'browser': { quality: 50 },
      'cloaked': { quality: 90 },
      'stealth': { quality: 85 },
    },
  },
  {
    pattern: 'yelp.com',
    overrides: {
      'simple': { quality: 15 },
      'cloaked': { quality: 88 },
      'stealth': { quality: 82 },
    },
  },
  {
    pattern: 'pinterest.com',
    overrides: {
      'simple': { quality: 15 },
      'cloaked': { quality: 88 },
      'stealth': { quality: 85 },
    },
  },
  {
    pattern: 'ticketmaster.com',
    overrides: {
      'simple': { quality: 10 },
      'cloaked': { quality: 90 },
      'stealth': { quality: 82 },
    },
  },
];

/**
 * Returns domain-specific engine config overrides for a given hostname.
 *
 * Matches against known domain patterns using suffix matching.
 * A pattern "twitter.com" matches hostnames "twitter.com", "www.twitter.com",
 * "mobile.twitter.com", etc.
 *
 * @param hostname - The hostname to look up (e.g. "www.twitter.com")
 * @returns Partial config overrides keyed by engine type, or an empty object
 */
export function getDomainOverrides(
  hostname: string,
): Partial<Record<EngineType, Partial<EngineConfig>>> {
  const lower = hostname.toLowerCase();
  const merged: Partial<Record<EngineType, Partial<EngineConfig>>> = {};

  for (const rule of DOMAIN_RULES) {
    if (lower === rule.pattern || lower.endsWith(`.${rule.pattern}`)) {
      // Merge overrides — last match wins for conflicting fields
      for (const [engineKey, overrideValue] of Object.entries(rule.overrides)) {
        const engine = engineKey as EngineType;
        merged[engine] = { ...merged[engine], ...overrideValue };
      }
    }
  }

  return merged;
}

// ---------------------------------------------------------------------------
// Fallback chain builder
// ---------------------------------------------------------------------------

/**
 * Deep-clones an EngineConfig and merges partial overrides onto it.
 */
function applyOverrides(base: EngineConfig, overrides: Partial<EngineConfig>): EngineConfig {
  return {
    ...base,
    ...overrides,
    features: {
      ...base.features,
      ...(overrides.features ?? {}),
    },
    // Ensure type is always preserved from base
    type: base.type,
  };
}

/**
 * Builds an ordered fallback chain of extraction engines for a given URL.
 *
 * The chain is constructed by:
 * 1. Starting with default engine configurations
 * 2. Applying domain-specific quality/score overrides
 * 3. Filtering engines based on the provided options
 * 4. Sorting by quality descending (ties broken by speed descending)
 *
 * @param url - The target URL to build a fallback chain for
 * @param options - Controls which engines are eligible
 * @returns Ordered array of engine entries, highest quality first
 *
 * @example
 * ```ts
 * // Basic chain for a static site
 * const chain = buildFallbackChain('https://wikipedia.org/wiki/Test');
 * // → [domain-api, simple, browser, stealth, cloaked, search-fallback]
 *
 * // Chain for a social media URL with rendering
 * const chain = buildFallbackChain('https://twitter.com/user', { render: true });
 * // → [domain-api, stealth, cloaked, browser, simple, search-fallback]
 *
 * // No browser rendering, no domain API
 * const chain = buildFallbackChain('https://example.com', {
 *   render: false,
 *   noDomainApi: true,
 * });
 * // → [simple, search-fallback]
 * ```
 */
export function buildFallbackChain(
  url: string,
  options: FallbackChainOptions = {},
): Array<{ engine: EngineType; config: EngineConfig }> {
  const { render, stealth, noDomainApi } = options;

  // 1. Parse hostname for domain overrides
  let hostname = '';
  try {
    hostname = new URL(url).hostname;
  } catch {
    // Invalid URL — proceed with no domain overrides
  }

  const domainOverrides = hostname ? getDomainOverrides(hostname) : {};

  // 2. Build full config for each engine (base + domain overrides)
  const allEngines = Object.keys(ENGINE_DEFAULTS) as EngineType[];
  const configs: Array<{ engine: EngineType; config: EngineConfig }> = allEngines.map(
    (engineType) => {
      const base = { ...ENGINE_DEFAULTS[engineType] };
      const override = domainOverrides[engineType];
      const config = override ? applyOverrides(base, override) : { ...base };
      return { engine: engineType, config };
    },
  );

  // 3. Filter engines based on options
  const filtered = configs.filter(({ engine, config }) => {
    // Remove domain-api if explicitly excluded
    if (noDomainApi && engine === 'domain-api') return false;

    // When render is explicitly false, remove engines that require a browser
    // UNLESS stealth is explicitly requested
    if (render === false) {
      if (config.features.javascript) {
        // Keep stealth/cloaked engines if stealth was explicitly requested
        if (stealth && config.features.stealth) return true;
        return false;
      }
    }

    return true;
  });

  // 4. Sort by quality descending, tie-break by speed descending
  filtered.sort((a, b) => {
    const qualityDiff = b.config.quality - a.config.quality;
    if (qualityDiff !== 0) return qualityDiff;
    return b.config.speed - a.config.speed;
  });

  return filtered;
}

/**
 * Returns the default engine configuration for a given engine type.
 * Useful for inspecting baseline values without domain overrides.
 *
 * @param type - The engine type to look up
 * @returns A copy of the default EngineConfig
 */
export function getEngineDefaults(type: EngineType): EngineConfig {
  return { ...ENGINE_DEFAULTS[type], features: { ...ENGINE_DEFAULTS[type].features } };
}

/**
 * Returns all available engine types.
 */
export function getAvailableEngines(): EngineType[] {
  return Object.keys(ENGINE_DEFAULTS) as EngineType[];
}
