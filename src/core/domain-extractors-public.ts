/**
 * Public re-exports for domain extraction functions.
 *
 * This module is always available (npm + repo + server).
 * It lazy-loads the full domain-extractors.js (compiled, ships in npm).
 * If compiled JS is missing (bare repo clone), returns null gracefully.
 *
 * TypeScript source for domain-extractors is .gitignore'd (not on GitHub).
 */

import type { DomainExtractResult } from './domain-extractors-basic.js';

let _loaded = false;
let _getDomainExtractor: ((url: string) => any) | null = null;
let _extractDomainData: ((html: string, url: string) => Promise<DomainExtractResult | null>) | null = null;

async function load(): Promise<void> {
  if (_loaded) return;
  _loaded = true;
  try {
    const mod = await import('./domain-extractors.js');
    _getDomainExtractor = mod.getDomainExtractor;
    _extractDomainData = mod.extractDomainData;
  } catch {
    // Compiled JS not available (bare repo clone)
  }
}

// Start loading immediately
load();

/**
 * Check if a URL has a domain-specific extractor.
 * Returns the extractor function or null.
 */
export function getDomainExtractor(url: string): any {
  return _getDomainExtractor ? _getDomainExtractor(url) : null;
}

/**
 * Run domain-specific extraction on HTML content.
 * Returns structured domain data or null.
 */
export async function extractDomainData(html: string, url: string): Promise<DomainExtractResult | null> {
  await load();
  return _extractDomainData ? _extractDomainData(html, url) : null;
}
