/**
 * Domain safety check using Google Safe Browsing Lookup API v4.
 * Free: 10,000 lookups/day.
 * Falls back to a local blocklist when no API key is configured.
 */

export interface SafeBrowsingResult {
  safe: boolean;
  threats: string[]; // e.g. ['MALWARE', 'SOCIAL_ENGINEERING', 'PHISHING']
  source: 'google-api' | 'local-blocklist' | 'unchecked';
}

// Known brands commonly impersonated in phishing
const KNOWN_BRANDS = [
  'amazon', 'google', 'facebook', 'apple', 'microsoft', 'paypal', 'netflix',
  'instagram', 'twitter', 'linkedin', 'dropbox', 'chase', 'wellsfargo', 'bankofamerica',
  'citibank', 'hsbc', 'ebay', 'walmart', 'target', 'bestbuy', 'fedex', 'ups', 'usps',
  'irs', 'dmv', 'gov', 'yahoo', 'outlook', 'hotmail',
];

// TLDs heavily abused for phishing/malware (free-domain registrars)
const SUSPICIOUS_TLDS = new Set(['.tk', '.ml', '.ga', '.cf', '.gq', '.top', '.click', '.loan', '.win', '.xyz', '.club', '.work']);

// Private/reserved IPv4 ranges (safe for local dev)
const PRIVATE_IP_RANGES = [
  /^127\.\d+\.\d+\.\d+$/,          // loopback
  /^10\.\d+\.\d+\.\d+$/,           // RFC 1918
  /^192\.168\.\d+\.\d+$/,          // RFC 1918
  /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/, // RFC 1918
  /^169\.254\.\d+\.\d+$/,          // link-local
  /^::1$/,                          // IPv6 loopback
  /^fc00:/,                         // IPv6 private
  /^fd[0-9a-f]{2}:/i,              // IPv6 ULA
];

function isPrivateIp(host: string): boolean {
  return PRIVATE_IP_RANGES.some((re) => re.test(host));
}

function isIpAddress(host: string): boolean {
  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  // IPv6 (bare or bracketed)
  if (/^\[?[0-9a-fA-F:]+\]?$/.test(host)) return true;
  return false;
}

/**
 * Local heuristic blocklist — catches common attack patterns without an API key.
 */
function checkLocalBlocklist(url: string): SafeBrowsingResult {
  const threats: string[] = [];

  // 1. Data URIs — always suspicious
  if (/^data:/i.test(url.trim())) {
    threats.push('DATA_URI');
    return { safe: false, threats, source: 'local-blocklist' };
  }

  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    // Unparseable URL — flag as suspicious
    threats.push('INVALID_URL');
    return { safe: false, threats, source: 'local-blocklist' };
  }

  const { hostname, username, password } = parsed;

  // 2. @ sign trick: http://google.com@evil.com/login → username = 'google.com'
  if (username || password) {
    threats.push('URL_CREDENTIALS_TRICK');
    return { safe: false, threats, source: 'local-blocklist' };
  }

  // 3. Punycode homograph attacks (xn-- internationalized domains)
  if (/\bxn--/i.test(hostname)) {
    // Allow legitimate IDN TLDs (e.g. .xn--p1ai = .рф)
    const parts = hostname.split('.');
    const hasPunycodeLabel = parts.slice(0, -1).some((p) => /^xn--/i.test(p));
    if (hasPunycodeLabel) {
      threats.push('PUNYCODE_HOMOGRAPH');
    }
  }

  // 4. IP-only URLs pointing to non-private ranges
  if (isIpAddress(hostname)) {
    const bare = hostname.replace(/^\[|\]$/g, ''); // strip brackets from IPv6
    if (!isPrivateIp(bare)) {
      threats.push('SUSPICIOUS_IP');
    }
    if (threats.length > 0) return { safe: false, threats, source: 'local-blocklist' };
    return { safe: true, threats: [], source: 'local-blocklist' };
  }

  const lowerHost = hostname.toLowerCase();
  // Remove www prefix for analysis
  const hostNoWww = lowerHost.replace(/^www\./, '');
  const parts = hostNoWww.split('.');
  const tld = parts.length >= 2 ? '.' + parts[parts.length - 1] : '';
  const sld = parts.length >= 2 ? parts[parts.length - 2] : '';

  // 5. Known-bad TLDs combined with brand names (amazon-login.tk)
  if (SUSPICIOUS_TLDS.has(tld)) {
    const containsBrand = KNOWN_BRANDS.some((brand) => hostNoWww.includes(brand));
    if (containsBrand) {
      threats.push('PHISHING');
    }
  }

  // 6. Excessive hyphens in SLD (amaz0n-login-verify-account.com)
  const hyphenCount = (sld.match(/-/g) || []).length;
  if (hyphenCount >= 3) {
    threats.push('EXCESSIVE_HYPHENS');
  }

  // 7. Brand name in subdomain combined with suspicious TLD
  if (SUSPICIOUS_TLDS.has(tld)) {
    const subdomains = parts.slice(0, -2).join('.');
    const subHasBrand = KNOWN_BRANDS.some((brand) => subdomains.includes(brand));
    if (subHasBrand && !threats.includes('PHISHING')) {
      threats.push('PHISHING');
    }
  }

  // 8. Excessive subdomains: login.secure.verify.account.bank.xyz.com
  if (parts.length > 5) {
    threats.push('EXCESSIVE_SUBDOMAINS');
  }

  if (threats.length > 0) {
    return { safe: false, threats, source: 'local-blocklist' };
  }

  return { safe: true, threats: [], source: 'local-blocklist' };
}

/**
 * Check a URL against the Google Safe Browsing Lookup API v4.
 * Returns null on any error (network timeout, bad key, etc.) so caller can fall back.
 */
async function checkGoogleSafeBrowsing(
  url: string,
  apiKey: string
): Promise<SafeBrowsingResult | null> {
  const endpoint = `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(apiKey)}`;

  const body = {
    client: { clientId: 'webpeel', clientVersion: '1.0.0' },
    threatInfo: {
      threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
      platformTypes: ['ANY_PLATFORM'],
      threatEntryTypes: ['URL'],
      threatEntries: [{ url }],
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);

  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!resp.ok) return null;

    const data = await resp.json() as { matches?: Array<{ threatType: string }> };

    if (!data.matches || data.matches.length === 0) {
      return { safe: true, threats: [], source: 'google-api' };
    }

    const threats = [...new Set(data.matches.map((m) => m.threatType))];
    return { safe: false, threats, source: 'google-api' };
  } catch {
    clearTimeout(timeoutId);
    return null;
  }
}

/**
 * Check URL safety.
 *
 * Flow:
 * 1. If SAFE_BROWSING_API_KEY (or passed apiKey) is set, race Google API vs 2s timeout.
 *    Falls back to local blocklist on timeout or error.
 * 2. Without an API key, use local heuristic blocklist only.
 *
 * @param url    The URL to check
 * @param apiKey Google Safe Browsing API key (optional). Falls back to SAFE_BROWSING_API_KEY env var.
 */
export async function checkUrlSafety(url: string, apiKey?: string): Promise<SafeBrowsingResult> {
  const key = apiKey ?? process.env.SAFE_BROWSING_API_KEY;

  if (key) {
    // Race: Google API with 2s timeout, fallback to local
    const timeoutResult: SafeBrowsingResult = checkLocalBlocklist(url);
    const googleResult = await Promise.race([
      checkGoogleSafeBrowsing(url, key),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000)),
    ]);

    if (googleResult !== null) return googleResult;
    // API timed out or errored — use local blocklist result
    return timeoutResult;
  }

  // No API key — local blocklist only
  return checkLocalBlocklist(url);
}
