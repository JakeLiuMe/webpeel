"""Type definitions for WebPeel SDK."""

from dataclasses import dataclass, field
from typing import Optional, Dict, List, Any

@dataclass
class PageMetadata:
    description: Optional[str] = None
    author: Optional[str] = None
    published: Optional[str] = None
    image: Optional[str] = None
    canonical: Optional[str] = None
    
    @classmethod
    def from_dict(cls, d: dict) -> "PageMetadata":
        return cls(
            description=d.get("description"),
            author=d.get("author"),
            published=d.get("published"),
            image=d.get("image"),
            canonical=d.get("canonical"),
        )

@dataclass
class PeelResult:
    url: str
    title: str
    content: str
    metadata: PageMetadata
    links: List[str]
    tokens: int
    method: str
    elapsed: int
    screenshot: Optional[str] = None
    content_type: Optional[str] = None
    quality: Optional[float] = None
    fingerprint: Optional[str] = None
    extracted: Optional[Dict[str, Any]] = None
    
    @classmethod
    def from_dict(cls, d: dict) -> "PeelResult":
        return cls(
            url=d.get("url", ""),
            title=d.get("title", ""),
            content=d.get("content", ""),
            metadata=PageMetadata.from_dict(d.get("metadata", {})),
            links=d.get("links", []),
            tokens=d.get("tokens", 0),
            method=d.get("method", "simple"),
            elapsed=d.get("elapsed", 0),
            screenshot=d.get("screenshot"),
            content_type=d.get("contentType"),
            quality=d.get("quality"),
            fingerprint=d.get("fingerprint"),
            extracted=d.get("extracted"),
        )

@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str
    
    @classmethod
    def from_dict(cls, d: dict) -> "SearchResult":
        return cls(
            title=d.get("title", ""),
            url=d.get("url", ""),
            snippet=d.get("snippet", ""),
        )

@dataclass
class MapResult:
    urls: List[str]
    sitemap_urls: List[str]
    total: int
    elapsed: int
    
    @classmethod
    def from_dict(cls, d: dict) -> "MapResult":
        return cls(
            urls=d.get("urls", []),
            sitemap_urls=d.get("sitemapUrls", []),
            total=d.get("total", 0),
            elapsed=d.get("elapsed", 0),
        )

@dataclass
class CrawlResult:
    url: str
    title: str
    markdown: str
    links: List[str]
    depth: int
    parent: Optional[str]
    elapsed: int
    error: Optional[str] = None
    fingerprint: Optional[str] = None
    
    @classmethod
    def from_dict(cls, d: dict) -> "CrawlResult":
        return cls(
            url=d.get("url", ""),
            title=d.get("title", ""),
            markdown=d.get("markdown", ""),
            links=d.get("links", []),
            depth=d.get("depth", 0),
            parent=d.get("parent"),
            elapsed=d.get("elapsed", 0),
            error=d.get("error"),
            fingerprint=d.get("fingerprint"),
        )

# Type aliases for page actions
PageAction = Dict[str, Any]
ExtractOptions = Dict[str, Any]
