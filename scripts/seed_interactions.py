
import asyncio
import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()
MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
DATABASE_NAME = os.getenv("DATABASE_NAME", "mediguide_db")

INTERACTIONS = [
    {
        "med_a": "Amlodipine",
        "med_b": "Metoprolol",
        "severity": "Moderate",
        "description": "Concurrent use may increase the risk of hypotension and bradycardia.",
        "evidence": {
            "sourceName": "CDSCO India / DrugBank",
            "sourceUrl": "https://cdsco.gov.in",
            "sourceVersion": "2026.1",
            "evidenceTier": 1,
            "confidenceScore": 95,
            "retrievalDate": "2026-11-15"
        }
    },
    {
        "med_a": "Ibuprofen",
        "med_b": "Metformin",
        "severity": "Minor",
        "description": "NSAIDs may affect renal function and indirectly impact metformin clearance.",
        "evidence": {
            "sourceName": "CDSCO India / DailyMed",
            "sourceUrl": "https://cdsco.gov.in",
            "sourceVersion": "2026.1",
            "evidenceTier": 2,
            "confidenceScore": 90,
            "retrievalDate": "2026-11-15"
        }
    },
    {
        "med_a": "Ibuprofen",
        "med_b": "Atorvastatin",
        "severity": "Major",
        "description": "Increased risk of myopathy and rhabdomyolysis or renal impairment.",
        "evidence": {
            "sourceName": "CDSCO India",
            "sourceUrl": "https://cdsco.gov.in",
            "sourceVersion": "2026.1",
            "evidenceTier": 1,
            "confidenceScore": 96,
            "retrievalDate": "2026-11-15"
        }
    },
    {
        "med_a": "Amlodipine",
        "med_b": "Atorvastatin",
        "severity": "Contraindicated",
        "description": "Severe pharmacokinetic conflict or toxic buildup reported in specific sensitive cohorts.",
        "evidence": {
            "sourceName": "CDSCO Safety Alert",
            "sourceUrl": "https://cdsco.gov.in",
            "sourceVersion": "2026.1",
            "evidenceTier": 1,
            "confidenceScore": 99,
            "retrievalDate": "2026-11-15"
        }
    }
]

async def seed():
    client = AsyncIOMotorClient(MONGODB_URL)
    db = client[DATABASE_NAME]
    collection = db["interactions"]

    print("Clearing existing interactions...")
    await collection.delete_many({})

    print(f"Seeding {len(INTERACTIONS)} interactions...")
    await collection.insert_many(INTERACTIONS)

    print("Creating indexes...")
    await collection.create_index([("med_a", 1), ("med_b", 1)])

    print("Interactions seeded successfully.")
    client.close()

if __name__ == "__main__":
    asyncio.run(seed())
