"""WebPeel — Fast web fetcher for AI agents.

Usage:
    from webpeel import WebPeel
    
    wp = WebPeel(api_key="wp_live_...")
    result = wp.fetch("https://example.com")
    print(result.content)  # Markdown content
    print(result.metadata)  # Structured metadata
"""

from .client import WebPeel
from .types import PeelResult, SearchResult, MapResult, CrawlResult, PageMetadata
from .exceptions import WebPeelError, AuthError, RateLimitError, TimeoutError, BlockedError

__version__ = "0.4.0"
__all__ = [
    "WebPeel",
    "PeelResult",
    "SearchResult",
    "MapResult",
    "CrawlResult",
    "PageMetadata",
    "WebPeelError",
    "AuthError",
    "RateLimitError",
    "TimeoutError",
    "BlockedError",
]
