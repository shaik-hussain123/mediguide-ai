"""Database connection module for MediGuide AI API routes.

This module provides database access for API route handlers.
"""

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
import os

MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
DATABASE_NAME = os.getenv("DATABASE_NAME", "mediguide_db")

_client = None
_db = None


def get_db():
    """Get or create database connection."""
    global _db, _client
    if _db is None:
        _client = AsyncIOMotorClient(MONGODB_URL)
        _db = _client[DATABASE_NAME]
    return _db


# Initialize db connection
db = get_db()