/**
 * Realistic User Agent Rotation for WebPeel
 *
 * Provides a curated list of real-world Chrome user agents (120-130 range)
 * across Windows and macOS platforms. Used when stealth mode is active and
 * no custom UA is set — prevents the default "Chrome for Testing" UA which
 * is an instant bot-detection signal.
 */

// ── Curated UA lists ──────────────────────────────────────────────────────────

const WINDOWS_UAS: readonly string[] = [
  // Chrome 120
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  // Chrome 121
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  // Chrome 122
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  // Chrome 124
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  // Chrome 125
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  // Chrome 126
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  // Chrome 128
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  // Chrome 129
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  // Chrome 130
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
];

const MAC_UAS: readonly string[] = [
  // Chrome 120 macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  // Chrome 122 macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  // Chrome 124 macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  // Chrome 126 macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  // Chrome 128 macOS (arm64)
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  // Chrome 130 macOS
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
];

const LINUX_UAS: readonly string[] = [
  // Chrome 120 Linux
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  // Chrome 124 Linux
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  // Chrome 128 Linux
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  // Chrome 130 Linux
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
];

/** All UAs combined (fallback when no platform is specified) */
const ALL_UAS: readonly string[] = [...WINDOWS_UAS, ...MAC_UAS, ...LINUX_UAS];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Returns a realistic, recent Chrome user agent string.
 * Randomly picks from a curated list of real-world UAs (Chrome 120-130 range).
 *
 * @param platform - Optionally restrict to a specific OS platform.
 *                   When omitted, picks from all platforms (weighted: ~55% Windows, ~35% Mac, ~10% Linux).
 *
 * @example
 * ```ts
 * // Random platform
 * const ua = getRealisticUserAgent();
 *
 * // Force Windows UA (e.g. for LinkedIn, which is more common on Windows)
 * const ua = getRealisticUserAgent('windows');
 * ```
 */
export function getRealisticUserAgent(platform?: 'windows' | 'mac' | 'linux'): string {
  let pool: readonly string[];

  if (platform === 'windows') {
    pool = WINDOWS_UAS;
  } else if (platform === 'mac') {
    pool = MAC_UAS;
  } else if (platform === 'linux') {
    pool = LINUX_UAS;
  } else {
    // Weighted random: Windows ~55%, Mac ~35%, Linux ~10%
    const roll = Math.random();
    if (roll < 0.55) {
      pool = WINDOWS_UAS;
    } else if (roll < 0.90) {
      pool = MAC_UAS;
    } else {
      pool = LINUX_UAS;
    }
  }

  const idx = Math.floor(Math.random() * pool.length);
  return pool[idx]!;
}

/**
 * Returns a random UA from the full list (all platforms).
 * Equivalent to `getRealisticUserAgent()` with no arguments.
 */
export function getRandomUA(): string {
  const idx = Math.floor(Math.random() * ALL_UAS.length);
  return ALL_UAS[idx]!;
}

/**
 * The full curated list of realistic user agents.
 * Exported for inspection / testing.
 */
export const REALISTIC_USER_AGENTS: readonly string[] = ALL_UAS;
