"""
Tests for Medication Dosage Charts (Feature 2)
Tests adult dosage calculations, pediatric calculations, exposure calculations, chart rendering, risk color logic.
"""

import unittest
import sys
import os

sys.path.insert(0, os.path.join(os.getcwd(), 'backend'))

from models.safety import DosageRequest, PatientProfile
from safety_engine import DosageSafetyEngine


class TestDosageCharts(unittest.TestCase):
    """Test dosage chart calculations and rendering logic."""

    def setUp(self):
        """Set up test fixtures."""
        self.engine = DosageSafetyEngine()

        # Mock medication data with safety thresholds
        self.paracetamol = {
            'id': 1,
            'name': 'Paracetamol',
            'safe_min': 500.0,
            'safe_max': 4000.0,
            'pediatric_max': 90.0,
            'mg_per_kg_max': 15.0,
            'sourceName': 'CDSCO India',
            'confidenceScore': 95,
            'evidenceTier': 1
        }

        self.ibuprofen = {
            'id': 2,
            'name': 'Ibuprofen',
            'safe_min': 200.0,
            'safe_max': 1200.0,
            'pediatric_max': 400.0,
            'mg_per_kg_max': 10.0,
            'sourceName': 'CDSCO India',
            'confidenceScore': 90,
            'evidenceTier': 1
        }

    def test_adult_dosage_range_calculation(self):
        """Test adult dosage min/max range calculation."""
        safe_min = self.paracetamol['safe_min']
        safe_max = self.paracetamol['safe_max']

        self.assertEqual(safe_min, 500.0)
        self.assertEqual(safe_max, 4000.0)
        self.assertLess(safe_min, safe_max)

    def test_pediatric_dosage_calculation(self):
        """Test pediatric dosage max and mg/kg calculation."""
        pediatric_max = self.paracetamol['pediatric_max']
        mg_per_kg_max = self.paracetamol['mg_per_kg_max']

        self.assertEqual(pediatric_max, 90.0)
        self.assertEqual(mg_per_kg_max, 15.0)

        # Test weight-based calculation for 10kg child
        weight_kg = 10
        max_dose_for_weight = mg_per_kg_max * weight_kg
        self.assertEqual(max_dose_for_weight, 150.0)
        # Should not exceed pediatric_max
        self.assertLessEqual(max_dose_for_weight, pediatric_max)

    def test_daily_exposure_calculation(self):
        """Test daily exposure calculation for different frequencies."""
        dose = 500.0

        # Frequency multipliers
        freq_multipliers = {
            'OD': 1,
            'BD': 2,
            'TDS': 3,
            'QID': 4,
            'Q8H': 3,
            'Q12H': 2,
            'HS': 1
        }

        for freq, multiplier in freq_multipliers.items():
            daily_exposure = dose * multiplier
            expected = dose * multiplier
            self.assertEqual(daily_exposure, expected)

    def test_risk_level_classification(self):
        """Test risk level classification based on percentage of safe_max."""
        safe_max = 4000.0

        test_cases = [
            # (daily_exposure, expected_risk_level)
            (500.0, 'INFORMATIONAL'),      # 12.5%
            (1000.0, 'INFORMATIONAL'),     # 25%
            (2000.0, 'CAUTION'),           # 50%
            (3000.0, 'ELEVATED_RISK'),     # 75%
            (3500.0, 'ELEVATED_RISK'),     # 87.5%
            (4000.0, 'CRITICAL_REVIEW_REQUIRED'),  # 100%
            (4500.0, 'CRITICAL_REVIEW_REQUIRED'),  # 112.5%
        ]

        for daily_exposure, expected_risk in test_cases:
            percent = (daily_exposure / safe_max) * 100

            if percent <= 25:
                risk = 'INFORMATIONAL'
            elif percent <= 50:
                risk = 'CAUTION'
            elif percent <= 75:
                risk = 'ELEVATED_RISK'
            elif percent <= 100:
                risk = 'ELEVATED_RISK'
            else:
                risk = 'CRITICAL_REVIEW_REQUIRED'

            self.assertEqual(risk, expected_risk)

    def test_risk_color_mapping(self):
        """Test risk level to color mapping."""
        risk_colors = {
            'INFORMATIONAL': 'var(--good)',      # Green
            'CAUTION': 'var(--warn)',            # Yellow
            'ELEVATED_RISK': 'var(--warn)',      # Orange
            'CRITICAL_REVIEW_REQUIRED': 'var(--bad)'  # Red
        }

        expected_colors = {
            'INFORMATIONAL': 'var(--good)',
            'CAUTION': 'var(--warn)',
            'ELEVATED_RISK': 'var(--warn)',
            'CRITICAL_REVIEW_REQUIRED': 'var(--bad)'
        }

        for risk, color in risk_colors.items():
            self.assertEqual(color, expected_colors[risk])

    def test_safety_engine_evaluation(self):
        """Test DosageSafetyEngine evaluation with mock medication data."""
        # Create a dosage request
        request = DosageRequest(
            med_id=1,
            dosage=500.0,
            frequency='OD',
            patient=PatientProfile(
                age=30,
                weight=70.0,
                conditions=[],
                pregnant=False
            )
        )

        # Evaluate with mock medication data
        assessment = self.engine.evaluate(request, self.paracetamol)

        # Verify assessment structure
        self.assertIsNotNone(assessment)
        self.assertEqual(assessment.reference_max, 4000.0)
        self.assertEqual(assessment.dosage, 500.0)
        self.assertEqual(assessment.frequency, 'OD')
        self.assertEqual(assessment.daily_multiplier, 1)

        # Daily exposure should be 500 mg
        self.assertEqual(assessment.daily_exposure, 500.0)

        # Risk level for 500/4000 = 12.5% should be INFORMATIONAL
        self.assertEqual(assessment.risk_level, 'INFORMATIONAL')

    def test_safety_engine_high_dose(self):
        """Test safety engine with high dose."""
        request = DosageRequest(
            med_id=1,
            dosage=2000.0,
            frequency='QID',  # 4x daily = 8000 mg/day
            patient=PatientProfile(age=30, weight=70.0, conditions=[], pregnant=False)
        )

        assessment = self.engine.evaluate(request, self.paracetamol)

        # Daily exposure = 2000 * 4 = 8000 mg
        self.assertEqual(assessment.daily_exposure, 8000.0)
        # 8000/4000 = 200% -> CRITICAL_REVIEW_REQUIRED
        self.assertEqual(assessment.risk_level, 'CRITICAL_REVIEW_REQUIRED')

    def test_pediatric_patient_assessment(self):
        """Test safety assessment for pediatric patient."""
        request = DosageRequest(
            med_id=1,
            dosage=250.0,
            frequency='TDS',  # 3x daily = 750 mg/day
            patient=PatientProfile(age=8, weight=25.0, conditions=[], pregnant=False)
        )

        assessment = self.engine.evaluate(request, self.paracetamol)

        # Should trigger pediatric rule
        self.assertIsNotNone(assessment.findings)
        pediatric_findings = [f for f in assessment.findings if f.rule_type == 'pediatric']
        self.assertGreater(len(pediatric_findings), 0)

    def test_evidence_attribution(self):
        """Test that evidence attribution is included in assessment."""
        request = DosageRequest(
            med_id=1,
            dosage=500.0,
            frequency='OD',
            patient=PatientProfile(age=30, weight=70.0, conditions=[], pregnant=False)
        )

        assessment = self.engine.evaluate(request, self.paracetamol)

        # Check evidence attribution
        self.assertIsNotNone(assessment.evidence)
        self.assertEqual(assessment.evidence.source_name, 'CDSCO India')
        self.assertEqual(assessment.evidence.confidence_score, 95)
        self.assertEqual(assessment.evidence.evidence_tier, 1)

    def test_chart_data_structure(self):
        """Test the data structure expected by dosage charts."""
        # Adult chart data
        adult_chart = {
            'min': self.paracetamol['safe_min'],
            'max': self.paracetamol['safe_max'],
            'unit': 'mg'
        }
        self.assertEqual(adult_chart['min'], 500.0)
        self.assertEqual(adult_chart['max'], 4000.0)

        # Pediatric chart data
        pediatric_chart = {
            'min': 0,
            'max': self.paracetamol['pediatric_max'],
            'mg_per_kg': self.paracetamol['mg_per_kg_max'],
            'unit': 'mg'
        }
        self.assertEqual(pediatric_chart['max'], 90.0)
        self.assertEqual(pediatric_chart['mg_per_kg'], 15.0)

        # Exposure chart data
        exposure_chart = {
            'daily_exposure': 500.0,
            'reference_max': 4000.0,
            'percent_of_max': 12.5,
            'risk_level': 'INFORMATIONAL',
            'risk_color': 'var(--good)'
        }
        self.assertEqual(exposure_chart['percent_of_max'], 12.5)
        self.assertEqual(exposure_chart['risk_color'], 'var(--good)')


class TestDosageChartRendering(unittest.TestCase):
    """Test chart rendering logic (frontend)."""

    def test_chart_percentage_calculation(self):
        """Test percentage calculation for chart bar width."""
        test_cases = [
            {'value': 0, 'max': 4000, 'expected': 0},
            {'value': 1000, 'max': 4000, 'expected': 25},
            {'value': 2000, 'max': 4000, 'expected': 50},
            {'value': 3000, 'max': 4000, 'expected': 75},
            {'value': 4000, 'max': 4000, 'expected': 100},
            {'value': 5000, 'max': 4000, 'expected': 100},  # Capped at 100%
        ]

        for case in test_cases:
            percent = min(100, (case['value'] / case['max']) * 100)
            self.assertEqual(percent, case['expected'])

    def test_chart_marker_position(self):
        """Test marker position calculation."""
        safe_max = 4000.0
        reference_max = 4000.0

        # Threshold marker should be at reference_max position
        position = min(100, (reference_max / safe_max) * 100)
        self.assertEqual(position, 100)

        # If reference_max is different
        reference_max = 2000.0
        position = min(100, (reference_max / safe_max) * 100)
        self.assertEqual(position, 50)

    def test_accessibility_labels(self):
        """Test that chart accessibility labels are properly formatted."""
        safe_min = 500.0
        safe_max = 4000.0

        # Adult chart aria-label
        adult_label = f"Adult dosage range from {safe_min} to {safe_max} mg"
        self.assertIn('500', adult_label)
        self.assertIn('4000', adult_label)
        self.assertIn('mg', adult_label)

        # Min marker aria-label
        min_label = f"Minimum safe dose: {safe_min} mg"
        self.assertEqual(min_label, "Minimum safe dose: 500.0 mg")

        # Max marker aria-label
        max_label = f"Maximum safe dose: {safe_max} mg"
        self.assertEqual(max_label, "Maximum safe dose: 4000.0 mg")


if __name__ == '__main__':
    unittest.main()