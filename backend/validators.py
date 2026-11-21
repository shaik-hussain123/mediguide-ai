"""Validation utilities for MediGuide AI."""

import re
from typing import Optional, Any

# --- Field Validators ---

def validate_email(email: str) -> bool:
    """Validate email format."""
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))


def validate_password_strength(password: str) -> dict:
    """Check password strength. Returns (is_valid: bool, errors: list[str])."""
    errors = []
    if len(password) < 8:
        errors.append("Password must be at least 8 characters")
    if not re.search(r'[A-Z]', password):
        errors.append("Password must contain at least one uppercase letter")
    if not re.search(r'[a-z]', password):
        errors.append("Password must contain at least one lowercase letter")
    if not re.search(r'\d', password):
        errors.append("Password must contain at least one digit")
    return {
        "is_valid": len(errors) == 0,
        "errors": errors,
        "score": max(0, 100 - len(errors) * 25)
    }


def validate_phone(phone: str) -> bool:
    """Validate Indian phone number format."""
    pattern = r'^(\+91|91|0)?[6-9]\d{9}$'
    return bool(re.match(pattern, phone.replace(" ", "").replace("-", "")))


def validate_id(id_str: str, prefix: str = "") -> bool:
    """Validate ObjectId or custom ID format."""
    from bson import ObjectId
    if not id_str:
        return False
    try:
        ObjectId(id_str)
        return True
    except Exception:
        return bool(re.match(f"^{prefix}[a-zA-Z0-9_-]+$", id_str))


def sanitize_input(text: str, max_length: int = 5000) -> str:
    """Basic input sanitization to remove XSS attempts."""
    if not text:
        return ""
    # Remove script tags and event handlers
    sanitized = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.DOTALL | re.IGNORECASE)
    sanitized = re.sub(r'on\w+\s*=\s*["\'][^"\']*["\']', '', sanitized, flags=re.IGNORECASE)
    return sanitized[:max_length]


class ValidationException(Exception):
    """Custom exception for validation failures."""
    def __init__(self, message: str, field: Optional[str] = None):
        self.message = message
        self.field = field
        super().__init__(message)
