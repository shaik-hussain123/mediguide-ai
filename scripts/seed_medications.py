
# Python script to seed medications into MongoDB from JSON dataset

import asyncio
import json
import os
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from datetime import datetime

# Load environment variables
load_dotenv()
MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
DATABASE_NAME = os.getenv("DATABASE_NAME", "mediguide_db")

async def load_medications():
    """Load medications from JSON file."""
    json_path = os.path.join(os.path.dirname(__file__), "..", "data", "medications_500.json")
    with open(json_path, "r", encoding="utf-8") as f:
        return json.load(f)

async def validate_medication(med: dict) -> tuple[bool, list]:
    """Validate medication record against required schema."""
    required_fields = [
        "id", "name", "generic_name", "active_ingredient", "strength",
        "category", "safe_min", "safe_max", "pediatric_max", "mg_per_kg_max",
        "pregnancy_category", "renal_adjustment", "hepatic_adjustment",
        "sourceName", "sourceUrl", "evidenceTier", "confidenceScore", "retrievalDate"
    ]
    errors = []
    for field in required_fields:
        if field not in med:
            errors.append(f"Missing required field: {field}")

    # Validate ranges
    if "safe_min" in med and "safe_max" in med:
        if med["safe_min"] > med["safe_max"]:
            errors.append("safe_min cannot exceed safe_max")

    if "evidenceTier" in med:
        if not 1 <= med["evidenceTier"] <= 4:
            errors.append("evidenceTier must be between 1 and 4")

    if "confidenceScore" in med:
        if not 0 <= med["confidenceScore"] <= 100:
            errors.append("confidenceScore must be between 0 and 100")

    if "pregnancy_category" in med:
        if med["pregnancy_category"] not in ["A", "B", "C", "D", "X"]:
            errors.append("pregnancy_category must be A, B, C, D, or X")

    return len(errors) == 0, errors

async def seed():
    client = AsyncIOMotorClient(MONGODB_URL)
    db = client[DATABASE_NAME]
    collection = db["medications"]

    # Load medications from JSON
    medications = await load_medications()
    print(f"Loaded {len(medications)} medications from JSON dataset.")

    # Validate all medications
    print("Validating medications...")
    valid_count = 0
    invalid_count = 0
    for med in medications:
        is_valid, errors = await validate_medication(med)
        if is_valid:
            valid_count += 1
        else:
            invalid_count += 1
            print(f"  INVALID: {med.get('name', 'Unknown')} - {', '.join(errors)}")

    if invalid_count > 0:
        print(f"Validation failed for {invalid_count} medications. Aborting seed.")
        client.close()
        return

    print(f"All {valid_count} medications passed validation.")

    print("Clearing existing medications...")
    await collection.delete_many({})

    print(f"Seeding {len(medications)} medications...")
    await collection.insert_many(medications)

    print("Creating indexes...")
    await collection.create_index("id", unique=True)
    await collection.create_index("name")
    await collection.create_index("generic_name")
    await collection.create_index("active_ingredient")
    await collection.create_index("category")
    await collection.create_index("pregnancy_category")
    await collection.create_index("renal_adjustment")
    await collection.create_index("hepatic_adjustment")

    print("Database seeded successfully.")
    client.close()

if __name__ == "__main__":
    asyncio.run(seed())
