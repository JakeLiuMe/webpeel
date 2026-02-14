# WebPeel + n8n Integration

Use WebPeel in your n8n workflows for web scraping, searching, and crawling.

## Setup

### Option 1: HTTP Request Node (No Installation)

Use n8n's built-in HTTP Request node to call the WebPeel API directly:

**Scrape a page:**
```
Method: GET
URL: https://api.webpeel.dev/v1/fetch
Query Parameters:
  url: https://example.com
  format: markdown
Headers:
  Authorization: Bearer wp_YOUR_API_KEY
```

**Search the web:**
```
Method: GET
URL: https://api.webpeel.dev/v1/search
Query Parameters:
  q: your search query
  limit: 5
```

**Crawl a site:**
```
Method: POST
URL: https://api.webpeel.dev/v1/crawl
Headers:
  Content-Type: application/json
  Authorization: Bearer wp_YOUR_API_KEY
Body:
  {
    "url": "https://example.com",
    "limit": 10
  }
```

### Option 2: Firecrawl-Compatible Mode

If you already have a Firecrawl node in n8n, you can switch to WebPeel by changing the base URL:

```
Base URL: https://api.webpeel.dev
```

WebPeel supports Firecrawl-compatible API endpoints (`POST /v1/scrape`, `POST /v1/crawl`, `POST /v1/map`, `POST /v1/search`), so existing Firecrawl workflows work without changes.

## Example Workflows

### Lead Enrichment
1. **Trigger**: New row in Google Sheets
2. **WebPeel Scrape**: Fetch company website → get markdown
3. **AI Node**: Extract company info from markdown
4. **Google Sheets**: Write enriched data back

### Content Monitoring
1. **Schedule Trigger**: Every hour
2. **WebPeel Scrape**: Fetch monitored pages
3. **Compare**: Check against previous version
4. **Slack**: Notify on changes

### Market Research
1. **WebPeel Search**: Search for topic
2. **Loop**: For each result URL
3. **WebPeel Scrape**: Get full page content
4. **AI Node**: Summarize findings
5. **Email**: Send research report

## Self-Hosted

Point to your own WebPeel instance:
```
Base URL: http://your-webpeel-host:3000
```
No API key needed for self-hosted instances.
