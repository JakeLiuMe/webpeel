/**
 * Human Behavior Engine for WebPeel
 *
 * Simulates realistic human interaction patterns to avoid bot detection.
 * All functions introduce natural variance and imperfection that mirrors
 * how real users actually interact with web pages.
 *
 * Key techniques:
 * - Gaussian-distributed delays (not flat uniform random)
 * - Bézier curve mouse movement (not teleport or linear)
 * - Realistic typing with occasional typo+correction
 * - Variable scroll speed with pauses
 * - Site-specific warmup sequences
 */

import type { Page } from 'playwright';

// ── Configuration ─────────────────────────────────────────────────────────────

export interface HumanConfig {
  /** Typing speed range in ms per character. Default: [45, 120] */
  typingSpeed?: [number, number];
  /** Chance of a typo + correction per character (0-1). Default: 0.03 */
  typoChance?: number;
  /** Mouse movement speed factor (1 = normal, 0.5 = slow, 2 = fast). Default: 1 */
  mouseSpeed?: number;
  /** Minimum think time before actions in ms. Default: 500 */
  minThinkTime?: number;
  /** Maximum think time before actions in ms. Default: 3000 */
  maxThinkTime?: number;
}

const DEFAULT_CONFIG: Required<HumanConfig> = {
  typingSpeed: [45, 120],
  typoChance: 0.03,
  mouseSpeed: 1,
  minThinkTime: 500,
  maxThinkTime: 3000,
};

function mergeConfig(config?: HumanConfig): Required<HumanConfig> {
  return { ...DEFAULT_CONFIG, ...config };
}

// ── Core Utilities ────────────────────────────────────────────────────────────

/**
 * Random number between min and max (inclusive, uniform distribution).
 */
function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Gaussian-distributed random number using Box-Muller transform.
 * More natural than uniform distribution for human timing simulation.
 */
function gaussianRand(mean: number, stddev: number): number {
  // Box-Muller transform
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const normal = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + stddev * normal;
}

/**
 * Delay with gaussian-distributed timing centered between minMs and maxMs.
 * Clamps to [minMs, maxMs] so the result is always in-range.
 */
export async function humanDelay(minMs: number, maxMs: number): Promise<void> {
  const mean = (minMs + maxMs) / 2;
  const stddev = (maxMs - minMs) / 6; // 99.7% of values within [min, max]
  const delay = Math.max(minMs, Math.min(maxMs, gaussianRand(mean, stddev)));
  await new Promise<void>(resolve => setTimeout(resolve, Math.round(delay)));
}

// ── QWERTY keyboard neighbor map ──────────────────────────────────────────────

/**
 * Adjacent keys on a QWERTY layout for realistic typo simulation.
 * Only lowercase letters and common punctuation are mapped.
 */
const KEYBOARD_NEIGHBORS: Record<string, string[]> = {
  'a': ['s', 'q', 'w', 'z'],
  'b': ['v', 'g', 'h', 'n'],
  'c': ['x', 'd', 'f', 'v'],
  'd': ['s', 'e', 'r', 'f', 'c', 'x'],
  'e': ['w', 's', 'd', 'r'],
  'f': ['d', 'r', 't', 'g', 'v', 'c'],
  'g': ['f', 't', 'y', 'h', 'b', 'v'],
  'h': ['g', 'y', 'u', 'j', 'n', 'b'],
  'i': ['u', 'o', 'k', 'j'],
  'j': ['h', 'u', 'i', 'k', 'm', 'n'],
  'k': ['j', 'i', 'o', 'l', 'm'],
  'l': ['k', 'o', 'p', ';'],
  'm': ['n', 'j', 'k', ','],
  'n': ['b', 'h', 'j', 'm'],
  'o': ['i', 'p', 'l', 'k'],
  'p': ['o', 'l', ';', '['],
  'q': ['w', 'a'],
  'r': ['e', 'd', 'f', 't'],
  's': ['a', 'w', 'e', 'd', 'x', 'z'],
  't': ['r', 'f', 'g', 'y'],
  'u': ['y', 'h', 'j', 'i'],
  'v': ['c', 'f', 'g', 'b'],
  'w': ['q', 'a', 's', 'e'],
  'x': ['z', 's', 'd', 'c'],
  'y': ['t', 'g', 'h', 'u'],
  'z': ['a', 's', 'x'],
  '0': ['9', '-', 'o', 'p'],
  '1': ['2', 'q'],
  '2': ['1', '3', 'w', 'q'],
  '3': ['2', '4', 'e', 'w'],
  '4': ['3', '5', 'r', 'e'],
  '5': ['4', '6', 't', 'r'],
  '6': ['5', '7', 'y', 't'],
  '7': ['6', '8', 'u', 'y'],
  '8': ['7', '9', 'i', 'u'],
  '9': ['8', '0', 'o', 'i'],
  '.': [',', '/', 'l'],
  ',': ['m', '.', 'k', 'l'],
  '-': ['0', '=', 'p', '['],
  ';': ['l', 'p', "'", '/'],
};

/**
 * Returns a random adjacent key for typo simulation.
 * Falls back to a random letter if the char has no mapping.
 */
function nearbyKey(char: string): string {
  const lower = char.toLowerCase();
  const neighbors = KEYBOARD_NEIGHBORS[lower];
  if (neighbors && neighbors.length > 0) {
    return neighbors[Math.floor(Math.random() * neighbors.length)]!;
  }
  // Fallback: random lowercase letter
  return String.fromCharCode(97 + Math.floor(Math.random() * 26));
}

// ── Bézier curve mouse movement ───────────────────────────────────────────────

/**
 * Calculate a point on a cubic Bézier curve at parameter t (0-1).
 */
function bezierPoint(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/** Tracks the last known mouse position across calls */
let lastMouseX = 0;
let lastMouseY = 0;

/**
 * Move mouse along a cubic Bézier curve from current position to (targetX, targetY).
 * Generates 15-30 intermediate points with variable speed for natural movement.
 */
async function moveMouse(
  page: Page,
  targetX: number,
  targetY: number,
  speedFactor: number = 1,
): Promise<void> {
  const startX = lastMouseX;
  const startY = lastMouseY;

  // Generate two random control points that create a natural arc
  const midX = (startX + targetX) / 2;
  const midY = (startY + targetY) / 2;

  const spread = Math.max(50, Math.sqrt((targetX - startX) ** 2 + (targetY - startY) ** 2) * 0.3);

  const cp1x = midX + rand(-spread, spread);
  const cp1y = midY + rand(-spread, spread);
  const cp2x = midX + rand(-spread, spread);
  const cp2y = midY + rand(-spread, spread);

  // Number of steps scales with distance — more steps = smoother curve
  const distance = Math.sqrt((targetX - startX) ** 2 + (targetY - startY) ** 2);
  const steps = Math.round(rand(15, 30) * Math.min(1, distance / 300));
  const effectiveSteps = Math.max(8, steps);

  for (let i = 1; i <= effectiveSteps; i++) {
    const t = i / effectiveSteps;

    // Add slight jitter to simulate hand tremor (very small)
    const jitter = 1.5;
    const x = bezierPoint(t, startX, cp1x, cp2x, targetX) + rand(-jitter, jitter);
    const y = bezierPoint(t, startY, cp1y, cp2y, targetY) + rand(-jitter, jitter);

    await page.mouse.move(Math.round(x), Math.round(y));

    // Variable speed: slower near start/end, faster in the middle (ease-in-out)
    const ease = Math.sin(t * Math.PI); // 0 → 1 → 0 across the curve
    const baseDelay = rand(8, 25) / speedFactor;
    const stepDelay = baseDelay * (1 - ease * 0.5); // 50% faster at peak speed
    await new Promise<void>(resolve => setTimeout(resolve, Math.round(stepDelay)));
  }

  lastMouseX = targetX;
  lastMouseY = targetY;
}

// ── Typing ────────────────────────────────────────────────────────────────────

/**
 * Type text with human-like timing and occasional typos.
 *
 * Behavior:
 * - Each character has a gaussian-distributed delay based on typingSpeed config
 * - Speed varies: faster mid-word, slower at word boundaries
 * - Occasionally pauses 200-500ms (simulating thinking/reading ahead)
 * - Rarely makes a typo, notices it (100-300ms), backspaces, then corrects
 *
 * @param page     Playwright page
 * @param selector CSS selector for the input element
 * @param text     Text to type
 * @param config   Optional human behavior config overrides
 */
export async function humanType(
  page: Page,
  selector: string,
  text: string,
  config?: HumanConfig,
): Promise<void> {
  const cfg = mergeConfig(config);
  const [minSpeed, maxSpeed] = cfg.typingSpeed;

  // Click the element first to focus it
  await page.click(selector);
  await humanDelay(80, 200);

  let typoInserted = false;
  const typoTargetIdx = Math.random() < cfg.typoChance
    ? Math.floor(rand(2, text.length - 2))
    : -1;

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;

    // Word boundary: slower at spaces and punctuation
    const isWordBoundary = char === ' ' || char === '.' || char === ',' || char === '!' || char === '?';
    const speedMultiplier = isWordBoundary ? 1.4 : 1.0;

    // Gaussian delay for this character
    const charDelay = gaussianRand(
      (minSpeed + maxSpeed) / 2,
      (maxSpeed - minSpeed) / 4,
    ) * speedMultiplier;
    const clampedDelay = Math.max(minSpeed * 0.5, Math.min(maxSpeed * 2, charDelay));

    await new Promise<void>(resolve => setTimeout(resolve, Math.round(clampedDelay)));

    // Occasional thinking pause (after spaces or at natural breakpoints)
    if (char === ' ' && Math.random() < 0.07) {
      await humanDelay(200, 500);
    }

    // Typo simulation: insert a wrong character then correct it
    if (!typoInserted && i === typoTargetIdx && text.length > 4) {
      typoInserted = true;

      // Type the wrong character
      const wrongChar = nearbyKey(char);
      await page.keyboard.type(wrongChar);

      // Pause — "noticing" the typo
      await humanDelay(100, 350);

      // Backspace to remove the typo
      await page.keyboard.press('Backspace');
      await humanDelay(30, 100);

      // Type the correct character
      await page.keyboard.type(char);
    } else {
      await page.keyboard.type(char);
    }
  }
}

/**
 * Clear a field and type new text — like a human triple-clicking to select all,
 * then typing the replacement. Useful when the field already has content.
 *
 * @param page     Playwright page
 * @param selector CSS selector for the input element
 * @param text     Replacement text
 * @param config   Optional human behavior config overrides
 */
export async function humanClearAndType(
  page: Page,
  selector: string,
  text: string,
  config?: HumanConfig,
): Promise<void> {
  const cfg = mergeConfig(config);

  // Think before clearing
  await humanDelay(cfg.minThinkTime / 4, cfg.minThinkTime);

  // Triple-click to select all existing content
  await page.click(selector, { clickCount: 3 });
  await humanDelay(50, 150);

  // Type the new text (will replace selection)
  await humanType(page, selector, text, config);
}

// ── Clicking ──────────────────────────────────────────────────────────────────

/**
 * Click an element with human-like behavior:
 * 1. Brief thinking pause
 * 2. Bézier curve mouse movement to the element
 * 3. Small random offset from center (humans rarely click the exact center)
 * 4. Brief hover before clicking
 * 5. Click
 *
 * @param page     Playwright page
 * @param selector CSS selector for the target element
 * @param config   Optional human behavior config overrides
 */
export async function humanClick(
  page: Page,
  selector: string,
  config?: HumanConfig,
): Promise<void> {
  const cfg = mergeConfig(config);

  // Think before acting
  await humanDelay(cfg.minThinkTime / 2, cfg.minThinkTime);

  // Get element bounding box
  const element = await page.waitForSelector(selector, { timeout: 10000 });
  if (!element) {
    throw new Error(`humanClick: element not found for selector "${selector}"`);
  }

  const box = await element.boundingBox();
  if (!box) {
    throw new Error(`humanClick: element has no bounding box for selector "${selector}"`);
  }

  // Random offset from center (within 30% of element size)
  const offsetX = rand(-box.width * 0.25, box.width * 0.25);
  const offsetY = rand(-box.height * 0.25, box.height * 0.25);
  const targetX = Math.round(box.x + box.width / 2 + offsetX);
  const targetY = Math.round(box.y + box.height / 2 + offsetY);

  // Move mouse along a Bézier curve
  await moveMouse(page, targetX, targetY, cfg.mouseSpeed);

  // Brief hover — humans don't click instantly on arrival
  await humanDelay(50, 200);

  // Click
  await page.mouse.click(targetX, targetY);

  lastMouseX = targetX;
  lastMouseY = targetY;
}

// ── Scrolling ─────────────────────────────────────────────────────────────────

/**
 * Scroll the page like a human.
 *
 * Behavior:
 * - Variable scroll speed (natural: faster through boring areas, slower near content)
 * - Occasional reading pauses mid-scroll
 * - Small back-scrolls (re-reading behavior)
 * - Uses page.mouse.wheel() for proper scroll events (not scrollTo)
 *
 * @param page    Playwright page
 * @param options Scroll direction, amount, and duration
 */
export async function humanScroll(
  page: Page,
  options: {
    /** Scroll direction. Default: 'down' */
    direction?: 'up' | 'down';
    /** Approximate pixels to scroll. Default: random 300-800 */
    amount?: number;
    /** Total scroll duration in ms. Default: random 1000-3000 */
    duration?: number;
  } = {},
): Promise<void> {
  const {
    direction = 'down',
    amount = Math.round(rand(300, 800)),
    duration = Math.round(rand(1000, 3000)),
  } = options;

  const sign = direction === 'down' ? 1 : -1;
  const totalPixels = amount * sign;

  // Break the scroll into chunks of varying size (simulates natural hand movement)
  const numChunks = Math.round(rand(4, 12));
  const startTime = Date.now();

  let scrolled = 0;
  let targetX = Math.round(rand(300, 900));
  let targetY = Math.round(rand(200, 600));

  // Move mouse to a natural scroll position first
  await moveMouse(page, targetX, targetY, 1.5);

  for (let chunk = 0; chunk < numChunks; chunk++) {
    const remaining = totalPixels - scrolled;
    if (Math.abs(remaining) < 10) break;

    // Each chunk is a random fraction of remaining pixels
    const isLastChunk = chunk === numChunks - 1;
    const chunkFraction = isLastChunk ? 1 : rand(0.1, 0.35);
    let chunkPixels = Math.round(remaining * chunkFraction);

    // Small back-scroll (re-reading), ~15% chance
    const isBackScroll = !isLastChunk && Math.random() < 0.15;
    if (isBackScroll) {
      chunkPixels = Math.round(rand(30, 100)) * -sign;
    }

    // Small horizontal mouse drift during scroll (natural)
    const drift = rand(-20, 20);
    targetX = Math.max(100, Math.min(1500, targetX + drift));
    await page.mouse.move(Math.round(targetX), Math.round(targetY));

    // Apply the scroll event
    await page.mouse.wheel(0, chunkPixels);
    scrolled += chunkPixels;

    // Variable delay between chunks based on remaining duration
    const elapsed = Date.now() - startTime;
    const remainingDuration = duration - elapsed;
    const avgChunkDelay = remainingDuration / (numChunks - chunk);
    const chunkDelay = gaussianRand(avgChunkDelay, avgChunkDelay * 0.3);

    // Pause to "read" — longer pause on some chunks
    const isReadingPause = Math.random() < 0.25 && !isLastChunk;
    const actualDelay = isReadingPause
      ? chunkDelay + rand(500, 1500)
      : Math.max(50, chunkDelay);

    await new Promise<void>(resolve => setTimeout(resolve, Math.round(actualDelay)));
  }
}

/**
 * Scroll the page until a specific element is visible, with natural scrolling.
 *
 * @param page     Playwright page
 * @param selector CSS selector for the target element
 * @param config   Optional human behavior config overrides
 */
export async function humanScrollToElement(
  page: Page,
  selector: string,
  config?: HumanConfig,
): Promise<void> {
  void mergeConfig(config); // config reserved for future speed/behavior options

  // Check if element is already visible
  const isVisible = await page.isVisible(selector);
  if (isVisible) return;

  // Scroll down in increments until the element comes into view
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    await humanScroll(page, { direction: 'down', amount: Math.round(rand(200, 500)) });

    const nowVisible = await page.isVisible(selector);
    if (nowVisible) break;

    attempts++;
  }

  // Final scroll to center the element in view — string-based eval avoids DOM lib requirement
  await page.evaluate(
    (sel: string) =>
      (globalThis as unknown as { document: { querySelector(s: string): { scrollIntoView(o: object): void } | null } })
        .document
        .querySelector(sel)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
    selector,
  );

  await humanDelay(300, 700);
}

// ── Session Warmup ────────────────────────────────────────────────────────────

/**
 * Browse a site naturally for warmup before performing target actions.
 * Establishes a realistic browsing pattern that helps avoid bot detection.
 *
 * Site-specific behavior:
 * - **LinkedIn**: Scroll feed, maybe hover posts, pause to "read"
 * - **Upwork**: Browse job listings, scroll, hover over results
 * - **Indeed**: Scroll job results, maybe hover over a few listings
 * - **Generic**: Slow scroll, hover over links, maybe click one internal link
 *
 * @param page       Playwright page
 * @param site       Site identifier for tailored warmup behavior
 * @param durationMs Approximate warmup duration in ms (default: 30000-60000)
 */
export async function warmupSession(
  page: Page,
  site: 'linkedin' | 'upwork' | 'indeed' | 'generic' = 'generic',
  durationMs?: number,
): Promise<void> {
  const duration = durationMs ?? Math.round(rand(30000, 60000));
  const startTime = Date.now();

  const elapsed = (): number => Date.now() - startTime;
  const shouldContinue = (): boolean => elapsed() < duration;

  switch (site) {
    case 'linkedin':
      await warmupLinkedIn(page, duration);
      break;

    case 'upwork':
      await warmupUpwork(page, duration);
      break;

    case 'indeed':
      await warmupIndeed(page, duration);
      break;

    default:
      await warmupGeneric(page, duration, elapsed, shouldContinue);
      break;
  }
}

/** LinkedIn-specific warmup: scroll feed, hover posts, reading pauses */
async function warmupLinkedIn(page: Page, duration: number): Promise<void> {
  const screenHeights = rand(2, 4);

  // Slow scroll through the feed (2-4 screen heights)
  for (let i = 0; i < screenHeights; i++) {
    if (Date.now() >= duration) break;

    await humanScroll(page, {
      direction: 'down',
      amount: Math.round(rand(600, 900)),
      duration: Math.round(rand(3000, 6000)),
    });

    // Pause to "read" a post
    await humanDelay(2000, 6000);

    // Occasionally hover over a post card (50% chance)
    if (Math.random() < 0.5) {
      try {
        const posts = await page.$$('.feed-shared-update-v2, .occludable-update');
        if (posts.length > 0) {
          const post = posts[Math.floor(Math.random() * Math.min(posts.length, 3))];
          const box = post ? await post.boundingBox() : null;
          if (box) {
            await moveMouse(
              page,
              Math.round(box.x + rand(50, box.width - 50)),
              Math.round(box.y + rand(20, box.height / 2)),
              0.7,
            );
            await humanDelay(500, 2000);
          }
        }
      } catch { /* continue warmup even if hover fails */ }
    }
  }
}

/** Upwork-specific warmup: browse job listings */
async function warmupUpwork(page: Page, duration: number): Promise<void> {
  const scrollRounds = Math.round(rand(2, 3));

  for (let i = 0; i < scrollRounds && Date.now() < duration; i++) {
    await humanScroll(page, {
      direction: 'down',
      amount: Math.round(rand(400, 700)),
      duration: Math.round(rand(2000, 5000)),
    });

    await humanDelay(1500, 4000);

    // Occasionally hover over a job tile
    if (Math.random() < 0.4) {
      try {
        const tiles = await page.$$('[data-test="job-tile-header"], .job-tile');
        if (tiles.length > 0) {
          const tile = tiles[Math.floor(Math.random() * Math.min(tiles.length, 4))];
          const box = tile ? await tile.boundingBox() : null;
          if (box) {
            await moveMouse(
              page,
              Math.round(box.x + rand(20, box.width - 20)),
              Math.round(box.y + rand(10, box.height / 2)),
              0.8,
            );
            await humanDelay(800, 2500);
          }
        }
      } catch { /* continue */ }
    }
  }
}

/** Indeed-specific warmup: scroll job results */
async function warmupIndeed(page: Page, duration: number): Promise<void> {
  const scrollRounds = Math.round(rand(2, 4));

  for (let i = 0; i < scrollRounds && Date.now() < duration; i++) {
    await humanScroll(page, {
      direction: 'down',
      amount: Math.round(rand(350, 650)),
      duration: Math.round(rand(2000, 4500)),
    });

    await humanDelay(1000, 3500);

    // Occasionally hover over a job card
    if (Math.random() < 0.45) {
      try {
        const cards = await page.$$('.job_seen_beacon, .jobsearch-SerpJobCard');
        if (cards.length > 0) {
          const card = cards[Math.floor(Math.random() * Math.min(cards.length, 5))];
          const box = card ? await card.boundingBox() : null;
          if (box) {
            await moveMouse(
              page,
              Math.round(box.x + rand(20, box.width - 20)),
              Math.round(box.y + rand(5, box.height / 2)),
              0.9,
            );
            await humanDelay(600, 2000);
          }
        }
      } catch { /* continue */ }
    }
  }
}

/** Generic site warmup: scroll, hover links, maybe click one internal link */
async function warmupGeneric(
  page: Page,
  _duration: number,
  elapsed: () => number,
  shouldContinue: () => boolean,
): Promise<void> {
  // Phase 1: Slow scroll down
  const scrollRounds = Math.round(rand(2, 4));
  for (let i = 0; i < scrollRounds && shouldContinue(); i++) {
    await humanScroll(page, {
      direction: 'down',
      amount: Math.round(rand(300, 700)),
      duration: Math.round(rand(2000, 4000)),
    });
    await humanDelay(800, 2500);
  }

  if (!shouldContinue()) return;

  // Phase 2: Hover over a few links
  const hoverCount = Math.round(rand(1, 4));
  for (let i = 0; i < hoverCount && shouldContinue(); i++) {
    try {
      const links = await page.$$('a[href]');
      const visibleLinks = links.slice(0, 10); // only top 10
      if (visibleLinks.length > 0) {
        const link = visibleLinks[Math.floor(Math.random() * visibleLinks.length)];
        const box = link ? await link.boundingBox() : null;
        if (box && box.width > 0 && box.height > 0) {
          await moveMouse(
            page,
            Math.round(box.x + box.width / 2),
            Math.round(box.y + box.height / 2),
            0.8,
          );
          await humanDelay(300, 1500);
        }
      }
    } catch { /* continue */ }
  }

  if (!shouldContinue()) return;

  // Phase 3: Maybe click an internal link and go back (30% chance)
  if (Math.random() < 0.3) {
    try {
      const currentUrl = page.url();
      const currentOrigin = new URL(currentUrl).origin;

      const links = await page.$$('a[href]');
      for (const link of links.slice(0, 15)) {
        const href = await link.getAttribute('href');
        if (!href) continue;

        // Only click internal links
        try {
          const linkUrl = new URL(href, currentUrl);
          if (linkUrl.origin === currentOrigin && linkUrl.href !== currentUrl) {
            await humanClick(page, 'a[href="' + href + '"]');
            await humanDelay(2000, 5000);

            // Go back
            await page.goBack({ waitUntil: 'domcontentloaded' });
            await humanDelay(500, 1500);
            break;
          }
        } catch { /* invalid URL — skip */ }
      }
    } catch { /* continue */ }
  }

  // Final reading pause
  const remainingMs = _duration - elapsed();
  if (remainingMs > 1000) {
    await humanDelay(Math.min(remainingMs * 0.3, 1000), Math.min(remainingMs * 0.5, 3000));
  }
}

// ── Form Interaction ──────────────────────────────────────────────────────────

/**
 * Select an option from a <select> dropdown with human-like behavior:
 * 1. Click the dropdown
 * 2. Brief pause (deciding)
 * 3. Select the target option
 *
 * @param page     Playwright page
 * @param selector CSS selector for the <select> element
 * @param value    Option value or label text to select
 * @param config   Optional human behavior config overrides
 */
export async function humanSelect(
  page: Page,
  selector: string,
  value: string,
  config?: HumanConfig,
): Promise<void> {
  const cfg = mergeConfig(config);

  // Think before opening the dropdown
  await humanDelay(cfg.minThinkTime / 3, cfg.minThinkTime / 2);

  // Click to open the dropdown
  await humanClick(page, selector, config);
  await humanDelay(200, 600);

  // Select the value
  await page.selectOption(selector, value);
  await humanDelay(100, 300);
}

/**
 * Upload a file via a file input with natural delays.
 * Simulates the realistic timing of a user who opened a file picker and
 * navigated to the file.
 *
 * @param page      Playwright page
 * @param selector  CSS selector for the file input element
 * @param filePath  Absolute path to the file to upload
 */
export async function humanUploadFile(
  page: Page,
  selector: string,
  filePath: string,
): Promise<void> {
  // "Thinking" about where the file is
  await humanDelay(500, 2000);

  await page.setInputFiles(selector, filePath);

  // Brief pause after the file is selected (user confirming the selection)
  await humanDelay(300, 1000);
}

/**
 * Click a checkbox or radio button with human-like behavior.
 * Moves the mouse naturally before clicking.
 *
 * @param page     Playwright page
 * @param selector CSS selector for the checkbox or radio
 * @param config   Optional human behavior config overrides
 */
export async function humanToggle(
  page: Page,
  selector: string,
  config?: HumanConfig,
): Promise<void> {
  await humanClick(page, selector, config);

  // Brief pause after toggling — humans verify the state visually
  const cfg = mergeConfig(config);
  await humanDelay(cfg.minThinkTime / 4, cfg.minThinkTime / 2);
}

// ── Public wrappers for programmatic use ──────────────────────────────────────

/**
 * Move mouse along a natural Bézier curve to a position.
 * Public wrapper around the internal moveMouse function.
 *
 * @param page      Playwright page
 * @param targetX   Target X coordinate
 * @param targetY   Target Y coordinate
 * @param options   Speed options
 */
export async function humanMouseMove(
  page: Page,
  targetX: number,
  targetY: number,
  options?: {
    /** Number of intermediate steps (approximated via speed factor). Default: normal */
    steps?: number;
    /** Total duration in ms range [min, max]. Default: [200, 600] */
    duration?: [number, number];
  },
): Promise<void> {
  const speedFactor = options?.duration
    ? 600 / ((options.duration[0] + options.duration[1]) / 2)
    : 1;
  await moveMouse(page, targetX, targetY, speedFactor);
}

/**
 * Read a page like a human — scroll through content with natural pauses.
 * Simulates someone actually reading the page before taking action.
 *
 * @param page       Playwright page
 * @param durationMs Approximate time to spend "reading" (default: 5000-15000 random)
 */
export async function humanRead(page: Page, durationMs?: number): Promise<void> {
  const readTime = durationMs ?? Math.round(rand(5000, 15000));
  const startTime = Date.now();
  const elapsed = (): number => Date.now() - startTime;

  while (elapsed() < readTime) {
    const remaining = readTime - elapsed();
    if (remaining < 500) break;

    // Scroll a chunk (reading speed: one screen section at a time)
    const chunkAmount = Math.round(rand(180, 350));
    const chunkDuration = Math.round(rand(800, 2000));

    await humanScroll(page, {
      direction: 'down',
      amount: chunkAmount,
      duration: Math.min(chunkDuration, remaining - 200),
    });

    if (elapsed() >= readTime) break;

    // Pause to "read" the revealed content
    const pauseTime = Math.min(Math.round(rand(1000, 3500)), readTime - elapsed());
    if (pauseTime > 100) {
      await humanDelay(pauseTime * 0.7, pauseTime);
    }

    // Occasionally scroll back up slightly (re-reading)
    if (Math.random() < 0.2 && elapsed() < readTime - 2000) {
      await humanScroll(page, {
        direction: 'up',
        amount: Math.round(rand(60, 120)),
        duration: Math.round(rand(400, 800)),
      });
      await humanDelay(300, 800);
    }
  }
}

/**
 * Browse a site naturally for warmup before performing the target action.
 * Thin wrapper around `warmupSession` with a simplified site-detection interface.
 *
 * @param page       Playwright page
 * @param durationMs How long to browse (default: 30000-60000 random)
 */
export async function warmupBrowse(page: Page, durationMs?: number): Promise<void> {
  const url = page.url();
  let site: Parameters<typeof warmupSession>[1] = 'generic';
  if (url.includes('linkedin.com')) site = 'linkedin';
  else if (url.includes('indeed.com')) site = 'indeed';
  else if (url.includes('upwork.com')) site = 'upwork';

  await warmupSession(page, site, durationMs);
}
