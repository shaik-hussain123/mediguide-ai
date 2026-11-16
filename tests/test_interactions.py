
import sys
import os
import unittest
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

sys.path.append(os.path.join(os.getcwd(), 'backend'))

from safety_engine import DosageSafetyEngine
from models.safety import DosageRequest, PatientProfile

load_dotenv()
MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
DATABASE_NAME = os.getenv("DATABASE_NAME", "mediguide_db")

class TestInteractions(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = AsyncIOMotorClient(MONGODB_URL)
        self.db = self.client[DATABASE_NAME]
        self.engine = DosageSafetyEngine()

    async def test_drug_interaction_rule(self):
        # Amlodipine (med_id 8) and Metoprolol (med_id 12) have a Moderate interaction
        med_data = {"id": 8, "name": "Amlodipine"}
        req = DosageRequest(
            med_id=8,
            dosage=5.0,
            frequency="OD",
            patient=PatientProfile(age=30, current_medications=["Metoprolol"])
        )

        # Manually fetch interaction
        interaction = await self.db["interactions"].find_one({"med_a": "Amlodipine", "med_b": "Metoprolol"})
        interactions = [interaction]

        assessment = self.engine.evaluate(req, med_data, interactions=interactions)

        # Check if Interaction rule triggered
        interaction_findings = [f for f in assessment.findings if f["ruleType"] == "Drug Interaction"]
        self.assertTrue(len(interaction_findings) > 0)
        self.assertEqual(interaction_findings[0]["severity"], "MODERATE")

    async def asyncTearDown(self):
        self.client.close()

if __name__ == "__main__":
    unittest.main()
