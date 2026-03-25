# AGENTS.md — WebPeel for AI Coding Agents

You are working with WebPeel, a web data platform for AI agents.

## Key Things You Need to Know

### 1. Use --render for JavaScript sites
Most sites work without flags. For React/Next.js/Vue/Angular SPAs:
```bash
webpeel "https://spa-site.com" --render
```
Many popular SPAs auto-detect (Polymarket, Twitter, Reddit, etc.) — but if content is empty, add `--render`.

### 2. Use --stealth for bot-protected sites
```bash
webpeel "https://cloudflare-protected.com" --stealth
```

### 3. 55+ domain extractors return instant structured data
Sites like GitHub, Reddit, YouTube, Amazon, Polymarket — WebPeel calls their APIs directly. No browser needed, instant results with structured data.

### 4. Programmatic usage
```typescript
import { peel } from 'webpeel';

const result = await peel('https://example.com');
console.log(result.content);      // Clean markdown
console.log(result.tokens);       // Token count
console.log(result.domainData);   // Structured data (if domain extractor matched)

// JS-rendered site
const spa = await peel('https://polymarket.com/@user', { render: true });

// With scrolling for infinite/lazy content
const full = await peel('https://imgur.com', {
  render: true,
  autoScroll: true,
});
```

### 5. Common options
| Option | What it does |
|--------|-------------|
| `--render` / `-r` | Browser rendering for JS sites |
| `--stealth` | Anti-bot bypass (Cloudflare, etc.) |
| `--json` | JSON output with metadata |
| `--clean` | AI-optimized (strips URLs, nav) |
| `--scroll-extract` | Scroll to load lazy content |
| `-q "question"` | Ask about page content (no LLM) |
| `--budget N` | Limit output to N tokens |

### 6. If you get empty content
1. Retry with `--render` (JS site)
2. If still empty, try `--stealth` (bot protection)
3. Check if a domain extractor exists — it may return data via API automatically

### 7. MCP server
```bash
webpeel mcp  # Start MCP server with 8 tools
```

## Project Structure
- `src/core/` — Pipeline, fetcher, extraction, actions
- `src/ee/extractors/` — 55+ domain-specific extractors
- `src/mcp/` — MCP server and tool definitions
- `src/cli/` — CLI commands
- `src/server/` — API server (Express)
