
import sys, os, unittest
sys.path.append(os.path.join(os.getcwd(), 'backend'))
from safety_engine import DosageSafetyEngine
from models.safety import DosageRequest, PatientProfile

class TestSourceConflict(unittest.TestCase):
    def test_conflict_detection(self):
        engine = DosageSafetyEngine()
        med_data = {"name": "TestMed", "safe_min": 100, "safe_max": 200}
        conflicts = [{"type": "dosage", "med": "TestMed", "severity": "MODERATE"}]
        req = DosageRequest(med_id=1, dosage=50, frequency="OD")
        assessment = engine.evaluate(req, med_data, source_conflicts=conflicts)
        findings = [f for f in assessment.findings if f["ruleType"] == "Source Conflict"]
        self.assertTrue(len(findings) > 0)
        self.assertEqual(findings[0]["triggered"], True)

if __name__ == "__main__":
    unittest.main()
