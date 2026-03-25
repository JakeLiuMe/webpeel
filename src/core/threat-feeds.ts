/**
 * Community threat intelligence feeds — cached in-memory, refreshed every 6 hours.
 *
 * Sources (all free, no API key):
 * - URLhaus (abuse.ch): ~150K active malware distribution URLs
 *   API: https://urlhaus-api.abuse.ch/v1/url/ (POST with url=<url>)
 * - PhishTank: community-verified phishing URLs
 *   API: https://checkurl.phishtank.com/checkurl/ (POST with url=<url>&format=json)
 * - OpenPhish: curated phishing feed
 *   Feed: https://openphish.com/feed.txt (plain text, one URL per line, ~5K URLs)
 *
 * Strategy:
 * - On startup, fetch OpenPhish feed into a Set (small, fast lookup)
 * - For URLhaus and PhishTank, do real-time API lookups with 2s timeout
 * - Cache results for 1 hour to avoid hammering APIs
 */

export interface ThreatFeedResult {
  safe: boolean;
  threats: string[];  // e.g. ['URLHAUS_MALWARE', 'PHISHTANK_PHISHING']
  source: 'urlhaus' | 'phishtank' | 'openphish' | 'none';
  details?: string;   // e.g. "URLhaus: malware_download, tags: emotet"
}

// Cache for URL lookups (avoid re-checking same URL)
const resultCache = new Map<string, { result: ThreatFeedResult; expires: number }>();
const CACHE_TTL = 3600_000; // 1 hour

// OpenPhish feed (loaded once, refreshed every 6h)
let openPhishSet: Set<string> | null = null;
let openPhishLastFetch = 0;
const OPENPHISH_REFRESH = 6 * 3600_000;

async function loadOpenPhishFeed(): Promise<Set<string>> {
  if (openPhishSet && Date.now() - openPhishLastFetch < OPENPHISH_REFRESH) {
    return openPhishSet;
  }
  try {
    const res = await fetch('https://openphish.com/feed.txt', {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const text = await res.text();
      openPhishSet = new Set(text.split('\n').filter(Boolean).map(u => u.trim().toLowerCase()));
      openPhishLastFetch = Date.now();
    }
  } catch { /* silent — feed optional */ }
  return openPhishSet ?? new Set();
}

export async function checkThreatFeeds(url: string): Promise<ThreatFeedResult> {
  // Check cache first
  const normalizedUrl = url.toLowerCase();
  const cached = resultCache.get(normalizedUrl);
  if (cached && cached.expires > Date.now()) return cached.result;

  const threats: string[] = [];
  let details: string | undefined;
  let source: ThreatFeedResult['source'] = 'none';

  // 1. OpenPhish (local Set lookup — instant)
  const phishSet = await loadOpenPhishFeed();
  if (phishSet.has(normalizedUrl)) {
    threats.push('OPENPHISH_PHISHING');
    source = 'openphish';
  }

  // 2. URLhaus API (2s timeout)
  try {
    const res = await fetch('https://urlhaus-api.abuse.ch/v1/url/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `url=${encodeURIComponent(url)}`,
      signal: AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const data = await res.json() as {
        query_status?: string;
        threat?: string;
        tags?: string[];
      };
      if (data.query_status === 'listed') {
        threats.push('URLHAUS_MALWARE');
        source = 'urlhaus';
        details = `URLhaus: ${data.threat || 'malware'}, tags: ${(data.tags || []).join(', ') || 'none'}`;
      }
    }
  } catch { /* timeout or network error — skip silently */ }

  // 3. PhishTank API (2s timeout) — only if not already flagged
  if (threats.length === 0) {
    try {
      const res = await fetch('https://checkurl.phishtank.com/checkurl/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `url=${encodeURIComponent(url)}&format=json&app_key=`,
        signal: AbortSignal.timeout(2000),
      });
      if (res.ok) {
        const data = await res.json() as {
          results?: {
            in_database?: boolean;
            verified?: string;
            valid?: string;
          };
        };
        if (
          data.results?.in_database &&
          data.results?.verified === 'yes' &&
          data.results?.valid === 'yes'
        ) {
          threats.push('PHISHTANK_PHISHING');
          source = 'phishtank';
        }
      }
    } catch { /* timeout — skip */ }
  }

  const result: ThreatFeedResult = {
    safe: threats.length === 0,
    threats,
    source,
    details,
  };

  // Cache the result
  resultCache.set(normalizedUrl, { result, expires: Date.now() + CACHE_TTL });
  return result;
}
