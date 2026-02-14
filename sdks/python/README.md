# WebPeel Python SDK

[![PyPI version](https://badge.fury.io/py/webpeel.svg)](https://badge.fury.io/py/webpeel)
[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/downloads/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Fast web fetcher for AI agents.** Extract clean markdown, metadata, and structured data from any website with a simple Python API.

WebPeel is the **open-source alternative to Firecrawl** — faster, cheaper, and fully transparent.

## 🚀 Installation

```bash
pip install webpeel
```

## ⚡ Quick Start

```python
from webpeel import WebPeel

# Initialize client (get your API key at app.webpeel.dev)
wp = WebPeel(api_key="wp_live_...")

# Fetch a webpage as clean markdown
result = wp.fetch("https://example.com")
print(result.content)      # Clean markdown content
print(result.title)        # Page title
print(result.metadata)     # Structured metadata
print(result.links)        # All extracted links
```

## 📖 Features

- **🔥 Fast**: Built on Playwright for reliable rendering
- **🧹 Clean**: Smart content extraction removes ads, navbars, footers
- **🤖 AI-Ready**: Markdown output optimized for LLMs
- **🔍 Search**: Built-in DuckDuckGo search integration
- **🗺️ Map**: Discover all URLs on a domain via sitemaps
- **🕷️ Crawl**: Multi-page crawling with depth control
- **📸 Screenshots**: Capture page screenshots
- **🎭 Stealth**: Bypass bot detection with stealth mode
- **📊 Extract**: Structured data extraction with CSS selectors or JSON schema

## 📚 API Reference

### Fetch

Extract content from a single URL.

```python
result = wp.fetch(
    "https://example.com",
    render=False,          # Use headless browser (for JS-heavy sites)
    stealth=False,         # Enable stealth mode (bypasses bot detection)
    wait=0,                # Wait time in ms after page load
    format="markdown",     # Output format: markdown, text, html
    selector=None,         # CSS selector to extract specific content
    exclude=None,          # List of CSS selectors to exclude
    headers=None,          # Custom HTTP headers (dict)
    cookies=None,          # Cookies to set (list of strings)
    screenshot=False,      # Capture screenshot (base64 PNG)
    raw=False,             # Skip smart content extraction
    max_tokens=None,       # Maximum token count for output
)

# Access result properties
print(result.content)      # Main content (markdown/text/html)
print(result.title)        # Page title
print(result.url)          # Final URL (after redirects)
print(result.metadata)     # PageMetadata object
print(result.links)        # List of URLs found on page
print(result.tokens)       # Approximate token count
print(result.method)       # Fetch method used (simple/render/stealth)
print(result.elapsed)      # Time taken in ms
print(result.screenshot)   # Base64 PNG (if screenshot=True)
```

### Search

Search the web using DuckDuckGo.

```python
results = wp.search("Python web scraping", count=5)

for r in results:
    print(r.title)    # Result title
    print(r.url)      # Result URL
    print(r.snippet)  # Description snippet
```

### Map

Discover all URLs on a domain (uses sitemaps + crawling).

```python
result = wp.map(
    "https://example.com",
    max_urls=5000,
    include_patterns=["*/blog/*"],  # Regex patterns to include
    exclude_patterns=["*/admin/*"], # Regex patterns to exclude
)

print(result.urls)          # List of discovered URLs
print(result.sitemap_urls)  # URLs found in sitemap.xml
print(result.total)         # Total count
print(result.elapsed)       # Time taken in ms
```

### Crawl

Crawl multiple pages starting from a URL.

```python
results = wp.crawl(
    "https://example.com/docs",
    max_pages=10,      # Max pages to crawl (1-100)
    max_depth=2,       # Max depth (1-5)
    render=False,      # Use browser rendering
    stealth=False,     # Use stealth mode
    sitemap_first=True # Try sitemap.xml before crawling
)

for page in results:
    print(page.url)       # Page URL
    print(page.title)     # Page title
    print(page.markdown)  # Page content (markdown)
    print(page.links)     # Links found on page
    print(page.depth)     # Depth level
    print(page.parent)    # Parent URL
    print(page.error)     # Error message (if failed)
```

### Extract

Extract structured data using CSS selectors or JSON schema.

```python
# Using CSS selectors
data = wp.extract(
    "https://news.ycombinator.com",
    selectors={
        "headline": ".titleline > a",
        "points": ".score",
        "comments": ".subtext > a:last-child"
    },
    render=False
)

# Using JSON schema (AI-powered extraction)
data = wp.extract(
    "https://example.com/product",
    schema={
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "price": {"type": "number"},
            "description": {"type": "string"}
        }
    },
    render=True
)
```

### Page Actions

Execute actions before extraction (clicks, scrolling, typing).

```python
result = wp.fetch(
    "https://example.com",
    render=True,
    actions=[
        {"type": "click", "selector": "#load-more"},
        {"type": "wait", "ms": 1000},
        {"type": "scroll", "direction": "down", "amount": 500},
        {"type": "type", "selector": "input[name='q']", "text": "search query"},
        {"type": "press", "key": "Enter"},
    ]
)
```

## 🛡️ Error Handling

WebPeel provides specific exception types for different error scenarios:

```python
from webpeel import WebPeel, AuthError, RateLimitError, TimeoutError, WebPeelError

wp = WebPeel(api_key="wp_live_...")

try:
    result = wp.fetch("https://example.com")
except AuthError:
    print("Invalid or missing API key")
except RateLimitError:
    print("Rate limit exceeded. Upgrade your plan at app.webpeel.dev")
except TimeoutError:
    print("Request timed out")
except WebPeelError as e:
    print(f"API error: {e}")
```

## 🆚 WebPeel vs Firecrawl

| Feature | WebPeel | Firecrawl |
|---------|---------|-----------|
| **License** | MIT (Open Source) | Proprietary |
| **Pricing** | Free tier + pay-as-you-go | Expensive ($99+/mo) |
| **Speed** | ⚡ Faster (native Playwright) | Slower |
| **Self-hosting** | ✅ Yes (Docker + Node.js) | ❌ No |
| **Python SDK** | ✅ Yes | ✅ Yes |
| **JavaScript SDK** | ✅ Yes | ✅ Yes |
| **Search** | ✅ Built-in (DuckDuckGo) | ❌ Extra cost |
| **Screenshots** | ✅ Included | ✅ Included |
| **Stealth mode** | ✅ Yes | ✅ Yes |
| **API key required** | Optional (free CLI) | Always |

**Migration from Firecrawl:**

```python
# Firecrawl
from firecrawl import FirecrawlApp
app = FirecrawlApp(api_key="fc-...")
result = app.scrape_url("https://example.com", params={"formats": ["markdown"]})

# WebPeel (drop-in replacement)
from webpeel import WebPeel
wp = WebPeel(api_key="wp_live_...")
result = wp.fetch("https://example.com")
```

## 🔧 Advanced Usage

### Context Manager

```python
with WebPeel(api_key="wp_live_...") as wp:
    result = wp.fetch("https://example.com")
    print(result.content)
# Client automatically closed
```

### Custom Base URL (Self-Hosted)

```python
wp = WebPeel(
    api_key="wp_live_...",
    base_url="https://your-instance.com",
    timeout=120.0  # Custom timeout in seconds
)
```

### Multiple Requests

```python
wp = WebPeel(api_key="wp_live_...")

urls = ["https://example.com", "https://example.org", "https://example.net"]
results = [wp.fetch(url) for url in urls]

for result in results:
    print(f"{result.title}: {len(result.content)} chars")
```

## 📊 Metadata

Every fetch returns rich metadata:

```python
result = wp.fetch("https://example.com")

print(result.metadata.description)  # Meta description
print(result.metadata.author)       # Author
print(result.metadata.published)    # Publish date
print(result.metadata.image)        # OpenGraph image
print(result.metadata.canonical)    # Canonical URL
```

## 📸 Screenshots

```python
result = wp.fetch("https://example.com", screenshot=True, render=True)

# Save screenshot to file
import base64
with open("screenshot.png", "wb") as f:
    f.write(base64.b64decode(result.screenshot))
```

## 🌐 CLI (Free, No API Key)

WebPeel also provides a free CLI for local scraping:

```bash
# Install globally
npm install -g webpeel

# Fetch and print markdown
webpeel https://example.com

# JSON output
webpeel https://example.com --json

# With browser rendering
webpeel https://example.com --render

# Save to file
webpeel https://example.com > output.md
```

## 📝 License

MIT License - see [LICENSE](LICENSE) for details.

## 🔗 Links

- **Homepage**: [https://webpeel.dev](https://webpeel.dev)
- **Documentation**: [https://webpeel.dev/llms.txt](https://webpeel.dev/llms.txt)
- **GitHub**: [https://github.com/JakeLiuMe/webpeel](https://github.com/JakeLiuMe/webpeel)
- **Issues**: [https://github.com/JakeLiuMe/webpeel/issues](https://github.com/JakeLiuMe/webpeel/issues)
- **Get API Key**: [https://app.webpeel.dev](https://app.webpeel.dev)

## 🤝 Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## ⭐ Support

If you find WebPeel useful, please give it a star on [GitHub](https://github.com/JakeLiuMe/webpeel)!

---

Made with ❤️ by [Jake Liu](https://github.com/JakeLiuMe)
