# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-02-12

### Added
- **Stealth Mode** (CRITICAL differentiator)
  - Added `playwright-extra` and `puppeteer-extra-plugin-stealth` dependencies
  - New `--stealth` flag in CLI to bypass bot detection
  - `stealth: true` option in library API
  - `stealth` parameter in MCP `webpeel_fetch` tool
  - Smart escalation now tries stealth mode as fallback when browser mode gets blocked (403, CAPTCHA)
  - Stealth plugin handles: navigator.webdriver, chrome.runtime, WebGL vendor, languages, permissions, codecs, etc.

- **Crawl Mode** (Firecrawl's killer feature)
  - New `webpeel crawl` CLI command with options: `--max-pages`, `--max-depth`, `--allowed-domains`, `--exclude`, `--ignore-robots`, `--rate-limit`
  - New `crawl(url, options)` function export in library API
  - New `webpeel_crawl` MCP tool for Claude/Cursor
  - Crawls starting URL and follows links matching domain/pattern
  - Respects robots.txt by default (can be disabled with `--ignore-robots`)
  - Rate limiting between requests (default 1 req/sec, honors `Crawl-delay` directive)
  - Maximum pages limit (default 10, max 100)
  - Maximum depth limit (default 2, max 5)
  - Returns array of `{url, markdown, title, links, depth, parent, elapsed, error?}` objects

- **Landing Page Improvements**
  - Added "Works with" section showing Claude, Cursor, VS Code, Windsurf, Cline, OpenAI
  - Updated comparison table with "Stealth mode" and "Crawl mode" rows
  - Updated terminal demo to show `--stealth` flag example
  - Updated meta description to mention stealth and crawl modes
  - Updated stats: "5 modes" (HTTP → Browser → Stealth → Crawl → CAPTCHA)

- **README Improvements**
  - Added GitHub stars badge
  - Added "Why WebPeel?" section with 3 clear value propositions
  - Added quick comparison table at top (vs Firecrawl, Jina, MCP Fetch)
  - Added stealth mode and crawl mode examples to CLI section
  - Updated feature comparison table with stealth and crawl rows

### Changed
- Package version bumped to 0.3.0 in package.json, CLI, and MCP server
- Package description updated to mention stealth mode and crawl mode
- Method return value now includes 'stealth' as possible value (in addition to 'simple' and 'browser')

## [0.1.2] - 2026-02-12

### Changed
- npm package slimmed down: server code excluded (216KB removed), server deps moved to optional
- GitHub Actions keepalive workflow to prevent Render cold starts

### Fixed
- README "Hosted API" section updated (was "Coming Soon", now has live URL and curl examples)
- Pricing synced between README and landing page (removed pay-per-use track from README)

## [0.1.1] - 2026-02-12

### Added
- Free tier card on pricing page (500 pages/month, HTTP only)
- OG image, favicon (SVG/ICO/PNG), apple-touch-icon
- Email capture form on landing page
- MCP tool annotations (`readOnlyHint`, `idempotentHint`, `openWorldHint`)
- AI discoverability files: `.well-known/ai-plugin.json`, `llms.txt`, `server.json`
- GitHub issue templates and FUNDING.yml
- Sitemap and robots.txt

### Changed
- Landing page redesigned (Resend-inspired, violet accent on pure black)
- Premium effects: aurora background, noise texture, mouse-tracking glow, animated gradient borders
- Expanded npm keywords to 23 for discoverability

### Fixed
- Fixed `import { fetch }` → `import { peel }` in landing page code example
- Fixed MCP config `--mcp` → `mcp` in landing page
- Fixed hash-only link extraction in metadata.ts
- Fixed integration test URL trailing slash
- Fixed npm bin field path (`./dist/cli.js` → `dist/cli.js`)
- CLI version string now matches package.json

## [0.1.0] - 2026-02-12

### Added
- Initial release
- CLI with smart fetch (simple → browser → stealth escalation)
- Markdown output optimized for LLMs
- MCP server for Claude Desktop and Cursor
- DuckDuckGo search integration
- TypeScript support with full type definitions
- Self-hosted API server mode (`webpeel serve`)
- Configuration via `.webpeelrc` or inline options
- Automatic Cloudflare bypass
- JavaScript rendering with Playwright
- Stealth mode with playwright-extra
- Zero-config setup

[0.1.1]: https://github.com/JakeLiuMe/webpeel/releases/tag/v0.1.1
[0.1.0]: https://github.com/JakeLiuMe/webpeel/releases/tag/v0.1.0
