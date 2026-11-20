"""Pytest configuration for MediGuide AI tests."""
import sys
import os
import pytest
from unittest.mock import AsyncMock, MagicMock

# Add backend directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

# Create a mock for the app when importing main
@pytest.fixture(scope='session')
def mock_env():
    """Set up environment variables for testing."""
    os.environ['SECRET_KEY'] = 'test-secret-key-for-testing-at-least-32-chars-long!'
    os.environ['MONGODB_URL'] = 'mongodb://localhost:27017'
    os.environ['DATABASE_NAME'] = 'mediguide_test'
    os.environ['ALLOWED_ORIGINS'] = 'http://localhost:3000'
    yield
    # Cleanup if needed


@pytest.fixture(scope='session')
def app():
    """Create test FastAPI app with mocked database."""
    # We need to mock the database connection and dependencies
    from unittest.mock import patch, MagicMock
    import asyncio

    # Create a minimal test client approach
    from fastapi.testclient import TestClient

    # Mock the database collections
    mock_collections = {}

    def mock_find_one(query):
        if 'users' in str(query):
            return {'email': 'test@example.com', 'name': 'Test User', 'role': 'user', 'password_hash': 'hashed'}
        return None

    # Import the app module
    try:
        from main import app as fastapi_app
        return TestClient(fastapi_app)
    except ImportError as e:
        print(f"Could not import app: {e}")
        return None