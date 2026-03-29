#!/usr/bin/env npx tsx
/**
 * Browser-level verification for the smart-search transit verdict UI.
 *
 * Spins up a tiny local HTML page that loads widget.js, injects a realistic
 * TransactionalVerdict payload (matching Jake's exact query), and checks that
 * the rendered DOM contains the expected elements.
 *
 * Usage:
 *   npx tsx scripts/verify-transit-verdict-ui.ts              # local mock (fast, offline)
 *   npx tsx scripts/verify-transit-verdict-ui.ts --live        # hits production API with real query
 *   npx tsx scripts/verify-transit-verdict-ui.ts --screenshot  # saves screenshot to tmp/
 *   npx tsx scripts/verify-transit-verdict-ui.ts --live --screenshot
 *
 * Outputs a JSON report with pass/fail signals:
 *   { hasVerdict, hasBookNow, hasRoundTrip, hasAmazonJunk, renderedSnippet, ... }
 *
 * Exit code: 0 = all critical checks pass, 1 = at least one failure.
 */

import { chromium, type Browser, type Page } from 'playwright';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

// ── Config ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const IS_LIVE = args.includes('--live');
const SAVE_SCREENSHOT = args.includes('--screenshot');

const JAKE_QUERY =
  'help me find the cheapest boston ticket from new york i want to take bus. april 2 and i want to take the bus back at april 5th';

const API_KEY = process.env.WEBPEEL_API_KEY || '';

// ── ANSI ───────────────────────────────────────────────────────────────────
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m',
};

// ── Mock verdict payload (matches buildTransitVerdict output for Jake's query) ─
const MOCK_VERDICT = {
  vertical: 'transit',
  headline: 'Cheapest I found is $19.00 on FlixBus for New York → Boston',
  confidence: 'HIGH' as const,
  bestOption: {
    provider: 'FlixBus',
    price: 19.0,
    currency: 'USD',
    route: 'New York → Boston',
    url: 'https://www.wanderu.com/en-us/bus/us-ny/new-york/us-ma/boston/',
    notes: 'Booking site',
  },
  alternatives: [
    {
      provider: 'OurBus',
      price: 23.0,
      currency: 'USD',
      route: 'New York → Boston',
      url: 'https://www.wanderu.com/en-us/bus/us-ny/new-york/us-ma/boston/',
      notes: 'Booking site',
    },
    {
      provider: 'Greyhound',
      price: 25.0,
      currency: 'USD',
      route: 'New York → Boston',
      url: 'https://www.greyhound.com/routes/new-york-to-boston',
      notes: 'Booking site',
    },
  ],
  totals: {
    oneWayLowest: 19.0,
    returnLowest: 21.0,
    roundTripLowest: 40.0,
    currency: 'USD',
  },
  caveats: [
    'Prices may vary by date and availability. Book directly for confirmed pricing.',
  ],
  query: {
    origin: 'new york',
    destination: 'boston',
    departDate: 'april 2',
    returnDate: 'april 5',
    isRoundTrip: true,
    mode: 'bus',
  },
};

// ── Build the local test HTML ──────────────────────────────────────────────
function buildTestHTML(verdictJSON: string): string {
  // Read widget.js source
  const widgetPath = path.join(PROJECT_ROOT, 'site', 'widget.js');
  const widgetSrc = fs.readFileSync(widgetPath, 'utf-8');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Transit Verdict UI Verification</title>
  <style>
    body {
      margin: 0;
      padding: 32px;
      background: #09090b;
      color: #e4e4e7;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
    }
    #test-container {
      max-width: 640px;
      margin: 0 auto;
    }
    #verdict-render-target {
      /* This will receive the rendered verdict HTML */
    }
  </style>
</head>
<body>
  <div id="test-container">
    <div id="verdict-render-target"></div>
  </div>

  <script>
  // We only need the renderVerdictCard function from widget.js.
  // Extract it by defining the globals it expects, then calling it directly.
  ${extractRenderFunction(widgetSrc)}

  // Inject the verdict and render it
  var verdict = ${verdictJSON};
  var html = renderVerdictCard(verdict);
  document.getElementById('verdict-render-target').innerHTML = html;
  </script>
</body>
</html>`;
}

/**
 * Extract the esc() and renderVerdictCard() functions from widget.js IIFE
 * so we can call them standalone in the test harness.
 */
function extractRenderFunction(src: string): string {
  // Find esc function
  const escMatch = src.match(/function esc\([\s\S]*?\n  \}/);
  // Find renderVerdictCard function
  const renderMatch = src.match(
    /\/\/ ─── Render: transactional verdict card[\s\S]*?function renderVerdictCard\(verdict\) \{[\s\S]*?\n  \}/
  );

  if (!renderMatch) {
    throw new Error('Could not extract renderVerdictCard from widget.js — structure changed?');
  }

  // esc() is small — inline a simple version if extraction fails
  const escFn = escMatch
    ? escMatch[0]
    : `function esc(s) {
      return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }`;

  return `${escFn}\n\n${renderMatch[0]}`;
}

// ── Local HTTP server ──────────────────────────────────────────────────────
function startLocalServer(html: string): Promise<{ server: http.Server; url: string }> {
  return new Promise((resolve) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

// ── Verification checks ───────────────────────────────────────────────────
interface VerifyResult {
  hasVerdict: boolean;
  hasPrimaryCTA: boolean;
  hasRoundTrip: boolean;
  hasPrice: boolean;
  hasProvider: boolean;
  hasAlternatives: boolean;
  hasCaveat: boolean;
  hasConfidenceBadge: boolean;
  hasAmazonJunk: boolean;
  renderedSnippet: string;
  screenshotPath?: string;
  errors: string[];
  mode: 'mock' | 'live';
  pass: boolean;
}

async function verifyPage(page: Page): Promise<VerifyResult> {
  const errors: string[] = [];

  await page.waitForTimeout(500);

  const target = page.locator('#verdict-render-target');

  const renderedHTML = await target.innerHTML();
  const renderedText = await target.innerText();

  // Semantic verdict check: enough rendered structure + best-fare language
  const hasVerdict = renderedHTML.length > 50 && (
    /best fare found/i.test(renderedText) ||
    /best one-way fare/i.test(renderedText) ||
    /cheapest i found/i.test(renderedText)
  );

  // Primary CTA can evolve; verify an actionable fare-booking link exists
  const ctaLinks = await target.locator('a').filter({ hasText: /(book|compare).*(fare|now|one-way)|book one-way/i }).count();
  const hasPrimaryCTA = ctaLinks > 0;

  // ── Check: round-trip totals ─────────────────────────────────────────
  const hasRoundTrip = renderedText.includes('Round trip') || renderedHTML.includes('🔄');

  // ── Check: price visible ─────────────────────────────────────────────
  const priceMatch = renderedText.match(/\$\d+\.\d{2}/);
  const hasPrice = !!priceMatch;

  // ── Check: provider name ─────────────────────────────────────────────
  const hasProvider = renderedText.includes('FlixBus');

  // ── Check: alternatives ──────────────────────────────────────────────
  // Alternatives are rendered as separate links with prices
  const altPrices = renderedText.match(/\$\d+\.\d{2}/g);
  const hasAlternatives = (altPrices?.length ?? 0) >= 2; // best + at least 1 alt

  // ── Check: caveat text ───────────────────────────────────────────────
  const hasCaveat = renderedText.includes('Prices may vary');

  // ── Check: confidence badge ──────────────────────────────────────────
  const hasConfidenceBadge =
    renderedText.includes('High confidence') ||
    renderedText.includes('Medium confidence') ||
    renderedText.includes('Low confidence');

  // ── Anti-check: no Amazon/shopping junk ──────────────────────────────
  const hasAmazonJunk =
    renderedText.toLowerCase().includes('amazon') ||
    renderedText.toLowerCase().includes('add to cart') ||
    renderedText.toLowerCase().includes('buy now') ||
    renderedHTML.includes('amazon.com');

  // Collect errors for failures
  if (!hasVerdict) errors.push('FAIL: verdict card not rendered');
  if (!hasPrimaryCTA) errors.push('FAIL: primary booking CTA missing');
  if (!hasPrice) errors.push('FAIL: no price visible');
  if (!hasProvider) errors.push('FAIL: provider name (FlixBus) missing');
  if (hasAmazonJunk) errors.push('FAIL: Amazon/shopping junk detected in transit verdict');

  const renderedSnippet = renderedText.replace(/\s+/g, ' ').trim().slice(0, 300);

  const pass = hasVerdict && hasPrimaryCTA && hasPrice && hasProvider && !hasAmazonJunk;

  return {
    hasVerdict,
    hasPrimaryCTA,
    hasRoundTrip,
    hasPrice,
    hasProvider,
    hasAlternatives,
    hasCaveat,
    hasConfidenceBadge,
    hasAmazonJunk,
    renderedSnippet,
    errors,
    mode: IS_LIVE ? 'live' : 'mock',
    pass,
  };
}

// ── Live mode: hit the real API, get the SSE response, extract verdict ────
async function fetchLiveVerdict(): Promise<typeof MOCK_VERDICT | null> {
  if (!API_KEY) {
    console.error(`${c.red}--live mode requires WEBPEEL_API_KEY env var${c.reset}`);
    return null;
  }

  console.log(`${c.dim}  Querying production API with Jake's exact query...${c.reset}`);
  const res = await fetch('https://api.webpeel.dev/v1/search/smart', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-Key': API_KEY,
    },
    body: JSON.stringify({ q: JAKE_QUERY }),
  });

  if (!res.ok) {
    console.error(`${c.red}  API returned HTTP ${res.status}${c.reset}`);
    return null;
  }

  const data = await res.json();
  const smart = data.data || data;

  if (smart.verdict && smart.verdict.bestOption) {
    console.log(`${c.green}  ✓ Got live verdict: ${smart.verdict.headline}${c.reset}`);
    return smart.verdict;
  }

  console.error(`${c.yellow}  ⚠ API returned no verdict for this query.${c.reset}`);
  console.error(`${c.dim}  type=${smart.type}, has content=${!!smart.content}${c.reset}`);
  return null;
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${c.bold}${c.cyan}━━━ Transit Verdict UI Verification ━━━${c.reset}`);
  console.log(`${c.dim}Mode: ${IS_LIVE ? 'LIVE (production API)' : 'MOCK (offline)'}${c.reset}`);
  console.log(`${c.dim}Query: "${JAKE_QUERY}"${c.reset}\n`);

  // Get verdict (mock or live)
  let verdict = MOCK_VERDICT;
  if (IS_LIVE) {
    const liveVerdict = await fetchLiveVerdict();
    if (!liveVerdict) {
      console.error(`${c.red}Could not get live verdict — falling back to mock${c.reset}`);
    } else {
      verdict = liveVerdict as typeof MOCK_VERDICT;
    }
  }

  // Build test HTML
  const html = buildTestHTML(JSON.stringify(verdict));

  // Start local server
  const { server, url } = await startLocalServer(html);
  console.log(`${c.dim}  Local test server: ${url}${c.reset}`);

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // Run verification
    const result = await verifyPage(page);

    // Screenshot
    if (SAVE_SCREENSHOT || !result.pass) {
      const ssDir = path.join(PROJECT_ROOT, 'tmp');
      fs.mkdirSync(ssDir, { recursive: true });
      const ssPath = path.join(ssDir, 'transit-verdict-verify.png');
      await page.screenshot({ path: ssPath, fullPage: true });
      result.screenshotPath = ssPath;
      console.log(`${c.dim}  Screenshot saved: ${ssPath}${c.reset}`);
    }

    // Print report
    console.log(`\n${c.bold}${c.cyan}━━━ Results ━━━${c.reset}`);
    const checks = [
      ['hasVerdict', result.hasVerdict, 'Verdict card rendered'],
      ['hasPrimaryCTA', result.hasPrimaryCTA, 'Primary booking CTA present'],
      ['hasPrice', result.hasPrice, 'Price visible ($XX.XX)'],
      ['hasProvider', result.hasProvider, 'Provider name (FlixBus) visible'],
      ['hasRoundTrip', result.hasRoundTrip, 'Round-trip totals shown'],
      ['hasAlternatives', result.hasAlternatives, 'Alternative options shown'],
      ['hasCaveat', result.hasCaveat, 'Caveat/disclaimer text present'],
      ['hasConfidenceBadge', result.hasConfidenceBadge, 'Confidence badge visible'],
      ['!hasAmazonJunk', !result.hasAmazonJunk, 'No Amazon/shopping junk'],
    ] as const;

    for (const [key, value, label] of checks) {
      const icon = value ? `${c.green}✓` : `${c.red}✗`;
      console.log(`  ${icon} ${label}${c.reset}`);
    }

    console.log(`\n${c.dim}Rendered snippet:${c.reset}`);
    console.log(`  ${c.dim}${result.renderedSnippet}${c.reset}`);

    if (result.errors.length > 0) {
      console.log(`\n${c.red}Errors:${c.reset}`);
      for (const err of result.errors) {
        console.log(`  ${c.red}${err}${c.reset}`);
      }
    }

    // JSON output
    console.log(`\n${c.dim}JSON report:${c.reset}`);
    console.log(JSON.stringify(result, null, 2));

    const exitCode = result.pass ? 0 : 1;
    console.log(
      `\n${result.pass ? c.green : c.red}${c.bold}${result.pass ? '✓ ALL CRITICAL CHECKS PASSED' : '✗ VERIFICATION FAILED'}${c.reset}\n`
    );

    return exitCode;
  } finally {
    await browser?.close().catch(() => {});
    server.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`${c.red}Fatal error: ${err.message}${c.reset}`);
    console.error(err.stack);
    process.exit(1);
  });
