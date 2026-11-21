"""
Tests for Database Schema Expansion.
Tests collection creation, indexes, validation, migrations.
"""
import unittest
import sys
import os
from datetime import datetime

sys.path.insert(0, os.path.join(os.getcwd(), 'backend'))

from database import (
    initialize_collections, initialize_indexes, initialize_database,
    run_migrations, validate_user_document, validate_medication_document,
    validate_all_documents, seed_emergency_blood_groups, seed_pregnancy_categories,
    seed_interaction_severities, seed_adr_severities, seed_adr_statuses,
    seed_risk_levels, seed_clinical_severities
)
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
DATABASE_NAME = os.getenv("DATABASE_NAME", "mediguide_test_db")


class TestDatabaseSchema(unittest.IsolatedAsyncioTestCase):
    """Test database schema initialization and validation."""

    async def asyncSetUp(self):
        """Set up test database."""
        self.client = AsyncIOMotorClient(MONGODB_URL)
        self.db = self.client[DATABASE_NAME]
        # Clean up test collections
        await self.db["users"].delete_many({})
        await self.db["medications"].delete_many({})

    async def asyncTearDown(self):
        """Clean up after tests."""
        await self.db["users"].delete_many({})
        await self.db["medications"].delete_many({})
        self.client.close()

    async def test_initialize_collections(self):
        """Test collection creation."""
        from database import COLLECTIONS
        result = await initialize_collections(self.db)

        for coll_name in COLLECTIONS.values():
            self.assertIn(coll_name, result)
            self.assertIn(result[coll_name], ["created", "exists"])

        # Verify collections exist
        collections = await self.db.list_collection_names()
        for coll_name in COLLECTIONS.values():
            self.assertIn(coll_name, collections)

    async def test_initialize_indexes(self):
        """Test index creation."""
        from database import INDEX_DEFINITIONS
        result = await initialize_indexes(self.db)

        for coll_name in INDEX_DEFINITIONS.keys():
            self.assertIn(coll_name, result)
            self.assertIsInstance(result[coll_name], dict)

    async def test_initialize_database_full(self):
        """Test complete database initialization."""
        result = await initialize_database(self.db)

        self.assertIn("collections", result)
        self.assertIn("indexes", result)
        self.assertIn("total_collections", result)
        self.assertIn("collections_list", result)
        self.assertIn("initialized_at", result)
        self.assertGreater(result["total_collections"], 0)

    async def test_validate_user_document_valid(self):
        """Test user document validation with valid data."""
        valid_user = {
            "id": "test-123",
            "name": "Test User",
            "email": "test@example.com",
            "password_hash": "hashed_password",
            "role": "user",
            "created_at": datetime.utcnow().isoformat(),
            "profile": {
                "age": 30,
                "weight": 70.5,
                "height": 175,
                "blood_group": "O+",
                "gender": "male",
                "conditions": ["hypertension"],
                "allergies": ["penicillin"],
                "is_pregnant": False,
                "is_lactating": False
            },
            "settings": {
                "elderly_mode": False,
                "high_contrast": False,
                "font_scale": 1,
                "notifications": True,
                "language": "en"
            }
        }

        is_valid, errors = await validate_user_document(valid_user)
        self.assertTrue(is_valid)
        self.assertEqual(len(errors), 0)

    async def test_validate_user_document_invalid_email(self):
        """Test user document validation with invalid email."""
        invalid_user = {
            "id": "test-123",
            "name": "Test User",
            "email": "invalid-email",
            "password_hash": "hashed_password",
            "role": "user",
            "created_at": datetime.utcnow().isoformat()
        }

        is_valid, errors = await validate_user_document(invalid_user)
        self.assertFalse(is_valid)
        self.assertTrue(any("email" in e.lower() for e in errors))

    async def test_validate_user_document_invalid_role(self):
        """Test user document validation with invalid role."""
        invalid_user = {
            "id": "test-123",
            "name": "Test User",
            "email": "test@example.com",
            "password_hash": "hashed_password",
            "role": "invalid_role",
            "created_at": datetime.utcnow().isoformat()
        }

        is_valid, errors = await validate_user_document(invalid_user)
        self.assertFalse(is_valid)
        self.assertTrue(any("role" in e.lower() for e in errors))

    async def test_validate_user_document_invalid_blood_group(self):
        """Test user document validation with invalid blood group."""
        invalid_user = {
            "id": "test-123",
            "name": "Test User",
            "email": "test@example.com",
            "password_hash": "hashed_password",
            "role": "user",
            "created_at": datetime.utcnow().isoformat(),
            "profile": {
                "blood_group": "Z+"
            }
        }

        is_valid, errors = await validate_user_document(invalid_user)
        self.assertFalse(is_valid)
        self.assertTrue(any("blood group" in e.lower() for e in errors))

    async def test_validate_medication_document_valid(self):
        """Test medication document validation with valid data."""
        valid_med = {
            "id": 100,
            "name": "TestMed",
            "generic_name": "Test Generic",
            "active_ingredient": "Test Ingredient",
            "strength": "500mg",
            "dosage_form": "Tablet",
            "category": "Test Category",
            "safe_min": 100.0,
            "safe_max": 1000.0,
            "pediatric_max": 50.0,
            "mg_per_kg_max": 10.0,
            "pregnancy_category": "B",
            "renal_adjustment": False,
            "hepatic_adjustment": True,
            "evidenceTier": 1,
            "confidenceScore": 95
        }

        is_valid, errors = await validate_medication_document(valid_med)
        self.assertTrue(is_valid)
        self.assertEqual(len(errors), 0)

    async def test_validate_medication_document_safe_min_max(self):
        """Test medication validation with safe_min > safe_max."""
        invalid_med = {
            "id": 100,
            "name": "TestMed",
            "generic_name": "Test Generic",
            "active_ingredient": "Test Ingredient",
            "strength": "500mg",
            "dosage_form": "Tablet",
            "category": "Test Category",
            "safe_min": 1000.0,
            "safe_max": 500.0,
        }

        is_valid, errors = await validate_medication_document(invalid_med)
        self.assertFalse(is_valid)
        self.assertTrue(any("safe_min" in e.lower() for e in errors))

    async def test_validate_medication_document_invalid_pregnancy_category(self):
        """Test medication validation with invalid pregnancy category."""
        invalid_med = {
            "id": 100,
            "name": "TestMed",
            "generic_name": "Test Generic",
            "active_ingredient": "Test Ingredient",
            "strength": "500mg",
            "dosage_form": "Tablet",
            "category": "Test Category",
            "safe_min": 100.0,
            "safe_max": 1000.0,
            "pregnancy_category": "Z"
        }

        is_valid, errors = await validate_medication_document(invalid_med)
        self.assertFalse(is_valid)
        self.assertTrue(any("pregnancy" in e.lower() for e in errors))

    async def test_validate_medication_document_invalid_evidence_tier(self):
        """Test medication validation with invalid evidence tier."""
        invalid_med = {
            "id": 100,
            "name": "TestMed",
            "generic_name": "Test Generic",
            "active_ingredient": "Test Ingredient",
            "strength": "500mg",
            "dosage_form": "Tablet",
            "category": "Test Category",
            "safe_min": 100.0,
            "safe_max": 1000.0,
            "evidenceTier": 5
        }

        is_valid, errors = await validate_medication_document(invalid_med)
        self.assertFalse(is_valid)
        self.assertTrue(any("evidencetier" in e.lower() for e in errors))

    async def test_seed_functions(self):
        """Test seed data functions return expected values."""
        blood_groups = await seed_emergency_blood_groups()
        self.assertEqual(len(blood_groups), 8)
        self.assertIn("O+", blood_groups)
        self.assertIn("AB-", blood_groups)

        pregnancy_cats = await seed_pregnancy_categories()
        self.assertEqual(len(pregnancy_cats), 5)
        self.assertIn("A", pregnancy_cats)
        self.assertIn("X", pregnancy_cats)

        interaction_sev = await seed_interaction_severities()
        self.assertEqual(len(interaction_sev), 4)
        self.assertIn("Major", interaction_sev)
        self.assertIn("Contraindicated", interaction_sev)

        adr_sev = await seed_adr_severities()
        self.assertEqual(len(adr_sev), 4)
        self.assertIn("Critical", adr_sev)

        adr_status = await seed_adr_statuses()
        self.assertEqual(len(adr_status), 3)
        self.assertIn("Open", adr_status)
        self.assertIn("Closed", adr_status)

        risk_levels = await seed_risk_levels()
        self.assertEqual(len(risk_levels), 4)
        self.assertIn("CRITICAL_REVIEW_REQUIRED", risk_levels)

        clinical_sev = await seed_clinical_severities()
        self.assertEqual(len(clinical_sev), 4)
        self.assertIn("CRITICAL", clinical_sev)

    async def test_run_migrations(self):
        """Test migration execution."""
        # Create a user without profile/settings to test migration
        await self.db["users"].insert_one({
            "id": "migration-test-1",
            "name": "Migration Test",
            "email": "migration@test.com",
            "password_hash": "hash",
            "role": "user",
            "created_at": datetime.utcnow().isoformat()
            # No profile or settings fields
        })

        applied = await run_migrations(self.db)
        self.assertIsInstance(applied, list)

        # Check that profile and settings were added
        user = await self.db["users"].find_one({"email": "migration@test.com"})
        self.assertIn("profile", user)
        self.assertIn("settings", user)
        self.assertIn("age", user["profile"])
        self.assertIn("elderly_mode", user["settings"])

    async def test_validate_all_documents(self):
        """Test document validation across collections."""
        # Insert valid and invalid users
        await self.db["users"].insert_many([
            {
                "id": "valid-1",
                "name": "Valid User",
                "email": "valid@test.com",
                "password_hash": "hash",
                "role": "user",
                "created_at": datetime.utcnow().isoformat(),
                "profile": {"age": 30, "weight": 70},
                "settings": {"language": "en"}
            },
            {
                "id": "invalid-1",
                "name": "Invalid User",
                "email": "not-an-email",
                "password_hash": "hash",
                "role": "user",
                "created_at": datetime.utcnow().isoformat()
            }
        ])

        # Insert valid and invalid medications
        await self.db["medications"].insert_many([
            {
                "id": 200,
                "name": "ValidMed",
                "generic_name": "Valid Generic",
                "active_ingredient": "Valid",
                "strength": "100mg",
                "dosage_form": "Tablet",
                "category": "Test",
                "safe_min": 50.0,
                "safe_max": 200.0
            },
            {
                "id": 201,
                "name": "InvalidMed",
                "generic_name": "Invalid Generic",
                "active_ingredient": "Invalid",
                "strength": "100mg",
                "dosage_form": "Tablet",
                "category": "Test",
                "safe_min": 300.0,
                "safe_max": 100.0  # Invalid: min > max
            }
        ])

        report = await validate_all_documents(self.db)

        self.assertIn("users", report)
        self.assertIn("medications", report)
        self.assertEqual(report["users"]["valid"], 1)
        self.assertEqual(report["users"]["invalid"], 1)
        self.assertEqual(report["medications"]["valid"], 1)
        self.assertEqual(report["medications"]["invalid"], 1)


if __name__ == '__main__':
    unittest.main()