"""WebPeel Python SDK — Fast web fetcher for AI agents."""

import httpx
from typing import Optional, Dict, List, Any, Union
from .types import PeelResult, SearchResult, MapResult, CrawlResult, PageAction, ExtractOptions
from .exceptions import WebPeelError, AuthError, RateLimitError, TimeoutError

DEFAULT_BASE_URL = "https://api.webpeel.dev"
DEFAULT_TIMEOUT = 60.0

class WebPeel:
    """WebPeel API client.
    
    Usage:
        from webpeel import WebPeel
        
        wp = WebPeel(api_key="wp_live_...")
        result = wp.fetch("https://example.com")
        print(result.content)
    """
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT,
    ):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self._client = httpx.Client(
            base_url=self.base_url,
            timeout=timeout,
            headers=self._headers(),
        )
    
    def _headers(self) -> Dict[str, str]:
        headers = {"Content-Type": "application/json", "User-Agent": "webpeel-python/0.4.0"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers
    
    def _request(self, method: str, path: str, **kwargs) -> dict:
        try:
            resp = self._client.request(method, path, **kwargs)
            if resp.status_code == 401:
                raise AuthError("Invalid or missing API key")
            if resp.status_code == 429:
                raise RateLimitError("Rate limit exceeded. Check your plan usage at app.webpeel.dev")
            if resp.status_code >= 400:
                try:
                    body = resp.json()
                    msg = body.get("error", {}).get("message", resp.text)
                except Exception:
                    msg = resp.text
                raise WebPeelError(f"API error {resp.status_code}: {msg}")
            return resp.json()
        except httpx.TimeoutException:
            raise TimeoutError(f"Request timed out after {self.timeout}s")
        except httpx.HTTPError as e:
            raise WebPeelError(f"HTTP error: {str(e)}")
    
    def fetch(
        self,
        url: str,
        *,
        render: bool = False,
        stealth: bool = False,
        wait: int = 0,
        format: str = "markdown",
        selector: Optional[str] = None,
        exclude: Optional[List[str]] = None,
        headers: Optional[Dict[str, str]] = None,
        cookies: Optional[List[str]] = None,
        screenshot: bool = False,
        raw: bool = False,
        actions: Optional[List[Dict[str, Any]]] = None,
        extract: Optional[Dict[str, Any]] = None,
        max_tokens: Optional[int] = None,
        timeout: Optional[int] = None,
    ) -> PeelResult:
        """Fetch a URL and extract content.
        
        Args:
            url: URL to fetch
            render: Use headless browser
            stealth: Use stealth mode (auto-enables render)
            wait: Wait time in ms after page load
            format: Output format (markdown, text, html)
            selector: CSS selector to extract
            exclude: CSS selectors to exclude
            headers: Custom HTTP headers
            cookies: Cookies to set
            screenshot: Capture screenshot
            raw: Skip smart content extraction
            actions: Page actions to execute before extraction
            extract: Structured data extraction options
            max_tokens: Maximum token count for output
            timeout: Request timeout in ms
            
        Returns:
            PeelResult with content, metadata, links, etc.
        """
        payload = {"url": url, "format": format}
        if render: payload["render"] = True
        if stealth: payload["stealth"] = True
        if wait: payload["wait"] = wait
        if selector: payload["selector"] = selector
        if exclude: payload["exclude"] = exclude
        if headers: payload["headers"] = headers
        if cookies: payload["cookies"] = cookies
        if screenshot: payload["screenshot"] = True
        if raw: payload["raw"] = True
        if actions: payload["actions"] = actions
        if extract: payload["extract"] = extract
        if max_tokens: payload["maxTokens"] = max_tokens
        if timeout: payload["timeout"] = timeout
        
        data = self._request("POST", "/v1/fetch", json=payload)
        return PeelResult.from_dict(data.get("data", data))
    
    def search(self, query: str, *, count: int = 5) -> List[SearchResult]:
        """Search using DuckDuckGo.
        
        Args:
            query: Search query
            count: Number of results (1-10)
        """
        data = self._request("POST", "/v1/search", json={"query": query, "count": count})
        results = data.get("data", data.get("results", []))
        return [SearchResult.from_dict(r) for r in results]
    
    def map(
        self,
        url: str,
        *,
        max_urls: int = 5000,
        include_patterns: Optional[List[str]] = None,
        exclude_patterns: Optional[List[str]] = None,
    ) -> MapResult:
        """Discover all URLs on a domain.
        
        Args:
            url: Starting URL or domain
            max_urls: Maximum URLs to discover
            include_patterns: Only include URLs matching these regex patterns
            exclude_patterns: Exclude URLs matching these patterns
        """
        payload = {"url": url, "maxUrls": max_urls}
        if include_patterns: payload["includePatterns"] = include_patterns
        if exclude_patterns: payload["excludePatterns"] = exclude_patterns
        
        data = self._request("POST", "/v1/map", json=payload)
        return MapResult.from_dict(data.get("data", data))
    
    def crawl(
        self,
        url: str,
        *,
        max_pages: int = 10,
        max_depth: int = 2,
        render: bool = False,
        stealth: bool = False,
        sitemap_first: bool = False,
    ) -> List[CrawlResult]:
        """Crawl a website starting from a URL.
        
        Args:
            url: Starting URL
            max_pages: Maximum pages to crawl (max 100)
            max_depth: Maximum depth (max 5)
            render: Use browser rendering
            stealth: Use stealth mode
            sitemap_first: Try sitemap.xml before crawling
        """
        payload = {
            "url": url,
            "maxPages": max_pages,
            "maxDepth": max_depth,
        }
        if render: payload["render"] = True
        if stealth: payload["stealth"] = True
        if sitemap_first: payload["sitemapFirst"] = True
        
        data = self._request("POST", "/v1/crawl", json=payload)
        results = data.get("data", data.get("results", []))
        return [CrawlResult.from_dict(r) for r in results]
    
    def extract(
        self,
        url: str,
        *,
        selectors: Optional[Dict[str, str]] = None,
        schema: Optional[Dict[str, Any]] = None,
        render: bool = False,
    ) -> Dict[str, Any]:
        """Extract structured data from a webpage.
        
        Args:
            url: URL to extract from
            selectors: Map of field names to CSS selectors
            schema: JSON schema describing expected output
            render: Use browser rendering
        """
        result = self.fetch(
            url,
            render=render,
            extract={"selectors": selectors, "schema": schema},
        )
        return result.extracted or {}
    
    def close(self):
        """Close the HTTP client."""
        self._client.close()
    
    def __enter__(self):
        return self
    
    def __exit__(self, *args):
        self.close()
