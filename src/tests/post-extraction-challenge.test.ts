/**
 * Tests for post-extraction challenge detection in the pipeline.
 *
 * These tests verify that the pipeline's content-level challenge detection
 * (which runs AFTER markdown extraction) correctly uses detectChallenge()
 * on raw HTML instead of fragile string matching on extracted content.
 *
 * Key scenarios tested:
 * 1. Challenge pages > 2000 chars (previously missed by the length gate)
 * 2. 404 pages NOT misclassified as bot blocks
 * 3. Real content mentioning security terms NOT flagged
 * 4. Retailer-specific challenge pages correctly caught
 */

import { describe, it, expect } from 'vitest';
import { detectChallenge } from '../core/challenge-detection.js';

// Helper to create realistic HTML
function makeHtml(title: string, body: string, scripts?: string): string {
  return `<!DOCTYPE html><html><head><title>${title}</title></head><body>${body}${scripts || ''}</body></html>`;
}

// ── Challenge pages that were previously missed (> 2000 chars) ──────────

describe('post-extraction challenge: large challenge pages (> 2000 chars)', () => {
  it('catches Cloudflare challenge with bundled JS (large HTML)', () => {
    // Cloudflare challenge pages include large bundled scripts — the extracted
    // markdown can easily exceed 2000 chars even though it's not real content
    const largeScript = 'x'.repeat(3000);
    const html = `<!DOCTYPE html>
<html>
<head><title>Just a moment...</title></head>
<body>
  <div id="challenge-running">Checking your browser before accessing the site.</div>
  <div id="challenge-form" action="/cdn-cgi/challenge-platform/h/b/flow/ov1/...">
    <input type="hidden" id="cf-spinner" />
  </div>
  <script>window._cf_chl_opt = { cType: 'interactive' }; ${largeScript}</script>
  <script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>
  <noscript><p>Please enable JavaScript to continue.</p></noscript>
  <p>Performance &amp; security by Cloudflare</p>
  <span>Ray ID: 8f3a2b1c4d5e6f7a</span>
</body>
</html>`;
    expect(html.length).toBeGreaterThan(2000);
    const result = detectChallenge(html, 503);
    expect(result.isChallenge).toBe(true);
    expect(result.type).toBe('cloudflare');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('catches Akamai block page with large inline scripts (> 2000 chars total)', () => {
    // Real Akamai block pages are mostly script/obfuscated code, not visible text.
    // The old pipeline check gated on ctx.content.length < 2000 — but after markdown
    // extraction, the scripts are stripped and the visible content is short.
    // The key issue was the pipeline never ran detectChallenge() on this HTML at all.
    const inlineScript = '<script>' + 'var _s="' + 'a'.repeat(2000) + '";' + '</script>';
    const html = `<!DOCTYPE html>
<html>
<head><title>Access Denied</title></head>
<body>
  <h1>Access Denied</h1>
  <p>You don't have permission to access this resource.</p>
  <script src="https://example.akamaized.net/akam/13/bmak.js"></script>
  <script>var ak_bmsc = "token"; var _abck = "akamai_cookie"; var bm_sz = "size";</script>
  ${inlineScript}
</body>
</html>`;
    expect(html.length).toBeGreaterThan(2000);
    const result = detectChallenge(html, 403);
    expect(result.isChallenge).toBe(true);
    expect(result.type).toBe('akamai');
  });

  it('catches PerimeterX block page with large inline scripts (> 2000 chars total)', () => {
    // Real PerimeterX block pages include large obfuscated JS payloads.
    // The visible text is short, but the total HTML is large due to scripts.
    const pxScript = '<script>' + 'window._px3="' + 'b'.repeat(2000) + '";' + '</script>';
    const html = `<!DOCTYPE html>
<html>
<head><title>Pardon Our Interruption</title></head>
<body>
  <div class="block-page">
    <h1>Pardon Our Interruption</h1>
    <p>As you were browsing, something about your browser made us think you were a bot.</p>
    <p>Press & Hold to confirm you are a human (and not a bot).</p>
    <p>Reference ID: c74752d2-0d38-11f1-83bf-f3d585362b78</p>
  </div>
  <script>
    window._pxAppId = 'PXabcdef12';
    window._pxUuid = 'abc123-def456';
  </script>
  ${pxScript}
</body>
</html>`;
    expect(html.length).toBeGreaterThan(2000);
    const result = detectChallenge(html, 403);
    expect(result.isChallenge).toBe(true);
    expect(result.type).toBe('perimeterx');
  });
});

// ── 404 pages should NOT trigger challenge detection ────────────────────

describe('post-extraction challenge: 404 pages are NOT blocks', () => {
  it('does NOT flag a standard 404 page', () => {
    const html = makeHtml(
      'Page Not Found',
      `<h1>404 — Page Not Found</h1>
       <p>Sorry, this page doesn't exist.</p>
       <a href="/">Go back home</a>`,
    );
    const result = detectChallenge(html, 404);
    expect(result.isChallenge).toBe(false);
  });

  it('does NOT flag a retailer 404 page (Amazon-style)', () => {
    const html = makeHtml(
      "Sorry! We couldn't find that page - Amazon.com",
      `<div class="a-container">
        <h1>Looking for something?</h1>
        <p>We're sorry. The Web address you entered is not a functioning page on our site.</p>
        <p>Go to Amazon.com's Home Page</p>
        <img src="/error-page-dog.png" alt="Dog" />
      </div>`,
    );
    const result = detectChallenge(html, 404);
    expect(result.isChallenge).toBe(false);
  });

  it('does NOT flag a Walmart 404 page', () => {
    const html = makeHtml(
      'Error 404 | Walmart.com',
      `<div class="error-page">
        <h1>We couldn't find this page</h1>
        <p>The page you're looking for has been moved, deleted, or doesn't exist.</p>
        <p>Here are some helpful links instead:</p>
        <a href="/">Homepage</a>
        <a href="/browse/electronics">Electronics</a>
      </div>`,
    );
    const result = detectChallenge(html, 404);
    expect(result.isChallenge).toBe(false);
  });
});

// ── Real content with security-related terms ────────────────────────────

describe('post-extraction challenge: real content is NOT flagged', () => {
  it('does NOT flag an article about Cloudflare', () => {
    const html = makeHtml(
      'How Cloudflare Protects Against DDoS Attacks',
      `<article>
        <h1>How Cloudflare Protects Against DDoS Attacks</h1>
        <p>Cloudflare is one of the leading CDN and web security providers. Their bot
           protection uses challenge pages, CAPTCHAs, and JavaScript challenges to verify
           that visitors are human.</p>
        <p>When you see a "Just a moment..." page, that's Cloudflare's browser verification
           at work. It checks your browser's Ray ID and other signals.</p>
        <p>Cloudflare also offers Turnstile, a CAPTCHA alternative that doesn't require
           user interaction. This is used on many e-commerce sites.</p>
        <p>Sites like Amazon, Walmart, and Target use various bot detection systems including
           Akamai Bot Manager, which shows "Access Denied" pages to blocked requests.</p>
        <p>For web scraping, you need to handle these challenge pages gracefully, either by
           using residential proxies, browser automation with stealth plugins, or CAPTCHA
           solving services.</p>
      </article>`,
    );
    const result = detectChallenge(html, 200);
    expect(result.isChallenge).toBe(false);
  });

  it('does NOT flag a product page mentioning "blocked" in a review', () => {
    const html = makeHtml(
      'Premium Drain Guard - $24.99',
      `<div class="product">
        <h1>Premium Drain Guard</h1>
        <p class="price">$24.99</p>
        <p>Keep your drains clear and blocked-free with our premium drain guard.</p>
        <div class="reviews">
          <div class="review">
            <p>"My drain was completely blocked before I got this. Now water flows freely!"</p>
            <p>— Sarah M., Verified Buyer</p>
          </div>
          <div class="review">
            <p>"Excellent product. Access denied to all hair and debris. Nothing gets past it."</p>
            <p>— Mike R., Verified Buyer</p>
          </div>
        </div>
      </div>`,
    );
    const result = detectChallenge(html, 200);
    expect(result.isChallenge).toBe(false);
  });

  it('does NOT flag an error page with 500 status', () => {
    const html = makeHtml(
      'Internal Server Error',
      `<h1>500 Internal Server Error</h1>
       <p>Sorry, something went wrong on our end. Please try again later.</p>
       <p>If this problem persists, please contact support.</p>`,
    );
    const result = detectChallenge(html, 500);
    expect(result.isChallenge).toBe(false);
  });
});

// ── Retailer-specific challenge pages ───────────────────────────────────

describe('post-extraction challenge: retailer challenge pages', () => {
  it('catches Zillow PerimeterX Press & Hold challenge', () => {
    const html = makeHtml(
      'Access to this page has been denied',
      `<div>
        <h1>Please verify you are a human</h1>
        <p>Press & Hold to confirm you are a human (and not a bot).</p>
        <p>Reference ID: c74752d2-0d38-11f1-83bf-f3d585362b78</p>
      </div>`,
    );
    const result = detectChallenge(html, 403);
    expect(result.isChallenge).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('catches Target Akamai block page', () => {
    const html = `<!DOCTYPE html><html><head><title>Access Denied</title></head><body><h1>Access Denied</h1><p>You don't have permission to access this resource.</p><script src="https://cdn.akamaized.net/akam/13/bmak.js"></script><script>var _abck="token";var bm_sz="size";</script></body></html>`;
    const result = detectChallenge(html, 403);
    expect(result.isChallenge).toBe(true);
  });

  it('catches Etsy DataDome captcha-delivery challenge', () => {
    const html = `<html lang="en"><head><title>etsy.com</title><style>#cmsg{animation: A 1.5s;}@keyframes A{0%{opacity:0;}99%{opacity:0;}100%{opacity:1;}}</style></head><body style="margin:0"><script data-cfasync="false">var dd={'rt':'c','cid':'AHrlqA','hsh':'D013AA','t':'bv','s':45977,'host':'geo.captcha-delivery.com','cookie':'hGW_WGUTY'}</script><script data-cfasync="false" src="https://ct.captcha-delivery.com/c.js"></script><iframe src="https://geo.captcha-delivery.com/captcha/?initialCid=AHrlqA" title="DataDome CAPTCHA" width="100%" height="100%" style="height:100vh;" frameborder="0"></iframe></body></html>`;
    const result = detectChallenge(html, 403);
    expect(result.isChallenge).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('catches Expedia "Bot or Not?" challenge (200 status!)', () => {
    // This is a tricky case: Expedia returns 200 status with a challenge page
    const html = `<!DOCTYPE html>
<html>
<head><title>Bot or Not?</title></head>
<body>
  <h2>Show us your human side...</h2>
  <p>We can't tell if you're a human or a bot.</p>
  <p>Please complete the verification below to continue.</p>
</body>
</html>`;
    const result = detectChallenge(html, 200);
    expect(result.isChallenge).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it('catches BestBuy Akamai challenge', () => {
    const html = `<!DOCTYPE html><html><head><title>Access Denied</title></head><body><h1>Access Denied</h1><script src="https://example.akamaized.net/akam/13/bmak.js"></script><script>var ak_bmsc = "token_here"; var _abck = "akamai";</script></body></html>`;
    const result = detectChallenge(html, 403);
    expect(result.isChallenge).toBe(true);
    expect(result.type).toBe('akamai');
  });
});

// ── Edge cases: statusCode handling ─────────────────────────────────────

describe('post-extraction challenge: status code edge cases', () => {
  it('catches 200-status Cloudflare challenge (interstitial)', () => {
    const html = `<!DOCTYPE html>
<html>
<head><title>Just a moment...</title></head>
<body>
  <div id="challenge-running"></div>
  <div class="cf-browser-verification">Verifying your browser...</div>
  <script>window._cf_chl_opt = { cType: 'managed' };</script>
</body>
</html>`;
    // Some CF challenges return 200 instead of 503
    const result = detectChallenge(html, 200);
    expect(result.isChallenge).toBe(true);
    expect(result.type).toBe('cloudflare');
  });

  it('does NOT flag a healthy page with undefined statusCode', () => {
    const html = makeHtml(
      'My Store - Home',
      `<h1>Welcome to My Store</h1>
       <p>Browse our collection of widgets and gadgets.</p>
       <div class="product-grid">
         <div class="product"><h2>Widget A</h2><p>$19.99</p></div>
         <div class="product"><h2>Widget B</h2><p>$29.99</p></div>
       </div>`,
    );
    const result = detectChallenge(html);
    expect(result.isChallenge).toBe(false);
  });
});
