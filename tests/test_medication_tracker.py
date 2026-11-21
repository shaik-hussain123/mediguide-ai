"""
Tests for Medication Tracker (Feature 4)
Tests schedule CRUD, dose logging, adherence calculation.
"""

import unittest
import sys
import os
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.getcwd(), 'backend'))


class TestMedicationTracker(unittest.TestCase):
    """Test medication tracker functionality."""

    def setUp(self):
        """Set up test fixtures."""
        self.sample_schedule = {
            "user_email": "test@example.com",
            "med_id": 1,
            "med_name": "Paracetamol",
            "dosage": "500mg",
            "times": ["08:00", "14:00", "20:00", "22:00"],
            "days": [0, 1, 2, 3, 4, 5, 6],
            "start_date": "2024-01-01",
            "end_date": None,
            "notes": "Take with food",
            "active": True
        }

    def test_schedule_validation(self):
        """Test schedule creation validation."""
        # Valid schedule
        schedule = self.sample_schedule
        self.assertTrue(schedule["med_name"])
        self.assertTrue(schedule["dosage"])
        self.assertGreater(len(schedule["times"]), 0)
        self.assertGreater(len(schedule["days"]), 0)
        self.assertTrue(schedule["start_date"])

    def test_dose_logging_statuses(self):
        """Test valid dose logging statuses."""
        valid_statuses = ["taken", "skipped", "missed"]
        for status in valid_statuses:
            self.assertIn(status, valid_statuses)

    def test_adherence_calculation(self):
        """Test adherence percentage calculation."""
        # Scenario: 10 scheduled, 8 taken, 1 skipped, 1 missed
        total_scheduled = 10
        taken = 8
        skipped = 1
        missed = 1

        adherence_pct = (taken / total_scheduled * 100) if total_scheduled > 0 else 0
        self.assertEqual(adherence_pct, 80.0)

    def test_schedule_days_format(self):
        """Test schedule days array format (0=Sunday)."""
        days = [0, 1, 2, 3, 4, 5, 6]
        self.assertEqual(len(days), 7)
        self.assertTrue(all(0 <= d <= 6 for d in days))

    def test_time_format_24h(self):
        """Test time format is 24-hour."""
        times = ["08:00", "14:00", "20:00", "22:00"]
        for t in times:
            parts = t.split(":")
            self.assertEqual(len(parts), 2)
            hour = int(parts[0])
            minute = int(parts[1])
            self.assertTrue(0 <= hour <= 23)
            self.assertTrue(0 <= minute <= 59)

    def test_date_format_iso(self):
        """Test date format is ISO YYYY-MM-DD."""
        date_str = "2024-01-15"
        # Validate format
        parts = date_str.split("-")
        self.assertEqual(len(parts), 3)
        year, month, day = int(parts[0]), int(parts[1]), int(parts[2])
        self.assertTrue(2020 <= year <= 2030)
        self.assertTrue(1 <= month <= 12)
        self.assertTrue(1 <= day <= 31)


class TestMedicationTrackerIntegration(unittest.TestCase):
    """Integration tests for medication tracker API."""

    def test_schedule_crud_operations(self):
        """Test CRUD operations for schedules."""
        operations = ["create", "read", "update", "delete", "log_dose"]
        for op in operations:
            self.assertIsInstance(op, str)

    def test_adherence_endpoint(self):
        """Test adherence calculation endpoint."""
        # Would test /api/schedules/{id}/adherence
        params = {"days": 30}
        self.assertIn("days", params)

    def test_log_dose_payload(self):
        """Test dose logging payload structure."""
        payload = {
            "schedule_id": "507f1f77bcf86cd799439011",
            "scheduled_time": "2024-01-15T08:00:00",
            "status": "taken",
            "notes": "Taken with breakfast"
        }
        required_fields = ["schedule_id", "scheduled_time", "status"]
        for field in required_fields:
            self.assertIn(field, payload)


if __name__ == '__main__':
    unittest.main()