"""
WebPeel Tool for CrewAI
Scrape, search, and crawl the web using WebPeel.

Usage:
    from webpeel_tool import WebPeelScrapeTool, WebPeelSearchTool

    scrape_tool = WebPeelScrapeTool()
    search_tool = WebPeelSearchTool()

    # Use in a CrewAI agent
    agent = Agent(
        role="Researcher",
        tools=[scrape_tool, search_tool],
    )
"""

from typing import Optional, Type
from crewai.tools import BaseTool
from pydantic import BaseModel, Field


class ScrapeInput(BaseModel):
    """Input for WebPeel scrape tool."""
    url: str = Field(description="The URL to scrape")
    render: bool = Field(default=False, description="Use browser rendering for JS-heavy sites")
    stealth: bool = Field(default=False, description="Use stealth mode for protected sites")


class SearchInput(BaseModel):
    """Input for WebPeel search tool."""
    query: str = Field(description="Search query")
    limit: int = Field(default=5, description="Max number of results")


class CrawlInput(BaseModel):
    """Input for WebPeel crawl tool."""
    url: str = Field(description="The URL to start crawling from")
    limit: int = Field(default=10, description="Max pages to crawl")


class WebPeelScrapeTool(BaseTool):
    name: str = "webpeel_scrape"
    description: str = (
        "Scrape a web page and get clean markdown content. "
        "Handles JavaScript rendering and anti-bot protection automatically. "
        "Use render=True for JS-heavy sites, stealth=True for protected sites."
    )
    args_schema: Type[BaseModel] = ScrapeInput

    api_key: Optional[str] = None
    base_url: str = "https://api.webpeel.dev"

    def _run(self, url: str, render: bool = False, stealth: bool = False) -> str:
        import urllib.request
        import urllib.parse
        import json

        params = {"url": url, "format": "markdown"}
        if render:
            params["render"] = "true"
        if stealth:
            params["stealth"] = "true"

        query = urllib.parse.urlencode(params)
        req_url = f"{self.base_url}/v1/fetch?{query}"

        req = urllib.request.Request(req_url)
        if self.api_key:
            req.add_header("Authorization", f"Bearer {self.api_key}")

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
                return data.get("markdown", data.get("content", str(data)))
        except Exception as e:
            return f"Error scraping {url}: {e}"


class WebPeelSearchTool(BaseTool):
    name: str = "webpeel_search"
    description: str = (
        "Search the web and get full content from results. "
        "Returns titles, URLs, and snippets."
    )
    args_schema: Type[BaseModel] = SearchInput

    api_key: Optional[str] = None
    base_url: str = "https://api.webpeel.dev"

    def _run(self, query: str, limit: int = 5) -> str:
        import urllib.request
        import urllib.parse
        import json

        params = {"q": query, "limit": str(limit)}
        query_str = urllib.parse.urlencode(params)
        req_url = f"{self.base_url}/v1/search?{query_str}"

        req = urllib.request.Request(req_url)
        if self.api_key:
            req.add_header("Authorization", f"Bearer {self.api_key}")

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode())
                results = data.get("results", [])
                output = []
                for r in results:
                    output.append(f"**{r.get('title', 'No title')}**\n{r.get('url', '')}\n{r.get('snippet', '')}\n")
                return "\n".join(output) if output else "No results found."
        except Exception as e:
            return f"Error searching '{query}': {e}"


class WebPeelCrawlTool(BaseTool):
    name: str = "webpeel_crawl"
    description: str = (
        "Crawl a website and get content from multiple pages. "
        "Useful for gathering data from an entire site."
    )
    args_schema: Type[BaseModel] = CrawlInput

    api_key: Optional[str] = None
    base_url: str = "https://api.webpeel.dev"

    def _run(self, url: str, limit: int = 10) -> str:
        import urllib.request
        import json

        req_url = f"{self.base_url}/v1/crawl"
        body = json.dumps({"url": url, "limit": limit}).encode()

        req = urllib.request.Request(req_url, data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        if self.api_key:
            req.add_header("Authorization", f"Bearer {self.api_key}")

        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read().decode())
                job_id = data.get("id", "")
                return f"Crawl job started: {job_id}. Use GET /v1/crawl/{job_id} to check status."
        except Exception as e:
            return f"Error crawling {url}: {e}"
