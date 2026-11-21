"""Standardized API response models for MediGuide AI."""

from pydantic import BaseModel, Field
from typing import Optional, Any, List, Dict
from datetime import datetime


class APIResponse(BaseModel):
    """Standardized API response wrapper."""
    success: bool
    data: Optional[Any] = None
    message: Optional[str] = None
    error: Optional[str] = None
    status_code: Optional[int] = None
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())

    @classmethod
    def ok(cls, data: Any = None, message: str = "Success"):
        return cls(success=True, data=data, message=message)

    @classmethod
    def err(cls, message: str, status_code: int = 400, details: Any = None):
        return cls(success=False, message=message, error=message, status_code=status_code)

class ResponseStandard(BaseModel):
    """Standardized response wrapper for all API endpoints."""
    success: bool = True
    data: Optional[Any] = None
    message: Optional[str] = "Success"
    error: Optional[str] = None
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class PaginatedResponse(BaseModel):
    """Paginated response model."""
    items: List[Any]
    total: int
    page: int
    limit: int
    has_more: bool

    @classmethod
    def create(cls, items: List[Any], total: int, page: int, limit: int):
        return cls(
            items=items,
            total=total,
            page=page,
            limit=limit,
            has_more=(page * limit < total)
        )


class ErrorResponse(BaseModel):
    """Standardized error response."""
    error: str
    detail: Optional[Any] = None
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    status_code: int = 400


class AuditLog(BaseModel):
    """Audit log entry."""
    action: str
    user: str
    resource: str
    timestamp: str
    ip_address: Optional[str] = None
