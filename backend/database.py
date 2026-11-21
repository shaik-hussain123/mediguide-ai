"""
Database initialization, schema validation, and migration module.
Handles collection creation, index management, and data validation.
"""
import os
from datetime import datetime
from typing import Optional, List
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING, TEXT
from pymongo.errors import CollectionInvalid, OperationFailure
import logging

logger = logging.getLogger(__name__)

# ── Database Collections ──────────────────────────────────────────────────────
COLLECTIONS = {
    "users": "users",
    "medications": "medications",
    "interactions": "interactions",
    "adverse_events": "adverse_events",
    "medication_schedules": "medication_schedules",
    "medication_logs": "medication_logs",
    "dosage_assessments": "dosage_assessments",
    "source_conflicts": "source_conflicts",
    "emergency_profiles": "emergency_profiles",
    "clinic_search_history": "clinic_search_history",
    "audit_logs": "audit_logs",
    "symptom_checks": "symptom_checks",
    "reminders": "reminders",
}

# ── Index Definitions ────────────────────────────────────────────────────────
INDEX_DEFINITIONS = {
    "users": [
        ([("email", ASCENDING)], {"unique": True, "name": "idx_email_unique"}),
        ([("role", ASCENDING)], {"name": "idx_role"}),
        ([("created_at", DESCENDING)], {"name": "idx_created_at"}),
        ([("profile.blood_group", ASCENDING)], {"name": "idx_blood_group"}),
    ],
    "medications": [
        ([("id", ASCENDING)], {"unique": True, "name": "idx_id_unique"}),
        ([("name", ASCENDING)], {"name": "idx_name"}),
        ([("generic_name", ASCENDING)], {"name": "idx_generic_name"}),
        ([("active_ingredient", ASCENDING)], {"name": "idx_active_ingredient"}),
        ([("category", ASCENDING)], {"name": "idx_category"}),
        ([("pregnancy_category", ASCENDING)], {"name": "idx_pregnancy_category"}),
        ([("renal_adjustment", ASCENDING)], {"name": "idx_renal_adjustment"}),
        ([("hepatic_adjustment", ASCENDING)], {"name": "idx_hepatic_adjustment"}),
        ([("name", TEXT), ("generic_name", TEXT), ("active_ingredient", TEXT)],
         {"name": "idx_text_search", "default_language": "english"}),
    ],
    "interactions": [
        ([("med_a", ASCENDING)], {"name": "idx_med_a"}),
        ([("med_b", ASCENDING)], {"name": "idx_med_b"}),
        ([("severity", ASCENDING)], {"name": "idx_severity"}),
        ([("med_a", ASCENDING), ("med_b", ASCENDING)], {"unique": True, "name": "idx_med_pair_unique"}),
    ],
    "adverse_events": [
        ([("user_id", ASCENDING)], {"name": "idx_user_id"}),
        ([("medication", ASCENDING)], {"name": "idx_medication"}),
        ([("severity", ASCENDING)], {"name": "idx_severity"}),
        ([("status", ASCENDING)], {"name": "idx_status"}),
        ([("created_at", DESCENDING)], {"name": "idx_created_at"}),
    ],
    "medication_schedules": [
        ([("user_id", ASCENDING)], {"name": "idx_user_id"}),
        ([("medication_id", ASCENDING)], {"name": "idx_medication_id"}),
        ([("active", ASCENDING)], {"name": "idx_active"}),
        ([("user_id", ASCENDING), ("active", ASCENDING)], {"name": "idx_user_active"}),
        ([("start_date", ASCENDING)], {"name": "idx_start_date"}),
    ],
    "medication_logs": [
        ([("user_id", ASCENDING)], {"name": "idx_user_id"}),
        ([("schedule_id", ASCENDING)], {"name": "idx_schedule_id"}),
        ([("timestamp", DESCENDING)], {"name": "idx_timestamp"}),
        ([("user_id", ASCENDING), ("timestamp", DESCENDING)], {"name": "idx_user_timestamp"}),
    ],
    "dosage_assessments": [
        ([("user_id", ASCENDING)], {"name": "idx_user_id"}),
        ([("medication_id", ASCENDING)], {"name": "idx_medication_id"}),
        ([("timestamp", DESCENDING)], {"name": "idx_timestamp"}),
        ([("risk_level", ASCENDING)], {"name": "idx_risk_level"}),
        ([("user_id", ASCENDING), ("timestamp", DESCENDING)], {"name": "idx_user_timestamp"}),
    ],
    "source_conflicts": [
        ([("medication", ASCENDING)], {"name": "idx_medication"}),
        ([("resolved", ASCENDING)], {"name": "idx_resolved"}),
        ([("created_at", DESCENDING)], {"name": "idx_created_at"}),
    ],
    "emergency_profiles": [
        ([("user_email", ASCENDING)], {"unique": True, "name": "idx_user_email_unique"}),
        ([("blood_group", ASCENDING)], {"name": "idx_blood_group"}),
    ],
    "clinic_search_history": [
        ([("user_id", ASCENDING)], {"name": "idx_user_id"}),
        ([("search_type", ASCENDING)], {"name": "idx_search_type"}),
        ([("created_at", DESCENDING)], {"name": "idx_created_at"}),
    ],
    "audit_logs": [
        ([("timestamp", DESCENDING)], {"name": "idx_timestamp"}),
        ([("action", ASCENDING)], {"name": "idx_action"}),
        ([("user", ASCENDING)], {"name": "idx_user"}),
        ([("resource", ASCENDING)], {"name": "idx_resource"}),
    ],
    "symptom_checks": [
        ([("user_email", ASCENDING)], {"name": "idx_user_email"}),
        ([("timestamp", DESCENDING)], {"name": "idx_timestamp"}),
    ],
    "reminders": [
        ([("user_email", ASCENDING)], {"name": "idx_user_email"}),
        ([("active", ASCENDING)], {"name": "idx_active"}),
        ([("start_date", ASCENDING)], {"name": "idx_start_date"}),
    ],
}


# ── Validation Functions ──────────────────────────────────────────────────────
async def validate_user_document(doc: dict) -> tuple[bool, list[str]]:
    """Validate user document against schema."""
    errors = []

    required_fields = ["id", "name", "email", "password_hash", "role", "created_at"]
    for field in required_fields:
        if field not in doc:
            errors.append(f"Missing required field: {field}")

    if "email" in doc and "@" not in doc["email"]:
        errors.append("Invalid email format")

    if "role" in doc and doc["role"] not in ["user", "admin"]:
        errors.append("Role must be 'user' or 'admin'")

    # Validate profile if present
    if "profile" in doc:
        profile = doc["profile"]
        if "age" in profile and profile["age"] is not None:
            if not isinstance(profile["age"], int) or profile["age"] < 0 or profile["age"] > 150:
                errors.append("Invalid age in profile")
        if "weight" in profile and profile["weight"] is not None:
            if not isinstance(profile["weight"], (int, float)) or profile["weight"] <= 0 or profile["weight"] > 500:
                errors.append("Invalid weight in profile")
        if "blood_group" in profile and profile["blood_group"]:
            valid_groups = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]
            if profile["blood_group"] not in valid_groups:
                errors.append(f"Invalid blood group: {profile['blood_group']}")
        if "gender" in profile and profile["gender"]:
            valid_genders = ["male", "female", "other", "prefer_not_to_say"]
            if profile["gender"] not in valid_genders:
                errors.append(f"Invalid gender: {profile['gender']}")

    return len(errors) == 0, errors


async def validate_medication_document(doc: dict) -> tuple[bool, list[str]]:
    """Validate medication document against schema."""
    errors = []

    required_fields = ["id", "name", "generic_name", "active_ingredient", "strength",
                       "dosage_form", "category", "safe_min", "safe_max"]
    for field in required_fields:
        if field not in doc:
            errors.append(f"Missing required field: {field}")

    if "safe_min" in doc and "safe_max" in doc:
        if doc["safe_min"] > doc["safe_max"]:
            errors.append("safe_min cannot exceed safe_max")

    if "pregnancy_category" in doc and doc["pregnancy_category"]:
        valid = ["A", "B", "C", "D", "X"]
        if doc["pregnancy_category"] not in valid:
            errors.append(f"Invalid pregnancy category: {doc['pregnancy_category']}")

    if "evidenceTier" in doc:
        if not isinstance(doc["evidenceTier"], int) or not 1 <= doc["evidenceTier"] <= 4:
            errors.append("evidenceTier must be integer 1-4")

    if "confidenceScore" in doc:
        if not isinstance(doc["confidenceScore"], (int, float)) or not 0 <= doc["confidenceScore"] <= 100:
            errors.append("confidenceScore must be 0-100")

    return len(errors) == 0, errors


# ── Collection Initialization ─────────────────────────────────────────────────
async def initialize_collections(db: AsyncIOMotorDatabase) -> dict:
    """
    Initialize all collections with proper indexes.
    Returns dict with status of each collection.
    """
    results = {}
    existing = await db.list_collection_names()

    for coll_name in COLLECTIONS.values():
        try:
            if coll_name not in existing:
                await db.create_collection(coll_name)
                results[coll_name] = "created"
                logger.info(f"Created collection: {coll_name}")
            else:
                results[coll_name] = "exists"
                logger.info(f"Collection exists: {coll_name}")
        except CollectionInvalid:
            results[coll_name] = "exists"
        except Exception as e:
            results[coll_name] = f"error: {str(e)}"
            logger.error(f"Error creating collection {coll_name}: {e}")

    return results


async def initialize_indexes(db: AsyncIOMotorDatabase) -> dict:
    """
    Create all defined indexes for each collection.
    Returns dict with status of each index creation.
    """
    results = {}

    # Drop obsolete indexes first
    try:
        await db["emergency_profiles"].drop_index("idx_user_id_unique")
        logger.info("Dropped obsolete index idx_user_id_unique on emergency_profiles")
    except Exception:
        pass  # Index may not exist

    for coll_name, indexes in INDEX_DEFINITIONS.items():
        if coll_name not in COLLECTIONS.values():
            continue

        coll = db[coll_name]
        coll_results = {}

        for index_spec, options in indexes:
            try:
                await coll.create_index(index_spec, **options)
                idx_name = options.get("name", str(index_spec))
                coll_results[idx_name] = "created"
                logger.info(f"Created index {idx_name} on {coll_name}")
            except OperationFailure as e:
                if "already exists" in str(e):
                    idx_name = options.get("name", str(index_spec))
                    coll_results[idx_name] = "exists"
                else:
                    idx_name = options.get("name", str(index_spec))
                    coll_results[idx_name] = f"error: {str(e)}"
                    logger.error(f"Error creating index on {coll_name}: {e}")
            except Exception as e:
                idx_name = options.get("name", str(index_spec))
                coll_results[idx_name] = f"error: {str(e)}"
                logger.error(f"Unexpected error creating index on {coll_name}: {e}")

        results[coll_name] = coll_results

    return results


async def initialize_database(db: AsyncIOMotorDatabase) -> dict:
    """
    Complete database initialization: collections + indexes.
    Returns comprehensive status report.
    """
    logger.info("Starting database initialization...")

    # Initialize collections
    coll_results = await initialize_collections(db)

    # Initialize indexes
    index_results = await initialize_indexes(db)

    # Verify collections
    collections_after = await db.list_collection_names()

    return {
        "collections": coll_results,
        "indexes": index_results,
        "total_collections": len(collections_after),
        "collections_list": collections_after,
        "initialized_at": datetime.utcnow().isoformat(),
    }


# ── Migration Utilities ───────────────────────────────────────────────────────
async def run_migrations(db: AsyncIOMotorDatabase) -> list:
    """
    Run any pending migrations.
    Returns list of applied migrations.
    """
    applied = []

    # Migration: Add new fields to existing users
    try:
        result = await db["users"].update_many(
            {"profile": {"$exists": False}},
            {"$set": {
                "profile": {
                    "age": None,
                    "weight": None,
                    "height": None,
                    "blood_group": "",
                    "gender": "",
                    "conditions": [],
                    "allergies": [],
                    "is_pregnant": False,
                    "is_lactating": False
                }
            }}
        )
        if result.modified_count > 0:
            applied.append(f"Added profile field to {result.modified_count} users")
    except Exception as e:
        logger.error(f"Migration error (user profile): {e}")

    # Migration: Add settings field to existing users
    try:
        result = await db["users"].update_many(
            {"settings": {"$exists": False}},
            {"$set": {
                "settings": {
                    "elderly_mode": False,
                    "high_contrast": False,
                    "font_scale": 1,
                    "notifications": True,
                    "language": "en"
                }
            }}
        )
        if result.modified_count > 0:
            applied.append(f"Added settings field to {result.modified_count} users")
    except Exception as e:
        logger.error(f"Migration error (user settings): {e}")

    # Migration: Add missing fields to medications
    try:
        result = await db["medications"].update_many(
            {"interactions": {"$exists": False}},
            {"$set": {"interactions": []}}
        )
        if result.modified_count > 0:
            applied.append(f"Added interactions field to {result.modified_count} medications")
    except Exception as e:
        logger.error(f"Migration error (medication interactions): {e}")

    # Migration: Ensure audit_logs has proper fields
    try:
        result = await db["audit_logs"].update_many(
            {"details": {"$exists": False}},
            {"$set": {"details": {}}}
        )
        if result.modified_count > 0:
            applied.append(f"Added details field to {result.modified_count} audit logs")
    except Exception as e:
        logger.error(f"Migration error (audit logs): {e}")

    return applied


# ── Validation Helpers ────────────────────────────────────────────────────────
async def validate_all_documents(db: AsyncIOMotorDatabase) -> dict:
    """
    Validate all documents in collections against their schemas.
    Returns validation report.
    """
    report = {}

    # Validate users
    users_valid = 0
    users_invalid = 0
    user_errors = []
    async for doc in db["users"].find({}):
        is_valid, errors = await validate_user_document(doc)
        if is_valid:
            users_valid += 1
        else:
            users_invalid += 1
            user_errors.extend([f"User {doc.get('_id')}: {e}" for e in errors])

    report["users"] = {
        "valid": users_valid,
        "invalid": users_invalid,
        "errors": user_errors[:10]  # Limit error list
    }

    # Validate medications
    meds_valid = 0
    meds_invalid = 0
    med_errors = []
    async for doc in db["medications"].find({}):
        is_valid, errors = await validate_medication_document(doc)
        if is_valid:
            meds_valid += 1
        else:
            meds_invalid += 1
            med_errors.extend([f"Med {doc.get('id', doc.get('_id'))}: {e}" for e in errors])

    report["medications"] = {
        "valid": meds_valid,
        "invalid": meds_invalid,
        "errors": med_errors[:10]
    }

    return report


# ── Seed Data ─────────────────────────────────────────────────────────────────
async def seed_emergency_blood_groups() -> list:
    """Return valid blood group options."""
    return ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"]


async def seed_pregnancy_categories() -> list:
    """Return valid pregnancy categories."""
    return ["A", "B", "C", "D", "X"]


async def seed_interaction_severities() -> list:
    """Return valid interaction severity levels."""
    return ["Minor", "Moderate", "Major", "Contraindicated"]


async def seed_adr_severities() -> list:
    """Return valid ADR severity levels."""
    return ["Mild", "Moderate", "Severe", "Critical"]


async def seed_adr_statuses() -> list:
    """Return valid ADR statuses."""
    return ["Open", "Reviewed", "Closed"]


async def seed_risk_levels() -> list:
    """Return valid risk levels."""
    return ["INFORMATIONAL", "CAUTION", "ELEVATED_RISK", "CRITICAL_REVIEW_REQUIRED"]


async def seed_clinical_severities() -> list:
    """Return valid clinical severities."""
    return ["LOW", "MODERATE", "HIGH", "CRITICAL"]


# ── Main Initialization Function ──────────────────────────────────────────────
async def setup_database(db: AsyncIOMotorDatabase) -> dict:
    """
    Complete database setup: initialize, migrate, validate.
    """
    logger.info("Setting up database...")

    # Initialize collections and indexes
    init_result = await initialize_database(db)

    # Run migrations
    migrations = await run_migrations(db)
    init_result["migrations_applied"] = migrations

    logger.info("Database setup complete")
    return init_result