/**
 * Page actions executor for browser automation
 *
 * This is WebPeel's "Actions API" — click/scroll/type/wait before extracting.
 *
 * Timeouts:
 * - Default per action: 5s
 * - Max total across all actions: 30s
 */

import type { Page } from 'playwright';
import type { PageAction } from '../types.js';
import { TimeoutError, WebPeelError } from '../types.js';

export const DEFAULT_ACTION_TIMEOUT_MS = 5_000;
export const MAX_TOTAL_ACTIONS_MS = 30_000;

export interface AutoScrollOptions {
  /** Maximum number of scroll iterations (default: 20) */
  maxScrolls?: number;
  /** Milliseconds to wait between scrolls (default: 1000) */
  scrollDelay?: number;
  /** Total timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Optional: wait for this CSS selector after each scroll */
  waitForSelector?: string;
}

export interface AutoScrollResult {
  /** Number of scroll iterations performed */
  scrollCount: number;
  /** Final document height in pixels */
  finalHeight: number;
  /** Whether the page content grew during scrolling */
  contentGrew: boolean;
  /** Whether a virtual/inner scrollable container was found and used */
  scrollContainerFound?: boolean;
  /** Total number of DOM mutations detected during scrolling */
  mutationsDetected?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) {
    throw new TimeoutError(message);
  }

  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new TimeoutError(message)), ms)),
  ]);
}

/**
 * Normalize a raw actions array to WebPeel's internal PageAction shape.
 * Accepts Firecrawl-style fields (milliseconds, text, direction/amount).
 */
export function normalizeActions(input?: unknown): PageAction[] | undefined {
  if (!input) return undefined;
  if (!Array.isArray(input)) throw new WebPeelError('Invalid actions: must be an array');

  return input.map((raw: any) => {
    if (!raw || typeof raw !== 'object') throw new WebPeelError('Invalid action: must be an object');
    if (typeof raw.type !== 'string') throw new WebPeelError('Invalid action: missing type');

    const type = raw.type as PageAction['type'];

    // Common aliases
    const selector = typeof raw.selector === 'string' ? raw.selector : undefined;
    const timeout = typeof raw.timeout === 'number' ? raw.timeout : undefined;

    switch (type) {
      case 'wait': {
        const ms = typeof raw.milliseconds === 'number'
          ? raw.milliseconds
          : typeof raw.ms === 'number'
            ? raw.ms
            : typeof raw.value === 'number'
              ? raw.value
              : undefined;

        return {
          type: 'wait',
          ms: ms ?? 1000,
          timeout,
        };
      }

      case 'click':
        return { type: 'click', selector, timeout };

      case 'type':
      case 'fill': {
        const value = typeof raw.value === 'string' ? raw.value
          : typeof raw.text === 'string' ? raw.text
            : undefined;
        return { type, selector, value, timeout };
      }

      case 'select': {
        const value = typeof raw.value === 'string' ? raw.value : undefined;
        return { type: 'select', selector, value, timeout };
      }

      case 'press': {
        const key = typeof raw.key === 'string' ? raw.key : (typeof raw.value === 'string' ? raw.value : undefined);
        return { type: 'press', key, timeout };
      }

      case 'hover':
        return { type: 'hover', selector, timeout };

      case 'waitForSelector':
        return { type: 'waitForSelector', selector, timeout };

      case 'scroll': {
        const direction = typeof raw.direction === 'string' ? raw.direction : undefined;
        const amount = typeof raw.amount === 'number' ? raw.amount : undefined;

        // Legacy/internal: to can be top|bottom|number|{x,y}
        let to: 'top' | 'bottom' | number | { x: number; y: number } | undefined;
        if (raw.to === 'top' || raw.to === 'bottom' || typeof raw.to === 'number') {
          to = raw.to;
        } else if (typeof raw.to === 'object' && raw.to !== null && 'x' in raw.to && 'y' in raw.to) {
          to = { x: (raw.to as any).x, y: (raw.to as any).y };
        } else {
          to = undefined;
        }

        return {
          type: 'scroll',
          direction: (direction === 'up' || direction === 'down' || direction === 'left' || direction === 'right') ? direction : undefined,
          amount,
          to,
          timeout,
        };
      }

      case 'screenshot':
        return { type: 'screenshot', timeout };

      default:
        // Allow forward compatibility — but still pass through known fields.
        return { ...raw } as PageAction;
    }
  });
}

/**
 * Check if an error message indicates the execution context was destroyed.
 * This happens on SPAs (like Polymarket) when scrolling triggers navigation.
 */
function isContextDestroyedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('Execution context was destroyed') ||
    msg.includes('Target closed') ||
    msg.includes('frame was detached') ||
    msg.includes('Session closed')
  );
}

/**
 * Detect the most likely scrollable container on the page.
 * Returns a CSS selector string for the container, or null if only window scrolling is needed.
 *
 * Looks for elements with overflow-y: auto|scroll whose scrollHeight > clientHeight,
 * preferring the largest such element. Used by autoScroll and scrollThrough.
 */
export async function detectScrollContainer(page: Page): Promise<string | null> {
  try {
    return await page.evaluate(() => {
      const candidates: Array<{ selector: string; scrollable: number }> = [];

      const elements = document.querySelectorAll('*');
      for (const el of Array.from(elements)) {
        // Skip body/html (that's the default window scroll)
        if (el === document.body || el === document.documentElement) continue;

        const style = window.getComputedStyle(el);
        const overflowY = style.overflowY;
        if (overflowY !== 'auto' && overflowY !== 'scroll') continue;

        const scrollable = el.scrollHeight - el.clientHeight;
        if (scrollable < 100) continue; // Must have meaningful scrollable space

        // Build a reasonable selector
        let selector = el.tagName.toLowerCase();
        if (el.id) {
          selector = `#${CSS.escape(el.id)}`;
        } else if (el.className && typeof el.className === 'string') {
          const cls = el.className.trim().split(/\s+/)[0];
          if (cls) selector = `${el.tagName.toLowerCase()}.${CSS.escape(cls)}`;
        }

        candidates.push({ selector, scrollable });
      }

      if (candidates.length === 0) return null;

      // Sort by most scrollable content and return the best candidate
      candidates.sort((a, b) => b.scrollable - a.scrollable);
      return candidates[0].selector;
    });
  } catch {
    // Context may be gone — safe to ignore
    return null;
  }
}

/**
 * Intelligently scroll the page to load all lazy/infinite-scroll content.
 *
 * Improvements over the basic version:
 * 1. Detects virtual/inner scroll containers (Polymarket, React virtualized lists)
 * 2. Uses MutationObserver to detect DOM additions (not just height changes)
 * 3. Gracefully handles execution context destruction (SPA navigation)
 * 4. Stability requires BOTH no height change AND no DOM mutations
 *
 * Stops when:
 * - Height is stable AND no DOM mutations for 2 consecutive checks
 * - maxScrolls limit is reached
 * - Total timeout is exceeded
 * - Execution context is destroyed (SPA navigation)
 */
export async function autoScroll(page: Page, options: AutoScrollOptions = {}): Promise<AutoScrollResult> {
  const {
    maxScrolls = 20,
    scrollDelay = 1000,
    timeout = 30_000,
    waitForSelector,
  } = options;

  const startTime = Date.now();
  let scrollCount = 0;
  let stableCount = 0;
  const stableThreshold = 2;
  let totalMutations = 0;
  let scrollContainerFound = false;

  // ── Step 1: Detect the actual scrollable container ─────────────────────────
  // Use || null to normalize undefined (returned by test mocks) to null.
  const containerSelector = (await detectScrollContainer(page)) || null;
  scrollContainerFound = containerSelector !== null;

  // ── Step 2: Get initial height (body or container) ─────────────────────────
  const getHeight = async (): Promise<number> => {
    try {
      if (containerSelector) {
        const h = await page.evaluate((sel: string) => {
          const el = document.querySelector(sel);
          return el ? el.scrollHeight : document.body.scrollHeight;
        }, containerSelector);
        return (h as number) || 0;
      }
      // Use string form for backward compatibility with test mocks
      return ((await page.evaluate('document.body.scrollHeight')) as number) || 0;
    } catch (err) {
      if (isContextDestroyedError(err)) return -1; // Sentinel: context gone
      throw err;
    }
  };

  // ── Step 3: Set up MutationObserver inside the page ─────────────────────────
  // We store a mutation count in window.__wpMutationCount so we can poll it.
  const setupObserver = async (): Promise<void> => {
    try {
      await page.evaluate(() => {
        (window as any).__wpMutationCount = 0;
        const observer = new MutationObserver((mutations) => {
          (window as any).__wpMutationCount += mutations.reduce(
            (sum, m) => sum + m.addedNodes.length,
            0
          );
        });
        observer.observe(document.body, { childList: true, subtree: true });
        (window as any).__wpMutationObserver = observer;
      });
    } catch {
      // If we can't set up the observer, we'll fall back to height-only detection
    }
  };

  const getMutationCount = async (): Promise<number> => {
    try {
      const count = await page.evaluate(() => (window as any).__wpMutationCount ?? 0);
      return typeof count === 'number' ? count : 0;
    } catch {
      return 0;
    }
  };

  const resetMutationCount = async (): Promise<void> => {
    try {
      await page.evaluate(() => { (window as any).__wpMutationCount = 0; });
    } catch {
      // Ignore
    }
  };

  // ── Step 4: Perform the scroll function ────────────────────────────────────
  const scrollToBottom = async (): Promise<void> => {
    try {
      if (containerSelector) {
        await page.evaluate((sel: string) => {
          const el = document.querySelector(sel);
          if (el) {
            el.scrollTop = el.scrollHeight;
          } else {
            window.scrollTo(0, document.body.scrollHeight);
          }
        }, containerSelector);
      } else {
        // Use string form for backward compatibility with test mocks
        await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
      }
    } catch (err) {
      if (!isContextDestroyedError(err)) throw err;
      // Context destroyed — will be caught in main loop
    }
  };

  // ── Main loop ──────────────────────────────────────────────────────────────
  await setupObserver();
  await resetMutationCount();

  const initialHeight = await getHeight();
  if (initialHeight === -1) {
    // Context was already destroyed before we started
    return { scrollCount: 0, finalHeight: 0, contentGrew: false, scrollContainerFound, mutationsDetected: 0 };
  }

  let lastHeight = initialHeight;
  let finalHeight = initialHeight;
  let lastMutationCount = 0;

  while (scrollCount < maxScrolls) {
    // Check timeout
    if (Date.now() - startTime >= timeout) {
      break;
    }

    // Scroll to bottom (with error recovery)
    try {
      await scrollToBottom();
    } catch (err) {
      if (isContextDestroyedError(err)) {
        // SPA navigation destroyed the context — stop gracefully
        break;
      }
      throw err;
    }
    scrollCount++;

    // Wait for new content
    const remainingTime = timeout - (Date.now() - startTime);
    const waitMs = Math.min(scrollDelay, Math.max(remainingTime, 0));
    if (waitMs > 0) {
      await sleep(waitMs);
    }

    // Optionally wait for a specific selector
    if (waitForSelector) {
      const selectorTimeout = Math.max(0, timeout - (Date.now() - startTime));
      if (selectorTimeout > 0) {
        await page.waitForSelector(waitForSelector, { timeout: selectorTimeout }).catch(() => {});
      }
    }

    // Check height (with error recovery)
    let currentHeight: number;
    try {
      currentHeight = await getHeight();
      if (currentHeight === -1) break; // Context destroyed
    } catch (err) {
      if (isContextDestroyedError(err)) break;
      throw err;
    }
    finalHeight = currentHeight;

    // Check mutation count
    const currentMutations = await getMutationCount();
    const mutationsSinceLastCheck = currentMutations - lastMutationCount;
    totalMutations += mutationsSinceLastCheck;

    // Stability check: stable = no height growth AND no new DOM mutations
    const heightStable = currentHeight <= lastHeight;
    const mutationsStable = mutationsSinceLastCheck === 0;

    if (heightStable && mutationsStable) {
      stableCount++;
      if (stableCount >= stableThreshold) {
        break;
      }
    } else {
      stableCount = 0;
      if (!heightStable) lastHeight = currentHeight;
      lastMutationCount = currentMutations;
      await resetMutationCount();
      lastMutationCount = 0;
    }
  }

  return {
    scrollCount,
    finalHeight,
    contentGrew: finalHeight > initialHeight,
    scrollContainerFound,
    mutationsDetected: totalMutations,
  };
}

export async function executeActions(
  page: Page,
  actions: PageAction[],
  screenshotOptions?: { fullPage?: boolean; type?: 'png' | 'jpeg'; quality?: number }
): Promise<Buffer | undefined> {
  let lastScreenshot: Buffer | undefined;

  const screenshotType = screenshotOptions?.type || 'png';
  const screenshotFullPage = screenshotOptions?.fullPage ?? true;
  const screenshotQuality = screenshotOptions?.quality;

  const start = Date.now();
  const deadline = start + MAX_TOTAL_ACTIONS_MS;

  // Normalize once to handle Firecrawl-style aliases even if caller didn't.
  const normalized = normalizeActions(actions) ?? [];

  for (let i = 0; i < normalized.length; i++) {
    const action = normalized[i]!;

    const remainingTotal = deadline - Date.now();
    if (remainingTotal <= 0) {
      throw new TimeoutError(`Actions timed out after ${MAX_TOTAL_ACTIONS_MS}ms`);
    }

    const perActionTimeout = Math.min(
      typeof action.timeout === 'number' && action.timeout > 0 ? action.timeout : DEFAULT_ACTION_TIMEOUT_MS,
      remainingTotal
    );

    const label = `Action ${i + 1}/${normalized.length} (${action.type})`;

    switch (action.type) {
      case 'wait': {
        const ms = (typeof action.ms === 'number' ? action.ms : undefined)
          ?? (typeof (action as any).milliseconds === 'number' ? (action as any).milliseconds : undefined)
          ?? 1000;

        const waitMs = Math.min(Math.max(ms, 0), remainingTotal);
        await withTimeout(page.waitForTimeout(waitMs), waitMs + 50, `${label} timed out`);
        break;
      }

      case 'click': {
        if (!action.selector) throw new WebPeelError('click action requires selector');
        await withTimeout(
          page.click(action.selector, { timeout: perActionTimeout }),
          perActionTimeout + 50,
          `${label} timed out`
        );
        break;
      }

      case 'scroll': {
        const dir = action.direction;
        const amount = typeof action.amount === 'number' ? action.amount : undefined;

        const scrollPromise = (async () => {
          // Relative scroll (Firecrawl-style)
          if (dir && amount !== undefined) {
            const a = Math.max(0, amount);
            let dx = 0;
            let dy = 0;
            if (dir === 'down') dy = a;
            if (dir === 'up') dy = -a;
            if (dir === 'right') dx = a;
            if (dir === 'left') dx = -a;
            await page.evaluate(`window.scrollBy(${dx}, ${dy})`);
            return;
          }

          // Legacy absolute scroll target
          if (action.to === 'bottom') {
            await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
            return;
          }
          if (action.to === 'top') {
            await page.evaluate('window.scrollTo(0, 0)');
            return;
          }
          if (typeof action.to === 'number') {
            await page.evaluate(`window.scrollTo(0, ${action.to})`);
            return;
          }
          if (typeof action.to === 'object' && action.to !== null && 'x' in action.to && 'y' in action.to) {
            await page.evaluate(`window.scrollTo(${(action.to as any).x}, ${(action.to as any).y})`);
            return;
          }

          // Default: scroll to bottom
          await page.evaluate('window.scrollTo(0, document.body.scrollHeight)');
        })();

        await withTimeout(scrollPromise, perActionTimeout + 50, `${label} timed out`);
        break;
      }

      case 'type': {
        if (!action.selector) throw new WebPeelError('type action requires selector');
        const value = action.value ?? (action as any).text;
        if (!value) throw new WebPeelError('type action requires text');
        await withTimeout(
          page.type(action.selector, value, { timeout: perActionTimeout }),
          perActionTimeout + 50,
          `${label} timed out`
        );
        break;
      }

      case 'fill': {
        if (!action.selector) throw new WebPeelError('fill action requires selector');
        const value = action.value ?? (action as any).text;
        if (!value) throw new WebPeelError('fill action requires value');
        await withTimeout(
          page.fill(action.selector, value, { timeout: perActionTimeout }),
          perActionTimeout + 50,
          `${label} timed out`
        );
        break;
      }

      case 'select': {
        if (!action.selector) throw new WebPeelError('select action requires selector');
        if (!action.value) throw new WebPeelError('select action requires value');
        await withTimeout(
          page.selectOption(action.selector, action.value, { timeout: perActionTimeout }),
          perActionTimeout + 50,
          `${label} timed out`
        );
        break;
      }

      case 'press': {
        const key = action.key;
        if (!key) throw new WebPeelError('press action requires key');
        await withTimeout(
          page.keyboard.press(key),
          perActionTimeout + 50,
          `${label} timed out`
        );
        break;
      }

      case 'hover': {
        if (!action.selector) throw new WebPeelError('hover action requires selector');
        await withTimeout(
          page.hover(action.selector, { timeout: perActionTimeout }),
          perActionTimeout + 50,
          `${label} timed out`
        );
        break;
      }

      case 'waitForSelector': {
        if (!action.selector) throw new WebPeelError('waitForSelector action requires selector');
        await withTimeout(
          page.waitForSelector(action.selector, { timeout: perActionTimeout }),
          perActionTimeout + 50,
          `${label} timed out`
        );
        break;
      }

      case 'screenshot': {
        lastScreenshot = await withTimeout(
          page.screenshot({
            fullPage: screenshotFullPage,
            type: screenshotType,
            ...(screenshotType === 'jpeg' && typeof screenshotQuality === 'number'
              ? { quality: screenshotQuality }
              : {}),
          }),
          perActionTimeout + 50,
          `${label} timed out`
        );
        break;
      }

      default: {
        // This should not happen due to our type union, but keep a safe fallback.
        throw new WebPeelError(`Unknown action type: ${(action as any).type}`);
      }
    }

    // Small yield to avoid starving the event loop in tight action sequences
    await sleep(0);
  }

  return lastScreenshot;
}
