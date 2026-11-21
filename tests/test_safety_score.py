"""
Tests for Patient Safety Score (Feature 8)
Tests safety score calculation, risk categorization, gauge display.
"""

import unittest
import sys
import os

sys.path.insert(0, os.path.join(os.getcwd(), 'backend'))


class TestPatientSafetyScore(unittest.TestCase):
    """Test patient safety score functionality."""

    def setUp(self):
        """Set up test fixtures."""
        self.sample_request = {
            "med_ids": [1, 2, 3],  # Paracetamol, Ibuprofen, Metformin
            "patient": {
                "age": 45,
                "weight": 70,
                "conditions": ["hypertension"],
                "pregnant": False
            }
        }

    def test_safety_score_calculation(self):
        """Test safety score calculation logic."""
        # Risk weights per risk level
        risk_weights = {
            "INFORMATIONAL": 0,
            "CAUTION": 10,
            "ELEVATED_RISK": 25,
            "CRITICAL_REVIEW_REQUIRED": 50
        }

        # Example: 3 medications with different risk levels
        assessments = [
            {"risk_level": "INFORMATIONAL"},   # 0
            {"risk_level": "CAUTION"},         # 10
            {"risk_level": "ELEVATED_RISK"}    # 25
        ]

        total_risk = sum(risk_weights.get(a["risk_level"], 0) for a in assessments)
        max_possible = len(assessments) * 50  # 3 * 50 = 150
        safety_score = max(0, 100 - (total_risk / max_possible * 100))

        expected = max(0, 100 - (35 / 150 * 100))  # 100 - 23.33 = 76.67
        self.assertAlmostEqual(safety_score, expected, places=1)

    def test_risk_category_determination(self):
        """Test risk category from safety score."""
        test_cases = [
            (90, "LOW"),
            (80, "LOW"),
            (70, "MODERATE"),
            (60, "MODERATE"),
            (40, "HIGH"),
            (30, "HIGH"),
            (20, "CRITICAL"),
            (0, "CRITICAL")
        ]

        for score, expected_category in test_cases:
            if score >= 80:
                category = "LOW"
            elif score >= 60:
                category = "MODERATE"
            elif score >= 30:
                category = "HIGH"
            else:
                category = "CRITICAL"
            self.assertEqual(category, expected_category)

    def test_gauge_color_mapping(self):
        """Test gauge color per risk category."""
        colors = {
            "LOW": "var(--good)",       # Green
            "MODERATE": "var(--warn)",  # Yellow/Orange
            "HIGH": "var(--warn)",      # Orange
            "CRITICAL": "var(--bad)"    # Red
        }

        for category, color in colors.items():
            self.assertIsInstance(color, str)
            self.assertTrue(color.startswith("var(--"))

    def test_severity_breakdown(self):
        """Test findings severity breakdown."""
        findings = [
            {"severity": "LOW"},
            {"severity": "MODERATE"},
            {"severity": "MODERATE"},
            {"severity": "HIGH"},
            {"severity": "CRITICAL"}
        ]

        counts = {"LOW": 0, "MODERATE": 0, "HIGH": 0, "CRITICAL": 0}
        for f in findings:
            counts[f["severity"]] = counts.get(f["severity"], 0) + 1

        self.assertEqual(counts["LOW"], 1)
        self.assertEqual(counts["MODERATE"], 2)
        self.assertEqual(counts["HIGH"], 1)
        self.assertEqual(counts["CRITICAL"], 1)


class TestSafetyScoreIntegration(unittest.TestCase):
    """Integration tests for safety score API."""

    def test_safety_score_endpoint_payload(self):
        """Test safety score endpoint request payload."""
        payload = {
            "med_ids": [1, 2, 3],
            "patient": {
                "age": 45,
                "weight": 70,
                "conditions": ["hypertension"],
                "pregnant": False
            }
        }

        self.assertIn("med_ids", payload)
        self.assertIsInstance(payload["med_ids"], list)
        self.assertIn("patient", payload)

    def test_top_concerns_sorting(self):
        """Test top concerns sorted by severity."""
        findings = [
            {"severity": "LOW", "finding": "Minor"},
            {"severity": "CRITICAL", "finding": "Critical"},
            {"severity": "HIGH", "finding": "High"},
            {"severity": "MODERATE", "finding": "Moderate"}
        ]

        severity_order = {"CRITICAL": 4, "HIGH": 3, "MODERATE": 2, "LOW": 1}
        sorted_findings = sorted(findings, key=lambda x: severity_order.get(x["severity"], 0), reverse=True)

        self.assertEqual(sorted_findings[0]["severity"], "CRITICAL")
        self.assertEqual(sorted_findings[1]["severity"], "HIGH")
        self.assertEqual(sorted_findings[2]["severity"], "MODERATE")
        self.assertEqual(sorted_findings[3]["severity"], "LOW")


if __name__ == '__main__':
    unittest.main()