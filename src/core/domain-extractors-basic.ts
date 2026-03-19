/**
 * Domain extraction types and basic stub.
 *
 * Types are defined HERE (always available) so nothing depends
 * on the proprietary domain-extractors.ts TypeScript source.
 * The compiled domain-extractors.js ships in npm and is loaded at runtime.
 */

/** Structured result from a domain-specific extractor */
export interface DomainExtractResult {
  /** Canonical domain name (e.g. 'twitter.com') */
  domain: string;
  /** Page type within the domain (e.g. 'tweet', 'thread', 'repo', 'issue') */
  type: string;
  /** Domain-specific structured data */
  structured: Record<string, any>;
  /** Clean markdown representation of the content */
  cleanContent: string;
  /** Raw HTML size in characters (from the actual HTML page fetched by the extractor) */
  rawHtmlSize?: number;
}

/** An extractor receives the raw HTML and original URL, may make API calls. */
export type DomainExtractor = (
  html: string,
  url: string,
) => Promise<DomainExtractResult | null>;

/**
 * Basic domain data extractor — free tier stub.
 *
 * Always returns null (delegates all extraction to the normal pipeline).
 * Premium servers override this via the `extractDomainData` strategy hook.
 */
export async function extractDomainDataBasic(
  _html: string,
  _url: string,
): Promise<DomainExtractResult | null> {
  // Basic (free) tier: no domain-specific extraction.
  // The normal fetch + markdown pipeline handles everything.
  // Premium hook provides 55+ domain extractors (Twitter, Reddit, GitHub, HN, etc.)
  return null;
}

/**
 * Basic domain extractor lookup — free tier stub.
 *
 * Always returns null (no domain is recognized in basic mode).
 * Premium servers override this via the `getDomainExtractor` strategy hook.
 */
export function getDomainExtractorBasic(
  _url: string,
): ((html: string, url: string) => Promise<DomainExtractResult | null>) | null {
  return null;
}
