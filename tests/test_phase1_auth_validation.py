"""Tests for Phase 1: Authentication Validation, Validation Utilities, Response Standards, Audit Logging."""

import pytest
import sys
import os
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch
import asyncio

# Add backend directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

# Set required environment variables before importing app
os.environ['SECRET_KEY'] = 'test-secret-key-for-testing-at-least-32-chars-long!'
os.environ['MONGODB_URL'] = 'mongodb://localhost:27017'
os.environ['DATABASE_NAME'] = 'mediguide_test'
os.environ['ALLOWED_ORIGINS'] = 'http://localhost:3000'

from fastapi.testclient import TestClient
from main import app


@pytest.fixture
def client():
    """Create test client."""
    return TestClient(app)


class TestValidationUtilities:
    """Test validation utilities in validators.py"""

    def test_validate_email_valid(self):
        from validators import validate_email
        assert validate_email("test@example.com") is True
        assert validate_email("user.name+tag@domain.co.in") is True

    def test_validate_email_invalid(self):
        from validators import validate_email
        assert validate_email("invalid-email") is False
        assert validate_email("@missing.com") is False
        assert validate_email("") is False

    def test_validate_password_strength_weak(self):
        from validators import validate_password_strength
        result = validate_password_strength("weak")
        assert result["is_valid"] is False
        assert len(result["errors"]) > 0

    def test_validate_password_strength_strong(self):
        from validators import validate_password_strength
        result = validate_password_strength("StrongPass123")
        assert result["is_valid"] is True
        assert result["score"] == 100

    def test_validate_phone_indian(self):
        from validators import validate_phone
        assert validate_phone("+919876543210") is True
        assert validate_phone("919876543210") is True
        assert validate_phone("09876543210") is True
        assert validate_phone("1234567890") is False

    def test_sanitize_input_xss(self):
        from validators import sanitize_input
        result = sanitize_input("<script>alert('xss')</script>Hello")
        assert "<script>" not in result
        assert "Hello" in result

    def test_validation_exception(self):
        from validators import ValidationException
        exc = ValidationException("Invalid email", field="email")
        assert exc.message == "Invalid email"
        assert exc.field == "email"


class TestResponseModels:
    """Test standardized response models."""

    def test_api_response_ok(self):
        from response_models import APIResponse
        now_str = datetime.utcnow().isoformat()
        resp = APIResponse.ok(data={"key": "value"}, message="Success")
        assert resp.success is True
        assert resp.data == {"key": "value"}
        assert resp.timestamp is not None

    def test_api_response_error(self):
        from response_models import APIResponse
        resp = APIResponse.err("Something went wrong")
        assert resp.success is False
        assert resp.error == "Something went wrong"

    def test_paginated_response(self):
        from response_models import PaginatedResponse
        items = [{"id": i} for i in range(5)]
        paginated = PaginatedResponse.create(items, total=10, page=1, limit=5)
        assert len(paginated.items) == 5
        assert paginated.total == 10
        assert paginated.has_more is True

    def test_audit_log_model(self):
        from response_models import AuditLog
        log = AuditLog(action="LOGIN", user="test@example.com", resource="auth", timestamp=datetime.utcnow().isoformat())
        assert log.action == "LOGIN"
        assert log.user == "test@example.com"


class TestAuthEndpoints:
    """Test authentication endpoints."""

    def test_health_endpoint(self, client):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "timestamp" in data

    def test_root_endpoint(self, client):
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "version" in data


class TestAuditLogging:
    """Test audit logging functionality."""

    @pytest.mark.asyncio
    async def test_log_audit_async(self):
        """Test that log_audit function exists and is callable."""
        from main import log_audit
        # Just verify it's a function - we can't easily test DB without MongoDB running
        assert callable(log_audit)


class TestBackwardCompatibility:
    """Verify backward compatibility of existing endpoints."""

    def test_medicine_search_exists(self, client):
        response = client.get("/api/medicine/search?q=paracetamol")
        assert response.status_code == 200
        data = response.json()
        assert "results" in data
        assert "total" in data

    def test_company_list_exists(self, client):
        response = client.get("/api/company")
        assert response.status_code == 200
        data = response.json()
        assert "companies" in data
        assert "total" in data


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
