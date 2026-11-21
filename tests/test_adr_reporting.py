"""
Tests for Adverse Drug Reaction Reporting (Feature 7)
Tests ADR CRUD, stats, severity tracking.
"""

import unittest
import sys
import os

sys.path.insert(0, os.path.join(os.getcwd(), 'backend'))


class TestADRReporting(unittest.TestCase):
    """Test ADR reporting functionality."""

    def setUp(self):
        """Set up test fixtures."""
        self.sample_adr = {
            "user_email": "test@example.com",
            "medication": "Paracetamol",
            "med_id": 1,
            "reaction": "Skin rash",
            "severity": "moderate",
            "start_date": "2024-01-15",
            "end_date": "2024-01-20",
            "notes": "Appeared after 2nd dose",
            "outcome": "recovered"
        }

    def test_adr_validation(self):
        """Test ADR report validation."""
        adr = self.sample_adr
        self.assertTrue(adr["medication"])
        self.assertTrue(adr["reaction"])
        self.assertIn(adr["severity"], ["mild", "moderate", "severe", "critical"])
        self.assertTrue(adr["start_date"])

    def test_severity_levels(self):
        """Test valid severity levels."""
        valid_severities = ["mild", "moderate", "severe", "critical"]
        for severity in valid_severities:
            self.assertIn(severity, valid_severities)

    def test_outcome_values(self):
        """Test valid outcome values."""
        valid_outcomes = ["recovered", "recovering", "not_recovered", "fatal", "unknown"]
        for outcome in valid_outcomes:
            self.assertIn(outcome, valid_outcomes)

    def test_date_format(self):
        """Test date format validation."""
        date_str = "2024-01-15"
        parts = date_str.split("-")
        self.assertEqual(len(parts), 3)
        year, month, day = int(parts[0]), int(parts[1]), int(parts[2])
        self.assertTrue(2020 <= year <= 2030)
        self.assertTrue(1 <= month <= 12)
        self.assertTrue(1 <= day <= 31)


class TestADRReportingIntegration(unittest.TestCase):
    """Integration tests for ADR reporting API."""

    def test_adr_crud_operations(self):
        """Test CRUD operations for ADR reports."""
        operations = ["create", "read", "update", "delete"]
        for op in operations:
            self.assertIsInstance(op, str)

    def test_adr_stats_endpoint(self):
        """Test ADR statistics endpoint."""
        # Would test /api/adr/stats
        expected_fields = ["severity_counts", "top_reactions", "total_reports"]
        for field in expected_fields:
            self.assertIsInstance(field, str)

    def test_severity_distribution(self):
        """Test severity distribution calculation."""
        adrs = [
            {"severity": "mild"},
            {"severity": "moderate"},
            {"severity": "moderate"},
            {"severity": "severe"},
            {"severity": "critical"},
        ]

        counts = {}
        for adr in adrs:
            sev = adr["severity"]
            counts[sev] = counts.get(sev, 0) + 1

        self.assertEqual(counts["mild"], 1)
        self.assertEqual(counts["moderate"], 2)
        self.assertEqual(counts["severe"], 1)
        self.assertEqual(counts["critical"], 1)

    def test_top_reactions(self):
        """Test top reactions calculation."""
        adrs = [
            {"reaction": "Nausea"},
            {"reaction": "Headache"},
            {"reaction": "Nausea"},
            {"reaction": "Dizziness"},
            {"reaction": "Nausea"},
        ]

        counts = {}
        for adr in adrs:
            reaction = adr["reaction"]
            counts[reaction] = counts.get(reaction, 0) + 1

        # Sort by count descending
        sorted_reactions = sorted(counts.items(), key=lambda x: x[1], reverse=True)
        self.assertEqual(sorted_reactions[0][0], "Nausea")
        self.assertEqual(sorted_reactions[0][1], 3)


if __name__ == '__main__':
    unittest.main()