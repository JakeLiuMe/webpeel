# WebPeel — Complete Feature Registry

Last updated: 2026-03-29

## 📦 CLI Commands

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `webpeel <url>` | Fetch URL as clean markdown (default) | `--render`, `--stealth`, `--json`, `--silent` |
| `webpeel read <url>` | Reader mode (article content only) | `--format text/html/markdown` |
| `webpeel search <query>` | Web search (DuckDuckGo free, Brave BYOK) | `--count`, `--scrapeResults` |
| `webpeel crawl <url>` | Crawl entire site | `--max-pages`, `--max-depth`, `--rate-limit` |
| `webpeel screenshot <url>` | Take screenshot | `--full-page`, `--device mobile/tablet` |
| `webpeel ask <url> <question>` | Ask about any page (BYOK LLM) | `--llm-key`, `--model` |
| `webpeel monitor <url>` | Content change detection | `--interval`, `--selector`, `--json` |
| `webpeel mcp` | Start MCP server for AI tools | 7 MCP tools exposed |

## 🔧 CLI Fetch Options (all work with default `fetch` command)

| Flag | Description |
|------|-------------|
| `--render` | Force headless browser (JS-heavy sites) |
| `--stealth` | Stealth mode (Cloudflare bypass) |
| `--device mobile/tablet` | Device emulation with user-agent |
| `--viewport WxH` | Custom viewport size |
| `--scale <factor>` | Device pixel density for screenshots |
| `--screenshot [path]` | Capture screenshot |
| `--full-page` | Full-page screenshot |
| `--action <json>` | Browser actions (click, type, scroll, wait) |
| `--selector <css>` | Extract only matching elements |
| `--exclude <css>` | Remove elements before extraction |
| `--extract-schema` | LLM extraction with JSON schema |
| `--scroll-extract` | Auto-scroll and extract (infinite scroll pages) |
| `--readable` | Reader mode (article content only) |
| `--format markdown/text/html/json` | Output format |
| `--json` | JSON output |
| `--silent` | No spinner/progress |
| `--no-cache` | Bypass cache |
| `--content-only` | Raw content only (for piping to LLMs) |
| `--progress` | Show engine escalation steps |
| `--proxy <url>` | HTTP/SOCKS5 proxy |
| `--viewport WxH` | Browser viewport size |
| `--wait <ms>` | Wait after page load |
| `--timeout <ms>` | Request timeout |
| `--cookie <key=val>` | Set cookies |
| `--ua <string>` | Custom user agent |
| `--images` | Extract image URLs |
| `--export srt/txt/md/json` | YouTube transcript export format |

## 🌐 API Endpoints

### Core
| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| GET/POST | `/v1/fetch` | Fetch & extract content | Optional |
| GET/POST | `/v1/search` | Web search | Optional |
| POST | `/v1/search/smart` | AI-powered smart search (structured results) | Optional |
| POST | `/v1/screenshot` | Screenshot API | Optional |
| POST | `/v1/answer` | Q&A with citations (BYOK LLM) | Optional |
| POST | `/v1/agent` | Autonomous research agent | Optional |
| POST | `/v1/crawl` | Crawl a site | Required |
| POST | `/v1/batch/scrape` | Batch scrape multiple URLs | Required |
| POST | `/v1/extract` | Schema-based structured extraction | Required |
| POST | `/v1/deep-research` | Deep research (multi-query) | Required |
| POST | `/v1/deep-fetch` | Deep fetch (multi-page) | Required |
| POST | `/v1/map` | Sitemap/URL discovery | Required |

### Screenshot Variants
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/screenshot` | Standard screenshot |
| POST | `/v1/screenshot/viewports` | Multi-viewport screenshots |
| POST | `/v1/screenshot/diff` | Visual diff between two URLs |
| POST | `/v1/screenshot/filmstrip` | Page load filmstrip |
| POST | `/v1/screenshot/design-audit` | AI design quality analysis |
| POST | `/v1/screenshot/design-analysis` | Detailed design analysis |

### Sessions (Persistent Browser)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/session` | Create browser session (login flows) |
| GET | `/v1/session/:id` | Get session status |
| POST | `/v1/session/:id/navigate` | Navigate within session |
| POST | `/v1/session/:id/act` | Perform actions in session |
| GET | `/v1/session/:id/cookies` | Get session cookies |
| GET | `/v1/session/:id/screenshot` | Screenshot current page |
| DELETE | `/v1/session/:id` | Close session |

### Content Monitoring
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/watch` | Create watch (monitor URL for changes) |
| GET | `/v1/watch` | List all watches |
| GET | `/v1/watch/:id` | Get watch status |
| PATCH | `/v1/watch/:id` | Update watch config |
| POST | `/v1/watch/:id/check` | Force immediate check |
| DELETE | `/v1/watch/:id` | Delete watch |

### Account & Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/auth/register` | Create account |
| POST | `/v1/auth/login` | Login |
| POST | `/v1/auth/oauth` | OAuth (Google) login |
| POST | `/v1/auth/refresh` | Refresh JWT |
| POST | `/v1/auth/revoke` | Revoke token |
| POST | `/v1/auth/recover` | Password recovery |
| GET | `/v1/me` | Get profile |
| PATCH | `/v1/me` | Update profile |
| GET | `/v1/usage` | Current usage & limits |
| GET | `/v1/usage/history` | Usage history |
| POST | `/v1/keys` | Create API key |
| GET | `/v1/keys` | List API keys |
| PATCH | `/v1/keys/:id` | Update key (scopes) |
| DELETE | `/v1/keys/:id` | Revoke key |
| DELETE | `/v1/account` | Delete account (GDPR) |
| POST | `/v1/billing/portal` | Stripe customer portal |

## 🏷️ Domain Extractors (55+ domains)

Structured extraction without browser rendering. Representative examples:

| Domain | Data Returned |
|--------|--------------|
| twitter/x.com | Tweets, profiles |
| reddit.com | Posts, comments, subreddits |
| github.com | Repos, issues, profiles |
| news.ycombinator.com | Stories, comments |
| wikipedia.org | Articles, tables (List_of pages) |
| youtube.com | Transcripts, metadata |
| arxiv.org | Papers, abstracts, authors |
| stackoverflow.com | Q&A, answers |
| npmjs.com | Package info |
| bestbuy.com | Products, prices |
| walmart.com | Products, prices |
| amazon.com | Products, prices, ratings |
| medium.com | Articles |
| substack.com | Articles |
| allrecipes.com | Recipes |
| imdb.com | Movies, ratings |
| linkedin.com | Companies, profiles |
| pypi.org | Packages |
| dev.to | Articles |
| craigslist.org | Listings |
| spotify.com | Tracks, playlists |
| tiktok.com | Videos |
| pinterest.com | Pins |
| nytimes.com | Articles |
| bbc.co.uk | Articles |
| cnn.com | Articles |
| twitch.tv | Clips |
| soundcloud.com | Tracks |
| instagram.com | Posts, profiles |

## 🔒 Security Features

| Feature | Status |
|---------|--------|
| SSRF protection (localhost, private IPs, metadata, file://) | ✅ |
| Helmet.js (HSTS, X-Frame-Options, nosniff, XSS) | ✅ |
| Rate limiting (sliding window, per-tier) | ✅ |
| API key hashing (SHA-256) | ✅ |
| OAuth 2.0 (Google) | ✅ |
| Key scopes (granular permissions) | ✅ |
| Audit logging (all /v1/ endpoints) | ✅ |
| Webhook HMAC-SHA256 signing | ✅ |
| GDPR data deletion endpoint | ✅ |
| X-Data-Retention header | ✅ |
| Input validation (URL length, protocol) | ✅ |
| CORS (configured origins, no credentials on wildcard) | ✅ |
| npm audit: 0 vulnerabilities | ✅ |
| .env excluded from git + npm | ✅ |
| SOC 2 Type II | ❌ (future) |
| 2FA/MFA | ❌ (future) |

## 📄 Site Pages (54 total)

### Marketing
- `/` — Landing page (9 feature cards, search widget, pricing)
- `/pricing` — 3 tiers (Free, Pro, Enterprise)
- `/security` — Security practices & trust page
- `/sla` — Service Level Agreement (99.9% uptime)
- `/status` — Service status
- `/changelog` — Product changelog
- `/playground` — Interactive API playground
- `/migrate-from-firecrawl` — Migration guide
- `/methodology` — Benchmark methodology

### Legal
- `/privacy` — Privacy policy
- `/terms` — Terms of service
- `/acceptable-use` — Acceptable use policy

### Blog (8 posts)
- `/blog/web-scraping-api-comparison-2025` — SEO: "best web scraping API 2025"
- `/blog/scrape-amazon-products-api` — SEO: "scrape Amazon products"
- `/blog/build-price-monitoring-bot` — SEO: "build price monitoring bot"
- `/blog/webpeel-vs-competitors` — Comparison
- `/blog/benchmarks` — Performance benchmarks
- `/blog/how-webpeel-works` — Architecture
- `/blog/best-mcp-web-fetcher` — MCP integration
- `/blog/reduce-llm-token-costs` — Token optimization

### Docs (31 pages)
- Quickstart, CLI, API Reference, Authentication, Fetch, Search, Crawl, Extract, Screenshot, MCP, Agents, Ask, Batch, Deep Research, Deep Fetch, Domain Extractors, Errors, Monitoring, Proxy, Quick Answer, Readability, SDKs, Self-Hosting, Sessions, Sessions & Cookies, YouTube, Changelog, Migrate from Firecrawl

### Developer Resources
- `/webpeel-postman-collection.json` — Postman importable collection (10 endpoints)
- `/llms.txt` — AI crawler guidance
- `/sitemap.xml` — 50+ URLs indexed
- `/robots.txt` — Open crawling

## 📊 Analytics & Monitoring
- Vercel Analytics on all 54 pages
- Vercel Speed Insights (Core Web Vitals)
- Usage alert emails at 80% and 90% quota

## 🏗️ Infrastructure
- **API:** K8s (K3s) on Hetzner (6 API pods, 2 worker pods)
- **Site/Dashboard:** Vercel (volt-bee team)
- **Database:** Neon PostgreSQL
- **Cache:** Redis
- **CDN/DNS:** Cloudflare
- **Payments:** Stripe
- **Email:** Nodemailer + SMTP
- **CI/CD:** GitHub Actions → GHCR → K3s auto-deploy

## 📦 SDKs & Packages
- **npm:** `webpeel` (14,580 downloads/month)
- **PyPI:** `webpeel` (226 downloads/month)
- **CLI:** `npx webpeel` (zero-install)
