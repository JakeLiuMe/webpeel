#!/usr/bin/env npx tsx
/**
 * WebPeel Retailer Benchmark Harness
 *
 * Compares fetch modes (simple → render → stealth) across retailer/e-commerce
 * sites that are notoriously difficult to scrape. Outputs a clear comparison
 * table showing which mode works best per site.
 *
 * Usage:
 *   npx tsx scripts/bench-retailers.ts                       # Run all sites, all modes
 *   npx tsx scripts/bench-retailers.ts --modes simple,render  # Specific modes
 *   npx tsx scripts/bench-retailers.ts --sites amazon,walmart # Specific sites
 *   npx tsx scripts/bench-retailers.ts --timeout 45000        # Custom timeout
 *   npx tsx scripts/bench-retailers.ts --json                 # JSON output only
 *   npx tsx scripts/bench-retailers.ts --output results.json  # Save JSON to file
 *   npx tsx scripts/bench-retailers.ts --concurrency 2        # Parallel fetches per mode
 */

import { peel, cleanup, type PeelResult } from '../src/index.js';
import { writeFile } from 'node:fs/promises';

// ── ANSI colors ──────────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

// ── Types ────────────────────────────────────────────────────────────────────
type FetchMode = 'simple' | 'render' | 'stealth';

interface RetailerSite {
  id: string;
  name: string;
  url: string;
  category: 'ecommerce' | 'travel' | 'tech' | 'social' | 'docs';
  /** Substring expected in title (case-insensitive) */
  expectedTitle?: string;
  /** Minimum content length to consider "real content" */
  minContentLen?: number;
}

interface ModeResult {
  mode: FetchMode;
  success: boolean;
  latencyMs: number;
  contentLength: number;
  tokenCount: number;
  title: string;
  method: string;
  hasTitle: boolean;
  hasMeaningfulContent: boolean;
  blocked: boolean;
  error: string | null;
  quality: number; // 0-100
}

interface SiteResult {
  site: RetailerSite;
  modes: Record<FetchMode, ModeResult>;
  bestMode: FetchMode | null;
  recommendation: string;
}

interface BenchmarkReport {
  timestamp: string;
  config: {
    modes: FetchMode[];
    timeout: number;
    sites: string[];
  };
  results: SiteResult[];
  summary: {
    totalSites: number;
    modeWins: Record<FetchMode, number>;
    modeSuccessRates: Record<FetchMode, { success: number; total: number; rate: string }>;
    avgLatency: Record<FetchMode, number>;
    avgQuality: Record<FetchMode, number>;
    recommendations: string[];
  };
}

// ── Retailer URLs ────────────────────────────────────────────────────────────
const RETAILER_SITES: RetailerSite[] = [
  // E-commerce (the hard ones)
  {
    id: 'amazon',
    name: 'Amazon',
    url: 'https://www.amazon.com/dp/B0D1XD1ZV3',
    category: 'ecommerce',
    expectedTitle: 'amazon',
    minContentLen: 200,
  },
  {
    id: 'walmart',
    name: 'Walmart',
    url: 'https://www.walmart.com/ip/PlayStation-5-Disc-Console-Slim/5089412325',
    category: 'ecommerce',
    expectedTitle: 'walmart',
    minContentLen: 200,
  },
  {
    id: 'bestbuy',
    name: 'Best Buy',
    url: 'https://www.bestbuy.com/site/apple-macbook-air-13-inch-laptop-m4-chip-16gb-memory-256gb/6604203.p',
    category: 'ecommerce',
    expectedTitle: 'best buy',
    minContentLen: 200,
  },
  {
    id: 'costco',
    name: 'Costco',
    url: 'https://www.costco.com/kirkland-signature-products.html',
    category: 'ecommerce',
    expectedTitle: 'costco',
    minContentLen: 100,
  },
  {
    id: 'ebay',
    name: 'eBay',
    url: 'https://www.ebay.com/sch/i.html?_nkw=iphone+15',
    category: 'ecommerce',
    expectedTitle: 'ebay',
    minContentLen: 200,
  },
  {
    id: 'target',
    name: 'Target',
    url: 'https://www.target.com/p/apple-airpods-pro-2nd-generation/-/A-85978612',
    category: 'ecommerce',
    expectedTitle: 'target',
    minContentLen: 200,
  },

  // Travel
  {
    id: 'booking',
    name: 'Booking.com',
    url: 'https://www.booking.com/hotel/us/the-plaza.html',
    category: 'travel',
    expectedTitle: 'booking',
    minContentLen: 200,
  },

  // Tech / docs
  {
    id: 'apple-docs',
    name: 'Apple Developer',
    url: 'https://developer.apple.com/documentation/swiftui',
    category: 'docs',
    expectedTitle: 'swiftui',
    minContentLen: 100,
  },

  // Social (anti-bot)
  {
    id: 'reddit',
    name: 'Reddit',
    url: 'https://www.reddit.com/r/programming/top/?t=month',
    category: 'social',
    expectedTitle: 'programming',
    minContentLen: 200,
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeText(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

function looksBlocked(content: string, title: string): boolean {
  const text = normalizeText(content + ' ' + title).toLowerCase();
  if (content.length > 2000) return false; // Real pages are long
  const patterns = [
    'access denied',
    'request blocked',
    'verify you are a human',
    'captcha',
    'enable javascript',
    'bot detection',
    'just a moment',
    'checking your browser',
    'unusual traffic',
    'sorry, you have been blocked',
  ];
  return patterns.some(p => text.includes(p));
}

function hasMeaningfulContent(content: string, minLen: number): boolean {
  const text = normalizeText(content);
  if (text.length < minLen) return false;
  const words = text.split(/\s+/).filter(Boolean);
  const unique = new Set(words.map(w => w.toLowerCase()));
  return unique.size >= 15 && words.length >= 30;
}

function computeQuality(result: PeelResult, site: RetailerSite): number {
  let score = 0;
  const content = result.content || '';
  const title = result.title || '';
  const text = normalizeText(content);

  // Content length (0-30 points)
  const minLen = site.minContentLen || 200;
  if (text.length >= minLen * 3) score += 30;
  else if (text.length >= minLen) score += 20;
  else if (text.length >= minLen / 2) score += 10;
  else if (text.length > 50) score += 5;

  // Meaningful content (0-25 points)
  if (hasMeaningfulContent(content, minLen)) score += 25;
  else if (text.length > 100) score += 10;

  // Title match (0-20 points)
  if (title && site.expectedTitle) {
    if (title.toLowerCase().includes(site.expectedTitle.toLowerCase())) score += 20;
    else if (title.length > 3) score += 5;
  } else if (title) {
    score += 10;
  }

  // Links present (0-10 points)
  const linkCount = result.links?.length || 0;
  if (linkCount >= 20) score += 10;
  else if (linkCount >= 5) score += 7;
  else if (linkCount >= 1) score += 3;

  // Tokens reasonable (0-10 points)
  const tokens = result.tokens || 0;
  if (tokens >= 100 && tokens <= 100000) score += 10;
  else if (tokens >= 20) score += 5;

  // Blocked penalty (-40)
  if (looksBlocked(content, title)) score -= 40;

  // Metadata bonus (0-5 points)
  if (result.metadata && Object.keys(result.metadata).length > 0) score += 5;

  return Math.max(0, Math.min(100, score));
}

async function fetchWithMode(
  site: RetailerSite,
  mode: FetchMode,
  timeoutMs: number,
): Promise<ModeResult> {
  const start = Date.now();

  try {
    const opts: any = {
      timeout: timeoutMs,
      format: 'markdown' as const,
    };

    switch (mode) {
      case 'simple':
        // Default — no render, no stealth
        break;
      case 'render':
        opts.render = true;
        break;
      case 'stealth':
        opts.render = true;
        opts.stealth = true;
        break;
    }

    const result = await peel(site.url, opts);
    const latencyMs = Date.now() - start;
    const content = result.content || '';
    const title = result.title || '';
    const tokens = result.tokens || Math.round(content.length / 4);
    const blocked = looksBlocked(content, title);
    const meaningful = hasMeaningfulContent(content, site.minContentLen || 200);
    const quality = computeQuality(result, site);
    const success = quality >= 25 && !blocked;

    return {
      mode,
      success,
      latencyMs,
      contentLength: content.length,
      tokenCount: tokens,
      title,
      method: result.method || 'unknown',
      hasTitle: !!normalizeText(title),
      hasMeaningfulContent: meaningful,
      blocked,
      error: null,
      quality,
    };
  } catch (err: any) {
    return {
      mode,
      success: false,
      latencyMs: Date.now() - start,
      contentLength: 0,
      tokenCount: 0,
      title: '',
      method: 'error',
      hasTitle: false,
      hasMeaningfulContent: false,
      blocked: false,
      error: err.message || String(err),
      quality: 0,
    };
  }
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++;
      results[idx] = await tasks[idx]!();
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, tasks.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}

// ── CLI parsing ──────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const idx = args.indexOf(`--${name}`);
    if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
    // Also support --name=value
    const eq = args.find(a => a.startsWith(`--${name}=`));
    return eq?.split('=')[1];
  };

  const modes = (get('modes') || 'simple,render,stealth')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean) as FetchMode[];

  const siteFilter = get('sites')
    ?.split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);

  const timeout = parseInt(get('timeout') || '45000', 10);
  const concurrency = parseInt(get('concurrency') || '1', 10);
  const jsonOnly = args.includes('--json');
  const outputPath = get('output');

  return { modes, siteFilter, timeout, concurrency, jsonOnly, outputPath };
}

// ── Table rendering ──────────────────────────────────────────────────────────
function renderTable(results: SiteResult[], modes: FetchMode[]): void {
  const modeHeaders = modes.map(m => m.padStart(10)).join(' │ ');
  const divider = '─'.repeat(18) + '┼' + modes.map(() => '─'.repeat(12)).join('┼');

  console.log(`\n${c.bold}${c.cyan}┌──────────────────────────────────────────────────────────────┐${c.reset}`);
  console.log(`${c.bold}${c.cyan}│          RETAILER BENCHMARK — Mode Comparison                │${c.reset}`);
  console.log(`${c.bold}${c.cyan}└──────────────────────────────────────────────────────────────┘${c.reset}\n`);

  // Quality table
  console.log(`${c.bold}Quality Score (0-100):${c.reset}`);
  console.log(`${'Site'.padEnd(18)}│ ${modeHeaders}`);
  console.log(divider);

  for (const r of results) {
    const cells = modes.map(m => {
      const mr = r.modes[m];
      if (!mr) return '    —   '.padStart(10);
      const q = mr.quality;
      const icon = mr.success ? '✅' : mr.blocked ? '🚫' : mr.error ? '💥' : '⚠️';
      const color = q >= 60 ? c.green : q >= 25 ? c.yellow : c.red;
      return `${icon}${color}${String(q).padStart(4)}${c.reset}   `.padStart(10);
    }).join(' │ ');
    console.log(`${r.site.name.padEnd(18)}│ ${cells}`);
  }

  console.log('');

  // Latency table
  console.log(`${c.bold}Latency (ms):${c.reset}`);
  console.log(`${'Site'.padEnd(18)}│ ${modeHeaders}`);
  console.log(divider);

  for (const r of results) {
    const cells = modes.map(m => {
      const mr = r.modes[m];
      if (!mr) return '    —   '.padStart(10);
      const ms = mr.latencyMs;
      const color = ms < 2000 ? c.green : ms < 10000 ? c.yellow : c.red;
      return `${color}${String(ms).padStart(7)}ms${c.reset}`.padStart(10);
    }).join(' │ ');
    console.log(`${r.site.name.padEnd(18)}│ ${cells}`);
  }

  console.log('');

  // Method table
  console.log(`${c.bold}Method used:${c.reset}`);
  console.log(`${'Site'.padEnd(18)}│ ${modeHeaders}`);
  console.log(divider);

  for (const r of results) {
    const cells = modes.map(m => {
      const mr = r.modes[m];
      if (!mr) return '    —   '.padStart(10);
      return mr.method.padStart(10);
    }).join(' │ ');
    console.log(`${r.site.name.padEnd(18)}│ ${cells}`);
  }

  console.log('');

  // Best mode per site
  console.log(`${c.bold}Recommendations:${c.reset}`);
  for (const r of results) {
    const icon = r.bestMode ? '→' : '✗';
    const color = r.bestMode ? c.green : c.red;
    console.log(`  ${color}${icon}${c.reset} ${r.site.name.padEnd(18)} ${r.recommendation}`);
  }
}

function renderSummary(report: BenchmarkReport): void {
  const { summary } = report;

  console.log(`\n${c.bold}${c.cyan}━━━ Summary ━━━${c.reset}`);

  // Mode wins
  console.log(`\n${c.bold}Mode wins (best quality for each site):${c.reset}`);
  for (const [mode, wins] of Object.entries(summary.modeWins)) {
    const bar = '█'.repeat(wins) + '░'.repeat(summary.totalSites - wins);
    console.log(`  ${mode.padEnd(10)} ${bar} ${wins}/${summary.totalSites}`);
  }

  // Success rates
  console.log(`\n${c.bold}Success rates:${c.reset}`);
  for (const [mode, sr] of Object.entries(summary.modeSuccessRates)) {
    const color = parseFloat(sr.rate) >= 70 ? c.green : parseFloat(sr.rate) >= 40 ? c.yellow : c.red;
    console.log(`  ${mode.padEnd(10)} ${color}${sr.success}/${sr.total} (${sr.rate})${c.reset}`);
  }

  // Avg latency
  console.log(`\n${c.bold}Avg latency:${c.reset}`);
  for (const [mode, avg] of Object.entries(summary.avgLatency)) {
    console.log(`  ${mode.padEnd(10)} ${avg}ms`);
  }

  // Avg quality
  console.log(`\n${c.bold}Avg quality:${c.reset}`);
  for (const [mode, avg] of Object.entries(summary.avgQuality)) {
    const color = avg >= 60 ? c.green : avg >= 30 ? c.yellow : c.red;
    console.log(`  ${mode.padEnd(10)} ${color}${avg}/100${c.reset}`);
  }

  // Recommendations
  if (summary.recommendations.length > 0) {
    console.log(`\n${c.bold}Key takeaways:${c.reset}`);
    for (const rec of summary.recommendations) {
      console.log(`  • ${rec}`);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const { modes, siteFilter, timeout, concurrency, jsonOnly, outputPath } = parseArgs();

  // Filter sites
  let sites = RETAILER_SITES;
  if (siteFilter) {
    sites = sites.filter(s => siteFilter.includes(s.id));
    if (sites.length === 0) {
      console.error(`No sites match filter: ${siteFilter.join(', ')}`);
      console.error(`Available: ${RETAILER_SITES.map(s => s.id).join(', ')}`);
      process.exit(1);
    }
  }

  if (!jsonOnly) {
    console.log(`\n${c.bold}${c.cyan}🛒 WebPeel Retailer Benchmark${c.reset}`);
    console.log(`${c.gray}Sites: ${sites.map(s => s.name).join(', ')}${c.reset}`);
    console.log(`${c.gray}Modes: ${modes.join(', ')}${c.reset}`);
    console.log(`${c.gray}Timeout: ${timeout}ms | Concurrency: ${concurrency}${c.reset}`);
    console.log('');
  }

  const results: SiteResult[] = [];

  for (const site of sites) {
    if (!jsonOnly) {
      process.stderr.write(`${c.dim}Testing ${site.name}...${c.reset}\n`);
    }

    const modeResults: Record<FetchMode, ModeResult> = {} as any;

    // Run modes sequentially for fair comparison (browser resources)
    for (const mode of modes) {
      if (!jsonOnly) {
        process.stderr.write(`  ${c.dim}${mode}...${c.reset}`);
      }

      const result = await fetchWithMode(site, mode, timeout);
      modeResults[mode] = result;

      if (!jsonOnly) {
        const icon = result.success ? `${c.green}✓${c.reset}` : `${c.red}✗${c.reset}`;
        process.stderr.write(`\r  ${icon} ${mode.padEnd(8)} q=${String(result.quality).padStart(3)} ${result.latencyMs}ms\n`);
      }

      // Brief pause between modes to avoid being rate-limited
      await new Promise(r => setTimeout(r, 500));
    }

    // Determine best mode
    let bestMode: FetchMode | null = null;
    let bestQuality = -1;
    for (const mode of modes) {
      const mr = modeResults[mode];
      if (mr && mr.success && mr.quality > bestQuality) {
        bestQuality = mr.quality;
        bestMode = mode;
      }
    }

    // Generate recommendation
    let recommendation: string;
    if (!bestMode) {
      const anyBlocked = modes.some(m => modeResults[m]?.blocked);
      recommendation = anyBlocked
        ? 'All modes blocked — needs proxy/session rotation'
        : 'All modes failed — site may require specialized handling';
    } else if (bestMode === 'simple') {
      recommendation = 'Simple fetch sufficient — no browser needed';
    } else if (bestMode === 'render') {
      recommendation = 'Needs browser rendering (JS-heavy)';
    } else {
      const renderResult = modeResults['render'];
      if (renderResult && renderResult.success) {
        recommendation = 'Stealth best quality, but render also works';
      } else {
        recommendation = 'Requires stealth mode (bot detection present)';
      }
    }

    results.push({ site, modes: modeResults, bestMode, recommendation });

    // Cleanup browser between sites
    await cleanup().catch(() => {});
  }

  // Build summary
  const modeWins: Record<FetchMode, number> = {} as any;
  const modeSuccessRates: Record<FetchMode, { success: number; total: number; rate: string }> = {} as any;
  const modeTotalLatency: Record<FetchMode, number[]> = {} as any;
  const modeTotalQuality: Record<FetchMode, number[]> = {} as any;

  for (const mode of modes) {
    modeWins[mode] = 0;
    modeTotalLatency[mode] = [];
    modeTotalQuality[mode] = [];
    let successes = 0;
    let total = 0;

    for (const r of results) {
      const mr = r.modes[mode];
      if (mr) {
        total++;
        if (mr.success) successes++;
        modeTotalLatency[mode].push(mr.latencyMs);
        modeTotalQuality[mode].push(mr.quality);
      }
      if (r.bestMode === mode) modeWins[mode]++;
    }

    modeSuccessRates[mode] = {
      success: successes,
      total,
      rate: `${total > 0 ? ((successes / total) * 100).toFixed(0) : 0}%`,
    };
  }

  const avgLatency: Record<FetchMode, number> = {} as any;
  const avgQuality: Record<FetchMode, number> = {} as any;
  for (const mode of modes) {
    const lats = modeTotalLatency[mode] || [];
    const quals = modeTotalQuality[mode] || [];
    avgLatency[mode] = lats.length > 0 ? Math.round(lats.reduce((a, b) => a + b, 0) / lats.length) : 0;
    avgQuality[mode] = quals.length > 0 ? Math.round(quals.reduce((a, b) => a + b, 0) / quals.length) : 0;
  }

  // Generate high-level recommendations
  const recommendations: string[] = [];
  const stealthWins = modeWins['stealth'] || 0;
  const renderWins = modeWins['render'] || 0;
  const simpleWins = modeWins['simple'] || 0;

  if (stealthWins > renderWins && stealthWins > simpleWins) {
    recommendations.push('Stealth mode is the most reliable for retailer sites');
  }
  if (renderWins > 0) {
    recommendations.push(`Browser rendering helps for ${renderWins} site(s)`);
  }
  if (simpleWins > 0) {
    recommendations.push(`Simple fetch works for ${simpleWins} site(s) — fastest option when it works`);
  }

  const allFailed = results.filter(r => !r.bestMode);
  if (allFailed.length > 0) {
    recommendations.push(`${allFailed.length} site(s) failed all modes: ${allFailed.map(r => r.site.name).join(', ')}`);
  }

  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    config: {
      modes,
      timeout,
      sites: sites.map(s => s.id),
    },
    results,
    summary: {
      totalSites: sites.length,
      modeWins,
      modeSuccessRates,
      avgLatency,
      avgQuality,
      recommendations,
    },
  };

  // Output
  if (!jsonOnly) {
    renderTable(results, modes);
    renderSummary(report);
  }

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  }

  if (outputPath) {
    await writeFile(outputPath, JSON.stringify(report, null, 2), 'utf8');
    if (!jsonOnly) {
      console.log(`\n${c.dim}Results saved to ${outputPath}${c.reset}`);
    }
  }

  // Final cleanup
  await cleanup().catch(() => {});
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(`${c.red}Fatal error: ${err.message}${c.reset}`);
    process.exit(1);
  });
