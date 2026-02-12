#!/usr/bin/env node
/**
 * Generate OG image (1200x630) and favicon (32x32, 180x180) using Playwright
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const siteDir = join(__dirname, '..', 'site');

// ═══ OG IMAGE HTML (1200×630) ═══
const ogHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width:1200px; height:630px; overflow:hidden;
    background:#000; color:#FAFAFA;
    font-family:'Inter',sans-serif;
    position:relative;
    display:flex; align-items:center; justify-content:center;
  }
  /* Aurora blobs */
  .orb1 {
    position:absolute; top:-120px; left:60px;
    width:600px; height:400px; border-radius:50%;
    background:radial-gradient(circle, rgba(139,92,246,0.2), transparent 70%);
    filter:blur(80px);
  }
  .orb2 {
    position:absolute; bottom:-80px; right:40px;
    width:500px; height:350px; border-radius:50%;
    background:radial-gradient(circle, rgba(99,102,241,0.12), transparent 70%);
    filter:blur(80px);
  }
  .orb3 {
    position:absolute; top:40%; left:35%;
    width:300px; height:250px; border-radius:50%;
    background:radial-gradient(circle, rgba(168,85,247,0.08), transparent 70%);
    filter:blur(60px);
  }
  /* Grid */
  .grid {
    position:absolute; inset:0;
    background-image:
      linear-gradient(rgba(255,255,255,0.025) 1px,transparent 1px),
      linear-gradient(90deg,rgba(255,255,255,0.025) 1px,transparent 1px);
    background-size:48px 48px;
    mask-image:radial-gradient(ellipse 80% 70% at 50% 50%,black,transparent);
    -webkit-mask-image:radial-gradient(ellipse 80% 70% at 50% 50%,black,transparent);
  }
  /* Noise */
  .noise {
    position:absolute; inset:0; opacity:0.04; mix-blend-mode:overlay;
    background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size:200px;
  }
  /* Content */
  .content {
    position:relative; z-index:1; text-align:center;
    display:flex; flex-direction:column; align-items:center;
  }
  .logo-row {
    display:flex; align-items:center; gap:14px; margin-bottom:32px;
  }
  .logo-text {
    font-size:28px; font-weight:700; letter-spacing:-0.02em;
  }
  .logo-text span { color:#A78BFA; }
  .badge {
    display:inline-flex; align-items:center; gap:6px;
    padding:4px 12px; background:rgba(139,92,246,0.08);
    border:1px solid rgba(139,92,246,0.15); border-radius:100px;
    font-size:12px; color:#A78BFA; font-weight:500;
    margin-bottom:28px;
  }
  .badge .dot {
    width:6px; height:6px; background:#A78BFA;
    border-radius:50%; box-shadow:0 0 8px #8B5CF6;
  }
  h1 {
    font-size:72px; font-weight:800; line-height:1.05;
    letter-spacing:-0.04em; margin-bottom:20px;
  }
  h1 .accent {
    background:linear-gradient(135deg,#C4B5FD,#8B5CF6,#C084FC,#A78BFA);
    -webkit-background-clip:text; -webkit-text-fill-color:transparent;
    background-clip:text;
  }
  .sub {
    font-size:20px; color:#A1A1AA; max-width:600px; line-height:1.6;
    margin-bottom:36px;
  }
  .terminal {
    background:rgba(8,8,12,0.9); border:1px solid rgba(255,255,255,0.08);
    border-radius:10px; padding:14px 20px; text-align:left;
    font-family:'JetBrains Mono',monospace; font-size:14px;
    display:flex; gap:8px; align-items:center;
    box-shadow:0 20px 60px rgba(0,0,0,0.5);
    position:relative;
  }
  .terminal::before {
    content:''; position:absolute; top:0; left:15%; right:15%; height:1px;
    background:linear-gradient(90deg,transparent,rgba(139,92,246,0.3),transparent);
  }
  .prompt { color:#A78BFA; }
  .cmd { color:#FAFAFA; }
  /* Edge glow lines */
  .top-line {
    position:absolute; top:0; left:10%; right:10%; height:1px;
    background:linear-gradient(90deg,transparent,rgba(139,92,246,0.25),transparent);
  }
  .bottom-line {
    position:absolute; bottom:0; left:15%; right:15%; height:1px;
    background:linear-gradient(90deg,transparent,rgba(139,92,246,0.15),transparent);
  }
</style>
</head>
<body>
  <div class="orb1"></div>
  <div class="orb2"></div>
  <div class="orb3"></div>
  <div class="grid"></div>
  <div class="noise"></div>
  <div class="top-line"></div>
  <div class="bottom-line"></div>
  <div class="content">
    <div class="logo-row">
      <svg width="36" height="36" viewBox="0 0 28 28" fill="none">
        <rect x="3" y="2" width="22" height="24" rx="4" fill="rgba(139,92,246,0.2)" stroke="rgba(139,92,246,0.4)" stroke-width="1"/>
        <path d="M9 9h6M9 13h10M9 17h8" stroke="#A78BFA" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M19 2v5a2 2 0 002 2h4" stroke="#8B5CF6" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M19 2l6 7" stroke="#8B5CF6" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      <span class="logo-text">web<span>peel</span></span>
    </div>
    <h1>Web fetching<br><span class="accent">for AI agents.</span></h1>
    <p class="sub">Smart fetcher that auto-escalates from HTTP to headless browser. MCP server for Claude, Cursor & VS Code.</p>
    <div class="terminal">
      <span class="prompt">$</span>
      <span class="cmd">npx webpeel https://example.com</span>
    </div>
  </div>
</body>
</html>`;

// ═══ FAVICON SVG ═══
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="#0f0a1a" rx="4"/>
  <path d="M6 3h14l7 7v18a3 3 0 01-3 3H6a3 3 0 01-3-3V6a3 3 0 013-3z" fill="#F5F3FF" fill-opacity="0.92"/>
  <path d="M20 3v5a2 2 0 002 2h5" fill="#8B5CF6"/>
  <path d="M8 16h10" stroke="#8B5CF6" stroke-width="2.5" stroke-linecap="round"/>
  <path d="M8 21h14" stroke="#A78BFA" stroke-width="2.5" stroke-linecap="round"/>
</svg>`;

// ═══ Apple Touch Icon HTML (180×180) ═══
const touchIconHtml = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;width:180px;height:180px;background:linear-gradient(135deg,#0f0a1a,#1a1030);display:flex;align-items:center;justify-content:center;border-radius:38px;overflow:hidden;position:relative">
  <div style="position:absolute;inset:0;background:radial-gradient(circle at 30% 30%,rgba(139,92,246,0.2),transparent 60%)"></div>
  <svg width="96" height="96" viewBox="0 0 32 32" fill="none" style="position:relative">
    <!-- Main document body -->
    <path d="M6 4h14l6 6v18a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3z" fill="#F5F3FF" fill-opacity="0.95"/>
    <!-- Fold -->
    <path d="M20 4v6a2 2 0 002 2h6" fill="#8B5CF6"/>
    <path d="M20 4l8 8" stroke="none"/>
    <!-- Text lines -->
    <path d="M8 16h10" stroke="#8B5CF6" stroke-width="2" stroke-linecap="round"/>
    <path d="M8 20h14" stroke="#A78BFA" stroke-width="2" stroke-linecap="round"/>
    <path d="M8 24h8" stroke="#C4B5FD" stroke-width="2" stroke-linecap="round"/>
  </svg>
</body>
</html>`;

// ═══ Favicon 32x32 HTML ═══
const favicon32Html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;width:32px;height:32px;background:#0f0a1a;display:flex;align-items:center;justify-content:center;">
  <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
    <path d="M6 3h14l7 7v18a3 3 0 01-3 3H6a3 3 0 01-3-3V6a3 3 0 013-3z" fill="#F5F3FF" fill-opacity="0.92"/>
    <path d="M20 3v5a2 2 0 002 2h5" fill="#8B5CF6"/>
    <path d="M8 16h10" stroke="#8B5CF6" stroke-width="2.5" stroke-linecap="round"/>
    <path d="M8 21h14" stroke="#A78BFA" stroke-width="2.5" stroke-linecap="round"/>
  </svg>
</body>
</html>`;

async function main() {
  console.log('Launching browser...');
  const browser = await chromium.launch();
  
  try {
    // ═══ OG IMAGE ═══
    console.log('Generating og-image.png (1200×630)...');
    const ogPage = await browser.newPage({ viewport: { width: 1200, height: 630 } });
    await ogPage.setContent(ogHtml, { waitUntil: 'networkidle' });
    // Wait for fonts to load
    await ogPage.waitForTimeout(2000);
    await ogPage.screenshot({ path: join(siteDir, 'og-image.png'), type: 'png' });
    console.log('✓ og-image.png');

    // ═══ FAVICON 32×32 PNG ═══
    console.log('Generating favicon-32x32.png...');
    const fav32Page = await browser.newPage({ viewport: { width: 32, height: 32 } });
    await fav32Page.setContent(favicon32Html);
    await fav32Page.screenshot({ path: join(siteDir, 'favicon-32x32.png'), type: 'png' });
    console.log('✓ favicon-32x32.png');

    // ═══ APPLE TOUCH ICON ═══
    console.log('Generating apple-touch-icon.png (180×180)...');
    const touchPage = await browser.newPage({ viewport: { width: 180, height: 180 } });
    await touchPage.setContent(touchIconHtml);
    await touchPage.waitForTimeout(500);
    await touchPage.screenshot({ path: join(siteDir, 'apple-touch-icon.png'), type: 'png' });
    console.log('✓ apple-touch-icon.png');

    // ═══ FAVICON SVG ═══
    writeFileSync(join(siteDir, 'favicon.svg'), faviconSvg);
    console.log('✓ favicon.svg');

    // ═══ FAVICON ICO (use 32x32 PNG as base — browsers accept PNG in .ico) ═══
    // Modern browsers accept PNG-in-ICO. Copy the 32x32 PNG as favicon.ico
    const { copyFileSync } = await import('fs');
    copyFileSync(join(siteDir, 'favicon-32x32.png'), join(siteDir, 'favicon.ico'));
    console.log('✓ favicon.ico');

    console.log('\n✅ All assets generated in site/');
  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
