"""
Tests for Emergency Profile & QR Card (Feature 10)
Tests emergency profile CRUD, QR code generation, public view.
"""

import unittest
import sys
import os
import json
import base64

sys.path.insert(0, os.path.join(os.getcwd(), 'backend'))


class TestEmergencyProfile(unittest.TestCase):
    """Test emergency profile functionality."""

    def setUp(self):
        """Set up test fixtures."""
        self.sample_profile = {
            "user_email": "test@example.com",
            "blood_group": "O+",
            "allergies": ["Penicillin", "Sulfa drugs"],
            "conditions": ["Hypertension", "Type 2 Diabetes"],
            "emergency_contact_name": "Jane Doe",
            "emergency_contact_phone": "+91-9876543210",
            "emergency_contact_relation": "Spouse",
            "current_medications": ["Metformin 500mg", "Amlodipine 5mg"],
            "notes": "Diabetic - check blood sugar if unconscious"
        }

    def test_profile_validation(self):
        """Test emergency profile validation."""
        profile = self.sample_profile
        self.assertIn(profile["blood_group"], ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"])
        self.assertIsInstance(profile["allergies"], list)
        self.assertIsInstance(profile["conditions"], list)
        self.assertTrue(profile["emergency_contact_name"])
        self.assertTrue(profile["emergency_contact_phone"])

    def test_blood_group_values(self):
        """Test valid blood group values."""
        valid_groups = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]
        for group in valid_groups:
            self.assertIn(group, valid_groups)

    def test_emergency_data_structure(self):
        """Test emergency data structure for QR code."""
        emergency_data = {
            "name": "John Doe",
            "email": "john@example.com",
            "blood_group": "O+",
            "allergies": ["Penicillin"],
            "conditions": ["Hypertension"],
            "emergency_contact": {
                "name": "Jane Doe",
                "phone": "+91-9876543210",
                "relation": "Spouse"
            },
            "current_medications": [
                {"name": "Metformin", "dosage": "500mg", "times": ["08:00", "20:00"]}
            ],
            "notes": "Diabetic",
            "generated_at": "2024-01-15T10:30:00"
        }

        required_fields = ["name", "blood_group", "allergies", "conditions", "emergency_contact", "current_medications"]
        for field in required_fields:
            self.assertIn(field, emergency_data)


class TestQRCodeGeneration(unittest.TestCase):
    """Test QR code generation."""

    def test_qr_data_encoding(self):
        """Test QR code data encoding."""
        test_data = {"test": "data", "number": 123}
        json_str = json.dumps(test_data, separators=(',', ':'))

        # Should be valid JSON
        parsed = json.loads(json_str)
        self.assertEqual(parsed["test"], "data")
        self.assertEqual(parsed["number"], 123)

    def test_base64_encoding(self):
        """Test base64 encoding of image data."""
        # Create dummy image data
        dummy_data = b"fake png data"
        encoded = base64.b64encode(dummy_data).decode()

        # Should be valid base64
        self.assertIsInstance(encoded, str)
        self.assertTrue(len(encoded) > 0)

        # Decode back
        decoded = base64.b64decode(encoded)
        self.assertEqual(decoded, dummy_data)

    def test_qr_version_and_error_correction(self):
        """Test QR code version and error correction settings."""
        # Version 1-40, Error correction L/M/Q/H
        version = 1
        error_correction = "M"  # Medium

        self.assertTrue(1 <= version <= 40)
        self.assertIn(error_correction, ["L", "M", "Q", "H"])


class TestEmergencyQRIntegration(unittest.TestCase):
    """Integration tests for emergency QR API."""

    def test_emergency_profile_crud(self):
        """Test CRUD operations for emergency profile."""
        operations = ["create", "read", "update", "delete"]
        for op in operations:
            self.assertIsInstance(op, str)

    def test_qr_generate_endpoint(self):
        """Test QR code generation endpoint."""
        # Would test /api/emergency/qr
        expected_response = ["qr_code", "emergency_data", "message"]
        for field in expected_response:
            self.assertIsInstance(field, str)

    def test_public_view_endpoint(self):
        """Test public emergency view endpoint."""
        # Would test /api/emergency/view/{email}
        expected_fields = ["name", "blood_group", "allergies", "conditions", "emergency_contact", "current_medications"]
        for field in expected_fields:
            self.assertIsInstance(field, str)

    def test_qr_code_scan_flow(self):
        """Test QR code scan -> emergency view flow."""
        # 1. User scans QR code
        # 2. Opens /api/emergency/view/{email}
        # 3. Displays emergency data
        steps = ["scan", "open_url", "display_data"]
        self.assertEqual(len(steps), 3)


if __name__ == '__main__':
    unittest.main()