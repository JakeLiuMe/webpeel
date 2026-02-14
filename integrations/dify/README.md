# WebPeel + Dify Integration

Use WebPeel as a tool in your Dify AI applications for web data extraction.

## Setup

### Method 1: Custom Tool (API-Based)

1. In Dify, go to **Tools** → **Custom Tool**
2. Import this OpenAPI schema:

```yaml
openapi: "3.0.0"
info:
  title: WebPeel
  version: "0.6.0"
  description: Web fetcher for AI agents
servers:
  - url: https://api.webpeel.dev
paths:
  /v1/fetch:
    get:
      operationId: scrape
      summary: Scrape a web page
      parameters:
        - name: url
          in: query
          required: true
          schema:
            type: string
          description: URL to scrape
        - name: format
          in: query
          schema:
            type: string
            enum: [markdown, text, html]
            default: markdown
        - name: render
          in: query
          schema:
            type: boolean
            default: false
          description: Use browser rendering
        - name: stealth
          in: query
          schema:
            type: boolean
            default: false
          description: Use stealth mode
      responses:
        "200":
          description: Scraped content
  /v1/search:
    get:
      operationId: search
      summary: Search the web
      parameters:
        - name: q
          in: query
          required: true
          schema:
            type: string
          description: Search query
        - name: limit
          in: query
          schema:
            type: integer
            default: 5
      responses:
        "200":
          description: Search results
```

3. Add your API key in the authentication settings (Bearer token)

### Method 2: MCP Tool

If Dify supports MCP tools:

```json
{
  "mcpServers": {
    "webpeel": {
      "command": "npx",
      "args": ["webpeel", "mcp"]
    }
  }
}
```

## Use Cases

- **RAG Pipeline**: Scrape web pages → chunk → embed → store in vector DB
- **Research Agent**: Search + scrape → summarize with LLM
- **Content Monitoring**: Periodic scrape → compare → alert on changes
- **Data Extraction**: Scrape product pages → extract structured data

## Self-Hosted

Replace `https://api.webpeel.dev` with your instance URL. No API key needed for self-hosted.
