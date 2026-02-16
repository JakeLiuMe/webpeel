# WebPeel Benchmark — v2 results (re-run after improvements)

- Date: 2026-02-16
- URLs: 30
- Concurrency: 1
- Timeout: 30s

**Metric definitions (as computed by the benchmark runner):**
- Success rate = successes / 30 (based on `success` boolean)
- Median latency = median of `latency_ms` across all 30 URLs (including failures)
- Avg quality = average `content_quality` across all 30 URLs (failures contribute 0)
- Avg tokens/page = average `token_count` across all 30 URLs (failures contribute 0)

## Overall comparison (v2)

| Runner | Success | Median latency (ms) | Avg quality | Avg tokens/page |
|---|---:|---:|---:|---:|
| webpeel-local | 29/30 (96.7%) | 443 | 0.828 | 10210 |
| firecrawl | 28/30 (93.3%) | 205 | 0.727 | 11439 |
| jina-reader † | 16/17 (94.1%) | 727 | 0.650 | 7089 |
| tavily | 25/30 (83.3%) | 55 | 0.677 | 6371 |
| scrapingbee | 24/30 (80.0%) | 1613 | 0.600 | 5949 |
| raw-fetch | 24/30 (80.0%) | 140 | 0.743 | 4903 |

† **Jina Reader note:** Free tier rate-limits at 20 requests per IP. Of 30 URLs, 13 were rate-limited (not real failures). Stats above reflect only the 17 non-rate-limited URLs. With an API key, all 30 would be testable.

## Per-tier success breakdown (v2)

| Runner | static | dynamic | spa | protected | documents | edge |
|---|---:|---:|---:|---:|---:|---:|
| webpeel-local | 5/5 (100%) | 5/5 (100%) | 5/5 (100%) | 5/5 (100%) | 4/5 (80%) | 5/5 (100%) |
| firecrawl | 5/5 (100%) | 5/5 (100%) | 5/5 (100%) | 4/5 (80%) | 5/5 (100%) | 4/5 (80%) |
| jina-reader † | 4/5 (80%) | 5/5 (100%) | 5/5 (100%) | 2/2 (100%) | 0/0 (—) | 0/0 (—) |
| tavily | 4/5 (80%) | 5/5 (100%) | 5/5 (100%) | 2/5 (40%) | 4/5 (80%) | 5/5 (100%) |
| scrapingbee | 5/5 (100%) | 5/5 (100%) | 5/5 (100%) | 2/5 (40%) | 3/5 (60%) | 4/5 (80%) |
| raw-fetch | 5/5 (100%) | 4/5 (80%) | 5/5 (100%) | 1/5 (20%) | 4/5 (80%) | 5/5 (100%) |

## Failed URLs (v2)

### webpeel-local — 1 failed
- **documents**: https://www.sec.gov/Archives/edgar/data/1018724/000101872424000004/amzn-20231231.htm — error="HTTP 404: Not Found"

### firecrawl — 2 failed
- **protected**: https://linkedin.com/company/anthropic — error="We apologize for the inconvenience but we do not support this site. If you are part of an enterprise and want to have a further conversation about this, please fill out our intake form here: https://fk4bvu0n5qp.typeform.com/to/Ej6oydlg"
- **edge**: https://www.reddit.com/r/programming/top/?t=month — error="We apologize for the inconvenience but we do not support this site. If you are part of an enterprise and want to have a further conversation about this, please fill out our intake form here: https://fk4bvu0n5qp.typeform.com/to/Ej6oydlg"

### jina-reader — 1 real failure + 13 rate-limited
- **static**: https://httpbin.org/html — error="Anonymous access to domain httpbin.org blocked until 2035 due to previous abuse (DDoS suspected)"
- **Rate-limited (13 URLs):** documents (5/5) + edge (5/5) + protected (3/5) — all returned "Per IP rate limit exceeded (CRAWL 20 times)" after hitting the free-tier cap of 20 requests

### scrapingbee — 6 failed
- **protected**: https://www.cloudflare.com/learning/what-is-cloudflare/ — error="HTTP 500: Error with request, suggests render_js=True"
- **protected**: https://www.bloomberg.com/technology — error="HTTP 500: Error with request, suggests render_js=True"
- **protected**: https://www.glassdoor.com/Overview/Working-at-Anthropic-EI_IE7601188.11.20.htm — error="HTTP 404: returned Dutch Glassdoor page (geo-routing issue)"
- **documents**: https://www.sec.gov/Archives/edgar/data/320193/000032019324000123/aapl-20240928.htm — error="HTTP 500: Error with request"
- **edge**: https://news.google.com — error="HTTP 400: requires custom_google=True parameter (20 credits/request)"
- **edge**: https://www.youtube.com/watch?v=dQw4w9WgXcQ — scored too low (quality=0.65 but only 37 tokens — nearly empty content)

### tavily — 5 failed
- **static**: https://example.com — error="Tavily: missing results"
- **protected**: https://medium.com/@anthropic/introducing-claude-3-5-sonnet-a53f88e9e9ae — error="Tavily: missing results"
- **protected**: https://www.bloomberg.com/technology — error="Tavily: missing results"
- **protected**: https://www.glassdoor.com/Overview/Working-at-Anthropic-EI_IE7601188.11.20.htm — error="Tavily: missing results"
- **documents**: https://www.sec.gov/Archives/edgar/data/1018724/000101872424000004/amzn-20231231.htm — error="Tavily: missing results"

### raw-fetch — 6 failed
- **dynamic**: https://www.npmjs.com/package/express — status=403
- **protected**: https://www.cloudflare.com/learning/what-is-cloudflare/ — status=403
- **protected**: https://medium.com/@anthropic/introducing-claude-3-5-sonnet-a53f88e9e9ae — status=403
- **protected**: https://www.bloomberg.com/technology — status=403
- **protected**: https://www.glassdoor.com/Overview/Working-at-Anthropic-EI_IE7601188.11.20.htm — status=403
- **documents**: https://www.sec.gov/Archives/edgar/data/1018724/000101872424000004/amzn-20231231.htm — status=404

## WebPeel (webpeel-local) — before vs after

### Summary metrics

| Metric | v1 (benchmarks/results-webpeel.json) | v2 (benchmarks/results-v2-webpeel.json) | Delta |
|---|---:|---:|---:|
| Success rate | 90.0% | 96.7% | 6.7 pp |
| Median latency (ms) | 346 | 443 | 97 |
| Avg quality | 0.848 | 0.828 | -0.020 |
| Avg tokens/page | 8437 | 10210 | 1774 |

### Previously-failed URLs that now succeed

- https://www.bloomberg.com/technology
- https://www.glassdoor.com/Overview/Working-at-Anthropic-EI_IE7601188.11.20.htm

### WebPeel v1 failed URLs

- **protected**: https://www.bloomberg.com/technology — status=403
- **protected**: https://www.glassdoor.com/Overview/Working-at-Anthropic-EI_IE7601188.11.20.htm — status=403
- **documents**: https://www.sec.gov/Archives/edgar/data/1018724/000101872424000004/amzn-20231231.htm — status=403

### WebPeel v2 failed URLs

- **documents**: https://www.sec.gov/Archives/edgar/data/1018724/000101872424000004/amzn-20231231.htm — error="HTTP 404: Not Found"

