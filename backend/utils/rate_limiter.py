"""Rate limiting utilities for MediGuide AI - with fallback for environments without slowapi."""

try:
    from slowapi import Limiter, _rate_limit_exceeded_handler
    from slowapi.util import get_remote_address
    SLOWAPI_AVAILABLE = True
except ImportError:
    SLOWAPI_AVAILABLE = False
    Limiter = None
    _rate_limit_exceeded_handler = None
    get_remote_address = None

from fastapi import Request, HTTPException
from fastapi.responses import JSONResponse


def get_user_id(request: Request) -> str:
    """Get user identifier for rate limiting - uses user email if authenticated, otherwise IP."""
    if SLOWAPI_AVAILABLE and get_remote_address:
        return get_remote_address(request)
    return request.client.host if request.client else "unknown"


# Rate limiter instances (with fallback)
if SLOWAPI_AVAILABLE:
    auth_limiter = Limiter(key_func=get_user_id, default_limits=["10/minute"])
    api_limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])
    general_limiter = Limiter(key_func=get_user_id, default_limits=["60/minute"])
else:
    # Fallback dummy limiter that does nothing
    class DummyLimiter:
        def limit(self, limit_string: str):
            def decorator(func):
                return func
            return decorator

    auth_limiter = DummyLimiter()
    api_limiter = DummyLimiter()
    general_limiter = DummyLimiter()



def rate_limit_exceeded_handler(request: Request, exc: HTTPException):
    """Custom rate limit exceeded handler returning standardized error response."""
    return JSONResponse(
        status_code=429,
        content={
            "success": False,
            "message": "Rate limit exceeded",
            "error": "Too many requests. Please try again later.",
            "timestamp": "2026-11-18T00:00:00.000000"
        }
    )