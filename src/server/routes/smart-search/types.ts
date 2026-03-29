export interface SearchIntent {
  type: 'cars' | 'flights' | 'hotels' | 'rental' | 'restaurants' | 'products' | 'general';
  query: string;
  params: Record<string, string>;
  /** Suggested domain sources for this intent — hints for result boosting, not filtering */
  suggestedDomains?: string[];
}

// ── Transactional Verdict Contract ─────────────────────────────────────────
// Machine-friendly top-level verdict for transactional queries (transit, gas,
// travel, equipment rental, etc.).  The UI can render this directly without
// parsing markdown blobs.

export interface VerdictOption {
  provider: string;
  price: number;
  currency: string;
  route?: string;
  url: string;
  notes?: string;
}

export interface TransactionalVerdict {
  /** Vertical / category — e.g. 'transit', 'gas', 'travel', 'equipment_rental' */
  vertical: string;
  /** Human-readable headline — e.g. "Cheapest I found is $19.00 on FlixBus for New York → Boston" */
  headline: string;
  /** How confident we are in the data (mirrors existing confidence field) */
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  /** Best option found across all sources */
  bestOption: VerdictOption;
  /** Other options found, sorted cheapest-first */
  alternatives: VerdictOption[];
  /** Aggregate totals when applicable (round-trip, etc.) */
  totals?: {
    oneWayLowest?: number;
    returnLowest?: number;
    roundTripLowest?: number;
    currency: string;
  };
  /** Caveats/disclaimers about the data */
  caveats: string[];
  /** Parsed query parameters (origin, destination, dates, etc.) */
  query?: {
    origin?: string;
    destination?: string;
    departDate?: string;
    returnDate?: string;
    isRoundTrip?: boolean;
    mode?: string;
  };
}

export interface SmartSearchResult {
  type: 'cars' | 'flights' | 'hotels' | 'rental' | 'restaurants' | 'products' | 'general';
  source: string;
  sourceUrl: string;
  content: string;
  title?: string;
  domainData?: any;
  structured?: any;
  results?: any[];
  tokens: number;
  fetchTimeMs: number;
  loadingMessage?: string;
  answer?: string;
  confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  sources?: Array<{ title: string; url: string; domain: string }>;
  timing?: { searchMs: number; peelMs: number; llmMs: number };
  mapUrl?: string;
  safety?: {
    verified: boolean;
    promptInjectionsBlocked: number;
    maliciousPatternsStripped: number;
    sourcesChecked: number;
  };
  /** Suggested authoritative domains for this query (financial → reuters, etc.) */
  suggestedDomains?: string[];
  /** Structured verdict for transactional queries (transit, gas, travel, etc.) */
  verdict?: TransactionalVerdict;
}
