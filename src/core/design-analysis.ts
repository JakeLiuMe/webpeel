/**
 * Design Analysis — Structured visual design intelligence extraction.
 *
 * Runs entirely in the browser via page.evaluate(), returning a rich
 * DesignAnalysis object that an AI agent can reason about without
 * vision models.
 */

import type { Page } from 'playwright';

// ── Interfaces ─────────────────────────────────────────────────────────────────

export interface EffectInstance {
  selector: string;
  properties: Record<string, string>;
}

export interface DesignAnalysis {
  visualEffects: {
    glassmorphism: EffectInstance[];
    shadows: EffectInstance[];
    gradients: EffectInstance[];
    animations: EffectInstance[];
    transforms: EffectInstance[];
    filters: EffectInstance[];
  };
  palette: {
    dominant: string[];
    backgrounds: string[];
    texts: string[];
    accents: string[];
    gradientColors: string[];
    scheme: 'light' | 'dark' | 'mixed';
  };
  layout: {
    sections: Array<{
      tag: string;
      id?: string;
      className?: string;
      height: number;
      background: string;
    }>;
    gridSystem: 'grid' | 'flexbox' | 'none';
    maxWidth: string;
    breakpoints: string[];
  };
  typeScale: {
    sizes: string[];
    isModular: boolean;
    ratio?: number;
    baseSize: string;
    families: string[];
    headingStyle: { family: string; weights: number[] };
    bodyStyle: { family: string; weight: number; lineHeight: string };
  };
  qualitySignals: {
    spacingConsistency: number;
    typographyConsistency: number;
    colorHarmony: number;
    visualHierarchy: number;
    overall: number;
  };
}

// ── Core extraction function ───────────────────────────────────────────────────

/**
 * Extract structured design intelligence from a Playwright Page.
 * The page must already be navigated to the target URL.
 */
export async function extractDesignAnalysis(page: Page): Promise<DesignAnalysis> {
  const timeoutMs = 15000; // 15 second timeout for design analysis
  return await Promise.race([
    page.evaluate((): DesignAnalysis => {
    // ── Helpers ─────────────────────────────────────────────────────────────

    function elementLabel(el: Element): string {
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : '';
      const cls = el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.')
        : '';
      return `${tag}${id}${cls}`;
    }

    function isVisible(el: Element): boolean {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return false;
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    }

    function parseRgba(color: string): [number, number, number, number] | null {
      const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!m) return null;
      return [parseInt(m[1]), parseInt(m[2]), parseInt(m[3]), m[4] !== undefined ? parseFloat(m[4]) : 1];
    }

    function toHex(r: number, g: number, b: number): string {
      return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    }

    function colorToHex(color: string): string {
      const parsed = parseRgba(color);
      if (!parsed) return color;
      return toHex(parsed[0], parsed[1], parsed[2]);
    }

    function luminance(color: string): number {
      const parsed = parseRgba(color);
      if (!parsed) return 0.5;
      const [r, g, b] = parsed;
      const [rs, gs, bs] = [r, g, b].map(c => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
    }

    function extractGradientColors(gradient: string): string[] {
      const colors: string[] = [];
      // Match hex colors
      const hexMatches = gradient.match(/#[0-9a-fA-F]{3,8}/g) || [];
      colors.push(...hexMatches);
      // Match rgb/rgba
      const rgbMatches = gradient.match(/rgba?\([^)]+\)/g) || [];
      for (const c of rgbMatches) {
        colors.push(colorToHex(c));
      }
      return colors;
    }

    // ── Color perception helpers (CIE Lab / deltaE76) ───────────────────────
    function hexToRgb(hex: string): [number, number, number] {
      const h = hex.replace('#', '');
      if (h.length === 3) {
        return [
          parseInt(h[0] + h[0], 16),
          parseInt(h[1] + h[1], 16),
          parseInt(h[2] + h[2], 16),
        ];
      }
      return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    }

    function rgbToLab(r: number, g: number, b: number): [number, number, number] {
      // sRGB to linear light
      let rr = r / 255, gg = g / 255, bb = b / 255;
      rr = rr > 0.04045 ? Math.pow((rr + 0.055) / 1.055, 2.4) : rr / 12.92;
      gg = gg > 0.04045 ? Math.pow((gg + 0.055) / 1.055, 2.4) : gg / 12.92;
      bb = bb > 0.04045 ? Math.pow((bb + 0.055) / 1.055, 2.4) : bb / 12.92;
      // linear RGB → XYZ (D65)
      const x = (rr * 0.4124564 + gg * 0.3575761 + bb * 0.1804375) / 0.95047;
      const y = (rr * 0.2126729 + gg * 0.7151522 + bb * 0.0721750);
      const z = (rr * 0.0193339 + gg * 0.1191920 + bb * 0.9503041) / 1.08883;
      // XYZ → Lab
      const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : (7.787 * t) + 16 / 116;
      return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
    }

    function deltaE(lab1: [number, number, number], lab2: [number, number, number]): number {
      return Math.sqrt(
        (lab1[0] - lab2[0]) ** 2 +
        (lab1[1] - lab2[1]) ** 2 +
        (lab1[2] - lab2[2]) ** 2,
      );
    }

    const rawElements = Array.from(document.querySelectorAll('*'));
    // Sample up to 500 elements for performance — sufficient for accurate analysis
    const allElements = rawElements.length > 500
      ? rawElements.filter((_, i) => i % Math.ceil(rawElements.length / 500) === 0)
      : rawElements;

    // ── A. Visual Effects ───────────────────────────────────────────────────

    const glassmorphism: EffectInstance[] = [];
    const shadows: EffectInstance[] = [];
    const gradients: EffectInstance[] = [];
    const animations: EffectInstance[] = [];
    const transforms: EffectInstance[] = [];
    const filters: EffectInstance[] = [];

    for (const el of allElements) {
      if (!isVisible(el)) continue;
      const style = window.getComputedStyle(el);
      const sel = elementLabel(el);

      // Glassmorphism
      if (glassmorphism.length < 20) {
        const bf = style.backdropFilter || (style as any).webkitBackdropFilter || '';
        const bg = style.backgroundColor;
        if (bf && bf !== 'none' && bf.includes('blur')) {
          const parsed = parseRgba(bg);
          if (parsed && parsed[3] < 0.5) {
            const props: Record<string, string> = {
              'backdrop-filter': bf,
              background: bg,
            };
            const bs = style.boxShadow;
            if (bs && bs !== 'none') props['box-shadow'] = bs;
            glassmorphism.push({ selector: sel, properties: props });
          }
        }
      }

      // Shadows
      if (shadows.length < 20) {
        const bs = style.boxShadow;
        if (bs && bs !== 'none') {
          // Count shadows (separated by commas not inside parens)
          const parts = bs.split(/,(?![^(]*\))/);
          let type: string;
          if (parts.length > 1) type = 'layered';
          else if (bs.includes('inset')) type = 'inset';
          else type = 'drop';
          shadows.push({ selector: sel, properties: { 'box-shadow': bs, type } });
        }
      }

      // Gradients
      if (gradients.length < 20) {
        const bgImage = style.backgroundImage;
        if (bgImage && bgImage !== 'none' && bgImage.includes('gradient')) {
          const type = bgImage.includes('radial') ? 'radial' :
            bgImage.includes('conic') ? 'conic' : 'linear';
          const colors = extractGradientColors(bgImage);
          gradients.push({ selector: sel, properties: { 'background-image': bgImage, type, colors: colors.join(', ') } });
        }
      }

      // Animations
      if (animations.length < 20) {
        const anim = style.animation;
        const trans = style.transition;
        if ((anim && anim !== 'none' && !anim.startsWith('none')) ||
            (trans && trans !== 'none' && !trans.startsWith('none'))) {
          const props: Record<string, string> = {};
          if (anim && anim !== 'none') props.animation = anim;
          if (trans && trans !== 'none') props.transition = trans;
          animations.push({ selector: sel, properties: props });
        }
      }

      // Transforms
      if (transforms.length < 20) {
        const transform = style.transform;
        if (transform && transform !== 'none') {
          transforms.push({ selector: sel, properties: { transform } });
        }
      }

      // Filters
      if (filters.length < 20) {
        const filter = style.filter;
        const blendMode = style.mixBlendMode;
        if ((filter && filter !== 'none') ||
            (blendMode && blendMode !== 'normal')) {
          const props: Record<string, string> = {};
          if (filter && filter !== 'none') props.filter = filter;
          if (blendMode && blendMode !== 'normal') props['mix-blend-mode'] = blendMode;
          filters.push({ selector: sel, properties: props });
        }
      }
    }

    // ── B. Color Palette ────────────────────────────────────────────────────

    const bgColorMap: Map<string, number> = new Map();
    const textColorSet: Set<string> = new Set();
    const accentColorSet: Set<string> = new Set();
    const gradientColorSet: Set<string> = new Set();

    // Accent elements
    const accentEls = document.querySelectorAll('button, a, [role="button"], input[type="submit"], input[type="button"]');
    for (const el of Array.from(accentEls)) {
      const style = window.getComputedStyle(el);
      const bg = style.backgroundColor;
      const parsed = parseRgba(bg);
      if (parsed && parsed[3] > 0.1) {
        accentColorSet.add(colorToHex(bg));
      }
      const color = style.color;
      if (color) textColorSet.add(colorToHex(color));
    }

    for (const el of allElements) {
      if (!isVisible(el)) continue;
      const style = window.getComputedStyle(el);

      const bg = style.backgroundColor;
      const parsed = parseRgba(bg);
      if (parsed && parsed[3] > 0.05) {
        const hex = colorToHex(bg);
        bgColorMap.set(hex, (bgColorMap.get(hex) || 0) + 1);
      }

      const color = style.color;
      if (color) textColorSet.add(colorToHex(color));

      // Gradient colors
      const bgImage = style.backgroundImage;
      if (bgImage && bgImage !== 'none' && bgImage.includes('gradient')) {
        for (const c of extractGradientColors(bgImage)) {
          gradientColorSet.add(c);
        }
      }
    }

    // Top 5 dominant bg colors by frequency
    const sorted = Array.from(bgColorMap.entries()).sort((a, b) => b[1] - a[1]);
    const dominant = sorted.slice(0, 5).map(([hex]) => hex);
    const backgrounds = Array.from(bgColorMap.keys());

    // Detect scheme from body background luminance
    const bodyBg = window.getComputedStyle(document.body).backgroundColor;
    const bodyLum = luminance(bodyBg);
    const scheme: 'light' | 'dark' | 'mixed' = bodyLum > 0.5 ? 'light' : bodyLum < 0.2 ? 'dark' : 'mixed';

    // ── C. Layout Structure ──────────────────────────────────────────────────

    const sections: DesignAnalysis['layout']['sections'] = [];
    let gridSystem: 'grid' | 'flexbox' | 'none' = 'none';
    let maxWidth = '';

    const layoutParents = [document.body, document.querySelector('main')].filter(Boolean) as Element[];
    for (const parent of layoutParents) {
      for (const child of Array.from(parent.children)) {
        const tag = child.tagName.toLowerCase();
        if (tag !== 'section' && tag !== 'div' && tag !== 'article' && tag !== 'header' && tag !== 'footer' && tag !== 'nav') continue;
        const rect = child.getBoundingClientRect();
        if (rect.height <= 100) continue;
        const style = window.getComputedStyle(child);
        sections.push({
          tag,
          id: child.id || undefined,
          className: child.className && typeof child.className === 'string' ? child.className.trim().slice(0, 80) || undefined : undefined,
          height: Math.round(rect.height),
          background: style.backgroundColor,
        });

        // Check grid system
        const display = style.display;
        if (display === 'grid' && gridSystem === 'none') gridSystem = 'grid';
        if (display === 'flex' && gridSystem === 'none') gridSystem = 'flexbox';

        // Check max-width
        const mw = style.maxWidth;
        if (mw && mw !== 'none' && !maxWidth) maxWidth = mw;
      }
    }

    // Also scan containers for grid/flex
    if (gridSystem === 'none') {
      for (const el of allElements) {
        const style = window.getComputedStyle(el);
        if (style.display === 'grid') { gridSystem = 'grid'; break; }
        if (style.display === 'flex') { gridSystem = 'flexbox'; break; }
      }
    }

    // Extract media query breakpoints
    const breakpoints: string[] = [];
    try {
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          const rules = Array.from(sheet.cssRules || []);
          for (const rule of rules) {
            if (rule instanceof CSSMediaRule) {
              const cond = rule.conditionText || rule.media?.mediaText || '';
              if (cond && !breakpoints.includes(cond)) {
                breakpoints.push(cond);
              }
            }
          }
        } catch {
          // Cross-origin stylesheet
        }
      }
    } catch {
      // ignore
    }

    // ── D. Typography Scale ──────────────────────────────────────────────────

    const fontSizeMap: Map<number, number> = new Map();
    const fontFamilySet: Set<string> = new Set();
    const headingWeights: number[] = [];
    let headingFamily = '';
    let bodyFamily = '';
    let bodyWeight = 400;
    let bodyLineHeight = '1.5';

    // Body style
    const bodyStyle = window.getComputedStyle(document.body);
    bodyFamily = bodyStyle.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    bodyWeight = parseInt(bodyStyle.fontWeight) || 400;
    bodyLineHeight = bodyStyle.lineHeight;
    const baseFontSize = parseFloat(bodyStyle.fontSize) || 16;

    // Headings
    const headingEls = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    for (const h of Array.from(headingEls)) {
      const hs = window.getComputedStyle(h);
      const w = parseInt(hs.fontWeight) || 400;
      if (!headingWeights.includes(w)) headingWeights.push(w);
      if (!headingFamily) headingFamily = hs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    }

    // Collect all font sizes
    for (const el of allElements) {
      if (!isVisible(el)) continue;
      const style = window.getComputedStyle(el);
      const size = parseFloat(style.fontSize);
      if (!isNaN(size) && size > 0) {
        fontSizeMap.set(size, (fontSizeMap.get(size) || 0) + 1);
      }
      const family = style.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      if (family) fontFamilySet.add(family);
    }

    const sortedSizes = Array.from(fontSizeMap.keys()).sort((a, b) => a - b);
    const sizeStrings = sortedSizes.map(s => `${s}px`);

    // Detect modular scale
    let isModular = false;
    let ratio: number | undefined;
    if (sortedSizes.length >= 3) {
      const ratios: number[] = [];
      for (let i = 1; i < sortedSizes.length; i++) {
        ratios.push(sortedSizes[i] / sortedSizes[i - 1]);
      }
      const meanRatio = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      const isConsistent = ratios.every(r => Math.abs(r - meanRatio) / meanRatio < 0.05);
      if (isConsistent && meanRatio > 1.05) {
        isModular = true;
        ratio = Math.round(meanRatio * 1000) / 1000;
      }
    }

    // ── E. Quality Signals ───────────────────────────────────────────────────

    // spacingConsistency: % of margin/padding values that are multiples of 4 or 8
    let spacingTotal = 0;
    let spacingAligned = 0;
    const spacingBase = 4;
    const sampleEls = allElements.slice(0, 200);
    for (const el of sampleEls) {
      const style = window.getComputedStyle(el);
      const props = [
        style.marginTop, style.marginBottom, style.marginLeft, style.marginRight,
        style.paddingTop, style.paddingBottom, style.paddingLeft, style.paddingRight,
      ];
      for (const v of props) {
        const px = parseFloat(v);
        if (!isNaN(px) && px > 0) {
          spacingTotal++;
          if (Math.round(px) % spacingBase === 0) spacingAligned++;
        }
      }
    }
    const spacingConsistency = spacingTotal > 0 ? spacingAligned / spacingTotal : 0.5;

    // typographyConsistency: R² of log-linear fit of font sizes
    let typographyConsistency = 0.5;
    if (sortedSizes.length >= 3) {
      const n = sortedSizes.length;
      const xs = sortedSizes.map((_, i) => i);
      const ys = sortedSizes.map(s => Math.log(s));
      const xMean = xs.reduce((a, b) => a + b, 0) / n;
      const yMean = ys.reduce((a, b) => a + b, 0) / n;
      const ssXY = xs.reduce((acc, x, i) => acc + (x - xMean) * (ys[i] - yMean), 0);
      const ssXX = xs.reduce((acc, x) => acc + (x - xMean) ** 2, 0);
      const ssYY = ys.reduce((acc, y) => acc + (y - yMean) ** 2, 0);
      if (ssXX > 0 && ssYY > 0) {
        typographyConsistency = Math.min(1, Math.max(0, (ssXY / Math.sqrt(ssXX * ssYY)) ** 2));
      }
    }

    // colorHarmony: perceptual color clustering via CIE Lab / deltaE76
    // Groups visually similar colors (deltaE ≤ 12) into clusters, then scores
    // by cluster count — tolerant of glassmorphism variants, strict on chaos.
    const uniqueColorSet = new Set([...backgrounds, ...Array.from(textColorSet), ...Array.from(accentColorSet)]);
    const clusterCentroids: [number, number, number][] = [];
    for (const hex of uniqueColorSet) {
      if (!/^#[0-9a-fA-F]{3,8}$/.test(hex)) continue;
      const [r, g, b] = hexToRgb(hex);
      const lab = rgbToLab(r, g, b);
      let assigned = false;
      for (const centroid of clusterCentroids) {
        if (deltaE(lab, centroid) <= 12) {
          // update centroid as running average
          centroid[0] = (centroid[0] + lab[0]) / 2;
          centroid[1] = (centroid[1] + lab[1]) / 2;
          centroid[2] = (centroid[2] + lab[2]) / 2;
          assigned = true;
          break;
        }
      }
      if (!assigned) clusterCentroids.push([lab[0], lab[1], lab[2]]);
    }
    const clusterCount = clusterCentroids.length;
    let colorHarmony: number;
    if (clusterCount <= 10) colorHarmony = 1.0;
    else if (clusterCount >= 25) colorHarmony = 0.5;
    else colorHarmony = 1.0 - (clusterCount - 10) / (25 - 10) * 0.5;

    // visualHierarchy: ratio of h1 font size to body
    let visualHierarchy = 0.75;
    const h1 = document.querySelector('h1');
    if (h1) {
      const h1Size = parseFloat(window.getComputedStyle(h1).fontSize);
      const bodySize = baseFontSize;
      const hratio = h1Size / bodySize;
      if (hratio >= 2) visualHierarchy = 1.0;
      else if (hratio <= 1.5) visualHierarchy = 0.5;
      else visualHierarchy = 0.5 + (hratio - 1.5) / (2 - 1.5) * 0.5;
    }

    const overall = (spacingConsistency * 0.25 + typographyConsistency * 0.25 + colorHarmony * 0.25 + visualHierarchy * 0.25);

    return {
      visualEffects: { glassmorphism, shadows, gradients, animations, transforms, filters },
      palette: {
        dominant,
        backgrounds,
        texts: Array.from(textColorSet),
        accents: Array.from(accentColorSet),
        gradientColors: Array.from(gradientColorSet),
        scheme,
      },
      layout: {
        sections: sections.slice(0, 30),
        gridSystem,
        maxWidth: maxWidth || 'none',
        breakpoints: breakpoints.slice(0, 20),
      },
      typeScale: {
        sizes: sizeStrings,
        isModular,
        ...(ratio !== undefined ? { ratio } : {}),
        baseSize: `${baseFontSize}px`,
        families: Array.from(fontFamilySet),
        headingStyle: { family: headingFamily || bodyFamily, weights: headingWeights.sort() },
        bodyStyle: { family: bodyFamily, weight: bodyWeight, lineHeight: bodyLineHeight },
      },
      qualitySignals: {
        spacingConsistency: Math.round(spacingConsistency * 1000) / 1000,
        typographyConsistency: Math.round(typographyConsistency * 1000) / 1000,
        colorHarmony: Math.round(colorHarmony * 1000) / 1000,
        visualHierarchy: Math.round(visualHierarchy * 1000) / 1000,
        overall: Math.round(overall * 1000) / 1000,
      },
    };
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Design analysis timed out after 15s')), timeoutMs)
    ),
  ]);
}
