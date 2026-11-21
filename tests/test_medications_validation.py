import sys
import os
import json
import unittest
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

sys.path.append(os.path.join(os.getcwd(), 'backend'))

load_dotenv()
MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
DATABASE_NAME = os.getenv("DATABASE_NAME", "mediguide_db")

class TestMedicationDataset(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client = AsyncIOMotorClient(MONGODB_URL)
        self.db = self.client[DATABASE_NAME]
        self.collection = self.db["medications"]

    async def test_json_file_exists_and_loads(self):
        json_path = os.path.join(os.getcwd(), 'data', 'medications_500.json')
        self.assertTrue(os.path.exists(json_path))
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        self.assertEqual(len(data), 500)

    async def test_all_medications_have_required_fields(self):
        json_path = os.path.join(os.getcwd(), 'data', 'medications_500.json')
        with open(json_path, 'r', encoding='utf-8') as f:
            medications = json.load(f)

        required_fields = [
            "id", "name", "generic_name", "active_ingredient", "strength",
            "category", "safe_min", "safe_max", "pediatric_max", "mg_per_kg_max",
            "pregnancy_category", "renal_adjustment", "hepatic_adjustment",
            "sourceName", "sourceUrl", "evidenceTier", "confidenceScore", "retrievalDate"
        ]

        for med in medications:
            for field in required_fields:
                self.assertIn(field, med, f"Medication {med.get('name', 'Unknown')} missing field: {field}")

    async def test_pregnancy_categories_valid(self):
        json_path = os.path.join(os.getcwd(), 'data', 'medications_500.json')
        with open(json_path, 'r', encoding='utf-8') as f:
            medications = json.load(f)

        valid_categories = ["A", "B", "C", "D", "X"]
        for med in medications:
            self.assertIn(med["pregnancy_category"], valid_categories,
                         f"Medication {med['name']} has invalid pregnancy_category: {med['pregnancy_category']}")

    async def test_evidence_tiers_valid(self):
        json_path = os.path.join(os.getcwd(), 'data', 'medications_500.json')
        with open(json_path, 'r', encoding='utf-8') as f:
            medications = json.load(f)

        for med in medications:
            self.assertTrue(1 <= med["evidenceTier"] <= 4,
                           f"Medication {med['name']} has invalid evidenceTier: {med['evidenceTier']}")

    async def test_confidence_scores_valid(self):
        json_path = os.path.join(os.getcwd(), 'data', 'medications_500.json')
        with open(json_path, 'r', encoding='utf-8') as f:
            medications = json.load(f)

        for med in medications:
            self.assertTrue(0 <= med["confidenceScore"] <= 100,
                           f"Medication {med['name']} has invalid confidenceScore: {med['confidenceScore']}")

    async def test_dosage_thresholds_logical(self):
        json_path = os.path.join(os.getcwd(), 'data', 'medications_500.json')
        with open(json_path, 'r', encoding='utf-8') as f:
            medications = json.load(f)

        for med in medications:
            self.assertLessEqual(med["safe_min"], med["safe_max"],
                               f"Medication {med['name']}: safe_min > safe_max")

    async def test_database_seeded_correctly(self):
        count = await self.collection.count_documents({})
        self.assertEqual(count, 500, f"Expected 500 medications in database, found {count}")

    async def test_database_indexes_exist(self):
        indexes = await self.collection.index_information()
        index_keys = [idx['key'] for idx in indexes.values()]
        # Check unique id index
        id_index = [k for k in index_keys if ('id', 1) in k]
        self.assertTrue(len(id_index) > 0, "Unique index on 'id' missing")

    async def test_dosage_safety_fields_populated(self):
        sample = await self.collection.find_one({"id": 1})
        self.assertIsNotNone(sample)
        self.assertGreater(sample["safe_max"], 0)
        self.assertGreaterEqual(sample["pediatric_max"], 0)
        self.assertGreaterEqual(sample["mg_per_kg_max"], 0)

    async def test_renal_hepatic_flags_populated(self):
        # Check that renal_adjustment and hepatic_adjustment are present
        meds_with_renal = await self.collection.count_documents({"renal_adjustment": True})
        meds_with_hepatic = await self.collection.count_documents({"hepatic_adjustment": True})
        self.assertGreater(meds_with_renal, 0, "No medications flagged for renal adjustment")
        self.assertGreater(meds_with_hepatic, 0, "No medications flagged for hepatic adjustment")

    async def asyncTearDown(self):
        self.client.close()

if __name__ == "__main__":
    unittest.main()