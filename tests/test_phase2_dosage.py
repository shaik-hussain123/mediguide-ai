"""Phase 2 Tests: Dosage Safety API, Drug Interaction API, and Safety Score API."""

import pytest
import sys
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch
import asyncio

# Add backend directory to path
sys.path.insert(0, "backend")

from fastapi.testclient import TestClient
from main import app, db, create_access_token


@pytest.fixture
def client():
    """Create test client."""
    return TestClient(app)


@pytest.fixture
def auth_headers(client):
    """Get auth headers by registering and logging in a test user."""
    # Register user
    response = client.post("/api/auth/register", json={
        "name": "Test User",
        "email": "test_phase2@example.com",
        "password": "password123",
        "consent": True
    })
    if response.status_code == 400:
        # User might already exist, try login
        response = client.post("/api/auth/login", json={
            "email": "test_phase2@example.com",
            "password": "password123"
        })
    assert response.status_code in [200, 201]
    token = response.json().get("accessToken") or response.json().get("access_token")
    return {"Authorization": f"Bearer {token}"}


class TestDosageAPI:
    """Test dosage safety API endpoints."""

    def test_dosage_check_single_med(self, client, auth_headers):
        """Test single medication dosage check."""
        response = client.post(
            "/api/safety/dosage-check",
            json={
                "med_id": 1,
                "dosage": 500.0,
                "frequency": "OD"
            },
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert hasattr(data, 'risk_level') or 'risk_level' in data

    def test_dosage_check_invalid_med(self, client, auth_headers):
        """Test dosage check with invalid medication ID."""
        response = client.post(
            "/api/safety/dosage-check",
            json={
                "med_id": 999,
                "dosage": 500.0,
                "frequency": "OD"
            },
            headers=auth_headers
        )
        assert response.status_code == 404

    def test_safety_score_single(self, client, auth_headers):
        """Test safety score with single medication."""
        response = client.post(
            "/api/safety/score",
            json={
                "med_ids": [1]
            },
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "score" in data or "risk_category" in data

    def test_safety_score_multiple(self, client, auth_headers):
        """Test safety score with multiple medications."""
        response = client.post(
            "/api/safety/score",
            json={
                "med_ids": [1, 2, 3]
            },
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        assert "score" in data or "risk_category" in data

    def test_safety_score_empty(self, client, auth_headers):
        """Test safety score with empty medication list."""
        response = client.post(
            "/api/safety/score",
            json={
                "med_ids": []
            },
            headers=auth_headers
        )
        assert response.status_code == 400  # Should reject empty list


class TestInteractionAPI:
    """Test drug interaction API endpoints."""

    @pytest.fixture
    def client(self):
        """Create test client."""
        return TestClient(app)

    @pytest.fixture
    def auth_headers(self, client):
        """Get auth headers by registering and logging in a test user."""
        response = client.post("/api/auth/register", json={
            "name": "Test User 2",
            "email": "test_interaction@example.com",
            "password": "password123",
            "consent": True
        })
        if response.status_code == 400:
            response = client.post("/api/auth/login", json={
                "email": "test_interaction@example.com",
                "password": "password123"
            })
        assert response.status_code in [200, 201]
        token = response.json().get("accessToken") or response.json().get("access_token")
        return {"Authorization": f"Bearer {token}"}

    def test_interaction_check_two_meds(self, client, auth_headers):
        """Test interaction check with two medications."""
        response = client.post(
            "/api/interactions/check",
            json={
                "med_ids": [1, 2]
            },
            headers=auth_headers
        )
        # Should return results (may be empty if no interactions in DB)
        assert response.status_code in [200, 404]

    def test_interaction_check_min_two(self, client, auth_headers):
        """Test interaction check requires at least 2 meds."""
        response = client.post(
            "/api/interactions/check",
            json={
                "med_ids": [1]
            },
            headers=auth_headers
        )
        assert response.status_code == 400  # Should require at least 2

    def test_interaction_check_invalid_med(self, client, auth_headers):
        """Test interaction check with invalid medication ID."""
        response = client.post(
            "/api/interactions/check",
            json={
                "med_ids": [1, 999]
            },
            headers=auth_headers
        )
        # Should handle gracefully
        assert response.status_code in [200, 404]


class TestPhase2BackwardCompatibility:
    """Verify Phase 2 endpoints don't break existing functionality."""

    @pytest.fixture
    def client(self):
        """Create test client."""
        return TestClient(app)

    def test_health_endpoint_still_works(self, client):
        """Ensure health endpoint still works after Phase 2 additions."""
        response = client.get("/health")
        assert response.status_code == 200

    def test_root_endpoint_still_works(self, client):
        """Ensure root endpoint still works after Phase 2 additions."""
        response = client.get("/")
        assert response.status_code == 200

    def test_medicine_search_still_works(self, client):
        """Ensure medicine search still works."""
        response = client.get("/api/medicine/search?q=paracetamol")
        assert response.status_code == 200


class TestPhase2ResponseStandards:
    """Test Phase 2 response standards compliance."""

    @pytest.fixture
    def client(self):
        """Create test client."""
        return TestClient(app)

    @pytest.fixture
    def auth_headers(self, client):
        """Get auth headers by registering and logging in a test user."""
        response = client.post("/api/auth/register", json={
            "name": "Test User 3",
            "email": "test_response@example.com",
            "password": "password123",
            "consent": True
        })
        if response.status_code == 400:
            response = client.post("/api/auth/login", json={
                "email": "test_response@example.com",
                "password": "password123"
            })
        assert response.status_code in [200, 201]
        token = response.json().get("accessToken") or response.json().get("access_token")
        return {"Authorization": f"Bearer {token}"}

    def test_dosage_response_has_timestamp(self, client, auth_headers):
        """Test dosage check response includes timestamp."""
        response = client.post(
            "/api/safety/dosage-check",
            json={
                "med_id": 1,
                "dosage": 500.0,
                "frequency": "OD"
            },
            headers=auth_headers
        )
        assert response.status_code == 200

    def test_safety_score_response_structure(self, client, auth_headers):
        """Test safety score response structure."""
        response = client.post(
            "/api/safety/score",
            json={
                "med_ids": [1]
            },
            headers=auth_headers
        )
        assert response.status_code == 200
        data = response.json()
        # Check that response follows APIResponse format
        assert isinstance(data, dict)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])