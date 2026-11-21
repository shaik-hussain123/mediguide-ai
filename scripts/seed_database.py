#!/usr/bin/env python3
"""
Database seeding script for MediGuide AI.
Initializes all collections with sample data.
"""
import asyncio
import os
import sys
from datetime import datetime, timedelta
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))

from motor.motor_asyncio import AsyncIOMotorClient
from passlib.context import CryptContext
from dotenv import load_dotenv

load_dotenv()

MONGODB_URL = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
DATABASE_NAME = os.getenv("DATABASE_NAME", "mediguide_db")

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(password: str) -> str:
    return pwd_context.hash(password)


# Sample medications data (12 core CDSCO medications)
SAMPLE_MEDICATIONS = [
    {
        "id": 1,
        "name": "Paracetamol",
        "generic_name": "Acetaminophen",
        "active_ingredient": "Paracetamol",
        "strength": "500mg",
        "dosage_form": "Tablet",
        "category": "Analgesic / Antipyretic",
        "safe_min": 500.0,
        "safe_max": 4000.0,
        "pediatric_max": 60.0,
        "mg_per_kg_max": 15.0,
        "pregnancy_category": "B",
        "renal_adjustment": False,
        "hepatic_adjustment": True,
        "contraindications": ["Severe hepatic impairment", "Hypersensitivity"],
        "side_effects": ["Rare skin rash", "Liver damage in overdose"],
        "interactions": ["Warfarin", "Isoniazid", "Carbamazepine"],
        "evidence": {
            "sourceName": "CDSCO India",
            "sourceUrl": "https://cdsco.gov.in",
            "evidenceTier": 1,
            "confidenceScore": 95,
            "retrievalDate": datetime.utcnow().isoformat()
        },
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    },
    {
        "id": 2,
        "name": "Azithromycin",
        "generic_name": "Azithromycin",
        "active_ingredient": "Azithromycin",
        "strength": "500mg",
        "dosage_form": "Tablet",
        "category": "Antibiotic (Macrolide)",
        "safe_min": 500.0,
        "safe_max": 1000.0,
        "pediatric_max": 20.0,
        "mg_per_kg_max": 10.0,
        "pregnancy_category": "B",
        "renal_adjustment": False,
        "hepatic_adjustment": True,
        "contraindications": ["Hypersensitivity to macrolides", "Severe hepatic impairment"],
        "side_effects": ["Nausea", "Diarrhoea", "Abdominal pain", "QT prolongation"],
        "interactions": ["Warfarin", "Digoxin", "Antacids", "Statins"],
        "evidence": {
            "sourceName": "CDSCO India",
            "sourceUrl": "https://cdsco.gov.in",
            "evidenceTier": 1,
            "confidenceScore": 92,
            "retrievalDate": datetime.utcnow().isoformat()
        },
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    },
    {
        "id": 3,
        "name": "Metformin",
        "generic_name": "Metformin Hydrochloride",
        "active_ingredient": "Metformin",
        "strength": "500mg",
        "dosage_form": "Tablet",
        "category": "Antidiabetic (Biguanide)",
        "safe_min": 500.0,
        "safe_max": 2550.0,
        "pediatric_max": 0.0,
        "mg_per_kg_max": 0.0,
        "pregnancy_category": "B",
        "renal_adjustment": True,
        "hepatic_adjustment": True,
        "contraindications": ["eGFR < 30", "Severe hepatic impairment", "Acute heart failure"],
        "side_effects": ["Nausea", "Diarrhoea", "Metallic taste", "Lactic acidosis (rare)"],
        "interactions": ["Cimetidine", "Contrast media", "ACE inhibitors", "Diuretics"],
        "evidence": {
            "sourceName": "CDSCO India",
            "sourceUrl": "https://cdsco.gov.in",
            "evidenceTier": 1,
            "confidenceScore": 98,
            "retrievalDate": datetime.utcnow().isoformat()
        },
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    },
    {
        "id": 4,
        "name": "Amoxicillin",
        "generic_name": "Amoxicillin",
        "active_ingredient": "Amoxicillin",
        "strength": "500mg",
        "dosage_form": "Capsule",
        "category": "Antibiotic (Penicillin)",
        "safe_min": 500.0,
        "safe_max": 3000.0,
        "pediatric_max": 100.0,
        "mg_per_kg_max": 50.0,
        "pregnancy_category": "B",
        "renal_adjustment": True,
        "hepatic_adjustment": False,
        "contraindications": ["Penicillin allergy", "Mononucleosis"],
        "side_effects": ["Rash", "Diarrhoea", "Nausea", "Yeast infection"],
        "interactions": ["Methotrexate", "Warfarin", "Oral contraceptives", "Probenecid"],
        "evidence": {
            "sourceName": "CDSCO India",
            "sourceUrl": "https://cdsco.gov.in",
            "evidenceTier": 1,
            "confidenceScore": 95,
            "retrievalDate": datetime.utcnow().isoformat()
        },
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    },
    {
        "id": 5,
        "name": "Cetirizine",
        "generic_name": "Cetirizine Hydrochloride",
        "active_ingredient": "Cetirizine",
        "strength": "10mg",
        "dosage_form": "Tablet",
        "category": "Antihistamine (2nd Gen)",
        "safe_min": 5.0,
        "safe_max": 20.0,
        "pediatric_max": 5.0,
        "mg_per_kg_max": 0.25,
        "pregnancy_category": "B",
        "renal_adjustment": True,
        "hepatic_adjustment": False,
        "contraindications": ["Severe renal impairment", "Hypersensitivity"],
        "side_effects": ["Mild drowsiness", "Dry mouth", "Headache", "Fatigue"],
        "interactions": ["Theophylline", "Ritonavir", "Alcohol"],
        "evidence": {
            "sourceName": "CDSCO India",
            "sourceUrl": "https://cdsco.gov.in",
            "evidenceTier": 1,
            "confidenceScore": 90,
            "retrievalDate": datetime.utcnow().isoformat()
        },
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    },
    {
        "id": 6,
        "name": "Omeprazole",
        "generic_name": "Omeprazole",
        "active_ingredient": "Omeprazole",
        "strength": "20mg",
        "dosage_form": "Capsule",
        "category": "Proton Pump Inhibitor (PPI)",
        "safe_min": 20.0,
        "safe_max": 40.0,
        "pediatric_max": 10.0,
        "mg_per_kg_max": 1.0,
        "pregnancy_category": "C",
        "renal_adjustment": False,
        "hepatic_adjustment": True,
        "contraindications": ["Hypersensitivity to PPIs", "Concomitant use with rilpivirine"],
        "side_effects": ["Headache", "Diarrhoea", "Nausea", "Vitamin B12 deficiency (long-term)"],
        "interactions": ["Clopidogrel", "Warfarin", "Diazepam", "Phenytoin", "Ketoconazole"],
        "evidence": {
            "sourceName": "CDSCO India",
            "sourceUrl": "https://cdsco.gov.in",
            "evidenceTier": 1,
            "confidenceScore": 93,
            "retrievalDate": datetime.utcnow().isoformat()
        },
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    },
    {
        "id": 7,
        "name": "Ibuprofen",
        "generic_name": "Ibuprofen",
        "active_ingredient": "Ibuprofen",
        "strength": "400mg",
        "dosage_form": "Tablet",
        "category": "NSAID / Anti-inflammatory",
        "safe_min": 200.0,
        "safe_max": 1200.0,
        "pediatric_max": 200.0,
        "mg_per_kg_max": 10.0,
        "pregnancy_category": "C",
        "renal_adjustment": True,
        "hepatic_adjustment": False,
        "contraindications": ["Active peptic ulcer", "Third trimester pregnancy", "Severe heart failure", "NSAID allergy"],
        "side_effects": ["GI irritation", "Nausea", "Elevated BP", "Renal impairment", "Bleeding risk"],
        "interactions": ["Warfarin", "ACE inhibitors", "Diuretics", "Methotrexate", "Lithium", "Aspirin"],
        "evidence": {
            "sourceName": "CDSCO India",
            "sourceUrl": "https://cdsco.gov.in",
            "evidenceTier": 1,
            "confidenceScore": 95,
            "retrievalDate": datetime.utcnow().isoformat()
        },
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    },
    {
        "id": 8,
        "name": "Amlodipine",
        "generic_name": "Amlodipine Besylate",
        "active_ingredient": "Amlodipine",
        "strength": "5mg",
        "dosage_form": "Tablet",
        "category": "Antihypertensive (CCB)",
        "safe_min": 2.5,
        "safe_max": 10.0,
        "pediatric_max": 0.0,
        "mg_per_kg_max": 0.0,
        "pregnancy_category": "C",
        "renal_adjustment": False,
        "hepatic_adjustment": True,
        "contraindications": ["Cardiogenic shock", "Severe aortic stenosis", "Hypersensitivity"],
        "side_effects": ["Ankle oedema", "Flushing", "Headache", "Palpitations", "Dizziness"],
        "interactions": ["Simvastatin", "Cyclosporine", "Tacrolimus", "Grapefruit juice", "Other antihypertensives"],
        "evidence": {
            "sourceName": "CDSCO India",
            "sourceUrl": "https://cdsco.gov.in",
            "evidenceTier": 1,
            "confidenceScore": 94,
            "retrievalDate": datetime.utcnow().isoformat()
        },
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    },
    {
        "id": 9,
        "name": "Atorvastatin",
        "generic_name": "Atorvastatin Calcium",
        "active_ingredient": "Atorvastatin",
        "strength": "10mg",
        "dosage_form": "Tablet",
        "category": "Statin / Lipid-Lowering",
        "safe_min": 10.0,
        "safe_max": 80.0,
        "pediatric_max": 0.0,
        "mg_per_kg_max": 0.0,
        "pregnancy_category": "X",
        "renal_adjustment": False,
        "hepatic_adjustment": True,
        "contraindications": ["Active liver disease", "Pregnancy", "Breastfeeding", "Hypersensitivity"],
        "side_effects": ["Myalgia", "Elevated liver enzymes", "Rhabdomyolysis (rare)", "Diabetes risk"],
        "interactions": ["Cyclosporine", "Gemfibrozil", "Clarithromycin", "Itraconazole", "Grapefruit juice"],
        "evidence": {
            "sourceName": "CDSCO India",
            "sourceUrl": "https://cdsco.gov.in",
            "evidenceTier": 1,
            "confidenceScore": 96,
            "retrievalDate": datetime.utcnow().isoformat()
        },
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    },
    {
        "id": 10,
        "name": "Pantoprazole",
        "generic_name": "Pantoprazole Sodium",
        "active_ingredient": "Pantoprazole",
        "strength": "40mg",
        "dosage_form": "Tablet",
        "category": "Proton Pump Inhibitor (PPI)",
        "safe_min": 20.0,
        "safe_max": 80.0,
        "pediatric_max": 20.0,
        "mg_per_kg_max": 1.0,
        "pregnancy_category": "B",
        "renal_adjustment": False,
        "hepatic_adjustment": True,
        "contraindications": ["Hypersensitivity to PPIs", "Concomitant use with rilpivirine"],
        "side_effects": ["Headache", "Diarrhoea", "Nausea", "Vitamin B12 deficiency (long-term)", "Osteoporosis risk"],
        "interactions": ["Clopidogrel", "Warfarin", "Methotrexate", "Atazanavir", "Ketoconazole"],
        "evidence": {
            "sourceName": "CDSCO India",
            "sourceUrl": "https://cdsco.gov.in",
            "evidenceTier": 1,
            "confidenceScore": 92,
            "retrievalDate": datetime.utcnow().isoformat()
        },
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    },
    {
        "id": 11,
        "name": "Montelukast",
        "generic_name": "Montelukast Sodium",
        "active_ingredient": "Montelukast",
        "strength": "10mg",
        "dosage_form": "Tablet",
        "category": "Leukotriene Receptor Antagonist",
        "safe_min": 4.0,
        "safe_max": 10.0,
        "pediatric_max": 5.0,
        "mg_per_kg_max": 0.0,
        "pregnancy_category": "B",
        "renal_adjustment": False,
        "hepatic_adjustment": True,
        "contraindications": ["Hypersensitivity to montelukast", "Phenylketonuria (chewable tablets)"],
        "side_effects": ["Headache", "Abdominal pain", "Mood changes (rare)", "Sleep disturbances"],
        "interactions": ["Phenobarbital", "Rifampin", "Carbamazepine", "Phenytoin"],
        "evidence": {
            "sourceName": "CDSCO India",
            "sourceUrl": "https://cdsco.gov.in",
            "evidenceTier": 1,
            "confidenceScore": 89,
            "retrievalDate": datetime.utcnow().isoformat()
        },
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    },
    {
        "id": 12,
        "name": "Metoprolol",
        "generic_name": "Metoprolol Tartrate",
        "active_ingredient": "Metoprolol",
        "strength": "50mg",
        "dosage_form": "Tablet",
        "category": "Beta-Blocker / Antihypertensive",
        "safe_min": 25.0,
        "safe_max": 200.0,
        "pediatric_max": 0.0,
        "mg_per_kg_max": 0.0,
        "pregnancy_category": "C",
        "renal_adjustment": True,
        "hepatic_adjustment": True,
        "contraindications": ["Severe bradycardia", "AV block", "Cardiogenic shock", "Severe heart failure", "Asthma"],
        "side_effects": ["Fatigue", "Bradycardia", "Dizziness", "Cold extremities", "Depression", "Erectile dysfunction"],
        "interactions": ["Verapamil", "Diltiazem", "Digoxin", "Clonidine", "Insulin", "NSAIDs"],
        "evidence": {
            "sourceName": "CDSCO India",
            "sourceUrl": "https://cdsco.gov.in",
            "evidenceTier": 1,
            "confidenceScore": 93,
            "retrievalDate": datetime.utcnow().isoformat()
        },
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    },
]


# Sample interactions
SAMPLE_INTERACTIONS = [
    {
        "med_a": "Paracetamol",
        "med_b": "Warfarin",
        "severity": "Major",
        "description": "Paracetamol may potentiate the anticoagulant effect of warfarin, increasing bleeding risk.",
        "recommendation": "Monitor INR closely when initiating or changing paracetamol dose.",
        "evidence": {
            "sourceName": "Drug Interaction Database",
            "sourceUrl": "https://reference.medscape.com",
            "evidenceTier": 2,
            "confidenceScore": 85
        },
        "created_at": datetime.utcnow().isoformat()
    },
    {
        "med_a": "Ibuprofen",
        "med_b": "Warfarin",
        "severity": "Major",
        "description": "NSAIDs increase bleeding risk when combined with warfarin.",
        "recommendation": "Avoid combination if possible. If required, monitor INR closely and watch for GI bleeding.",
        "evidence": {
            "sourceName": "Drug Interaction Database",
            "sourceUrl": "https://reference.medscape.com",
            "evidenceTier": 1,
            "confidenceScore": 90
        },
        "created_at": datetime.utcnow().isoformat()
    },
    {
        "med_a": "Metformin",
        "med_b": "Iodinated Contrast Media",
        "severity": "Major",
        "description": "Risk of lactic acidosis due to contrast-induced renal impairment.",
        "recommendation": "Hold metformin before and 48h after contrast administration; check renal function.",
        "evidence": {
            "sourceName": "FDA Drug Safety Communication",
            "sourceUrl": "https://fda.gov",
            "evidenceTier": 1,
            "confidenceScore": 95
        },
        "created_at": datetime.utcnow().isoformat()
    },
    {
        "med_a": "Atorvastatin",
        "med_b": "Gemfibrozil",
        "severity": "Major",
        "description": "Significantly increases risk of rhabdomyolysis.",
        "recommendation": "Avoid combination. If required, use lowest atorvastatin dose and monitor CK levels.",
        "evidence": {
            "sourceName": "FDA Drug Safety Communication",
            "sourceUrl": "https://fda.gov",
            "evidenceTier": 1,
            "confidenceScore": 95
        },
        "created_at": datetime.utcnow().isoformat()
    },
    {
        "med_a": "Ibuprofen",
        "med_b": "Methotrexate",
        "severity": "Major",
        "description": "NSAIDs reduce renal clearance of methotrexate, increasing toxicity risk.",
        "recommendation": "Avoid combination. If required, monitor methotrexate levels and renal function.",
        "evidence": {
            "sourceName": "Drug Interaction Database",
            "sourceUrl": "https://reference.medscape.com",
            "evidenceTier": 2,
            "confidenceScore": 88
        },
        "created_at": datetime.utcnow().isoformat()
    },
    {
        "med_a": "Amlodipine",
        "med_b": "Simvastatin",
        "severity": "Moderate",
        "description": "Amlodipine increases simvastatin levels via CYP3A4 inhibition.",
        "recommendation": "Limit simvastatin to 20mg daily when used with amlodipine.",
        "evidence": {
            "sourceName": "FDA Drug Safety Communication",
            "sourceUrl": "https://fda.gov",
            "evidenceTier": 1,
            "confidenceScore": 90
        },
        "created_at": datetime.utcnow().isoformat()
    },
    {
        "med_a": "Azithromycin",
        "med_b": "Warfarin",
        "severity": "Moderate",
        "description": "Macrolides may increase warfarin effect.",
        "recommendation": "Monitor INR when starting or stopping azithromycin.",
        "evidence": {
            "sourceName": "Drug Interaction Database",
            "sourceUrl": "https://reference.medscape.com",
            "evidenceTier": 2,
            "confidenceScore": 85
        },
        "created_at": datetime.utcnow().isoformat()
    },
    {
        "med_a": "Omeprazole",
        "med_b": "Clopidogrel",
        "severity": "Major",
        "description": "PPIs reduce clopidogrel activation via CYP2C19 inhibition.",
        "recommendation": "Consider alternative PPI (pantoprazole) or H2 blocker if antiplatelet therapy critical.",
        "evidence": {
            "sourceName": "FDA Drug Safety Communication",
            "sourceUrl": "https://fda.gov",
            "evidenceTier": 1,
            "confidenceScore": 95
        },
        "created_at": datetime.utcnow().isoformat()
    },
]


async def seed_database():
    """Seed all collections with sample data."""
    client = AsyncIOMotorClient(MONGODB_URL)
    db = client[DATABASE_NAME]

    print("Starting database seeding...")

    # Seed medications
    med_count = 0
    for med in SAMPLE_MEDICATIONS:
        existing = await db["medications"].find_one({"id": med["id"]})
        if not existing:
            await db["medications"].insert_one(med)
            med_count += 1
    print(f"Seeded {med_count} medications")

    # Seed interactions
    inter_count = 0
    for inter in SAMPLE_INTERACTIONS:
        existing = await db["interactions"].find_one({
            "med_a": inter["med_a"],
            "med_b": inter["med_b"]
        })
        if not existing:
            await db["interactions"].insert_one(inter)
            inter_count += 1
    print(f"Seeded {inter_count} interactions")

    # Seed admin user (handled by startup event)
    print("Database seeding complete!")
    client.close()


if __name__ == "__main__":
    asyncio.run(seed_database())