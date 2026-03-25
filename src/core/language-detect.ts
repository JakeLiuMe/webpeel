/**
 * Lightweight language detection from URL hostname TLD.
 * No external dependencies — pure TLD → language mapping.
 */

/** Map of country-code TLDs to primary BCP-47 language tags */
const TLD_TO_LANGUAGE: Record<string, string> = {
  jp: 'ja',
  cn: 'zh',
  de: 'de',
  fr: 'fr',
  kr: 'ko',
  br: 'pt',
  ru: 'ru',
  es: 'es',
  it: 'it',
  nl: 'nl',
  se: 'sv',
  tw: 'zh-TW',
  th: 'th',
  vn: 'vi',
  pl: 'pl',
  in: 'hi',
  id: 'id',
  ar: 'es',  // Argentina (.ar) — Spanish, not Arabic
  // Additional common ccTLDs
  pt: 'pt',
  mx: 'es',
  be: 'nl',        // Belgium — defaults to Dutch; French also common
  ch: 'de',        // Switzerland — German most common
  at: 'de',        // Austria
  dk: 'da',        // Denmark
  fi: 'fi',        // Finland
  no: 'nb',        // Norway
  hu: 'hu',        // Hungary
  cz: 'cs',        // Czech Republic
  sk: 'sk',        // Slovakia
  ro: 'ro',        // Romania
  bg: 'bg',        // Bulgaria
  hr: 'hr',        // Croatia
  gr: 'el',        // Greece
  tr: 'tr',        // Turkey
  ua: 'uk',        // Ukraine
  il: 'he',        // Israel
  sa: 'ar',        // Saudi Arabia
  ae: 'ar',        // UAE
  eg: 'ar',        // Egypt
};

/**
 * Detect the primary language from a URL based on the hostname TLD.
 * Returns a BCP-47 language tag (e.g. 'ja', 'zh-TW') or null if unknown.
 *
 * Handles:
 * - Simple ccTLDs: example.jp → 'ja'
 * - Second-level ccTLDs: example.co.jp → 'ja'
 * - No match for generic TLDs (.com, .org, .net, etc.): returns null
 *
 * @param url - The full URL string
 * @returns BCP-47 language tag or null
 */
export function detectLanguageFromUrl(url: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }

  // Remove www. and other common prefixes
  hostname = hostname.replace(/^www\./, '');

  // Split into parts: ['example', 'co', 'jp'] or ['tabelog', 'com']
  const parts = hostname.split('.');
  if (parts.length < 2) return null;

  const tld = parts[parts.length - 1];

  // Check last part first (e.g., .jp, .fr)
  if (TLD_TO_LANGUAGE[tld]) {
    return TLD_TO_LANGUAGE[tld];
  }

  // For second-level domains like .co.jp, .com.br, check second-to-last too
  // e.g., parts = ['example', 'co', 'jp'] → also already handled above
  // This is already covered by checking the TLD (last part)

  return null;
}

/**
 * Build an Accept-Language header value from a list of language preferences.
 * Adds quality weights (q=0.9, q=0.8, etc.) for secondary languages.
 *
 * @param languages - Array of BCP-47 language tags (e.g. ['ja', 'en'])
 * @returns Accept-Language header string
 */
/** Map bare language codes to their most common region for Accept-Language headers */
const LANG_TO_REGION: Record<string, string> = {
  ja: 'JP', zh: 'CN', ko: 'KR', en: 'US', de: 'DE', fr: 'FR',
  es: 'ES', pt: 'BR', ru: 'RU', it: 'IT', nl: 'NL', sv: 'SE',
  da: 'DK', nb: 'NO', fi: 'FI', pl: 'PL', cs: 'CZ', hu: 'HU',
  ro: 'RO', bg: 'BG', hr: 'HR', el: 'GR', tr: 'TR', uk: 'UA',
  he: 'IL', ar: 'SA', th: 'TH', vi: 'VN', id: 'ID', hi: 'IN',
  sk: 'SK',
};

export function buildAcceptLanguageHeader(languages: string[]): string {
  if (!languages || languages.length === 0) return 'en-US,en;q=0.9';

  const parts: string[] = [];
  for (let i = 0; i < languages.length; i++) {
    const lang = languages[i];
    if (i === 0) {
      // Primary language — no quality weight needed (implicitly q=1.0)
      // Add region variant if it's a bare language code
      if (!lang.includes('-') && lang.length === 2) {
        const region = LANG_TO_REGION[lang] || lang.toUpperCase();
        parts.push(`${lang}-${region}`);
        parts.push(`${lang};q=0.9`);
      } else {
        parts.push(lang);
        // Add bare language code as fallback
        const bare = lang.split('-')[0];
        if (bare !== lang) parts.push(`${bare};q=0.9`);
      }
    } else {
      // Secondary languages get decreasing quality weights
      const q = Math.max(0.1, 0.8 - (i - 1) * 0.1);
      parts.push(`${lang};q=${q.toFixed(1)}`);
    }
  }

  // Always add English as fallback unless already included
  const hasEnglish = languages.some(l => l.startsWith('en'));
  if (!hasEnglish) {
    const q = Math.max(0.1, 0.8 - (languages.length - 1) * 0.1);
    parts.push(`en;q=${q.toFixed(1)}`);
  }

  return parts.join(',');
}
