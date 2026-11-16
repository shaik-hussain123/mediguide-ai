
import sys
import os
import unittest
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

# Ensure the backend directory is in the path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from safety_engine import DosageSafetyEngine
from models.safety import DosageRequest, PatientProfile

# Load environment
load_dotenv()
MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
DATABASE_NAME = os.getenv("DATABASE_NAME", "mediguide_db")

class TestMedicationDatabase(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = AsyncIOMotorClient(MONGODB_URL)
        self.db = self.client[DATABASE_NAME]
        self.engine = DosageSafetyEngine()

    async def test_medication_retrieval(self):
        # Verify a seeded medicine exists
        med = await self.db["medications"].find_one({"id": 1})
        self.assertIsNotNone(med)
        self.assertEqual(med["name"], "Paracetamol")
        self.assertEqual(med["safe_max"], 4000.0)

    async def test_dosage_threshold_lookup(self):
        med = await self.db["medications"].find_one({"id": 1})
        req = DosageRequest(med_id=1, dosage=500.0, frequency="OD")
        assessment = self.engine.evaluate(req, med)
        self.assertEqual(assessment.reference_max, 4000.0)
        self.assertEqual(assessment.evidence.sourceName, "CDSCO India")

    async def test_fallback_behavior(self):
        # Test fallback with non-existent ID
        req = DosageRequest(med_id=999, dosage=500.0, frequency="OD")
        # Simulate logic in main.py:
        med_data = await self.db["medications"].find_one({"id": 999})
        if not med_data:
            med_data = {"name": "Unknown", "safe_min": 100.0, "safe_max": 2000.0, "sourceName": "DailyMed"}

        assessment = self.engine.evaluate(req, med_data)
        self.assertEqual(assessment.reference_max, 2000.0)
        self.assertEqual(assessment.evidence.sourceName, "DailyMed")

    async def asyncTearDown(self):
        self.client.close()

if __name__ == "__main__":
    unittest.main()
