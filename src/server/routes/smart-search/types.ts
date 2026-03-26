export interface SearchIntent {
  type: 'cars' | 'flights' | 'hotels' | 'rental' | 'restaurants' | 'products' | 'general';
  query: string;
  params: Record<string, string>;
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
  sources?: Array<{ title: string; url: string; domain: string }>;
  timing?: { searchMs: number; peelMs: number; llmMs: number };
  mapUrl?: string;
}
