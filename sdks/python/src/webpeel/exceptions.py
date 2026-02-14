"""Exception classes for WebPeel SDK."""

class WebPeelError(Exception):
    """Base exception for WebPeel SDK."""
    pass

class AuthError(WebPeelError):
    """Authentication error (invalid/missing API key)."""
    pass

class RateLimitError(WebPeelError):
    """Rate limit exceeded."""
    pass

class TimeoutError(WebPeelError):
    """Request timed out."""
    pass

class BlockedError(WebPeelError):
    """Request blocked by target site."""
    pass
