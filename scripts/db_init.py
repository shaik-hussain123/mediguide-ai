# Create database initialization script for MongoDB schemas
from pymongo import MongoClient
import os

client = MongoClient("mongodb://localhost:27017")
db = client["mediguide_db"]

# Collections
db.create_collection("medications")
db.create_collection("symptom_checks")
db.create_collection("audit_logs")
db.create_collection("source_conflicts")

# Create Indexes
db.medications.create_index("generic_name")
db.medications.create_index("brand_names")

print("Database collections initialized.")
