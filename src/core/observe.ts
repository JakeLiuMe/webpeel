/**
 * WebPeel Observe — Give agents structured "eyes" on a web page.
 *
 * Returns a machine-readable map of interactive elements (links, buttons,
 * inputs, forms, selects, media) so agents can decide what to do next
 * without needing a vision model.
 *
 * This bridges the gap between:
 *   - `peel()` / `webpeel_read` → markdown content (strips interaction cues)
 *   - `webpeel_act` → requires knowing selectors already
 *
 * With `observe()`, the loop becomes:
 *   1. observe(url) → see what's on the page
 *   2. decide which element to interact with
 *   3. act(url, actions) → do it
 *   4. observe again → see the result
 */

// ── Public types ──────────────────────────────────────────────────────────────

export interface ObserveOptions {
  /** URL to observe (required unless passing an existing Page) */
  url?: string;
  /** Use browser rendering (default: true — observation inherently needs the rendered DOM) */
  render?: boolean;
  /** CSS selector to scope observation (e.g. 'main', '#content') */
  selector?: string;
  /** Viewport: 'desktop' | 'mobile' | 'tablet' | {width, height} */
  viewport?: 'desktop' | 'mobile' | 'tablet' | { width: number; height: number };
  /** Include a screenshot alongside structured data (default: false) */
  screenshot?: boolean;
  /** Full-page screenshot (default: false) */
  screenshotFullPage?: boolean;
  /** Max elements to return per category (default: 50) */
  maxElements?: number;
  /** Timeout in ms (default: 30000) */
  timeout?: number;
  /** Use stealth mode (default: false) */
  stealth?: boolean;
}

export interface ObservedElement {
  /** Auto-generated index for easy reference: "link-0", "button-3", "input-2" */
  ref: string;
  /** Element tag (a, button, input, select, textarea, etc.) */
  tag: string;
  /** Best CSS selector to target this element */
  selector: string;
  /** Visible text content (truncated to 120 chars) */
  text: string;
  /** Semantic role or purpose */
  role: string;
  /** Additional attributes that help identify purpose */
  attributes: Record<string, string>;
  /** Whether the element is visible in the current viewport */
  inViewport: boolean;
  /** Bounding box { x, y, width, height } relative to viewport */
  bbox?: { x: number; y: number; width: number; height: number };
}

export interface ObserveResult {
  /** Final URL after redirects */
  url: string;
  /** Page title */
  title: string;
  /** Current viewport dimensions */
  viewport: { width: number; height: number };
  /** Page scroll dimensions */
  scroll: { width: number; height: number };
  /** Interactive elements grouped by type */
  elements: {
    links: ObservedElement[];
    buttons: ObservedElement[];
    inputs: ObservedElement[];
    selects: ObservedElement[];
    forms: ObservedElement[];
    media: ObservedElement[];
  };
  /** Total count of discovered elements */
  totalElements: number;
  /** Plain-text summary for quick agent consumption */
  summary: string;
  /** Optional screenshot (base64 PNG) */
  screenshot?: string;
  /** Elapsed time in ms */
  elapsed: number;
}

// ── Serializable extraction logic (runs inside page.evaluate) ─────────────

/**
 * This function runs inside the browser context via page.evaluate().
 * It must be fully self-contained — no closures over Node variables.
 */
function extractInteractiveElements(
  args: { scopeSelector: string | null; maxPerCategory: number },
): {
  links: SerializedElement[];
  buttons: SerializedElement[];
  inputs: SerializedElement[];
  selects: SerializedElement[];
  forms: SerializedElement[];
  media: SerializedElement[];
} {
  interface SerializedElement {
    tag: string;
    selector: string;
    text: string;
    role: string;
    attributes: Record<string, string>;
    inViewport: boolean;
    bbox: { x: number; y: number; width: number; height: number } | null;
  }

  const { scopeSelector, maxPerCategory } = args;

  const root: Element | Document = scopeSelector
    ? document.querySelector(scopeSelector) || document
    : document;

  const vpW = window.innerWidth;
  const vpH = window.innerHeight;

  function isVisible(el: Element): boolean {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isInViewport(el: Element): boolean {
    const rect = el.getBoundingClientRect();
    return rect.top < vpH && rect.bottom > 0 && rect.left < vpW && rect.right > 0;
  }

  function getBbox(el: Element): { x: number; y: number; width: number; height: number } | null {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return null;
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  function getText(el: Element): string {
    // Prefer aria-label, then textContent, then value, then placeholder
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel.trim().slice(0, 120);

    const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (text && text.length <= 120) return text;
    if (text) return text.slice(0, 117) + '...';

    if (el instanceof HTMLInputElement) {
      return el.value || el.placeholder || '';
    }

    return el.getAttribute('title') || el.getAttribute('alt') || '';
  }

  function buildSelector(el: Element): string {
    // Best effort: id > unique class > nth-child path
    if (el.id) return `#${CSS.escape(el.id)}`;

    // data-testid is very reliable
    const testId = el.getAttribute('data-testid');
    if (testId) return `[data-testid="${CSS.escape(testId)}"]`;

    // aria-label is good for buttons
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return `${el.tagName.toLowerCase()}[aria-label="${CSS.escape(ariaLabel)}"]`;

    // name attribute for form elements
    const name = el.getAttribute('name');
    if (name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;

    // href for links
    if (el.tagName === 'A') {
      const href = el.getAttribute('href');
      if (href && href.length < 100) return `a[href="${CSS.escape(href)}"]`;
    }

    // class-based with tag
    if (el.className && typeof el.className === 'string') {
      const cls = el.className.trim().split(/\s+/)[0];
      if (cls) {
        const candidate = `${el.tagName.toLowerCase()}.${CSS.escape(cls)}`;
        // Check uniqueness
        if (document.querySelectorAll(candidate).length === 1) return candidate;
      }
    }

    // Fallback: nth-child path (2 levels max for readability)
    const tag = el.tagName.toLowerCase();
    const parent = el.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === el.tagName);
      if (siblings.length === 1) {
        const parentTag = parent.tagName.toLowerCase();
        if (parent.id) return `#${CSS.escape(parent.id)} > ${tag}`;
        return `${parentTag} > ${tag}`;
      }
      const idx = siblings.indexOf(el) + 1;
      if (parent.id) return `#${CSS.escape(parent.id)} > ${tag}:nth-of-type(${idx})`;
    }

    return tag;
  }

  function getRole(el: Element): string {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;

    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'input') {
      const type = (el as HTMLInputElement).type || 'text';
      if (type === 'submit') return 'submit';
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'file') return 'file-upload';
      if (type === 'search') return 'search';
      return 'textbox';
    }
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'listbox';
    if (tag === 'form') return 'form';
    if (tag === 'img') return 'image';
    if (tag === 'video') return 'video';
    if (tag === 'audio') return 'audio';
    return tag;
  }

  function getAttributes(el: Element): Record<string, string> {
    const attrs: Record<string, string> = {};
    const tag = el.tagName.toLowerCase();

    if (tag === 'a') {
      const href = el.getAttribute('href');
      if (href) attrs.href = href.slice(0, 200);
      if (el.getAttribute('target') === '_blank') attrs.target = '_blank';
    }

    if (tag === 'input') {
      const inp = el as HTMLInputElement;
      attrs.type = inp.type || 'text';
      if (inp.placeholder) attrs.placeholder = inp.placeholder;
      if (inp.name) attrs.name = inp.name;
      if (inp.required) attrs.required = 'true';
      if (inp.disabled) attrs.disabled = 'true';
      if (inp.value) attrs.value = inp.value.slice(0, 50);
    }

    if (tag === 'select') {
      const sel = el as HTMLSelectElement;
      const options = Array.from(sel.options).slice(0, 5).map(o => o.text.trim());
      if (options.length > 0) attrs.options = options.join(' | ');
      if (sel.name) attrs.name = sel.name;
    }

    if (tag === 'textarea') {
      const ta = el as HTMLTextAreaElement;
      if (ta.placeholder) attrs.placeholder = ta.placeholder;
      if (ta.name) attrs.name = ta.name;
    }

    if (tag === 'form') {
      const form = el as HTMLFormElement;
      if (form.action) attrs.action = form.action.slice(0, 200);
      if (form.method) attrs.method = form.method;
      attrs.fields = String(form.elements.length);
    }

    if (tag === 'img') {
      const img = el as HTMLImageElement;
      if (img.alt) attrs.alt = img.alt.slice(0, 120);
      if (img.src) attrs.src = img.src.slice(0, 200);
    }

    if (tag === 'video' || tag === 'audio') {
      const media = el as HTMLMediaElement;
      if (media.src) attrs.src = media.src.slice(0, 200);
      if (media.duration) attrs.duration = String(Math.round(media.duration));
    }

    return attrs;
  }

  function serialize(el: Element): SerializedElement {
    return {
      tag: el.tagName.toLowerCase(),
      selector: buildSelector(el),
      text: getText(el),
      role: getRole(el),
      attributes: getAttributes(el),
      inViewport: isInViewport(el),
      bbox: getBbox(el),
    };
  }

  function collect(selector: string): SerializedElement[] {
    const els = root instanceof Document
      ? Array.from(root.querySelectorAll(selector))
      : Array.from(root.querySelectorAll(selector));
    return els
      .filter(isVisible)
      .slice(0, maxPerCategory)
      .map(serialize);
  }

  return {
    links: collect('a[href]'),
    buttons: collect('button, [role="button"], input[type="submit"], input[type="button"]'),
    inputs: collect('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea'),
    selects: collect('select'),
    forms: collect('form'),
    media: collect('img[src], video, audio, iframe[src]'),
  };
}

// We need a serializable type to match what page.evaluate returns
interface SerializedElement {
  tag: string;
  selector: string;
  text: string;
  role: string;
  attributes: Record<string, string>;
  inViewport: boolean;
  bbox: { x: number; y: number; width: number; height: number } | null;
}

// ── Main observe function ─────────────────────────────────────────────────────

/**
 * Observe a web page and return a structured map of interactive elements.
 *
 * @example
 * ```typescript
 * import { observe } from 'webpeel';
 *
 * const result = await observe({ url: 'https://news.ycombinator.com' });
 * console.log(result.elements.links.length); // e.g. 30
 * console.log(result.elements.links[0].ref); // "link-0"
 * console.log(result.elements.links[0].text); // "Show HN: ..."
 * console.log(result.elements.links[0].selector); // "a[href='item?id=12345']"
 * console.log(result.summary);
 * // "30 links, 2 buttons, 1 input, 1 form. Key actions: ..."
 * ```
 */
export async function observe(options: ObserveOptions): Promise<ObserveResult> {
  const {
    url,
    selector = null,
    viewport = 'desktop',
    screenshot: wantScreenshot = false,
    screenshotFullPage = false,
    maxElements = 50,
    timeout = 30000,
    stealth = false,
  } = options;

  if (!url) throw new Error('observe() requires a url');

  const startTime = Date.now();

  // Resolve viewport dimensions
  let vpWidth = 1280;
  let vpHeight = 800;
  let deviceLabel = 'desktop';
  if (viewport === 'mobile') { vpWidth = 390; vpHeight = 844; deviceLabel = 'mobile'; }
  else if (viewport === 'tablet') { vpWidth = 768; vpHeight = 1024; deviceLabel = 'tablet'; }
  else if (typeof viewport === 'object') { vpWidth = viewport.width; vpHeight = viewport.height; deviceLabel = `${viewport.width}x${viewport.height}`; }

  // Use browserFetch with keepPageOpen so we can evaluate in the live page
  const { browserFetch } = await import('./browser-fetch.js');

  const fetchResult = await browserFetch(url, {
    timeoutMs: timeout,
    stealth,
    keepPageOpen: true,
    viewportWidth: vpWidth,
    viewportHeight: vpHeight,
    device: deviceLabel === 'mobile' ? 'mobile' : deviceLabel === 'tablet' ? 'tablet' : 'desktop',
  });

  const page = fetchResult.page;
  if (!page) {
    throw new Error('observe() failed: browser page not available');
  }

  try {
    // Extract interactive elements from the live DOM
    const raw = await page.evaluate(
      extractInteractiveElements,
      { scopeSelector: selector, maxPerCategory: maxElements },
    ) as ReturnType<typeof extractInteractiveElements>;

    // Take optional screenshot
    let screenshotBase64: string | undefined;
    if (wantScreenshot) {
      const buf = await page.screenshot({ type: 'png', fullPage: screenshotFullPage });
      screenshotBase64 = buf.toString('base64');
    }

    const pageTitle = await page.title();
    const finalUrl = page.url();

    // Get scroll dimensions
    const scrollDims = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
    }));

    const elapsed = Date.now() - startTime;

    // Add refs to elements
    const addRefs = (items: SerializedElement[], prefix: string): ObservedElement[] =>
      items.map((item, i) => ({
        ref: `${prefix}-${i}`,
        tag: item.tag,
        selector: item.selector,
        text: item.text,
        role: item.role,
        attributes: item.attributes,
        inViewport: item.inViewport,
        bbox: item.bbox ?? undefined,
      }));

    const elements = {
      links: addRefs(raw.links, 'link'),
      buttons: addRefs(raw.buttons, 'button'),
      inputs: addRefs(raw.inputs, 'input'),
      selects: addRefs(raw.selects, 'select'),
      forms: addRefs(raw.forms, 'form'),
      media: addRefs(raw.media, 'media'),
    };

    const totalElements =
      elements.links.length +
      elements.buttons.length +
      elements.inputs.length +
      elements.selects.length +
      elements.forms.length +
      elements.media.length;

    // Build summary
    const parts: string[] = [];
    if (elements.links.length > 0) parts.push(`${elements.links.length} links`);
    if (elements.buttons.length > 0) parts.push(`${elements.buttons.length} buttons`);
    if (elements.inputs.length > 0) parts.push(`${elements.inputs.length} inputs`);
    if (elements.selects.length > 0) parts.push(`${elements.selects.length} selects`);
    if (elements.forms.length > 0) parts.push(`${elements.forms.length} forms`);
    if (elements.media.length > 0) parts.push(`${elements.media.length} media`);

    // Highlight key actionable items
    const keyActions: string[] = [];
    for (const btn of elements.buttons.slice(0, 3)) {
      if (btn.text) keyActions.push(`[${btn.ref}] "${btn.text}"`);
    }
    for (const inp of elements.inputs.slice(0, 2)) {
      const label = inp.text || inp.attributes.placeholder || inp.attributes.name || 'text field';
      keyActions.push(`[${inp.ref}] ${label} (${inp.attributes.type || 'text'})`);
    }

    let summary = `Page: "${pageTitle}" — ${parts.join(', ')}`;
    if (keyActions.length > 0) {
      summary += `. Key actions: ${keyActions.join(', ')}`;
    }
    summary += `. ${elapsed}ms.`;

    return {
      url: finalUrl,
      title: pageTitle,
      viewport: { width: vpWidth, height: vpHeight },
      scroll: scrollDims,
      elements,
      totalElements,
      summary,
      screenshot: screenshotBase64,
      elapsed,
    };
  } finally {
    // Clean up: close the page and its browser
    try {
      const browser = page.context().browser();
      await page.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    } catch {
      // Best-effort cleanup
    }
  }
}
