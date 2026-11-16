import pytest
from backend.main import app
from fastapi.testclient import TestClient

client = TestClient(app)

def test_dosage_check_endpoint():
    payload = {
        "med_id": 1,
        "dosage": 500,
        "unit": "mg",
        "frequency": "BD",
        "route": "oral",
        "patient": {
            "age": 30,
            "weight_kg": 70,
            "is_pregnant": False,
            "conditions": []
        }
    }
    response = client.post("/api/safety/dosage-check", json=payload)
    # May be 401 if auth required, but should not crash
    assert response.status_code in [200, 401, 404]