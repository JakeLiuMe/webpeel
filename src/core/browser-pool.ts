/**
 * Browser lifecycle & page pool management.
 * Handles Playwright loading, browser instances, and the idle page pool.
 */

import type { Browser, Page } from 'playwright';
type ChromiumType = typeof import('playwright').chromium;

import { getRealisticUserAgent } from './user-agents.js';
import { startDnsWarmup } from './dns-cache.js';
import { closePool } from './http-fetch.js';

// Re-export closePool so fetcher.ts can barrel it from this module.
export { closePool };

// ── Playwright lazy loading ───────────────────────────────────────────────────

let _chromium: ChromiumType | null = null;
let _stealthChromium: ChromiumType | null = null;

/** Whether Playwright has been loaded (for diagnostics). */
export let playwrightLoaded = false;

async function getPlaywright(): Promise<ChromiumType> {
  if (!_chromium) {
    const pw = await import('playwright');
    _chromium = pw.chromium;
    playwrightLoaded = true;
  }
  return _chromium;
}

async function getStealthPlaywright(): Promise<ChromiumType> {
  if (!_stealthChromium) {
    const pwExtra = await import('playwright-extra');
    const StealthPlugin = (await import('puppeteer-extra-plugin-stealth')).default;
    _stealthChromium = pwExtra.chromium as unknown as ChromiumType;
    (_stealthChromium as any).use(StealthPlugin());
    playwrightLoaded = true;
  }
  return _stealthChromium;
}

// ── User agent & viewport helpers ─────────────────────────────────────────────

/**
 * Returns a realistic Chrome user agent.
 * Delegates to the curated user-agents module so stealth mode never exposes
 * the default "Chrome for Testing" UA which is a reliable bot-detection signal.
 */
export function getRandomUserAgent(): string {
  return getRealisticUserAgent();
}

/**
 * Common Chromium launch arguments for anti-bot-detection.
 * Applied to BOTH regular and stealth browser instances.
 * NOTE: --window-size is intentionally omitted here; it is added dynamically
 * per browser launch using a random realistic viewport (see getRandomViewport()).
 */
export const ANTI_DETECTION_ARGS: readonly string[] = [
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--disable-dev-shm-usage',
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-gpu',
  '--start-maximized',
  // Chrome branding / stealth hardening
  '--disable-features=ChromeUserAgentDataBranding',
  '--disable-component-extensions-with-background-pages',
  '--disable-default-apps',
  '--disable-extensions',
  '--disable-hang-monitor',
  '--disable-popup-blocking',
  '--disable-prompt-on-repost',
  '--disable-sync',
  '--metrics-recording-only',
  '--no-first-run',
];

/**
 * Returns a random realistic viewport weighted by real-world market share.
 * Used to avoid the telltale Playwright default of 1280×720.
 */
export function getRandomViewport(): { width: number; height: number } {
  // Common real-world resolutions weighted by market share
  const viewports = [
    { width: 1920, height: 1080, weight: 35 }, // Full HD
    { width: 1366, height: 768,  weight: 20 }, // Laptop
    { width: 1536, height: 864,  weight: 15 }, // Scaled laptop
    { width: 1440, height: 900,  weight: 10 }, // MacBook
    { width: 1680, height: 1050, weight: 8  }, // Large laptop
    { width: 2560, height: 1440, weight: 7  }, // QHD
    { width: 1280, height: 800,  weight: 5  }, // Older laptop
  ];
  const total = viewports.reduce((s, v) => s + v.weight, 0);
  let r = Math.random() * total;
  for (const v of viewports) {
    r -= v.weight;
    if (r <= 0) return { width: v.width, height: v.height };
  }
  return { width: 1920, height: 1080 };
}

/**
 * Apply stealth init scripts to a page to reduce bot-detection signals:
 * 1. Hides the `window.__pwInitScripts` Playwright leak.
 * 2. Patches `navigator.userAgentData.brands` to include "Google Chrome"
 *    (Chrome for Testing only ships "Chromium" which is a known detection signal).
 */
export async function applyStealthScripts(page: Page): Promise<void> {
  // 1. Hide Playwright's __pwInitScripts marker
  // Uses string form to avoid TypeScript DOM-lib requirements (tsconfig has no DOM lib).
  await page.addInitScript(`
    Object.defineProperty(window, '__pwInitScripts', {
      get: () => undefined,
      set: () => {},
      configurable: true,
    });
  `);

  // 2. Patch userAgentData brands to include "Google Chrome"
  // Chrome for Testing only ships "Chromium" — a well-known bot-detection signal.
  await page.addInitScript(`
    (function () {
      var uad = navigator.userAgentData;
      if (!uad) return;
      var originalBrands = uad.brands || [];
      var hasChromeEntry = originalBrands.some(function(b) { return b.brand === 'Google Chrome'; });
      if (hasChromeEntry) return;

      var chromiumEntry = originalBrands.find(function(b) { return b.brand === 'Chromium'; });
      var version = (chromiumEntry && chromiumEntry.version) || '136';
      var patchedBrands = [
        { brand: 'Chromium', version: version },
        { brand: 'Google Chrome', version: version },
        { brand: 'Not=A?Brand', version: '99' },
      ];

      Object.defineProperty(navigator, 'userAgentData', {
        get: function() {
          return {
            brands: patchedBrands,
            mobile: false,
            platform: uad.platform || 'Windows',
            getHighEntropyValues: uad.getHighEntropyValues ? uad.getHighEntropyValues.bind(uad) : undefined,
            toJSON: function() {
              return {
                brands: patchedBrands,
                mobile: false,
                platform: uad.platform || 'Windows',
              };
            },
          };
        },
        configurable: true,
      });
    })();
  `);
}

// ── Page pool constants & state ───────────────────────────────────────────────

export const MAX_CONCURRENT_PAGES = 5;
export const PAGE_POOL_SIZE = 3;

let sharedBrowser: Browser | null = null;
let sharedStealthBrowser: Browser | null = null;
const pooledPages = new Set<Page>();
const idlePagePool: Page[] = [];
let pagePoolFillPromise: Promise<void> | null = null;

// ── Profile browser instances ─────────────────────────────────────────────────
// Profile browsers are NOT shared — each profileDir gets its own instance.
// These are keyed by profile path and kept alive between fetches in the same process.
const profileBrowsers = new Map<string, Browser>();

// ── Pool helpers ──────────────────────────────────────────────────────────────

export function removePooledPage(page: Page): void {
  pooledPages.delete(page);
  const idleIndex = idlePagePool.indexOf(page);
  if (idleIndex >= 0) {
    idlePagePool.splice(idleIndex, 1);
  }
}

export function takePooledPage(): Page | null {
  while (idlePagePool.length > 0) {
    const page = idlePagePool.shift()!;
    if (page.isClosed()) {
      removePooledPage(page);
      continue;
    }
    return page;
  }

  return null;
}

/** Returns the current number of pooled pages (for size checks in browser-fetch). */
export function getPooledPagesCount(): number {
  return pooledPages.size;
}

export async function ensurePagePool(browser?: Browser): Promise<void> {
  const activeBrowser = browser ?? sharedBrowser;
  if (!activeBrowser || !activeBrowser.isConnected()) {
    return;
  }

  if (pagePoolFillPromise) {
    await pagePoolFillPromise;
    return;
  }

  pagePoolFillPromise = (async () => {
    while (pooledPages.size < PAGE_POOL_SIZE) {
      const pooledPage = await activeBrowser.newPage({
        userAgent: getRandomUserAgent(),
        viewport: null, // Use browser window size (set via --window-size at launch)
      });
      await applyStealthScripts(pooledPage);
      pooledPages.add(pooledPage);
      idlePagePool.push(pooledPage);
    }
  })().finally(() => {
    pagePoolFillPromise = null;
  });

  await pagePoolFillPromise;
}

export async function recyclePooledPage(page: Page): Promise<void> {
  if (!pooledPages.has(page)) {
    await page.close().catch(() => {});
    return;
  }

  if (page.isClosed()) {
    removePooledPage(page);
    if (sharedBrowser?.isConnected()) {
      void ensurePagePool(sharedBrowser).catch(() => {});
    }
    return;
  }

  try {
    await page.unroute('**/*').catch(() => {});
    await page.context().clearCookies().catch(() => {});
    await page.setExtraHTTPHeaders({});
    await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: 5000 }).catch(() => {});

    if (!idlePagePool.includes(page)) {
      idlePagePool.push(page);
    }
  } catch (e) {
    // Non-fatal: page reset failed, removing from pool and closing
    if (process.env.DEBUG) console.debug('[webpeel]', 'page reset failed:', e instanceof Error ? e.message : e);
    removePooledPage(page);
    await page.close().catch(() => {});
  }

  if (sharedBrowser?.isConnected() && pooledPages.size < PAGE_POOL_SIZE) {
    void ensurePagePool(sharedBrowser).catch(() => {});
  }
}

// ── Browser getters ───────────────────────────────────────────────────────────

export async function getBrowser(): Promise<Browser> {
  // SECURITY: Check if browser is still connected and healthy
  if (sharedBrowser) {
    try {
      if (sharedBrowser.isConnected()) {
        if (pooledPages.size < PAGE_POOL_SIZE) {
          void ensurePagePool(sharedBrowser).catch(() => {});
        }
        return sharedBrowser;
      }
    } catch (e) {
      // Browser is dead, recreate
      if (process.env.DEBUG) console.debug('[webpeel]', 'shared browser health check failed, recreating:', e instanceof Error ? e.message : e);
      sharedBrowser = null;
    }
  }

  pooledPages.clear();
  idlePagePool.length = 0;
  pagePoolFillPromise = null;

  const vp = getRandomViewport();
  const pw = await getPlaywright();
  sharedBrowser = await pw.launch({
    headless: true,
    args: [...ANTI_DETECTION_ARGS, `--window-size=${vp.width},${vp.height}`],
  });
  void ensurePagePool(sharedBrowser).catch(() => {});
  return sharedBrowser;
}

export async function getStealthBrowser(): Promise<Browser> {
  // SECURITY: Check if stealth browser is still connected and healthy
  if (sharedStealthBrowser) {
    try {
      if (sharedStealthBrowser.isConnected()) {
        return sharedStealthBrowser;
      }
    } catch (e) {
      // Browser is dead, recreate
      if (process.env.DEBUG) console.debug('[webpeel]', 'stealth browser health check failed, recreating:', e instanceof Error ? e.message : e);
      sharedStealthBrowser = null;
    }
  }

  const stealthVp = getRandomViewport();
  const stealthPw = await getStealthPlaywright();
  const stealthBrowser = await stealthPw.launch({
    headless: true,
    args: [...ANTI_DETECTION_ARGS, `--window-size=${stealthVp.width},${stealthVp.height}`],
  });
  if (!stealthBrowser) throw new Error('Failed to launch stealth browser');
  sharedStealthBrowser = stealthBrowser;
  return stealthBrowser;
}

/**
 * Get or create a browser instance with a persistent user data directory.
 * Profile browsers bypass the shared browser pool so cookies/sessions survive
 * between fetch calls.
 *
 * @param profileDir Absolute path to the Chrome user-data-dir directory
 * @param headed     Whether to launch in headed (visible) mode
 * @param stealth    Whether to use playwright-extra stealth instead of plain chromium
 */
export async function getProfileBrowser(
  profileDir: string,
  headed: boolean = false,
  stealth: boolean = false,
): Promise<Browser> {
  const existing = profileBrowsers.get(profileDir);
  if (existing) {
    try {
      if (existing.isConnected()) return existing;
    } catch (e) {
      // Profile browser is dead, recreate
      if (process.env.DEBUG) console.debug('[webpeel]', 'profile browser health check failed, recreating:', e instanceof Error ? e.message : e);
    }
    profileBrowsers.delete(profileDir);
  }

  const profileVp = getRandomViewport();
  const launchOptions = {
    headless: !headed,
    args: [
      ...ANTI_DETECTION_ARGS,
      `--window-size=${profileVp.width},${profileVp.height}`,
      `--user-data-dir=${profileDir}`,
    ],
  };

  const launched = stealth
    ? await (await getStealthPlaywright()).launch(launchOptions)
    : await (await getPlaywright()).launch(launchOptions);
  if (!launched) throw new Error('Failed to launch profile browser');

  profileBrowsers.set(profileDir, launched);
  return launched;
}

// ── Warmup ────────────────────────────────────────────────────────────────────

export async function warmup(): Promise<void> {
  startDnsWarmup();
  const browser = await getBrowser();
  await ensurePagePool(browser);
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

/**
 * Clean up browser resources (shared pool, stealth browser, and all profile browsers).
 */
export async function cleanup(): Promise<void> {
  const pagesToClose = Array.from(pooledPages);
  pooledPages.clear();
  idlePagePool.length = 0;
  pagePoolFillPromise = null;

  await Promise.all(pagesToClose.map((page) => page.close().catch(() => {})));

  if (sharedBrowser) {
    await sharedBrowser.close();
    sharedBrowser = null;
  }
  if (sharedStealthBrowser) {
    await sharedStealthBrowser.close();
    sharedStealthBrowser = null;
  }

  // Close all persistent profile browsers
  const profileBrowserList = Array.from(profileBrowsers.values());
  profileBrowsers.clear();
  await Promise.all(profileBrowserList.map(b => b.close().catch(() => {})));

  await closePool().catch(() => {});
}

/**
 * Close a specific persistent profile browser (e.g. when done with a session).
 * Safe to call even if the browser has already been closed.
 *
 * @param profileDir Path to the profile directory used when launching
 */
export async function closeProfileBrowser(profileDir: string): Promise<void> {
  const browser = profileBrowsers.get(profileDir);
  if (browser) {
    profileBrowsers.delete(profileDir);
    await browser.close().catch(() => {});
  }
}
