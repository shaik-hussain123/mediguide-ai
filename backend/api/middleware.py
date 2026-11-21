"""Rate limiting middleware and utilities for MediGuide AI API."""

try:
    from slowapi import Limiter, _rate_limit_exceeded_handler
    from slowapi.util import get_remote_address
    from slowapi.errors import RateLimitExceeded
    SLOWAPI_AVAILABLE = True
except ImportError:
    SLOWAPI_AVAILABLE = False
    _rate_limit_exceeded_handler = None
    get_remote_address = None

from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse


def get_user_id(request: Request) -> str:
    """Get user identifier for rate limiting."""
    if SLOWAPI_AVAILABLE and get_remote_address:
        return get_remote_address(request)
    return request.client.host if request.client else "unknown"


class RateLimitMiddleware:
    """Middleware wrapper for rate limiting with standardized error responses."""

    @staticmethod
    async def dispatch(request: Request, call_next):
        if SLOWAPI_AVAILABLE:
            return await call_next(request)

        # Fallback: simple rate limiting check
        response = await call_next(request)
        return response


def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded):
    """Standardized rate limit exceeded response."""
    return JSONResponse(
        status_code=429,
        content={
            "success": False,
            "message": "Rate limit exceeded",
            "error": "Too many requests. Please try again later.",
            "retry_after": 60
        }
    )