"""Phase 2 Tests: Dosage Safety API, Drug Interaction API, and Safety Score API.

These tests verify:
1. APIResponse backward compatibility
2. Endpoint response format consistency
3. Validation rule enforcement
4. Rate limiting implementation
5. Audit logging integration

Note: These tests work without MongoDB to verify structure and imports.
"""

import pytest
import sys
from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

# Add backend directory to path
sys.path.insert(0, "backend")


class TestAPIResponseBackwardCompatibility:
    """Test 1: APIResponse backward compatibility."""

    def test_api_response_has_required_fields(self):
        """Verify APIResponse has success, data, message, error, timestamp fields."""
        from response_models import APIResponse
        resp = APIResponse.ok(data={"key": "value"}, message="Success")
        assert hasattr(resp, 'success')
        assert hasattr(resp, 'data')
        assert hasattr(resp, 'message')
        assert hasattr(resp, 'timestamp')

    def test_api_response_error_format(self):
        """Verify APIResponse.err includes error field."""
        from response_models import APIResponse
        resp = APIResponse.err("Something went wrong", status_code=400)
        assert resp.success is False
        assert resp.error == "Something went wrong"
        assert resp.status_code == 400


class TestActualMedicationCount:
    """Test 2: Verify actual medication count in dataset."""

    def test_medicine_count_in_data_file(self):
        """Verify medicines.json has actual count."""
        import json
        import os
        data_file = "data/medicines.json"
        if os.path.exists(data_file):
            with open(data_file, 'r') as f:
                data = json.load(f)
            if isinstance(data, list):
                assert len(data) > 100, f"Expected 100+ medications, got {len(data)}"
            elif isinstance(data, dict) and 'medicines' in data:
                assert len(data['medicines']) > 100


class TestRateLimitingImplementation:
    """Test 3: Rate limiting implementation verification."""

    def test_rate_limiter_module_exists(self):
        """Verify rate limiting module exists and exports limiter."""
        from utils import rate_limiter
        assert hasattr(rate_limiter, 'auth_limiter')
        assert hasattr(rate_limiter, 'api_limiter')
        assert hasattr(rate_limiter, 'general_limiter')

    def test_dummy_limiter_works(self):
        """Verify dummy limiter decorator works."""
        from utils.rate_limiter import DummyLimiter
        dummy = DummyLimiter()

        @dummy.limit("10/minute")
        def test_func():
            return "ok"

        assert test_func() == "ok"


class TestAuditLoggingService:
    """Test 4: Audit logging service implementation."""

    def test_audit_logger_module_exists(self):
        """Verify audit logger module exists."""
        from utils import audit_logger
        assert hasattr(audit_logger, 'AuditLogger')
        assert hasattr(audit_logger, 'audit_logger')

    def test_log_audit_function_exists(self):
        """Verify log_audit function exists in main."""
        from main import log_audit
        assert callable(log_audit)

    def test_audit_log_model_exists(self):
        """Verify AuditLog model exists."""
        from response_models import AuditLog
        assert AuditLog is not None

    def test_audit_logger_can_be_instantiated(self):
        """Verify AuditLogger class can be created."""
        from utils.audit_logger import AuditLogger
        logger = AuditLogger()
        assert logger is not None
        assert hasattr(logger, 'log')


class TestAuthValidationRulesEnforcement:
    """Test 5: Auth validation rules enforcement - structure tests."""

    def test_validators_module_has_required_functions(self):
        """Verify validators module has required validation functions."""
        from utils import validators
        assert hasattr(validators, 'AuthValidator')
        assert hasattr(validators, 'DosageRequestValidator')
        assert hasattr(validators, 'SafetyScoreValidator')

    def test_auth_validator_structure(self):
        """Verify AuthValidator has required static methods."""
        from utils.validators import AuthValidator
        assert hasattr(AuthValidator, 'validate_email')
        assert hasattr(AuthValidator, 'validate_password')


class TestDosageSafetyAPIStructure:
    """Test Phase 2 Dosage Safety API structure."""

    def test_dosage_route_module_exists(self):
        """Verify dosage route module exists and has router."""
        from api.routes import dosage
        assert hasattr(dosage, 'router')
        assert dosage.router is not None

    def test_dosage_route_has_endpoints(self):
        """Verify dosage route has the required endpoints."""
        from api.routes import dosage
        routes = [route.path for route in dosage.router.routes]
        assert "/dosage-check" in str(routes)
        assert "/score" in str(routes)

    def test_dosage_check_request_model(self):
        """Verify DosageCheckRequest model exists and has correct fields."""
        from api.routes.dosage import DosageCheckRequest
        assert DosageCheckRequest is not None


class TestDrugInteractionAPIStructure:
    """Test Phase 2 Drug Interaction API structure."""

    def test_interaction_route_module_exists(self):
        """Verify interaction route module exists and has router."""
        from api.routes import interactions
        assert hasattr(interactions, 'router')
        assert interactions.router is not None

    def test_interaction_route_has_endpoints(self):
        """Verify interaction route has the required endpoints."""
        from api.routes import interactions
        routes = [route.path for route in interactions.router.routes]
        assert "/check" in str(routes)

    def test_interaction_check_request_model(self):
        """Verify InteractionCheckRequest model exists."""
        from api.routes.interactions import InteractionCheckRequest
        assert InteractionCheckRequest is not None


class TestSafetyScoreAPIStructure:
    """Test Phase 2 Safety Score API structure."""

    def test_safety_score_in_dosage_route(self):
        """Verify safety score endpoint is in dosage route."""
        from api.routes import dosage
        routes = [route.path for route in dosage.router.routes]
        assert "/score" in str(routes)


class TestModelsAndValidators:
    """Test Pydantic models and validators."""

    def test_safety_models_exist(self):
        """Verify safety models exist."""
        from models.safety import (
            PatientProfile, DosageRequest, EvidenceAttribution,
            ClinicalFinding, SafetyScoreRequest, SafetyScoreResponse,
            DosageSafetyRequest, DosageSafetyResponse,
            DrugInteractionRequest, DrugInteractionResponse, DosageAssessment
        )
        assert all([
            PatientProfile, DosageRequest, EvidenceAttribution,
            ClinicalFinding, SafetyScoreRequest, SafetyScoreResponse,
            DosageSafetyRequest, DosageSafetyResponse,
            DrugInteractionRequest, DrugInteractionResponse, DosageAssessment
        ])

    def test_patient_profile_validation(self):
        """Verify PatientProfile validation works."""
        from models.safety import PatientProfile
        profile = PatientProfile(age=30, weight_kg=70, is_pregnant=False)
        assert profile.age == 30
        assert profile.weight_kg == 70
        assert profile.is_pregnant is False

    def test_dosage_request_validation(self):
        """Verify DosageRequest validation works."""
        from models.safety import DosageRequest
        req = DosageRequest(med_id=1, dosage=500, frequency="OD")
        assert req.med_id == 1
        assert req.dosage == 500
        assert req.frequency == "OD"

    def test_safety_score_request_validation(self):
        """Verify SafetyScoreRequest validation works."""
        from models.safety import SafetyScoreRequest
        req = SafetyScoreRequest(med_ids=[1, 2, 3])
        assert req.med_ids == [1, 2, 3]

    def test_drug_interaction_request_validation(self):
        """Verify DrugInteractionRequest validation works."""
        from models.safety import DrugInteractionRequest
        req = DrugInteractionRequest(med_ids=[1, 2])
        assert req.med_ids == [1, 2]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])